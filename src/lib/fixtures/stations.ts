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

export const FIXTURE_FACILITIES: StationFacility[] = [
  {
    facilityId: "fac_shibuya_hikarie_escalator",
    stationId: "st_shibuya",
    facilityType: "escalator",
    name: "東口エスカレーター",
    level: "地上1階",
    accessible: true,
    coordinates: null,
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
    coordinates: null,
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
    coordinates: null,
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
    coordinates: null,
    confidence: mediumConfidence("稼働状況の最終確認日が古い"),
    verifiedAt: VERIFIED_AT,
  },
  {
    facilityId: "fac_shinjuku_new_south_gate",
    stationId: "st_shinjuku",
    facilityType: "gate",
    name: "新南改札",
    level: "地上2階",
    accessible: true,
    coordinates: null,
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
    coordinates: null,
    confidence: highConfidence("公式構内図で確認済み"),
    verifiedAt: VERIFIED_AT,
  },
];

export function unavailableFacilityConfidence(reason: string) {
  return unavailableConfidence(reason);
}
