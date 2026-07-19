import { describe, test, expect } from "vitest";
import { generateStationFacilities } from "@/lib/integrations/station-provider/ai-generation";
import { searchStationFacilitiesViaPipeline } from "../facilities-search-pipeline";
import { scoreFacilities } from "@/lib/eval/facilities-score";
import { FACILITIES_EVAL_DATASET } from "@/lib/eval/facilities-eval-dataset";
import { resolveEvalStationLimit } from "@/lib/eval/eval-station-limit";
import type { StationFacility } from "@/lib/domain/station";

/**
 * 改札・出口AI生成のバックエンド比較評価ゲート(PR6)。
 *
 * PR5で追加したSerper検索パイプライン(searchStationFacilitiesViaPipeline、
 * FACILITIES_SEARCH_BACKEND=serperフラグ)を、現行のGemini Search Grounding
 * (generateStationFacilities)と同一データセット・同一ルーブリック
 * (src/lib/eval/facilities-score.ts)で比較し、フラグをONにする判断材料を
 * 揃える。destination-hint-verification.test.tsと同じ設計思想
 * (実API・手動実行専用、多層ガード、ループ内でexpectしない)を踏襲する。
 *
 * 通常の `npm test` では実行されない(RUN_FACILITIES_EVAL=1 かつ
 * GEMINI_API_KEY・SERPER_API_KEY設定時のみ実行、CI等の副作用を防ぐ多層防御)。
 *
 * 実行方法(実際のAPIキーを渡すこと。値はこのファイルには書かない):
 *   RUN_FACILITIES_EVAL=1 GEMINI_API_KEY=xxx SERPER_API_KEY=xxx \
 *     [JINA_API_KEY=xxx] [EVAL_STATION_LIMIT=3] npx vitest run \
 *     src/lib/integrations/search/__tests__/facilities-backend-eval.test.ts
 *
 * JINA_API_KEYは任意(未設定でもJina Readerは動く。facilities-search-pipeline.ts
 * 参照)。EVAL_STATION_LIMITを設定すると、データセット先頭からその件数だけに
 * 絞って実行できる(開発中に少数駅だけで動作確認するため。未設定なら全20駅)。
 *
 * 実API課金が発生する(最大20駅×2方式=40回の検索+抽出呼び出し)。
 * タイムアウトは20駅×2方式×最大70秒(Grounding: 検索55秒+抽出15秒。
 * Serperパイプライン: 45秒程度)を余裕を持って超える値にする必要がある。
 */

const EVAL_TIMEOUT_MS = 3_600_000;

/** 全滅回避の許容件数。Grounding版がスコア>0を返した駅のうち、Serper版が
 *  0点になってよい駅数の上限(これを超えたら不合格)。 */
const MAX_ALLOWED_SERPER_ZERO_OUT = 2;

interface StationResult {
  label: string;
  groundingScore: number;
  serperScore: number;
  groundingMediumCount: number;
  serperMediumCount: number;
  groundingFacilities: StationFacility[];
  serperFacilities: StationFacility[];
}

function countMediumConfidence(facilities: StationFacility[]): number {
  return facilities.filter((f) => f.confidence.level === "medium").length;
}

// CI環境変数にRUN_FACILITIES_EVAL/GEMINI_API_KEY/SERPER_API_KEYが将来的に
// 設定されてしまった場合でも、CI上では絶対に実API呼び出しを走らせない多層防御
// (destination-hint-verification.test.tsと同じ方針)。手動実行はローカル
// (process.env.CI未設定)でのみ想定する。
const shouldRun =
  process.env.RUN_FACILITIES_EVAL === "1" &&
  Boolean(process.env.GEMINI_API_KEY) &&
  Boolean(process.env.SERPER_API_KEY) &&
  !process.env.CI;

describe.runIf(shouldRun)("Grounding vs Serperパイプライン比較評価ゲート(実API・手動実行専用)", () => {
  test(
    "Serper版の合計スコア・品質がGrounding版以上であり、全滅駅が許容件数以内である",
    async () => {
      const geminiApiKey = process.env.GEMINI_API_KEY as string;
      const serperApiKey = process.env.SERPER_API_KEY as string;
      const jinaApiKey = process.env.JINA_API_KEY ?? null;

      const limit = resolveEvalStationLimit(
        process.env.EVAL_STATION_LIMIT,
        FACILITIES_EVAL_DATASET.length
      );
      const pairs = FACILITIES_EVAL_DATASET.slice(0, limit);

      // ループ内でexpectしてthrowすると、1駅目の失敗で残りの駅が評価されない
      // まま終わってしまう(destination-hint-verification.test.tsで判明した
      // 実装ミスと同じ轍を踏まない)。全駅の結果を収集してから最後にまとめて
      // 判定する。
      const results: StationResult[] = [];
      const failures: string[] = [];

      for (const pair of pairs) {
        // 個別駅のAPI呼び出しが例外を投げると、try/catchなしではループ全体が
        // 中断し、以降の駅が一切評価されないまま終わってしまう(実API評価では
        // ネットワーク断・レート制限等で個別呼び出しが失敗しうる。/ai-review
        // 指摘、Medium)。失敗した駅はスコア0(=空配列)として扱いつつ、
        // エラー内容をfailuresへ記録して他の駅の評価は継続する。
        let groundingFacilities: StationFacility[] = [];
        let serperFacilities: StationFacility[] = [];

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
          serperFacilities = await searchStationFacilitiesViaPipeline(
            { serperApiKey, jinaApiKey, geminiApiKey },
            pair.stationName,
            pair.operator,
            pair.lines,
            null,
            pair.destinationHint
          );
        } catch (error) {
          failures.push(
            `${pair.label}: Serperパイプライン呼び出しで例外が発生しました: ${error instanceof Error ? error.message : String(error)}`
          );
        }

        const groundingScore = scoreFacilities(groundingFacilities);
        const serperScore = scoreFacilities(serperFacilities);

        console.log(
          `[facilities-backend-eval] ${pair.label}\n` +
            `  Grounding(score=${groundingScore}): ${JSON.stringify(groundingFacilities, null, 2)}\n` +
            `  Serper(score=${serperScore}): ${JSON.stringify(serperFacilities, null, 2)}`
        );

        results.push({
          label: pair.label,
          groundingScore,
          serperScore,
          groundingMediumCount: countMediumConfidence(groundingFacilities),
          serperMediumCount: countMediumConfidence(serperFacilities),
          groundingFacilities,
          serperFacilities,
        });
      }

      // (a) 合計スコア: Serper版の合計 ≧ Grounding版の合計
      const totalGrounding = results.reduce((sum, r) => sum + r.groundingScore, 0);
      const totalSerper = results.reduce((sum, r) => sum + r.serperScore, 0);
      console.log(
        `[facilities-backend-eval] 合計スコア: Grounding=${totalGrounding}, Serper=${totalSerper}`
      );
      if (totalSerper < totalGrounding) {
        failures.push(
          `合計スコアが劣化しました: Grounding=${totalGrounding}, Serper=${totalSerper}`
        );
      }

      // (b) 全滅回避: Grounding版がスコア>0を返した駅で、Serper版が0点になる
      //     ものが許容件数を超えない
      const zeroOutStations = results.filter(
        (r) => r.groundingScore > 0 && r.serperScore === 0
      );
      console.log(
        `[facilities-backend-eval] Serper全滅駅数: ${zeroOutStations.length} ` +
          `(許容${MAX_ALLOWED_SERPER_ZERO_OUT}件): ${zeroOutStations.map((r) => r.label).join(", ")}`
      );
      if (zeroOutStations.length > MAX_ALLOWED_SERPER_ZERO_OUT) {
        failures.push(
          `Serper版が全滅(0件)した駅が許容件数(${MAX_ALLOWED_SERPER_ZERO_OUT})を超えました: ` +
            zeroOutStations.map((r) => r.label).join(", ")
        );
      }

      // (c) 品質: Serper版のmedium confidence件数の合計 ≧ Grounding版の合計
      const totalGroundingMedium = results.reduce((sum, r) => sum + r.groundingMediumCount, 0);
      const totalSerperMedium = results.reduce((sum, r) => sum + r.serperMediumCount, 0);
      console.log(
        `[facilities-backend-eval] medium confidence合計件数: ` +
          `Grounding=${totalGroundingMedium}, Serper=${totalSerperMedium}`
      );
      if (totalSerperMedium < totalGroundingMedium) {
        failures.push(
          `medium confidence件数が劣化しました: ` +
            `Grounding=${totalGroundingMedium}, Serper=${totalSerperMedium}`
        );
      }

      expect(failures, failures.join("\n")).toEqual([]);
    },
    EVAL_TIMEOUT_MS
  );
});
