import type { StationProviderPort } from "./StationProviderPort";
import { generateBoardingPosition, isPlainArrivalPlatformLabel } from "./ai-generation";
import { generateStationFacilitiesDispatch } from "./facilities-generation";
import { generateArrivalNarrativeSteps } from "./arrival-guide-ai-generation";
import {
  generateUnifiedArrivalGuide,
  searchDestinationStatedExit,
} from "./unified-arrival-guide-generation";
import { groundedAiConfidence } from "./ai-generation";
import {
  decodeHeartRailsStationId,
  fetchNearestStationsFromHeartRails,
  searchStationsFromHeartRails,
} from "./heartrails";
import { getKvCacheStore } from "@/lib/store/kv-cache-store";
import type {
  BoardingPosition,
  Coordinates,
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
 * 号車位置のキャッシュキー用platformId値。実在の platformId(pf_...)と
 * 衝突しないよう区切り文字で分離する。
 */
function lineBoardingPlatformId(stationId: string, line: string, direction: string): string {
  return `${stationId}::line::${line}::${direction}`;
}

/**
 * 全駅の改札・出口・号車情報をGeminiで生成する(confidence: low〜medium)アダプター。
 *
 * fixture(手動確認済みハードコードデータ)は2026-07-20に廃止した
 * (chore/remove-fixtures)。収録3駅・号車データ西谷発1件のみという中途半端な
 * 収録範囲では「fixtureなら100%確実」という前提自体が既に崩れており、
 * 全駅をAI生成に一本化した方が一貫性がある、というユーザー判断による。
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
export class AiStationAdapter implements StationProviderPort {
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
    const fromApi = await searchStationsFromHeartRails(query);
    if (!fromApi || fromApi.length === 0) return [];

    const limited = fromApi.slice(0, MAX_SEARCH_RESULTS);
    await this.cacheNearbyStations(limited);

    return limited;
  }

  async getStation(stationId: string): Promise<Station | null> {
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

  async getPlatforms(_stationId: string): Promise<never[]> {
    // 番線マスタ(全国対応)は未実装のため、号車位置は常にstationId+line+direction
    // ベースのAI生成(getBoardingPosition)に委ねる。
    return [];
  }

  async nearestStations(
    latitude: number,
    longitude: number,
    limit: number
  ): Promise<Station[]> {
    const fromApi = await fetchNearestStationsFromHeartRails(latitude, longitude);
    if (!fromApi || fromApi.length === 0) return [];

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
    const boardingPlatformId = lineBoardingPlatformId(stationId, line, direction);

    // 到着番線が判明していればAI下書き生成へ引き渡す。generateRailRoute
    // (ai-route-generation.ts)が検索で確認できた到着番線ラベルをplatformId経由で
    // 引き継ぐ。取れない場合はnullのまま(無理に埋めない原則を維持)。
    const arrivalPlatformNumber = isPlainArrivalPlatformLabel(platformId) ? platformId : null;

    return generateBoardingPosition(
      this.geminiApiKey,
      stationName,
      line,
      direction,
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
    originLine: string,
    originDirection: string,
    destinationHint: string | null,
    stationCoordinates: Coordinates | null,
    destinationPlaceCoordinates: Coordinates | null
  ): Promise<UnifiedArrivalGuide | null> {
    // 目的地公式サイト・食べログ等が明記している出口を、統合生成本体より
    // 先に専用検索で確認する(experiment/destination-fix-then-vote)。
    // destinationHintが無い(駅そのものが目的地)場合は対象外。
    const fixedExit = destinationHint
      ? await searchDestinationStatedExit(
          this.geminiApiKey,
          destinationHint,
          destinationPlaceCoordinates
        )
      : null;

    const result = await generateUnifiedArrivalGuide(
      this.geminiApiKey,
      originStationName,
      originLine,
      originDirection,
      stationName,
      operator,
      lines,
      destinationHint,
      stationCoordinates,
      destinationPlaceCoordinates,
      fixedExit
    );
    if (!result) return null;

    return {
      boardingPosition: result.boardingPosition
        ? {
            carNumber: result.boardingPosition.carNumber,
            doorPosition: result.boardingPosition.doorPosition,
            reason: result.boardingPosition.reason,
            confidence: groundedAiConfidence(result.boardingPosition.confidenceLevel),
          }
        : null,
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
}
