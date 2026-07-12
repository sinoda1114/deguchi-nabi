import type { RouteSegment } from "@/lib/domain/route";
import { RouteSegmentListItem } from "@/components/timeline/RouteSegmentListItem";

interface TrainSegmentListProps {
  trainSegmentsPromise: Promise<RouteSegment[]>;
}

/**
 * train区間だけを表示する Server Component。page.tsx で作られた Promise を
 * props 経由で受け取って自分で await する(Promise as Props パターン)。
 * 同じ Promise インスタンスは「生成元の処理を1回だけ表す」という JS の仕様上、
 * 他のセクション(RouteDiagramSection 等)と Promise インスタンスを共有しても
 * buildTrainSegments が重複実行されることはない(重複するのは await する箇所だけ)。
 */
export async function TrainSegmentList({ trainSegmentsPromise }: TrainSegmentListProps) {
  const trainSegments = await trainSegmentsPromise;

  return (
    <ol className="flex flex-col gap-3">
      {trainSegments.map((segment, i) => (
        <RouteSegmentListItem key={i} segment={segment} />
      ))}
    </ol>
  );
}
