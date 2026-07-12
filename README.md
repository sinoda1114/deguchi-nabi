# deguchi-nabi

乗換え・駅構内ナビゲーションサービス。号車・乗換導線・改札・出口まで一続きで案内する。

- 要件定義・仕様・構造ドキュメント: `docs/`
- 開発フロー・タスク管理の正本: `notes/`（詳細は [`AGENTS.md`](./AGENTS.md) 参照）

## スタック

- Next.js (App Router) + TypeScript
- npm

## 開発

```bash
npm install
npm run dev
```

運用ルール（worktree / 2段ゲート / デプロイ規律 / GitHub正本 / Issue管理）は [`AGENTS.md`](./AGENTS.md) を参照。
