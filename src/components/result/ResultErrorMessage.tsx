import Link from "next/link";
import { RetrySearchButton } from "@/components/result/RetrySearchButton";

interface ResultErrorMessageProps {
  message: string;
  /**
   * true の場合のみ「もう一度検索」ボタンを表示する。
   * 検索条件不足や駅・施設IDが解決できない等の確定的な失敗では、同じURLに
   * 再アクセスしても結果は変わらないため false(既定値)のままにする。
   * AI(Gemini)によるルート・号車・改札/出口情報の生成失敗はキャッシュされない
   * ため、タイムアウトや一時的なAPI障害であれば再試行で成功しうる。
   */
  retryable?: boolean;
}

/**
 * main領域のみのエラー表示(AppHeaderは含まない)。page.tsxのバリデーション
 * エラー(AppHeader込みのErrorScreen)と、RouteResultBody内の解決失敗
 * (RouteResultBodyがSuspense配下でmainを描画するため、AppHeaderは既に
 * page.tsx側で描画済み)の両方から使い分けられるよう分離した。
 */
export function ResultErrorMessage({ message, retryable = false }: ResultErrorMessageProps) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-10 text-center">
      <p className="text-sm font-semibold text-[var(--foreground-muted)]">{message}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        {retryable && <RetrySearchButton />}
        <Link
          href="/"
          className="rounded-[var(--radius-pill)] bg-[var(--accent)] px-4 py-2 text-center text-sm font-bold text-[var(--accent-foreground)]"
        >
          検索へ戻る
        </Link>
      </div>
    </main>
  );
}
