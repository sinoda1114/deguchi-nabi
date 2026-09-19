# JEV Phase 1: Retry Gate 統合

## 概要

JEV (TypeSafe System One) をdeguchi-nabiの意思決定層に統合する第1フェーズ。
`single-call-navigator.ts`のリトライゲート判定を、機械的な件数ルールから意味理解ベースの判定へ改善。

## 統合範囲（Phase 1）

**対象**: `isFacilityUnavailable()` 関数（line 407-420）
**目的**: リトライ率30%→15%削減で3-4秒短縮
**非対象**: テキスト生成（Gemini Search Groundingのまま）

## 環境変数設定

### 必須環境変数

```bash
JEV_API_KEY=your_jev_api_key_here
```

### Vercel での設定

1. Vercel Dashboard → deguchi-nabi → Settings → Environment Variables
2. 以下を追加:
   - Variable: `JEV_API_KEY`
   - Value: (本番用JEVキー)
   - Environment: Production, Preview, Development すべて

### Cursor Cloud Agents での設定

1. Cursor Dashboard → Cloud Agents → Secrets
2. 以下を追加:
   - Repository: `sinoda1114/deguchi-nabi`
   - Key: `JEV_API_KEY`
   - Value: (開発用JEVキー)

### ローカル開発での設定

`.env.local`に追加（このファイルはgitignore済み）:

```bash
# JEV (TypeSafe System One) API Key
JEV_API_KEY=your_dev_jev_api_key_here
```

## 実装詳細

### フォールバック設計

JEV_API_KEYが未設定の場合、従来のルールベース判定（`facility.state === "unavailable"`）を使用。
既存の挙動を完全に保持し、段階的な移行を可能にする。

### タイムアウト

- デフォルト: 1000ms
- タイムアウト時: `shouldRetry=false`（retry不要判定）でフォールバック

### エラーハンドリング

JEV API呼び出しが失敗した場合、ログ出力後にルールベース判定へフォールバック。
アプリケーション全体の可用性を優先。

## テスト

```bash
npm test
```

JEV統合のテストケース:
- JEV未設定時のフォールバック挙動
- JEV設定時の意味的判定使用
- エラー時のフォールバック

## 測定ベースライン

### Phase 1 実装前
- 平均レイテンシ: 72.3秒（加重平均、リトライ込み）
- リトライ率: 30%

### Phase 1 目標
- 平均レイテンシ: 65-67秒（10-15%改善）
- リトライ率: 15%

### 測定方法

同一フィクスチャで測定:
- Route: 西谷駅 → 居酒屋ウエチャベ（渋谷、道玄坂2-9-2）
- N=10

## Phase 2以降の計画

- Phase 2: `classifyFacilityRecommendation()` の意味的重複検出
- Phase 3: 信頼度評価、モードルーティング最適化

詳細は PR #117 の計画書を参照。

## 関連PR

- #117: JEV統合計画書（実装準備完了）
- #118: Flash 3.8 + npm audit fix（並行トラック）
