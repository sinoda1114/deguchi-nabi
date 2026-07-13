import type { Confidence, Provenance } from "./confidence";
import type { FacilityType } from "./station";

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
 * 誤った場合の実害が大きいステップ種別(post_gate_direction等)ほど、表示可否を
 * 厳しく判定する(guide-step-visibility.ts参照)。情報不足時にtitleを推測で
 * 埋めてはならない(埋められないステップはそもそも生成しない)。
 */
export interface GuideStep {
  type: GuideStepType;
  /** 固有名詞(例: "南改札"、"A7出口")。確認できない場合はステップ自体を生成しない。 */
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
