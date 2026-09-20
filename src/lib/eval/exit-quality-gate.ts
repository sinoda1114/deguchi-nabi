import type { Coordinates } from "@/lib/domain/station";

/** Preview 品質ゲート用の凍結座標(道玄坂2-9-2 付近)。 */
export const UECHABE_DOGENZAKA = {
  label: "居酒屋ウエチャベ",
  address: "渋谷区道玄坂2-9-2",
  coordinates: { lat: 35.65755, lng: 139.69735 } satisfies Coordinates,
};

/**
 * 西側(道玄坂・ハチ公)の許容名。ヒカリエ/宮益坂は品質ゲートでは不合格。
 * 正確性(ハチ公 vs 道玄坂)は Presence とは別リスクとして残す。
 */
export const SHIBUYA_WEST_ALLOWLIST = {
  gates: ["道玄坂改札", "ハチ公改札", "東急東横線改札"] as const,
  exits: ["A1出口", "A0出口", "A2出口", "道玄坂口", "ハチ公口"] as const,
};

export const SHIBUYA_EAST_REJECT = [
  "ヒカリエ改札",
  "B5出口",
  "宮益坂改札",
  "宮益坂口",
] as const;
