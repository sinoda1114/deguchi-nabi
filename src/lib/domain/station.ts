import type { Confidence, Provenance } from "./confidence";

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Station {
  stationId: string;
  stationName: string;
  operator: string;
  lines: string[];
  prefecture: string;
  latitude: number;
  longitude: number;
}

export interface Platform {
  platformId: string;
  stationId: string;
  lineId: string;
  direction: string;
  platformNumber: string;
}

export interface BoardingPosition {
  boardingPositionId: string;
  platformId: string;
  trainFormation: number;
  carNumber: number;
  doorPosition: "前方" | "中央" | "後方";
  targetFacilityId: string | null;
  reason: string;
  confidence: Confidence;
  verifiedAt: string | null;
}

export type FacilityType =
  | "stairs"
  | "escalator"
  | "elevator"
  | "gate"
  | "exit"
  | "passage";

export interface StationFacility {
  facilityId: string;
  stationId: string;
  facilityType: FacilityType;
  name: string;
  level: string;
  accessible: boolean;
  coordinates: { lat: number; lng: number } | null;
  /**
   * facilityType === "exit" の場合のみ意味を持つ、接続先の改札(gate) facilityId。
   * 座標の近さだけで出口↔改札の連結を推定すると、物理的に近くても実際には
   * 連絡していない改札を誤って選んでしまうため、明示的なリンクとして持たせる
   * (docs/04_EXIT_SELECTION_DESIGN.md 参照)。
   */
  connectedGateId: string | null;
  confidence: Confidence;
  verifiedAt: string | null;
  /**
   * 出所(現地調査済み/地図で確認/AI推定)。GuideStep生成時にconfidenceの上限を
   * 決めるために使う(capConfidenceForProvenance参照)。省略時は最も慎重な
   * "ai_inferred"として扱う(出所不明なデータを誤って高信頼扱いしないため、
   * 安全側にフォールバックする設計)。
   */
  provenance?: Provenance;
}

export interface Destination {
  destinationId: string;
  name: string;
  category: "station" | "facility" | "shop" | "address";
  address: string;
  latitude: number;
  longitude: number;
  nearestStationCandidates: string[];
  /**
   * 公式サイトURL(Google Places由来のみ)。目的地特定の確からしさを示す付帯情報。
   * 公式サイトの有無を確認していないadapterはフィールド自体を省略する
   * (「未確認」と「確認したが公式サイト無し」を区別するため、`undefined` と `null` を使い分ける)。
   */
  websiteUri?: string | null;
  /**
   * 営業状態(Google Places由来のみ)。`CLOSED_PERMANENTLY`(閉店確定)は候補として
   * 誤案内になるため、検索候補生成の時点で除外され、ここには残らない。
   * `closed_temporarily`(一時休業)は閉世界仮定を避けるため除外せず、確認できた
   * 事実として保持する(docs/04_EXIT_SELECTION_DESIGN.md と同じ設計思想)。
   * 営業状態を確認していないadapterはフィールド自体を省略する。
   */
  businessStatus?: "operational" | "closed_temporarily";
}
