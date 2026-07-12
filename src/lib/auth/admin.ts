import type { User } from "@/lib/domain/user";

/**
 * 管理画面アクセス可否。MVP では環境変数の許可リストで権限分離する
 * (16.3 セキュリティ要件: 管理画面は権限分離する)。
 */
export function isAdminUser(user: User | null): boolean {
  if (!user) return false;
  const allowList = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  return allowList.includes(user.email);
}
