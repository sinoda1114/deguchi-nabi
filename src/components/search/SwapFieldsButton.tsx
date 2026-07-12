"use client";

import { Button } from "@heroui/react";

interface SwapFieldsButtonProps {
  isDisabled: boolean;
  isPending: boolean;
  onPress: () => void;
}

/** 出発地⇄目的地の入れ替えボタン。上下2本矢印のインラインSVGアイコンを使う。 */
export function SwapFieldsButton({ isDisabled, isPending, onPress }: SwapFieldsButtonProps) {
  return (
    <div className="-my-2 flex justify-center">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        isDisabled={isDisabled}
        isPending={isPending}
        onPress={onPress}
        aria-label="出発地と目的地を入れ替え"
        className="rounded-full p-2"
      >
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
          role="img"
          aria-label="入れ替え"
        >
          <path d="M6 3v11 M6 14l-3-3 M6 14l3-3 M14 17V6 M14 6l-3 3 M14 6l3 3" />
        </svg>
      </Button>
    </div>
  );
}
