import type { StationProviderPort } from "./StationProviderPort";
import { FixtureStationAdapter } from "./FixtureStationAdapter";
import {
  generateBoardingPosition,
  generateStationFacilities,
  isPlainArrivalPlatformLabel,
} from "./ai-generation";
import { generateArrivalNarrativeSteps } from "./arrival-guide-ai-generation";
import {
  decodeHeartRailsStationId,
  fetchNearestStationsFromHeartRails,
  searchStationsFromHeartRails,
} from "./heartrails";
import { readCollection, writeCollection } from "@/lib/store/json-file-store";
import { FIXTURE_PLATFORMS } from "@/lib/fixtures/stations";
import type {
  BoardingPosition,
  Coordinates,
  Platform,
  Station,
  StationFacility,
} from "@/lib/domain/station";
import type { GuideStep } from "@/lib/domain/route";

const FACILITIES_CACHE = "ai-station-facilities";
const BOARDING_CACHE = "ai-boarding-positions";
const NEARBY_STATION_CACHE = "nearby-stations";
const ARRIVAL_GUIDE_CACHE = "ai-arrival-guide-steps";

interface ArrivalGuideCacheEntry {
  key: string;
  steps: GuideStep[];
}

/**
 * 改札後導線AI生成のキャッシュキー。同じ駅の同じ改札→出口の組み合わせで
 * 再生成(検索グラウンディングは最大55秒かかる)を避けるため。
 */
function arrivalGuideCacheKey(stationId: string, gateName: string, exitName: string): string {
  return `${stationId}__${gateName}__${exitName}`;
}
// 短い部分一致クエリ(例: "中央")で全国から大量ヒットしうるため、
// レスポンス・キャッシュ肥大化を防ぐ上限。1文字駅名も存在するため
// 文字数制限ではなく件数制限で絞る。
const MAX_SEARCH_RESULTS = 20;
/**
 * 同一駅に対して保持するdestinationHint付きFacilitiesCacheEntryの上限件数。
 * 未認証・レート制限なしの/api/routes/searchから、同一駅周辺の異なる実在施設名を
 * 目的地に指定し続けられれば、destinationHintをキャッシュキーに含めたことで
 * 新規キャッシュキー(=課金対象のAI呼び出し)が際限なく生成されうる懸念への緩和策
 * (/ai-review指摘、High)。上限を超えたら作成順で最も古いエントリを削除する。
 */
const MAX_DESTINATION_HINT_ENTRIES_PER_STATION = 5;
/**
 * destinationHint付きの新規AI生成(課金対象)を許容する時間窓とその上限回数。
 * LRU上限(保存件数)だけでは、攻撃者が毎回異なる実在施設名を巡回指定する
 * ことで呼び出し頻度自体は無制限のままになる懸念に対応する
 * (/security-review指摘: 「保存件数の上限であって呼び出し頻度の上限では
 * ない」)。サーバーレス環境ではインスタンスがプロセス間で共有されないため
 * 完全な防御にはならないが、単一インスタンスが温まっている間の連続呼び出し
 * は抑制できる(真のレート制限=IP/セッション単位の呼び出し回数制限は
 * 別途必要、issue化して追跡)。
 */
const DESTINATION_HINT_RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_DESTINATION_HINT_GENERATIONS_PER_WINDOW = 10;

interface FacilitiesCacheEntry {
  stationId: string;
  /**
   * 目的地施設名(place由来の目的地のみ、駅そのものが目的地の場合はnull)。
   * 同じ駅でも目的地によって推奨される改札・出口が変わりうるため、
   * stationIdとの複合キーでキャッシュを分ける。既存のキャッシュエントリ
   * (このフィールド追加前に書き込まれたもの)にはこのフィールドが存在しない
   * が、読み込み時に`?? null`で補完するため後方互換性は保たれる
   * (destinationHintを指定しない=駅目的地の検索には引き続きヒットする)。
   */
  destinationHint: string | null;
  facilities: StationFacility[];
}

interface BoardingCacheEntry {
  key: string;
  boardingPosition: BoardingPosition;
}

/**
 * fixture platform に一致しない区間(fixture未収録駅を含むAI生成ルート等)向けの
 * キャッシュキー。実在の platformId(pf_...)と衝突しないよう区切り文字で分離する。
 */
function lineBoardingCacheKey(stationId: string, line: string, direction: string): string {
  return `line__${stationId}__${line}__${direction}`;
}

interface NearbyStationCacheEntry {
  station: Station;
}

/**
 * FixtureStationAdapter を優先しつつ、fixture に無い駅の改札・出口・号車情報は
 * Gemini で下書き生成して confidence: low として補う複合アダプター。
 * 生成結果はローカルJSONにキャッシュし、同じ駅への再生成を避ける。
 *
 * キャッシュ書き込みが失敗しても(例: 読み取り専用ファイルシステムの本番環境)、
 * 生成結果自体は返す。キャッシュは最適化であり必須要件ではないため。
 * 生成に失敗した(空/null)結果はキャッシュしない — 一時的なAPI障害を
 * 恒久的な「情報なし」として固定してしまうのを防ぐため。
 */
export class CompositeStationAdapter implements StationProviderPort {
  private readonly fixture = new FixtureStationAdapter();
  /**
   * HeartRails再照会結果(getStationのlines復元)のインメモリメモ化。
   * このアダプター自体がintegrations/index.tsでモジュール単位のシングルトンとして
   * 生成されるため、1リクエスト内の区間数分だけでなく、同一プロセスが複数
   * リクエストを処理する間(warm起動)も再利用される。stationIdごとにPromiseを
   * 即座に格納するため、並行呼び出し(同一駅の改札取得とboarding position取得が
   * 同時に走る場合等)でも再照会が重複しない。issue #59(本番でファイルキャッシュが
   * 機能しない問題)の恒久対応(DB化)までの緩和策。
   */
  private readonly heartRailsStationCache = new Map<string, Promise<Station | null>>();
  /**
   * destinationHint付きの新規AI生成の発生タイムスタンプ(プロセス内簡易
   * レートリミッタ)。getFacilities参照。
   */
  private recentDestinationHintGenerationTimestamps: number[] = [];

  constructor(private readonly geminiApiKey: string) {}

  async searchStations(query: string): Promise<Station[]> {
    // fixture(即時)とHeartRails(外部API、最大5秒)を並列に問い合わせる。
    // 直列にすると fixture がヒットする検索(西谷・渋谷・新宿)まで毎回
    // 外部APIの応答を待つ羽目になり、HeartRails側の遅延・障害が
    // 既存機能のレイテンシに波及してしまうため。
    const [fixtureMatches, fromApi] = await Promise.all([
      this.fixture.searchStations(query),
      searchStationsFromHeartRails(query),
    ]);
    if (!fromApi || fromApi.length === 0) return fixtureMatches;

    const fixtureIds = new Set(fixtureMatches.map((s) => s.stationId));
    const additional = fromApi
      .filter((s) => !fixtureIds.has(s.stationId))
      .slice(0, MAX_SEARCH_RESULTS);

    this.cacheNearbyStations(additional);

    return [...fixtureMatches, ...additional];
  }

  async getStation(stationId: string): Promise<Station | null> {
    const fixtureStation = await this.fixture.getStation(stationId);
    if (fixtureStation) return fixtureStation;

    const cache = readCollection<NearbyStationCacheEntry>(NEARBY_STATION_CACHE);
    const cached = cache.find((c) => c.station.stationId === stationId)?.station;
    if (cached) return cached;

    // キャッシュ書き込みが失敗していても(読み取り専用ファイルシステム等)、
    // HeartRails由来のstationIdには駅名・座標が自己完結的に埋め込まれているため
    // ここで復元できる(路線名等は失われるが、駅の存在自体は解決できる)。
    const decoded = decodeHeartRailsStationId(stationId);
    if (!decoded) return null;

    // decodeだけではlines(乗り入れ路線)が復元できず、本番(Vercel等の読み取り
    // 専用ファイルシステム)ではnearby-stationsキャッシュが常に効かないため、
    // 事実上毎回lines空の状態になってしまう。lines空はgenerateStationFacilities
    // への検索プロンプトを劣化させる(「◯◯駅()の主要な改札名・出口名...」)ため、
    // HeartRailsへ再照会してlinesを復元する(operatorはHeartRails自体が
    // 提供しないため再照会しても常に空文字のまま。heartrails.ts参照)。
    // 再照会が失敗しても、decodeの結果(路線情報なし)を返せば従来通り動作するため、
    // 従来より悪化することはない。同一stationIdへの重複再照会を避けるため、
    // Promise自体をheartRailsStationCacheに即座に格納してメモ化する
    // (1経路の区間数分・同時呼び出し分の重複APIコールを防ぐ)。
    const memoized = this.heartRailsStationCache.get(stationId);
    if (memoized) return memoized;

    const refetchPromise = this.refetchStationFromHeartRails(stationId, decoded);
    this.heartRailsStationCache.set(stationId, refetchPromise);
    return refetchPromise;
  }

  private async refetchStationFromHeartRails(
    stationId: string,
    decoded: Station
  ): Promise<Station | null> {
    const refetched = await fetchNearestStationsFromHeartRails(
      decoded.latitude,
      decoded.longitude
    );
    const matched = refetched?.find((s) => s.stationId === stationId);

    return matched ?? decoded;
  }

  getPlatforms(stationId: string) {
    // Step B(駅マスタの全国対応)までは Platform 自体も fixture 収録分のみのため、
    // HeartRails由来の駅は号車情報「確認できません」として扱われる(route-search.ts側)。
    return this.fixture.getPlatforms(stationId);
  }

  async nearestStations(
    latitude: number,
    longitude: number,
    limit: number
  ): Promise<Station[]> {
    const fromApi = await fetchNearestStationsFromHeartRails(latitude, longitude);
    if (!fromApi || fromApi.length === 0) {
      return this.fixture.nearestStations(latitude, longitude, limit);
    }

    const limited = fromApi.slice(0, limit);
    this.cacheNearbyStations(limited);

    return limited;
  }

  /**
   * HeartRails由来の駅を後から getStation() で解決できるようローカルJSONに
   * キャッシュする(nearestStations・searchStations共通)。
   * readCollection/writeCollection は同期I/Oのため呼び出し中は検索結果の
   * 返却をブロックする(既存のnearestStationsと同じ設計を踏襲)。
   * 書き込みが失敗しても(読み取り専用ファイルシステム等)例外は握りつぶし、
   * 検索結果自体は返す — キャッシュは最適化であり必須要件ではないため。
   */
  private cacheNearbyStations(stations: Station[]): void {
    if (stations.length === 0) return;
    try {
      const cache = readCollection<NearbyStationCacheEntry>(NEARBY_STATION_CACHE);
      const existingIds = new Set(cache.map((c) => c.station.stationId));
      const toAdd = stations
        .filter((s) => !existingIds.has(s.stationId))
        .map((station) => ({ station }));
      if (toAdd.length > 0) {
        writeCollection(NEARBY_STATION_CACHE, [...cache, ...toAdd]);
      }
    } catch {
      // キャッシュ保存は最適化にすぎないため、失敗しても検索結果自体は返す。
    }
  }

  async getFacilities(
    stationId: string,
    rawDestinationHint: string | null = null
  ): Promise<StationFacility[]> {
    const fixtureFacilities = await this.fixture.getFacilities(stationId);
    if (fixtureFacilities.length > 0) return fixtureFacilities;

    const cache = readCollection<FacilitiesCacheEntry>(FACILITIES_CACHE);
    const cached = cache.find(
      (c) => c.stationId === stationId && (c.destinationHint ?? null) === rawDestinationHint
    );
    if (cached) return cached.facilities;

    const station = await this.getStation(stationId);
    if (!station) return [];

    // 未認証・レート制限なしの/api/routes/searchから呼ばれうるが、getFacilities自体は
    // 駅+目的地の組み合わせごとに初回のみ課金が発生する設計(このFACILITIES_CACHEに
    // ヒットすれば以降はAI呼び出し自体を行わない)。ただしdestinationHintを
    // キャッシュキーに含めたことで、同一駅でも異なる実在施設名を指定し続けられれば
    // 新規キャッシュキーが際限なく生成されうる(/ai-review指摘、High)。
    // MAX_DESTINATION_HINT_ENTRIES_PER_STATIONで駅ごとのdestinationHint付き
    // エントリ数に上限を設け、古いものから削除することで無制限の肥大化・課金誘発を
    // 緩和する(destinationHint無し=駅自体が目的地のエントリは対象外。1駅につき
    // 高々1件で、目的地情報を伴う攻撃面ではないため)。
    //
    // ただしエントリ数の上限だけでは「呼び出し頻度」自体は制限できない
    // (異なる実在施設名を巡回指定されれば毎回キャッシュミス→新規AI呼び出しが
    // 発生しうる。/security-review指摘)。直近の時間窓内で新規生成回数が
    // 上限に達している場合、destinationHintを無視して駅全体検索(従来の
    // 挙動)にフォールバックすることで、destinationHint付きの(=より高コストな)
    // 生成が再開されるタイミングを遅らせる。フォールバック後のnull生成も
    // カウント対象に含める(下記rawDestinationHint判定)のは、そうしないと
    // destinationHint付きで呼び続けるだけでレート制限カウンタが時間経過とともに
    // 空になり、destinationHint付き生成がすぐ復活してしまうため(/ai-review指摘、High)。
    //
    // 正直な限界: このレートリミッタはdestinationHint付き生成の頻度しか
    // 制限しない。フォールバック後の駅全体検索(destinationHint=null)自体は
    // 依然として毎回呼び出される(ここでは止めていない)。本番ではIssue #59
    // (ファイルキャッシュが読み取り専用ファイルシステムで機能しない)が
    // 未解決のため、nullキャッシュも定着せず、フォールバック生成の総呼び出し
    // 回数には現状上限がない。IP/セッション単位の真のレート制限機構は
    // 別途Issue化して追跡する。
    const destinationHint =
      rawDestinationHint !== null && this.isDestinationHintRateLimited()
        ? null
        : rawDestinationHint;

    if (destinationHint !== rawDestinationHint) {
      const fallbackCached = cache.find(
        (c) => c.stationId === stationId && (c.destinationHint ?? null) === destinationHint
      );
      if (fallbackCached) return fallbackCached.facilities;
    }

    // rawDestinationHintがnull以外なら(フォールバックでnullに正規化された
    // 場合を含め)必ずカウントする。フォールバック生成を対象外にすると、
    // destinationHint付きで呼び続けるだけでレート制限カウンタがすぐ空になり、
    // destinationHint付き生成がすぐ復活してしまう(/ai-review指摘、High)。
    // 配列サイズは直近MAX件だけ保持すれば判定に十分なため、上限を超えた分は
    // 古い方から捨てる(高頻度フラッド時に配列が無制限に肥大化するのを防ぐ。
    // /ai-review指摘、Medium)。
    if (rawDestinationHint !== null) {
      this.recentDestinationHintGenerationTimestamps.push(Date.now());
      if (
        this.recentDestinationHintGenerationTimestamps.length >
        MAX_DESTINATION_HINT_GENERATIONS_PER_WINDOW
      ) {
        this.recentDestinationHintGenerationTimestamps =
          this.recentDestinationHintGenerationTimestamps.slice(
            -MAX_DESTINATION_HINT_GENERATIONS_PER_WINDOW
          );
      }
    }

    const generated = await generateStationFacilities(
      this.geminiApiKey,
      station.stationName,
      station.operator,
      station.lines,
      { lat: station.latitude, lng: station.longitude },
      destinationHint
    );
    if (generated.length === 0) return [];

    const withStationId = generated.map((f) => ({ ...f, stationId }));

    try {
      const cacheAfterEviction = this.evictOldestDestinationHintEntryIfNeeded(
        cache,
        stationId,
        destinationHint
      );
      writeCollection(FACILITIES_CACHE, [
        ...cacheAfterEviction,
        { stationId, destinationHint, facilities: withStationId },
      ]);
    } catch {
      // キャッシュ保存は最適化にすぎないため、失敗しても生成結果は返す。
    }

    return withStationId;
  }

  /**
   * 直近の時間窓内でdestinationHint付きの新規AI生成が上限回数に達しているか
   * 判定する(プロセス内簡易レートリミッタ)。判定と同時に時間窓外の古い
   * タイムスタンプを掃除する。
   */
  private isDestinationHintRateLimited(): boolean {
    const now = Date.now();
    this.recentDestinationHintGenerationTimestamps =
      this.recentDestinationHintGenerationTimestamps.filter(
        (t) => now - t < DESTINATION_HINT_RATE_LIMIT_WINDOW_MS
      );
    return (
      this.recentDestinationHintGenerationTimestamps.length >=
      MAX_DESTINATION_HINT_GENERATIONS_PER_WINDOW
    );
  }

  /**
   * 同一駅のdestinationHint付きエントリが上限に達している場合、作成順で最も
   * 古い1件を除いたキャッシュ配列を返す(evict)。上限未満の場合やdestinationHint
   * がnull(駅自体が目的地)の場合はそのまま返す。
   */
  private evictOldestDestinationHintEntryIfNeeded(
    cache: FacilitiesCacheEntry[],
    stationId: string,
    destinationHint: string | null
  ): FacilitiesCacheEntry[] {
    if (destinationHint === null) return cache;

    const oldestIndex = cache.findIndex(
      (c) => c.stationId === stationId && c.destinationHint !== null
    );
    const entryCount = cache.filter(
      (c) => c.stationId === stationId && c.destinationHint !== null
    ).length;
    if (entryCount < MAX_DESTINATION_HINT_ENTRIES_PER_STATION || oldestIndex === -1) {
      return cache;
    }

    return cache.filter((_, i) => i !== oldestIndex);
  }

  async getBoardingPosition(
    stationId: string,
    stationName: string,
    platformId: string,
    line: string,
    direction: string
  ): Promise<BoardingPosition | null> {
    // fixture platform に一致する場合はまず fixture の号車情報を試す
    // (西谷→渋谷のような検証済みデータを優先するため)。
    // stationId が一致しない platformId(呼び出し元の不整合なデータ)は
    // 別駅の号車情報を誤って返さないよう、fixture一致として扱わない。
    const fixturePlatform = platformId ? this.findPlatform(platformId) : null;
    const verifiedFixturePlatform =
      fixturePlatform && fixturePlatform.stationId === stationId ? fixturePlatform : null;
    if (verifiedFixturePlatform) {
      const fixturePositions = await this.fixture.getBoardingPositions(platformId);
      if (fixturePositions.length > 0) return fixturePositions[0];
    }

    // fixture platform が無い区間(fixture未収録駅を含むAI生成ルート等)は
    // platformId に依存せず stationId+line+direction でAI下書き生成にフォールバックする。
    // fixture platform 自体は一致しているが号車データが無いケース(新宿→渋谷等)は、
    // 呼び出し元の line/direction ではなく fixture 側の正規値を使う
    // (キャッシュキーが platformId 固定のため、不整合な値でキャッシュを汚染しないため)。
    const effectiveLine = verifiedFixturePlatform ? verifiedFixturePlatform.lineId : line;
    const effectiveDirection = verifiedFixturePlatform
      ? verifiedFixturePlatform.direction
      : direction;
    const cacheKey = verifiedFixturePlatform
      ? platformId
      : lineBoardingCacheKey(stationId, line, direction);

    const cache = readCollection<BoardingCacheEntry>(BOARDING_CACHE);
    const cached = cache.find((c) => c.key === cacheKey);
    if (cached) return cached.boardingPosition;

    // 到着番線が判明していれば号車推定へ引き渡す。fixture platformが検証済みなら
    // その正規のplatformNumberを使い(最も確実)、そうでない場合はgenerateRailRoute
    // (ai-route-generation.ts)が検索で確認できた到着番線ラベルをplatformId経由で
    // 引き継ぐ。ただし"pf_"接頭辞のfixture platformId文字列(別駅のplatformIdが
    // 誤って渡された場合等)は番線ラベルとして扱わない(isPlainArrivalPlatformLabel参照)。
    // 取れない場合はnullのまま(無理に埋めない原則を維持)。
    const arrivalPlatformNumber = verifiedFixturePlatform
      ? verifiedFixturePlatform.platformNumber
      : isPlainArrivalPlatformLabel(platformId)
        ? platformId
        : null;

    const generated = await generateBoardingPosition(
      this.geminiApiKey,
      stationName,
      effectiveLine,
      effectiveDirection,
      cacheKey,
      arrivalPlatformNumber
    );
    if (!generated) return null;

    try {
      writeCollection(BOARDING_CACHE, [...cache, { key: cacheKey, boardingPosition: generated }]);
    } catch {
      // キャッシュ保存は最適化にすぎないため、失敗しても生成結果は返す。
    }

    return generated;
  }

  async getArrivalGuideNarrativeSteps(
    stationId: string,
    stationName: string,
    gateName: string,
    exitName: string,
    arrivalStationCoordinates: Coordinates | null = null
  ): Promise<GuideStep[]> {
    const cacheKey = arrivalGuideCacheKey(stationId, gateName, exitName);
    const cache = readCollection<ArrivalGuideCacheEntry>(ARRIVAL_GUIDE_CACHE);
    const cached = cache.find((c) => c.key === cacheKey);
    if (cached) return cached.steps;

    const generated = await generateArrivalNarrativeSteps(
      this.geminiApiKey,
      stationName,
      gateName,
      exitName,
      arrivalStationCoordinates
    );
    // 生成結果が空の場合はキャッシュしない(一時的なAPI障害を恒久的な
    // 「情報なし」として固定してしまうのを防ぐ。既存のfacilities/boarding
    // キャッシュと同じ方針)。
    if (generated.length === 0) return [];

    try {
      writeCollection(ARRIVAL_GUIDE_CACHE, [...cache, { key: cacheKey, steps: generated }]);
    } catch {
      // キャッシュ保存は最適化にすぎないため、失敗しても生成結果は返す。
    }

    return generated;
  }

  private findPlatform(platformId: string): Platform | null {
    // Step B(駅マスタの全国対応)までは Platform 自体も fixture 収録分のみのため、
    // fixture データを直接参照する。全国対応時は駅マスタ由来の索引に置き換える。
    return FIXTURE_PLATFORMS.find((p) => p.platformId === platformId) ?? null;
  }
}
