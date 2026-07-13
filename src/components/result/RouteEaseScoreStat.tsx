import type { RouteMode, RouteSegment } from "@/lib/domain/route";
import type { FacilitiesSearchResult } from "@/lib/services/route-search";
import { computeConfidenceSummary } from "@/lib/services/route-search";
import { computeRouteEaseScore } from "@/lib/services/route-ease-score";
import { EaseScoreStars } from "@/components/confidence/EaseScoreStars";

interface RouteEaseScoreStatProps {
  trainSegmentsPromise: Promise<RouteSegment[]>;
  facilitiesPromise: Promise<FacilitiesSearchResult>;
  mode: RouteMode;
}

/**
 * サマリーカードの迷いにくさ欄。スコア自体はtrain区間とfacilitiesの両方が
 * 揃って初めて算出できるが、facilitiesが失敗した場合はtrainSegmentsを
 * 待つ意味が無い。先にfacilitiesPromiseだけを待ち、失敗ならtrainSegments
 * を待たず即座にエラー理由を表示する(trainSegmentsは既にpage.tsxで
 * 並行実行中のため、成功時にここで改めてawaitしても総待ち時間は増えない)。
 */
export async function RouteEaseScoreStat({
  trainSegmentsPromise,
  facilitiesPromise,
  mode,
}: RouteEaseScoreStatProps) {
  const facilitiesResult = await facilitiesPromise;

  if (!facilitiesResult.ok) {
    return (
      <p className="stream-reveal text-xs font-semibold opacity-90">{facilitiesResult.reason}</p>
    );
  }

  const trainSegments = await trainSegmentsPromise;

  return (
    <div className="stream-reveal flex items-center gap-2">
      <span className="text-xs font-bold opacity-80">迷いにくさ</span>
      <EaseScoreStars
        score={computeRouteEaseScore(
          computeConfidenceSummary(trainSegments, facilitiesResult.result, mode)
        )}
      />
    </div>
  );
}
