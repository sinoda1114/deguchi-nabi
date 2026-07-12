/**
 * KeyInstructionText の Suspense fallback。
 * KeyInstructionCard の背景(--accent)上に乗るため、白系の半透明バーにする。
 */
export function KeyInstructionTextSkeleton() {
  return (
    <span aria-hidden="true" className="block animate-pulse">
      <span className="block h-5 w-4/5 rounded-full bg-black/15" />
      <span className="mt-2 block h-5 w-2/3 rounded-full bg-black/15" />
    </span>
  );
}
