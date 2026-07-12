export function DirectionArrow() {
  return (
    <div className="flex justify-center py-1" aria-hidden="true">
      <svg viewBox="0 0 16 24" className="h-6 w-4 text-[var(--brand)]" fill="none">
        <path d="M8 1v18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
        <path
          d="M3 15l5 6 5-6"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
