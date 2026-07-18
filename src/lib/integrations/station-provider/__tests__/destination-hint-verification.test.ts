import { describe, test, expect } from "vitest";
import { generateStationFacilities } from "../ai-generation";
import type { StationFacility } from "@/lib/domain/station";

/**
 * destinationHint機能の検証ゲート(/plans/sunny-munching-lovelace.md参照)。
 *
 * 本番同一構成(generateStationFacilitiesを直接呼ぶ。CompositeStationAdapterの
 * JSONファイルキャッシュ・レートリミッタ・fixtureフォールバックは経由しない)で
 * 実際のGemini APIに対して、目的地ヒント有り/無しの生成結果を比較する。
 * DESTINATION_HINT_ENABLEDフラグの値には依存しない(ここでは常に
 * generateStationFacilitiesへ直接destinationHintを渡す)。
 *
 * 通常の `npm test` では実行されない(RUN_HINT_VERIFICATION=1 かつ
 * GEMINI_API_KEY設定時のみ実行、二重ガードでCI等の副作用を防ぐ)。
 *
 * 実行方法(実際のAPIキーを渡すこと。値はこのファイルには書かない):
 *   RUN_HINT_VERIFICATION=1 GEMINI_API_KEY=xxx npx vitest run \
 *     src/lib/integrations/station-provider/__tests__/destination-hint-verification.test.ts
 *
 * 実API課金が発生する(4ペア×2条件×検索+抽出の2段呼び出し=16リクエスト/回)。
 * Gemini出力は非決定的なため、境界的な結果になった場合は2回実行して
 * 安定側を採用する運用を推奨する。
 *
 * 全ペアを1つのtest内で直列実行するため、タイムアウトは
 * 4ペア×2条件×最大70秒(検索55秒+抽出15秒)=最大560秒を
 * 余裕を持って超える値にする必要がある(1ペア分の想定で300秒にしていたのは
 * 実装ミス。実行前のレビューで発覚)。
 */

const VERIFICATION_TIMEOUT_MS = 900_000;

interface VerificationPair {
  label: string;
  stationName: string;
  operator: string;
  lines: string[];
  destinationHint: string;
}

const VERIFICATION_PAIRS: VerificationPair[] = [
  {
    label: "横浜駅(横浜市営地下鉄ブルーライン)/ kawara CAFE＆DINING 横浜店",
    stationName: "横浜駅",
    operator: "横浜市交通局",
    lines: ["横浜市営地下鉄ブルーライン"],
    destinationHint: "kawara CAFE＆DINING 横浜店",
  },
  {
    label: "東京駅(JR東日本)/ KITTE丸の内",
    stationName: "東京駅",
    operator: "JR東日本",
    lines: ["JR東海道本線", "JR中央線", "JR京浜東北線"],
    destinationHint: "KITTE丸の内",
  },
  {
    label: "吉祥寺駅(JR中央線)/ 井の頭恩賜公園",
    stationName: "吉祥寺駅",
    operator: "JR東日本",
    lines: ["JR中央線"],
    destinationHint: "井の頭恩賜公園",
  },
  {
    label: "表参道駅(東京メトロ)/ 表参道ヒルズ",
    stationName: "表参道駅",
    operator: "東京メトロ",
    lines: ["東京メトロ銀座線", "東京メトロ千代田線", "東京メトロ半蔵門線"],
    destinationHint: "表参道ヒルズ",
  },
];

/**
 * ペアスコア = S1(有効facility総数) + S2(gate≧1かつexit≧1なら10点) +
 * S3(medium confidenceの件数)。乗換案内の中核であるgate/exitの両方確認を
 * 最も重く評価する。
 */
function scoreFacilities(facilities: StationFacility[]): number {
  const s1 = facilities.length;
  const hasGate = facilities.some((f) => f.facilityType === "gate");
  const hasExit = facilities.some((f) => f.facilityType === "exit");
  const s2 = hasGate && hasExit ? 10 : 0;
  const s3 = facilities.filter((f) => f.confidence.level === "medium").length;
  return s1 + s2 + s3;
}

// CI環境変数にRUN_HINT_VERIFICATION/GEMINI_API_KEYが将来的に設定されて
// しまった場合でも、CI上では絶対に実API呼び出しを走らせない多層防御
// (/ai-review指摘、Medium)。手動実行はローカル(process.env.CI未設定)でのみ想定する。
const shouldRun =
  process.env.RUN_HINT_VERIFICATION === "1" &&
  Boolean(process.env.GEMINI_API_KEY) &&
  !process.env.CI;

describe.runIf(shouldRun)("destinationHint検証ゲート(実API・手動実行専用)", () => {
  test(
    "hint有りの合計スコアがhint無し以上であり、hint無しで1件以上返るペアでhint有りが全滅(0件)しない",
    async () => {
      const apiKey = process.env.GEMINI_API_KEY as string;
      let totalOff = 0;
      let totalOn = 0;

      for (const pair of VERIFICATION_PAIRS) {
        const off = await generateStationFacilities(
          apiKey,
          pair.stationName,
          pair.operator,
          pair.lines,
          null,
          null
        );
        const on = await generateStationFacilities(
          apiKey,
          pair.stationName,
          pair.operator,
          pair.lines,
          null,
          pair.destinationHint
        );

        const scoreOff = scoreFacilities(off);
        const scoreOn = scoreFacilities(on);
        totalOff += scoreOff;
        totalOn += scoreOn;

        console.log(
          `[destination-hint-verification] ${pair.label}\n` +
            `  hint無し(score=${scoreOff}): ${JSON.stringify(off, null, 2)}\n` +
            `  hint有り(score=${scoreOn}): ${JSON.stringify(on, null, 2)}`
        );

        if (off.length > 0) {
          expect(
            on.length,
            `${pair.label}: hint無しで${off.length}件返ったのにhint有りが全滅(0件)しました`
          ).toBeGreaterThan(0);
        }

        // 合計スコアの比較だけだと、あるペアでの劣化が別ペアの改善で相殺され
        // 通過してしまう(/ai-review指摘、Medium)。ペア単位でも
        // hint有り≧hint無しを確認し、個別の劣化を見逃さないようにする。
        expect(
          scoreOn,
          `${pair.label}: hint有り(score=${scoreOn})がhint無し(score=${scoreOff})より劣化しました`
        ).toBeGreaterThanOrEqual(scoreOff);
      }

      console.log(
        `[destination-hint-verification] 合計スコア: hint無し=${totalOff}, hint有り=${totalOn}`
      );
      expect(totalOn).toBeGreaterThanOrEqual(totalOff);
    },
    VERIFICATION_TIMEOUT_MS
  );
});
