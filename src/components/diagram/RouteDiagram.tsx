import type { RouteSegment, RouteSegmentType } from "@/lib/domain/route";
import { StationNode } from "./StationNode";
import { DirectionArrow } from "./DirectionArrow";
import { FacilityIcon } from "./FacilityIcon";
import { WarningBadge } from "./WarningBadge";
import { SegmentDetail } from "./SegmentDetail";

interface RouteDiagramProps {
  segments: RouteSegment[];
}

/**
 * セグメント種別を色で瞬時に区別するためのアクセントカラー。
 * 出口は既存ブランドカラー(--accent、緑)をそのまま使い、乗車・乗換に
 * 新規追加した青・橙を割り当てる(全カード同一トーンで見分けがつかない
 * とのフィードバックを受けた変更)。
 */
const SEGMENT_ACCENT: Record<RouteSegmentType, string> = {
  train: "var(--segment-train)",
  transfer: "var(--segment-transfer)",
  station_walk: "var(--segment-transfer)",
  exit: "var(--accent)",
};

/**
 * SEGMENT_ACCENTの各背景色に対して十分なコントラストを持つ前景色。
 * text-white固定だと--segment-train/--segment-transferのような明度の高い
 * 色でコントラスト不足になるため、既存デザイントークンの対応する
 * foreground変数を使う(AIレビュー指摘に基づく修正)。
 */
const SEGMENT_FOREGROUND: Record<RouteSegmentType, string> = {
  train: "var(--segment-train-foreground)",
  transfer: "var(--segment-transfer-foreground)",
  station_walk: "var(--segment-transfer-foreground)",
  exit: "var(--accent-foreground)",
};

const SEGMENT_STEP_LABEL: Record<RouteSegmentType, string> = {
  train: "乗車",
  transfer: "乗換",
  station_walk: "乗換",
  exit: "出口",
};

/**
 * 検索ごとの画像生成はせず、構造化データから軽量な HTML/CSS で描画する
 * (02_SPECIFICATION.md §7)。実際の構内図は再現せず、主要導線だけを示す。
 *
 * 信頼度バッジはここでは表示しない(以前は各カードに表示していたが、
 * カードごとに「信頼度: 低」等が並ぶと利用者を不安にさせるとの
 * フィードバックを受け、ページ末尾のConfidenceSummarySectionに一本化した)。
 */
export function RouteDiagram({ segments }: RouteDiagramProps) {
  return (
    <div aria-label="ルートの簡易図" className="flex flex-col">
      {segments.map((segment, i) => (
        <div key={i}>
          {i > 0 ? <DirectionArrow /> : null}
          <StationNode
            name={segment.from}
            accent={SEGMENT_ACCENT[segment.type]}
            foreground={SEGMENT_FOREGROUND[segment.type]}
            stepNumber={i + 1}
            stepLabel={SEGMENT_STEP_LABEL[segment.type]}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--foreground-muted)]">
              {segment.boardingPosition ? (
                <span className="inline-flex items-center gap-1 font-semibold text-[var(--accent)]">
                  <FacilityIcon type="car" className="h-4 w-4" />
                  {segment.boardingPosition.carNumber}号車・{segment.boardingPosition.doorPosition}
                </span>
              ) : null}
              {segment.line ? <span>{segment.line}</span> : null}
              {segment.direction ? <span>{segment.direction}</span> : null}
              {segment.facilities.map((facility, fi) => (
                <span key={fi} className="inline-flex items-center gap-1">
                  <FacilityIcon type={facility.facilityType} className="h-4 w-4" />
                  {facility.name}
                </span>
              ))}
            </div>
            {segment.warnings.map((w, wi) => (
              <WarningBadge key={wi} text={w} />
            ))}
            <SegmentDetail segment={segment} />
          </StationNode>
        </div>
      ))}
    </div>
  );
}
