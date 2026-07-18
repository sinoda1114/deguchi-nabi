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
    destinationHint: string | null = null
  ): Promise<StationFacility[]> {
    const fixtureFacilities = await this.fixture.getFacilities(stationId);
    if (fixtureFacilities.length > 0) return fixtureFacilities;

    const cache = readCollection<FacilitiesCacheEntry>(FACILITIES_CACHE);
    const cached = cache.find(
      (c) => c.stationId === stationId && (c.destinationHint ?? null) === destinationHint
    );
    if (cached) return cached.facilities;

    const station = await this.getStation(stationId);
    if (!station) return [];

    // 未認証・レート制限なしの/api/routes/searchから呼ばれうるが、getFacilities自体は
    // 駅ごとに初回のみ課金が発生する設計(このFACILITIES_CACHEにヒットすれば以降は
    // AI呼び出し自体を行わない)。Search Grounding化で1回あたりの呼び出しコスト
    // (検索+抽出の2段)が増えても、駅単位でのキャッシュにより繰り返し攻撃のコストは
    // 既に抑制されているため、canGenerateNarrativeのような追加の同時実行ガードは
    // 不要と判断する(同一リクエスト内でfacilities/boarding/narrativeが重なる懸念は
    // narrative側がisRouteAiGeneratedで既に遮断しているため、facilities自体を
    // 追加で止める理由は薄い)。
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
      writeCollection(FACILITIES_CACHE, [
        ...cache,
        { stationId, destinationHint, facilities: withStationId },
      ]);
    } catch {
      // キャッシュ保存は最適化にすぎないため、失敗しても生成結果は返す。
    }

    return withStationId;
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
