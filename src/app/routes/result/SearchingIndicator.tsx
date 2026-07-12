"use client";

import { useEffect, useState } from "react";

const DOT_PATTERNS = ["", ".", "..", "..."];

export function SearchingIndicator() {
  const [dotIndex, setDotIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setDotIndex((i) => (i + 1) % DOT_PATTERNS.length);
    }, 400);
    return () => clearInterval(id);
  }, []);

  return (
    <p className="text-sm font-semibold text-[var(--foreground-muted)]" role="status" aria-live="polite">
      ルートを検索しています
      <span aria-hidden="true">{DOT_PATTERNS[dotIndex]}</span>
    </p>
  );
}
