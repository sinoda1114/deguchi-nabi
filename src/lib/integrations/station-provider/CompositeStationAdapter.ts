import type { StationProviderPort } from "./StationProviderPort";
import { FixtureStationAdapter } from "./FixtureStationAdapter";
import { generateBoardingPosition, isPlainArrivalPlatformLabel } from "./ai-generation";
import { generateStationFacilitiesDispatch } from "./facilities-generation";
import { generateArrivalNarrativeSteps } from "./arrival-guide-ai-generation";
import {
  decodeHeartRailsStationId,
  fetchNearestStationsFromHeartRails,
  searchStationsFromHeartRails,
} from "./heartrails";
import { getKvCacheStore } from "@/lib/store/kv-cache-store";
import type { KvCacheStore } from "@/lib/store/kv-cache-store";
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

/** facilities/boarding/arrival-guide キャッシュのTTL(日数)。 */
const AI_CACHE_TTL_DAYS = 90;

/**
 * 改札後導線AI生成のキャッシュキー。同じ駅の同じ改札→出口の組み合わせで
 * 再生成(検索グラウンディングは最大55秒かかる)を避けるため。
 * stationIdが先頭にあるため、将来の駅単位無効化はこのprefix(`${stationId}__`)
 * で一発にできる。
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

/**
 * facilities キャッシュのキー。destinationHint 無し(駅そのものが目的地)は
 * stationId単独、destinationHint 有りは `${stationId}::h::` を接頭辞に持つ。
 * stationId が常に先頭にあるため、駅単位の件数カウント・LRU削除は
 * このprefixに対する countByKeyPrefix/deleteOldestByKeyPrefix で行える。
 */
function facilitiesCacheKey(stationId: string, destinationHint: string | null): string {
  return destinationHint === null
    ? stationId
    : `${facilitiesHintPrefix(stationId)}${encodeURIComponent(destinationHint)}`;
}

function facilitiesHintPrefix(stationId: string): string {
  return `${stationId}::h::`;
}

/**
 * fixture platform に一致する区間(実在の platformId)向けの boarding キャッシュキー。
 * stationId を先頭に付けることで、実在の platformId(pf_...)自体が別駅の
 * ものと衝突しても駅単位で区別できる。
 */
function fixtureBoardingCacheKey(stationId: string, platformId: string): string {
  return `${stationId}::pf::${platformId}`;
}

/**
 * fixture platform に一致しない区間(fixture未収録駅を含むAI生成ルート等)向けの
 * キャッシュキー。実在の platformId(pf_...)と衝突しないよう区切り文字で分離する。
 */
function lineBoardingCacheKey(stationId: string, line: string, direction: string): string {
  return `${stationId}::line::${line}::${direction}`;
}

/**
 * FixtureStationAdapter を優先しつつ、fixture に無い駅の改札・出口・号車情報は
 * Gemini で下書き生成して confidence: low として補う複合アダプター。
 * 生成結果は KvCacheStore(Turso本番・ローカルJSONフォールバック)にキャッシュし、
 * 同じ駅への再生成を避ける。
 *
 * キャッシュの読み書きが失敗しても(例: 読み取り専用ファイルシステムの本番環境)、
 * KvCacheStore自身が例外を握りつぶし生成結果を返せる設計になっているため、
 * このクラス側でtry/catchする必要はない。キャッシュは最適化であり必須要件ではない
 * という方針は変わらない。生成に失敗した(空/null)結果はキャッシュしない —
 * 一時的なAPI障害を恒久的な「情報なし」として固定してしまうのを防ぐため。
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

    await this.cacheNearbyStations(additional);

    return [...fixtureMatches, ...additional];
  }

  async getStation(stationId: string): Promise<Station | null> {
    const fixtureStation = await this.fixture.getStation(stationId);
    if (fixtureStation) return fixtureStation;

    const cachedEntry = await getKvCacheStore().get<Station>(NEARBY_STATION_CACHE, stationId);
    if (cachedEntry) return cachedEntry.value;

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
    await this.cacheNearbyStations(limited);

    return limited;
  }

  /**
   * HeartRails由来の駅を後から getStation() で解決できるようKvCacheStoreに
   * キャッシュする(nearestStations・searchStations共通)。stationId自体を
   * キーにするため、同一駅の再キャッシュは自然に上書き(重複排除)される。
   * 書き込みが失敗しても(読み取り専用ファイルシステム等)、KvCacheStore自身が
   * 例外を握りつぶすため検索結果自体は返せる — キャッシュは最適化であり
   * 必須要件ではないため。呼び出し元(searchStations/nearestStations)は
   * これをawaitすることで、直後のgetStation()呼び出しが確実にキャッシュを
   * 参照できるようにする。
   */
  private async cacheNearbyStations(stations: Station[]): Promise<void> {
    if (stations.length === 0) return;
    const store = getKvCacheStore();
    await Promise.all(
      stations.map((station) =>
        store.set(NEARBY_STATION_CACHE, station.stationId, station, { ttlDays: null })
      )
    );
  }

  async getFacilities(
    stationId: string,
    rawDestinationHint: string | null = null
  ): Promise<StationFacility[]> {
    const fixtureFacilities = await this.fixture.getFacilities(stationId);
    if (fixtureFacilities.length > 0) return fixtureFacilities;

    const store = getKvCacheStore();
    const cached = await store.get<StationFacility[]>(
      FACILITIES_CACHE,
      facilitiesCacheKey(stationId, rawDestinationHint)
    );
    if (cached) return cached.value;

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
      const fallbackCached = await store.get<StationFacility[]>(
        FACILITIES_CACHE,
        facilitiesCacheKey(stationId, destinationHint)
      );
      if (fallbackCached) return fallbackCached.value;
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

    const generated = await generateStationFacilitiesDispatch(
      this.geminiApiKey,
      station.stationName,
      station.operator,
      station.lines,
      { lat: station.latitude, lng: station.longitude },
      destinationHint
    );
    if (generated.length === 0) return [];

    const withStationId = generated.map((f) => ({ ...f, stationId }));

    await this.evictOldestDestinationHintEntryIfNeeded(store, stationId, destinationHint);
    await store.set(
      FACILITIES_CACHE,
      facilitiesCacheKey(stationId, destinationHint),
      withStationId,
      { ttlDays: AI_CACHE_TTL_DAYS }
    );

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
   * 古い1件をKvCacheStoreから削除する(evict)。上限未満の場合やdestinationHint
   * がnull(駅自体が目的地)の場合は何もしない。destinationHint付きエントリは
   * すべて`${stationId}::h::`を接頭辞に持つため、countByKeyPrefix/
   * deleteOldestByKeyPrefixで駅単位に絞り込める。
   *
   * 正直な限界: count→deleteOldest→setは3つの別個の非同期操作で、原子的
   * (トランザクション)ではない(/ai-review指摘、Medium)。同一駅への異なる
   * destinationHintを持つリクエストが同時に到達すると、両者が同じ件数を
   * 読んで削除判断するため、上限を若干超過することがありうる(旧実装の
   * 同期I/Oでは原理上起きなかった競合が、非同期化により理論上可能になった)。
   * これはベストエフォートの緩和策であり、KvCacheStore側にトランザクション
   * 操作を追加しない限り解消できない。実害は「上限が5件を若干超える」程度
   * (無制限の肥大化ではない)なので、現時点では許容する。
   *
   * 追加の正直な限界: countByKeyPrefixはストア読み取りエラー時も例外を
   * 投げず0を返す設計(PR1で確定、KvCacheStore全実装共通の方針)。そのため
   * 「真に0件」と「エラーでたまたま0が返った」を呼び出し元は区別できない
   * (Cursor Bugbotの自動生成PRでの指摘)。下の条件はentryCount===0でも
   * deleteOldestByKeyPrefixを試みる(0を除外しない)ことでこれを緩和する:
   * 対象行が実際に無ければdeleteOldestByKeyPrefixのサブクエリが該当なしで
   * 安全にno-opになり(turso-kv-store.ts参照)、新規駅への初回
   * destinationHint登録という正常系への実害は「無駄なDELETEクエリ1回」の
   * みで、かつこのケースはeviction後は件数が0に戻らない設計上、駅ごとに
   * 生涯で最大1回しか発生しない。一方、読み取りが一時的なエラーで0を返し
   * 実際は上限に達していた場合、この呼び出しが最古の1件を削除でき上限
   * 超過を緩和できる可能性がある(読み取りと書き込みは別クエリのため、
   * 読み取り失敗が書き込み失敗を必ずしも意味しない)。読み取りと削除の
   * 両方が同じ原因で失敗する場合は緩和されないが、それでも「0を除外して
   * 常にスキップする」よりは安全側に倒れる。根本解決(エラーと真の0件を
   * 区別できるAPIへの変更)はKvCacheStoreインターフェースの見直しを伴う
   * ためこのPRのスコープを超え、現状はこのベストエフォート緩和で許容する。
   */
  private async evictOldestDestinationHintEntryIfNeeded(
    store: KvCacheStore,
    stationId: string,
    destinationHint: string | null
  ): Promise<void> {
    if (destinationHint === null) return;

    const prefix = facilitiesHintPrefix(stationId);
    const entryCount = await store.countByKeyPrefix(FACILITIES_CACHE, prefix);
    if (entryCount > 0 && entryCount < MAX_DESTINATION_HINT_ENTRIES_PER_STATION) return;

    await store.deleteOldestByKeyPrefix(FACILITIES_CACHE, prefix);
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
      ? fixtureBoardingCacheKey(stationId, platformId)
      : lineBoardingCacheKey(stationId, line, direction);

    const store = getKvCacheStore();
    const cached = await store.get<BoardingPosition>(BOARDING_CACHE, cacheKey);
    if (cached) return cached.value;

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

    await store.set(BOARDING_CACHE, cacheKey, generated, { ttlDays: AI_CACHE_TTL_DAYS });

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
    const store = getKvCacheStore();
    const cached = await store.get<GuideStep[]>(ARRIVAL_GUIDE_CACHE, cacheKey);
    if (cached) return cached.value;

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

    await store.set(ARRIVAL_GUIDE_CACHE, cacheKey, generated, { ttlDays: AI_CACHE_TTL_DAYS });

    return generated;
  }

  private findPlatform(platformId: string): Platform | null {
    // Step B(駅マスタの全国対応)までは Platform 自体も fixture 収録分のみのため、
    // fixture データを直接参照する。全国対応時は駅マスタ由来の索引に置き換える。
    return FIXTURE_PLATFORMS.find((p) => p.platformId === platformId) ?? null;
  }
}
