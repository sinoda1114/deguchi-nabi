export type SearchPictogramType =
  | "origin"
  | "destination"
  | "current-location"
  | "fastest"
  | "easy"
  | "accessible"
  | "favorite";

interface SearchPictogramProps {
  type: SearchPictogramType;
  className?: string;
}

const PATHS: Record<Exclude<SearchPictogramType, "favorite">, string> = {
  origin: "M10 2c-3 0-5.2 2.2-5.2 5.2C4.8 11 10 18 10 18s5.2-7 5.2-10.8C15.2 4.2 13 2 10 2Z M10 9a1.8 1.8 0 1 0 0-3.6A1.8 1.8 0 0 0 10 9Z",
  destination: "M6 3v14 M6 4h8l-2 3 2 3H6",
  "current-location": "M10 2v3 M10 15v3 M2 10h3 M15 10h3 M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  fastest:
    "M8.5 2h3 M10 2v1.7 M3.5 11a6.5 6.5 0 1 0 13 0 6.5 6.5 0 1 0-13 0 M10 11l2.8-2.2",
  easy: "M5 15a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2Z M15 8a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2Z M6.3 12.8Q10 10 13.7 7.2",
  accessible: "M5 3h10v16H5V3Z M9 8l3-3 3 3 M9 14l3 3 3-3",
};

/**
 * 検索フォーム用の統一ピクトグラム。FacilityIconと同じ20x20ストロークスタイルに揃える。
 * 常に隣接するテキストラベルの装飾として使うため、スクリーンリーダーには公開しない
 * (role/aria-labelを付けるとラベルと二重読み上げになる)。
 */
export function SearchPictogram({ type, className = "h-4 w-4" }: SearchPictogramProps) {
  if (type === "favorite") {
    return (
      <svg
        viewBox="0 0 20 20"
        fill="currentColor"
        stroke="none"
        className={className}
        aria-hidden="true"
        focusable="false"
      >
        <path d="M10 2l2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.4 7.2l5-.7L10 2Z" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[type]} />
    </svg>
  );
}
