import { describe, test, expect } from "vitest";
import { generateStationFacilities } from "@/lib/integrations/station-provider/ai-generation";
import { generateStationFacilitiesWithVision } from "@/lib/integrations/station-provider/facilities-vision-generation";
import { scoreFacilities } from "@/lib/eval/facilities-score";
import { FACILITIES_EVAL_DATASET } from "@/lib/eval/facilities-eval-dataset";
import { resolveEvalStationLimit } from "@/lib/eval/eval-station-limit";
import type { StationFacility } from "@/lib/domain/station";

/**
 * 改札・出口AI生成のバックエンド比較評価ゲート: Grounding vs Vision統合Grounding。
 *
 * council議論(2026-07-19)の結論を検証する評価ハーネス。Serper検索パイプライン
 * (facilities-backend-eval.test.ts)は実API評価で全滅9/20駅と判明した一方、
 * 構内図画像をGemini Visionに直接読ませるVision統合Grounding
 * (facilities-vision-generation.ts、FACILITIES_SEARCH_BACKEND=vision-grounding)
 * はPoCで有効性を実証した。同一データセット・同一ルーブリック
 * (src/lib/eval/facilities-score.ts)で比較し、フラグをONにする判断材料を揃える。
 * facilities-backend-eval.test.tsと同じ設計思想(実API・手動実行専用、多層ガード、
 * ループ内でexpectしない)を踏襲する。
 *
 * 通常の `npm test` では実行されない(RUN_FACILITIES_EVAL=1 かつ
 * GEMINI_API_KEY・SERPER_API_KEY設定時のみ実行、CI等の副作用を防ぐ多層防御)。
 *
 * 実行方法(実際のAPIキーを渡すこと。値はこのファイルには書かない):
 *   RUN_FACILITIES_EVAL=1 GEMINI_API_KEY=xxx SERPER_API_KEY=xxx \
 *     [EVAL_STATION_LIMIT=3] npx vitest run \
 *     src/lib/integrations/station-provider/__tests__/facilities-vision-eval.test.ts
 *
 * 実API課金が発生する(最大20駅×2方式=40回の検索+抽出呼び出し、うち画像取得も
 * 追加で発生する)。タイムアウトは20駅×2方式×最大70秒を余裕を持って超える値。
 */

const EVAL_TIMEOUT_MS = 3_600_000;

/** 全滅回避の許容件数。Grounding版がスコア>0を返した駅のうち、Vision版が
 *  0点になってよい駅数の上限(これを超えたら不合格)。 */
const MAX_ALLOWED_VISION_ZERO_OUT = 2;

interface StationResult {
  label: string;
  groundingScore: number;
  visionScore: number;
  groundingMediumCount: number;
  visionMediumCount: number;
  groundingFacilities: StationFacility[];
  visionFacilities: StationFacility[];
}

function countMediumConfidence(facilities: StationFacility[]): number {
  return facilities.filter((f) => f.confidence.level === "medium").length;
}

// CI環境変数にRUN_FACILITIES_EVAL/GEMINI_API_KEY/SERPER_API_KEYが将来的に
// 設定されてしまった場合でも、CI上では絶対に実API呼び出しを走らせない多層防御
// (facilities-backend-eval.test.tsと同じ方針)。手動実行はローカル
// (process.env.CI未設定)でのみ想定する。
const shouldRun =
  process.env.RUN_FACILITIES_EVAL === "1" &&
  Boolean(process.env.GEMINI_API_KEY) &&
  Boolean(process.env.SERPER_API_KEY) &&
  !process.env.CI;

describe.runIf(shouldRun)(
  "Grounding vs Vision統合Grounding比較評価ゲート(実API・手動実行専用)",
  () => {
    test(
      "Vision版の合計スコア・品質がGrounding版以上であり、全滅駅が許容件数以内である",
      async () => {
        const geminiApiKey = process.env.GEMINI_API_KEY as string;
        const serperApiKey = process.env.SERPER_API_KEY as string;

        const limit = resolveEvalStationLimit(
          process.env.EVAL_STATION_LIMIT,
          FACILITIES_EVAL_DATASET.length
        );
        const pairs = FACILITIES_EVAL_DATASET.slice(0, limit);

        // ループ内でexpectしてthrowすると1駅目の失敗で残りが評価されないまま
        // 終わる(facilities-backend-eval.test.tsと同じ教訓)。全駅の結果を
        // 収集してから最後にまとめて判定する。
        const results: StationResult[] = [];
        const failures: string[] = [];

        for (const pair of pairs) {
          let groundingFacilities: StationFacility[] = [];
          let visionFacilities: StationFacility[] = [];

          try {
            groundingFacilities = await generateStationFacilities(
              geminiApiKey,
              pair.stationName,
              pair.operator,
              pair.lines,
              null,
              pair.destinationHint
            );
          } catch (error) {
            failures.push(
              `${pair.label}: Grounding呼び出しで例外が発生しました: ${error instanceof Error ? error.message : String(error)}`
            );
          }

          try {
            visionFacilities = await generateStationFacilitiesWithVision(
              geminiApiKey,
              serperApiKey,
              pair.stationName,
              pair.operator,
              pair.lines,
              null,
              pair.destinationHint
            );
          } catch (error) {
            failures.push(
              `${pair.label}: Vision統合Grounding呼び出しで例外が発生しました: ${error instanceof Error ? error.message : String(error)}`
            );
          }

          const groundingScore = scoreFacilities(groundingFacilities);
          const visionScore = scoreFacilities(visionFacilities);

          console.log(
            `[facilities-vision-eval] ${pair.label}\n` +
              `  Grounding(score=${groundingScore}): ${JSON.stringify(groundingFacilities, null, 2)}\n` +
              `  Vision(score=${visionScore}): ${JSON.stringify(visionFacilities, null, 2)}`
          );

          results.push({
            label: pair.label,
            groundingScore,
            visionScore,
            groundingMediumCount: countMediumConfidence(groundingFacilities),
            visionMediumCount: countMediumConfidence(visionFacilities),
            groundingFacilities,
            visionFacilities,
          });
        }

        const totalGrounding = results.reduce((sum, r) => sum + r.groundingScore, 0);
        const totalVision = results.reduce((sum, r) => sum + r.visionScore, 0);
        console.log(
          `[facilities-vision-eval] 合計スコア: Grounding=${totalGrounding}, Vision=${totalVision}`
        );
        if (totalVision < totalGrounding) {
          failures.push(`合計スコアが劣化しました: Grounding=${totalGrounding}, Vision=${totalVision}`);
        }

        const zeroOutStations = results.filter(
          (r) => r.groundingScore > 0 && r.visionScore === 0
        );
        console.log(
          `[facilities-vision-eval] Vision全滅駅数: ${zeroOutStations.length} ` +
            `(許容${MAX_ALLOWED_VISION_ZERO_OUT}件): ${zeroOutStations.map((r) => r.label).join(", ")}`
        );
        if (zeroOutStations.length > MAX_ALLOWED_VISION_ZERO_OUT) {
          failures.push(
            `Vision版が全滅(0件)した駅が許容件数(${MAX_ALLOWED_VISION_ZERO_OUT})を超えました: ` +
              zeroOutStations.map((r) => r.label).join(", ")
          );
        }

        const totalGroundingMedium = results.reduce((sum, r) => sum + r.groundingMediumCount, 0);
        const totalVisionMedium = results.reduce((sum, r) => sum + r.visionMediumCount, 0);
        console.log(
          `[facilities-vision-eval] medium confidence合計件数: ` +
            `Grounding=${totalGroundingMedium}, Vision=${totalVisionMedium}`
        );
        if (totalVisionMedium < totalGroundingMedium) {
          failures.push(
            `medium confidence件数が劣化しました: ` +
              `Grounding=${totalGroundingMedium}, Vision=${totalVisionMedium}`
          );
        }

        expect(failures, failures.join("\n")).toEqual([]);
      },
      EVAL_TIMEOUT_MS
    );
  }
);
