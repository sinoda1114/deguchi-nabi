import type { Confidence, Provenance } from "./confidence";
import type { FacilityType } from "./station";
import type { FacilityRecommendation } from "./facility-recommendation";

export type RouteMode = "fastest" | "easy" | "accessible";

export const ROUTE_MODE_LABEL: Record<RouteMode, string> = {
  fastest: "最短",
  easy: "迷わない",
  accessible: "バリアフリー",
};

export type RouteSegmentType = "train" | "transfer" | "station_walk" | "exit";

export interface RouteSegmentFacility {
  facilityType: FacilityType;
  name: string;
  confidence: Confidence;
}

export interface RouteSegment {
  type: RouteSegmentType;
  from: string;
  to: string;
  line: string | null;
  direction: string | null;
  platform: string | null;
  boardingPosition: {
    carNumber: number;
    doorPosition: string;
    reason: string;
  } | null;
  facilities: RouteSegmentFacility[];
  instruction: string;
  confidence: Confidence;
  sourceReferences: string[];
  warnings: string[];
}

export interface RouteSummary {
  originName: string;
  destinationName: string;
  arrivalStationName: string;
  recommendedExit: string;
  estimatedDurationMinutes: number | null;
  transferCount: number;
  /**
   * 到着駅座標と目的地座標からの直線距離(近似値、メートル)。実際の徒歩経路
   * (道なり)とは異なり、道路・線路・建物等を考慮しないため、実際の徒歩距離を
   * 過小評価しうる。あくまで候補間比較・目安としての近似値であり、案内文言等で
   * 断定的な実測値として表示しないこと。座標が確認できない場合はnull。
   */
  walkingDistanceMeters: number | null;
}

export interface RouteConfidenceSummary {
  boardingPosition: Confidence["level"];
  transferGuide: Confidence["level"];
  gate: Confidence["level"];
  exit: Confidence["level"];
  accessibility: Confidence["level"] | null;
}

export interface KeyInstruction {
  text: string;
}

/**
 * 到着駅内の詳細導線ステップ種別。改札・出口を明確に分離し、改札後の方向・
 * 自由通路・地下街まで一続きの導線として表現するために追加した(既存の
 * RouteSegmentType「transfer」「exit」は改札・出口をまとめて扱っており、
 * この粒度を表現できないため新設。RouteSegmentは train 区間等でそのまま維持する)。
 */
export type GuideStepType =
  | "boarding"
  | "alighting"
  | "platform_facility"
  | "ticket_gate"
  | "post_gate_direction"
  | "public_passage"
  | "underground_mall"
  | "street_exit"
  | "destination_direction";

/**
 * 到着駅内の1ステップ。confidence(検証度)とprovenance(出所)を直交させて持つ。
 * 表示可否はconfidence.levelが"unavailable"かどうかのみで判定する
 * (guide-step-visibility.ts参照。ステップ種別による表示ゲートは設けない)。
 * 情報不足時にtitleを推測で埋めてはならない(埋められないステップはそもそも
 * 生成しない)。confidenceが"high"未満の情報も、隠さず値自体は表示する
 * (表示側の責務)。以前は確度を伝える注記("未確認情報")も併せて表示側で
 * 付けていたが、この注記テキスト自体はユーザーから不要と判断され削除した。
 */
export interface GuideStep {
  type: GuideStepType;
  /**
   * 固有名詞(例: "南改札"、"A7出口")。確認できない場合はステップ自体を生成
   * しない。改札・出口が複数候補(alternatives)の場合は、先頭候補だけでなく
   * 全候補名を"/"区切りで連結した文字列にする(例: "みなみ西口 / 5番街方面出口")。
   * UI側(overview-field.ts・route-timeline-nodes.ts)はtitleをそのまま表示する
   * だけで済み、単一候補を暗黙の推奨のように見せてしまうことを構造的に防げる。
   */
  title: string;
  instruction: string;
  landmarks: string[];
  confidence: Confidence;
  provenance: Provenance;
}

/**
 * 到着駅の詳細導線。destinationDirection(方角案内)は、streetExit等の具体的な
 * ステップが確認不能でも独立して持てる(方角を出口名の代わりに使わないため、
 * RouteSummary.recommendedExitとは別のフィールドとして持つ)。
 *
 * 不変条件: steps に "destination_direction" 型のGuideStepが含まれる場合、その
 * instructionはdestinationDirectionと同じ内容を表す(生成側が両方を同じ入力から
 * 導出する)。destinationDirectionは「stepsが空、または方角ステップを含まない
 * 場合でも常に参照できる最終フォールバック」として独立に持つ。
 */
export interface ArrivalGuide {
  steps: GuideStep[];
  destinationDirection: string | null;
  /**
   * 改札・出口の3状態(confirmed/alternatives/unavailable)。stepsは既存の
   * UI(route-timeline-nodes.ts等)向けにconfirmed/alternativesいずれの場合も
   * ticket_gate/street_exitステップへ変換済みだが、alternatives状態そのもの
   * (候補一覧・「いずれか」であること)を表示側が正確に扱うためにここでも
   * 保持する。
   */
  facility: FacilityRecommendation;
}

/**
 * 乗車位置・改札・出口・改札後の徒歩ルートを1回の検索セッションで統合生成した
 * 結果(unified-arrival-guide-generation.ts参照)。accessibleモード以外向け
 * (council議論2026-07-20)。gate/exitは座標を持たないため、route-search.tsの
 * 座標ベース選定(resolveExitRecommendation)を経由せず直接採用する。
 *
 * boardingPositionは2026-07-20に追加(fix/unified-guide-boarding-and-operator-
 * disambiguation)。同一検索セッションでgateを基準に号車を決めさせることで、
 * 独立した乗車位置生成(旧ai-generation.ts generateBoardingPosition)が
 * 統合生成とは無関係の改札を基準に号車を回答してしまう不整合を防ぐ。
 *
 * facilityは2026-07-22に gate/exit(単一断定 or null)から置き換えた。改札・
 * 出口を confirmed/alternatives/unavailable の3状態で表現し、「Aまたは B」
 * のように2択には絞れているが1つに断定できない情報も(alternativesとして)
 * 隠さず保持する(Fable 5・Codexの独立レビューで一致した結論)。
 */
export interface UnifiedArrivalGuide {
  boardingPosition: {
    carNumber: number;
    doorPosition: string;
    reason: string;
    confidence: Confidence;
  } | null;
  facility: FacilityRecommendation;
  walkingSteps: GuideStep[];
}

export interface RouteGuide {
  routeId: string;
  mode: RouteMode;
  summary: RouteSummary;
  keyInstruction: KeyInstruction;
  segments: RouteSegment[];
  /**
   * 加算的な拡張フィールド(既存のsegments/summary.recommendedExitは維持したまま
   * 追加)。optionalにしてあるのは、TypeScript型としても既存の全構築箇所を
   * 即座に更新しなくてよいようにするため(APIレスポンス上の後方互換とは別に、
   * 型レベルでも段階的な導入を許容する)。未生成の場合は省略またはnullで表す。
   */
  arrivalGuide?: ArrivalGuide | null;
  confidenceSummary: RouteConfidenceSummary;
  warnings: string[];
  generatedAt: string;
  expiresAt: string;
}

export interface AccessibilityCondition {
  avoidStairs: boolean;
  preferElevator: boolean;
  preferEscalator: boolean;
}

export type OriginInput =
  | { type: "home_station" }
  | { type: "current_location"; latitude: number; longitude: number }
  | { type: "station"; stationId: string };

export type DestinationInput =
  | { type: "station"; stationId: string }
  | { type: "place"; placeId: string };

export interface RouteSearchRequest {
  origin: OriginInput;
  destination: DestinationInput;
  mode: RouteMode;
  accessibility: AccessibilityCondition;
}
