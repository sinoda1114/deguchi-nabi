interface EaseScoreStarsProps {
  score: number;
}

const STAR_COUNT = 5;
const MIN_SCORE = 1;
const MAX_SCORE = 5;

function clampScore(score: number): number {
  return Math.min(MAX_SCORE, Math.max(MIN_SCORE, score));
}

function Star({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill={filled ? "var(--accent)" : "none"}
      stroke={filled ? "var(--accent)" : "var(--border)"}
      strokeWidth={1.4}
      strokeLinejoin="round"
      data-filled={filled}
      aria-hidden="true"
    >
      <path d="M10 2.5l2.35 4.76 5.25.76-3.8 3.7.9 5.23L10 14.5l-4.7 2.45.9-5.23-3.8-3.7 5.25-.76L10 2.5Z" />
    </svg>
  );
}

/**
 * 経路の「迷いにくさ」を★の数で瞬時に伝える。数値や文章より視覚的に
 * 一目で伝わるため、詳細な信頼度内訳(ConfidenceSummarySection)とは
 * 別に、サマリーカードの最上部で使う。
 */
export function EaseScoreStars({ score }: EaseScoreStarsProps) {
  const clamped = clampScore(score);
  return (
    <div
      className="flex items-center gap-0.5"
      aria-label={`迷いにくさ ${MAX_SCORE}段階中${clamped}`}
    >
      {Array.from({ length: STAR_COUNT }, (_, i) => (
        <Star key={i} filled={i < clamped} />
      ))}
    </div>
  );
}
