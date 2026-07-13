import { Accessibility, Flag, Locate, MapPin, Route, Star, Timer, type LucideIcon } from "lucide-react";

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
  /** "favorite"タイプの塗りつぶし有無(登録済み/未登録の状態表示に使う)。デフォルトtrue。 */
  filled?: boolean;
}

const ICONS: Record<SearchPictogramType, LucideIcon> = {
  origin: MapPin,
  destination: Flag,
  "current-location": Locate,
  fastest: Timer,
  easy: Route,
  accessible: Accessibility,
  favorite: Star,
};

/**
 * 検索フォーム用の統一ピクトグラム(lucide-react)。
 * 常に隣接するテキストラベルの装飾として使うため、スクリーンリーダーには公開しない
 * (aria-labelを付けるとラベルと二重読み上げになる)。
 */
export function SearchPictogram({ type, className = "h-4 w-4", filled = true }: SearchPictogramProps) {
  const Icon = ICONS[type];
  return (
    <Icon
      className={className}
      strokeWidth={1.8}
      fill={type === "favorite" && filled ? "currentColor" : "none"}
      aria-hidden="true"
      focusable="false"
    />
  );
}
