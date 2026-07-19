import type { StationProviderPort } from "./StationProviderPort";
import { FixtureStationAdapter } from "./FixtureStationAdapter";
import { generateBoardingPosition, isPlainArrivalPlatformLabel } from "./ai-generation";
import { generateStationFacilitiesDispatch } from "./facilities-generation";
import { generateArrivalNarrativeSteps } from "./arrival-guide-ai-generation";
import { generateUnifiedArrivalGuide } from "./unified-arrival-guide-generation";
import { groundedAiConfidence } from "./ai-generation";
import {
  decodeHeartRailsStationId,
  fetchNearestStationsFromHeartRails,
  searchStationsFromHeartRails,
} from "./heartrails";
import { getKvCacheStore } from "@/lib/store/kv-cache-store";
import { FIXTURE_PLATFORMS } from "@/lib/fixtures/stations";
import type {
  BoardingPosition,
  Coordinates,
  Platform,
  Station,
  StationFacility,
} from "@/lib/domain/station";
import type { GuideStep, UnifiedArrivalGuide } from "@/lib/domain/route";

const NEARBY_STATION_CACHE = "nearby-stations";

// 短い部分一致クエリ(例: "中央")で全国から大量ヒットしうるため、
// レスポンス肥大化を防ぐ上限。1文字駅名も存在するため
// 文字数制限ではなく件数制限で絞る。
const MAX_SEARCH_RESULTS = 20;

/**
 * fixture platform に一致する区間(実在の platformId)向けのBoardingPosition.platformId値。
 * stationId を先頭に付けることで、実在の platformId(pf_...)自体が別駅の
 * ものと衝突しても駅単位で区別できる。
 */
function fixtureBoardingPlatformId(stationId: string, platformId: string): string {
  return `${stationId}::pf::${platformId}`;
}

/**
 * fixture platform に一致しない区間(fixture未収録駅を含むAI生成ルート等)向けの
 * BoardingPosition.platformId値。実在の platformId(pf_...)と衝突しないよう
 * 区切り文字で分離する。
 */
function lineBoardingPlatformId(stationId: string, line: string, direction: string): string {
  return `${stationId}::line::${line}::${direction}`;
}

/**
 * FixtureStationAdapter を優先しつつ、fixture に無い駅の改札・出口・号車情報は
 * Gemini で下書き生成して confidence: low として補う複合アダプター。
 *
 * AI生成結果(facilities/boarding/arrival-guide)は永続キャッシュしない
 * (council議論2026-07-20: 検索を伴うAI生成は実行ごとに号車・改札名の
 * 表現が揺れうる性質であり、初回生成結果を90日間固定するTTLキャッシュの
 * 設計自体がこの揺れと相性が悪いと判断。IPレートリミット(PR4)が既に
 * 未認証課金エンドポイントの濫用を防いでいるため、駅単位のキャッシュ・
 * LRU・レート制限機構は撤去し、毎回アドホックに生成する)。
 * nearby-stations(HeartRails検索結果)はAI生成ではなく外部API結果の
 * キャッシュのため、対象外として維持する。
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
    destinationHint: string | null = null
  ): Promise<StationFacility[]> {
    const fixtureFacilities = await this.fixture.getFacilities(stationId);
    if (fixtureFacilities.length > 0) return fixtureFacilities;

    const station = await this.getStation(stationId);
    if (!station) return [];

    const generated = await generateStationFacilitiesDispatch(
      this.geminiApiKey,
      station.stationName,
      station.operator,
      station.lines,
      { lat: station.latitude, lng: station.longitude },
      destinationHint
    );
    if (generated.length === 0) return [];

    return generated.map((f) => ({ ...f, stationId }));
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
    const boardingPlatformId = verifiedFixturePlatform
      ? fixtureBoardingPlatformId(stationId, platformId)
      : lineBoardingPlatformId(stationId, line, direction);

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

    return generateBoardingPosition(
      this.geminiApiKey,
      stationName,
      effectiveLine,
      effectiveDirection,
      boardingPlatformId,
      arrivalPlatformNumber
    );
  }

  async getArrivalGuideNarrativeSteps(
    _stationId: string,
    stationName: string,
    gateName: string,
    exitName: string,
    arrivalStationCoordinates: Coordinates | null = null
  ): Promise<GuideStep[]> {
    return generateArrivalNarrativeSteps(
      this.geminiApiKey,
      stationName,
      gateName,
      exitName,
      arrivalStationCoordinates
    );
  }

  async getUnifiedArrivalGuide(
    _stationId: string,
    stationName: string,
    operator: string,
    lines: string[],
    originStationName: string,
    destinationHint: string | null,
    stationCoordinates: Coordinates | null,
    destinationPlaceCoordinates: Coordinates | null
  ): Promise<UnifiedArrivalGuide | null> {
    const result = await generateUnifiedArrivalGuide(
      this.geminiApiKey,
      originStationName,
      stationName,
      operator,
      lines,
      destinationHint,
      stationCoordinates,
      destinationPlaceCoordinates
    );
    if (!result) return null;

    return {
      gate: result.gate
        ? { name: result.gate.name, confidence: groundedAiConfidence(result.gate.confidenceLevel) }
        : null,
      exit: result.exit
        ? { name: result.exit.name, confidence: groundedAiConfidence(result.exit.confidenceLevel) }
        : null,
      walkingSteps: result.walkingSteps.map((step) => ({
        type: "public_passage",
        title: step.title,
        instruction: step.instruction,
        landmarks: [],
        confidence: groundedAiConfidence(step.confidenceLevel),
        provenance: "ai_inferred",
      })),
    };
  }

  async getFixtureFacilities(stationId: string): Promise<StationFacility[]> {
    return this.fixture.getFacilities(stationId);
  }

  private findPlatform(platformId: string): Platform | null {
    // Step B(駅マスタの全国対応)までは Platform 自体も fixture 収録分のみのため、
    // fixture データを直接参照する。全国対応時は駅マスタ由来の索引に置き換える。
    return FIXTURE_PLATFORMS.find((p) => p.platformId === platformId) ?? null;
  }
}
