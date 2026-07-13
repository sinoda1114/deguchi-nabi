import type {
  BoardingPosition,
  Platform,
  Station,
  StationFacility,
} from "@/lib/domain/station";
import { unavailableConfidence } from "@/lib/domain/confidence";

const VERIFIED_AT = "2026-06-01T00:00:00.000Z";

const highConfidence = (reason: string, sourceCount = 2) => ({
  level: "high" as const,
  reasons: [reason],
  verifiedAt: VERIFIED_AT,
  expiresAt: null,
  sourceCount,
});

const mediumConfidence = (reason: string) => ({
  level: "medium" as const,
  reasons: [reason],
  verifiedAt: VERIFIED_AT,
  expiresAt: null,
  sourceCount: 1,
});

/**
 * 公式構内図等での現地確認を一切行っていないデータ用。mediumConfidenceは
 * 「一度確認したが情報が古い」ケース向けで verifiedAt を固定値にするため、
 * 未確認データにそのまま使うと reason の文言と verifiedAt が矛盾する。
 */
const unverifiedMediumConfidence = (reason: string) => ({
  level: "medium" as const,
  reasons: [reason],
  verifiedAt: null,
  expiresAt: null,
  sourceCount: 0,
});

export const FIXTURE_STATIONS: Station[] = [
  {
    stationId: "st_nishiya",
    stationName: "西谷駅",
    operator: "相模鉄道",
    lines: ["相鉄本線", "相鉄新横浜線"],
    prefecture: "神奈川県",
    latitude: 35.4696,
    longitude: 139.5679,
  },
  {
    stationId: "st_shibuya",
    stationName: "渋谷駅",
    operator: "東急電鉄",
    lines: ["東急東横線", "東急新横浜線", "JR山手線", "東京メトロ副都心線"],
    prefecture: "東京都",
    latitude: 35.658,
    longitude: 139.7016,
  },
  {
    stationId: "st_shinjuku",
    stationName: "新宿駅",
    operator: "JR東日本",
    lines: ["JR山手線", "JR中央線", "京王線", "小田急線", "都営新宿線"],
    prefecture: "東京都",
    latitude: 35.6896,
    longitude: 139.7006,
  },
];

export const FIXTURE_PLATFORMS: Platform[] = [
  {
    platformId: "pf_nishiya_soutetsu_shin_yokohama",
    stationId: "st_nishiya",
    lineId: "相鉄新横浜線",
    direction: "渋谷方面",
    platformNumber: "2",
  },
  {
    platformId: "pf_shibuya_tokyu_toyoko",
    stationId: "st_shibuya",
    lineId: "東急東横線",
    direction: "元町・中華街方面",
    platformNumber: "3",
  },
  {
    platformId: "pf_shibuya_jr_yamanote",
    stationId: "st_shibuya",
    lineId: "JR山手線",
    direction: "新宿方面",
    platformNumber: "5",
  },
  {
    platformId: "pf_shinjuku_jr_yamanote",
    stationId: "st_shinjuku",
    lineId: "JR山手線",
    direction: "渋谷方面",
    platformNumber: "14",
  },
];

export const FIXTURE_BOARDING_POSITIONS: BoardingPosition[] = [
  {
    boardingPositionId: "bp_nishiya_shibuya_8",
    platformId: "pf_nishiya_soutetsu_shin_yokohama",
    trainFormation: 10,
    carNumber: 8,
    doorPosition: "後方",
    targetFacilityId: "fac_shibuya_hikarie_gate",
    reason: "乗換・出口方向への移動が短くなるため",
    confidence: mediumConfidence(
      "編成両数により号車位置が変動する場合がある"
    ),
    verifiedAt: VERIFIED_AT,
  },
];

// 座標は公式構内図の測量値ではなく、地図上の位置関係に基づく概算値。
// confidence(高/中)は「その出口・改札・号車が実在し、名称・階数等が
// 公式構内図で確認済みか」を表すものであり、座標の測量精度を保証するもの
// ではない。座標はあくまで pickNearestFacility(route-search.ts)の選定
// アルゴリズムへの入力であり、出口同士の距離差が小さい場合は選定結果が
// 逆転しうる(docs/04_EXIT_SELECTION_DESIGN.md 7章「未解決の論点」参照)。
export const FIXTURE_FACILITIES: StationFacility[] = [
  {
    facilityId: "fac_shibuya_hikarie_escalator",
    stationId: "st_shibuya",
    facilityType: "escalator",
    name: "東口エスカレーター",
    level: "地上1階",
    accessible: true,
    coordinates: { lat: 35.6591, lng: 139.7038 },
    connectedGateId: null,
    confidence: highConfidence("公式構内図で確認済み"),
    verifiedAt: VERIFIED_AT,
  },
  {
    facilityId: "fac_shibuya_hikarie_gate",
    stationId: "st_shibuya",
    facilityType: "gate",
    name: "ヒカリエ改札",
    level: "地上2階",
    accessible: true,
    coordinates: { lat: 35.6591, lng: 139.7038 },
    connectedGateId: null,
    confidence: highConfidence("公式構内図で確認済み"),
    verifiedAt: VERIFIED_AT,
  },
  {
    facilityId: "fac_shibuya_exit_b5",
    stationId: "st_shibuya",
    facilityType: "exit",
    name: "B5出口",
    level: "地上2階",
    accessible: true,
    coordinates: { lat: 35.6591, lng: 139.7038 },
    connectedGateId: "fac_shibuya_hikarie_gate",
    confidence: highConfidence("公式構内図で確認済み"),
    verifiedAt: VERIFIED_AT,
  },
  {
    facilityId: "fac_shibuya_elevator_hikarie",
    stationId: "st_shibuya",
    facilityType: "elevator",
    name: "ヒカリエ連絡エレベーター",
    level: "地上1階〜2階",
    accessible: true,
    coordinates: { lat: 35.6591, lng: 139.7037 },
    connectedGateId: null,
    confidence: mediumConfidence("稼働状況の最終確認日が古い"),
    verifiedAt: VERIFIED_AT,
  },
  {
    // 宮下パーク・渋谷横丁方面の目的地に対して、B5出口(ヒカリエ側)より
    // 地理的に近い出口として追加。西谷→渋谷ヒカリエ以外の目的地でも
    // 正しい方向の出口を案内できるようにするため
    // (docs/04_EXIT_SELECTION_DESIGN.md 背景 参照)。
    facilityId: "fac_shibuya_miyamasuzaka_gate",
    stationId: "st_shibuya",
    facilityType: "gate",
    name: "宮益坂改札",
    level: "地上2階",
    accessible: true,
    coordinates: { lat: 35.6595, lng: 139.7025 },
    connectedGateId: null,
    confidence: highConfidence("公式構内図で確認済み"),
    verifiedAt: VERIFIED_AT,
  },
  {
    facilityId: "fac_shibuya_exit_miyamasuzaka",
    stationId: "st_shibuya",
    facilityType: "exit",
    name: "宮益坂口",
    level: "地上2階",
    accessible: true,
    coordinates: { lat: 35.6595, lng: 139.7025 },
    connectedGateId: "fac_shibuya_miyamasuzaka_gate",
    confidence: highConfidence("公式構内図で確認済み"),
    verifiedAt: VERIFIED_AT,
  },
  {
    // これまでの登録出口(ヒカリエ改札・宮益坂口)は駅の東側に偏っており、
    // 南西側(桜丘町・Shibuya Sakura Stage方面)の目的地に対して常に
    // 東側出口を誤って推薦してしまう欠落があった。方角バランスを取るため
    // 南西側の出口を追加する(docs/04_EXIT_SELECTION_DESIGN.md 参照)。
    // 座標は一般的な地図情報を基にした概算であり、公式構内図による現地確認・
    // 改札との接続関係・段差状況は未確認。confidence は medium、
    // accessible は安全側に倒し未確認のまま true と断定しない(false)、
    // verifiedAt も現地確認していないため null とする
    // (「確認済みだが部分的」という状態を明示し、他の高確信度データと
    // 混同しないようにする)。
    facilityId: "fac_shibuya_sakuragaoka_gate",
    stationId: "st_shibuya",
    facilityType: "gate",
    name: "桜丘改札",
    level: "地上1階",
    accessible: false,
    coordinates: { lat: 35.6564, lng: 139.6989 },
    connectedGateId: null,
    confidence: unverifiedMediumConfidence(
      "一般的な地図情報を基に追加。公式構内図による現地確認・改札接続・段差状況は未確認"
    ),
    verifiedAt: null,
  },
  {
    facilityId: "fac_shibuya_exit_sakuragaoka",
    stationId: "st_shibuya",
    facilityType: "exit",
    name: "桜丘口",
    level: "地上1階",
    accessible: false,
    coordinates: { lat: 35.6564, lng: 139.6989 },
    connectedGateId: "fac_shibuya_sakuragaoka_gate",
    confidence: unverifiedMediumConfidence(
      "一般的な地図情報を基に追加。公式構内図による現地確認・改札接続・段差状況は未確認"
    ),
    verifiedAt: null,
  },
  {
    facilityId: "fac_shinjuku_new_south_gate",
    stationId: "st_shinjuku",
    facilityType: "gate",
    name: "新南改札",
    level: "地上2階",
    accessible: true,
    coordinates: { lat: 35.6884, lng: 139.7009 },
    connectedGateId: null,
    confidence: highConfidence("公式構内図で確認済み"),
    verifiedAt: VERIFIED_AT,
  },
  {
    facilityId: "fac_shinjuku_exit_new_south",
    stationId: "st_shinjuku",
    facilityType: "exit",
    name: "新南口",
    level: "地上2階",
    accessible: true,
    coordinates: { lat: 35.6884, lng: 139.7009 },
    connectedGateId: "fac_shinjuku_new_south_gate",
    confidence: highConfidence("公式構内図で確認済み"),
    verifiedAt: VERIFIED_AT,
  },
];

export function unavailableFacilityConfidence(reason: string) {
  return unavailableConfidence(reason);
}
