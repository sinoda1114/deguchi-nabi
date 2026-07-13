import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RouteDiagram } from "@/components/diagram/RouteDiagram";
import type { RouteSegment } from "@/lib/domain/route";
import type { Confidence } from "@/lib/domain/confidence";

const highConfidence: Confidence = {
  level: "high",
  reasons: [],
  verifiedAt: null,
  expiresAt: null,
  sourceCount: 2,
};

const TRAIN_SEGMENT: RouteSegment = {
  type: "train",
  from: "出発駅",
  to: "到着駅",
  line: "テスト線",
  direction: "到着駅方面",
  platform: "1",
  boardingPosition: { carNumber: 5, doorPosition: "中央", reason: "テスト理由" },
  facilities: [],
  instruction: "テスト線で5号車付近に乗車してください。",
  confidence: highConfidence,
  sourceReferences: [],
  warnings: [],
};

const TRANSFER_SEGMENT: RouteSegment = {
  type: "transfer",
  from: "到着駅",
  to: "到着駅",
  line: null,
  direction: "中央改札方面",
  platform: null,
  boardingPosition: null,
  facilities: [],
  instruction: "中央改札へ向かってください。",
  confidence: highConfidence,
  sourceReferences: [],
  warnings: [],
};

const EXIT_SEGMENT: RouteSegment = {
  type: "exit",
  from: "到着駅",
  to: "到着駅",
  line: null,
  direction: null,
  platform: null,
  boardingPosition: null,
  facilities: [],
  instruction: "A1出口から出てください。",
  confidence: highConfidence,
  sourceReferences: [],
  warnings: [],
};

describe("RouteDiagram", () => {
  test("信頼度バッジ(信頼度:)をカード内に表示しない(最後にまとめて表示する設計のため、カード内の表示は利用者を不安にさせるとのフィードバックを受けて削除)", () => {
    const html = renderToStaticMarkup(
      <RouteDiagram segments={[TRAIN_SEGMENT, TRANSFER_SEGMENT, EXIT_SEGMENT]} />
    );
    expect(html).not.toContain("信頼度");
  });

  test("セグメント種別ごとに異なるアクセントカラーを使う(乗車=train用、乗換=transfer用、出口=--accent)", () => {
    const html = renderToStaticMarkup(
      <RouteDiagram segments={[TRAIN_SEGMENT, TRANSFER_SEGMENT, EXIT_SEGMENT]} />
    );
    expect(html).toContain("var(--segment-train)");
    expect(html).toContain("var(--segment-transfer)");
    expect(html).toContain("var(--accent)");
  });

  test("種別ラベル(乗車・乗換・出口)を表示する", () => {
    const html = renderToStaticMarkup(
      <RouteDiagram segments={[TRAIN_SEGMENT, TRANSFER_SEGMENT, EXIT_SEGMENT]} />
    );
    expect(html).toContain("乗車");
    expect(html).toContain("乗換");
    expect(html).toContain("出口");
  });

  test("ステップ番号を1始まりの連番で表示する", () => {
    const html = renderToStaticMarkup(
      <RouteDiagram segments={[TRAIN_SEGMENT, TRANSFER_SEGMENT, EXIT_SEGMENT]} />
    );
    // StationNodeのバッジは各セグメントの連番(1,2,3)を持つ
    expect(html).toContain(">1<");
    expect(html).toContain(">2<");
    expect(html).toContain(">3<");
  });

  test("ステップ番号バッジの文字色にaccentに対応するforegroundを使う(text-white固定だとコントラスト不足になるため)", () => {
    const html = renderToStaticMarkup(
      <RouteDiagram segments={[TRAIN_SEGMENT, TRANSFER_SEGMENT, EXIT_SEGMENT]} />
    );
    expect(html).toContain("var(--segment-train-foreground)");
    expect(html).toContain("var(--segment-transfer-foreground)");
    expect(html).toContain("var(--accent-foreground)");
    expect(html).not.toContain("text-white");
  });
});
