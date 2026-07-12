# claude-project-starter

複数エージェント（Claude Code / Codex 等）で開発する個人プロジェクトの**運用・管理ルールの標準テンプレート**。
MatchFav（wc-tournament-tracker）で確立した運用を、新規プロジェクトへそのまま持ち込めるよう一般化したもの。

> 思想: **人間は「何を(WHAT)」だけ渡す。「やり方(HOW)」はこのテンプレに従う。**

## このテンプレが標準化するもの（stack 非依存）

- **マルチエージェント開発フロー** — 1 エージェント = 1 worktree = 1 ブランチ。本体 repo は統合＋デプロイ専用。
- **2 段ゲート** — `/ai-review` → コミット → `/security-review` を push 前に通す。
- **PR ベース・マージは番人専権** — `main` 直 push 禁止／自分の PR を自分でマージしない。
- **git 駆動デプロイ** — feature push = Preview 自動／main マージ = Production 自動（手動デプロイ原則禁止）。
- **「GitHub が正本」** — PR 状態・タスク状態は記憶や伝聞でなく GitHub を正とする。
- **タスク管理は GitHub Issue / Project** — 単一巨大 Markdown の並行編集クロバーを構造的に回避。
- **供給網デフォルト** — lockfile コミット／CI は `npm ci`／`npm audit`／Dependabot／`.npmrc` ignore-scripts。

## stack 依存（同じ構成のときだけ流用・要調整）

`.github/workflows/ci.yml`（Node/npm 前提）と、AGENTS.md / notes 内の **Vercel・Next.js 前提の記述**。
別 stack のときは「デプロイ＝git 駆動・Preview/Production 自動」という**原則は維持**し、コマンド/プラットフォーム名だけ差し替える。

## ファイル構成

```
AGENTS.md                              # 薄型：プロジェクト固有値＋notes/へのポインタ（挙動は再説明しない）
CLAUDE.md                              # Claude 用の薄い入口（AGENTS.md を参照）
.npmrc                                 # ignore-scripts / audit-level / save-exact
.github/
  workflows/ci.yml                     # typecheck / lint / test / build / audit
  ISSUE_TEMPLATE/task.yml              # タスク Issue フォーム（T-N）
  dependabot.yml                       # npm weekly
notes/
  dev-workflow-multiagent.md           # worktree / main 専用 / デプロイ規律（挙動の正本・travel する）
  task-management-issue-workflow.md    # Issue/Project タスク運用（挙動の正本・travel する）
  apply-to-existing-project.md         # 既存（運用中）PJ への後付け適用ガイド
scripts/
  fill-placeholders.sh                 # {{PLACEHOLDER}} を一括置換する補助
```

> 挙動ルール（worktree/2段ゲート/デプロイ規律/GitHub正本/Issue管理）は **`~/.claude` グローバル**にも既定として入れてあり、
> 自分の端末の全 PJ に自動適用される。リポ同梱の `notes/` は、その挙動正本を repo と一緒に travel させるためのもの。
> **既存の運用中 PJ に当てるときは [`notes/apply-to-existing-project.md`](notes/apply-to-existing-project.md) を参照**（全コピー厳禁・追記で当てる）。

## 使い方（新規プロジェクトへの適用）

1. このテンプレを新規 repo の土台にする（GitHub の「Use this template」、または手元で `cp -r`）。
2. **プレースホルダを埋める**: 下表の `{{...}}` を実値へ。`scripts/fill-placeholders.sh` で一括置換できる。
3. **GitHub 側の初期セットアップ**（下の「GitHub セットアップ」）。
4. AGENTS.md / CLAUDE.md を repo 直下に置いたまま開発開始。AI はこれを読んで HOW に従う。

### プレースホルダ一覧

| プレースホルダ | 意味 | 例 |
|---|---|---|
| `{{PROJECT_NAME}}` | プロジェクト/ブランド名 | MatchFav |
| `{{REPO_SLUG}}` | repo ディレクトリ名 | wc-tournament-tracker |
| `{{GH_OWNER_REPO}}` | GitHub の owner/repo | sinoda1114/wc-tournament-tracker |
| `{{DEPLOY_PLATFORM}}` | デプロイ基盤 | Vercel |
| `{{PROD_URL}}` | 本番 URL | https://example.vercel.app |
| `{{DOMAIN}}` | 独自ドメイン | example.com |
| `{{SITE_URL_ENV}}` | 絶対 URL を持つ env 名 | NEXT_PUBLIC_SITE_URL |
| `{{PROJECT_BOARD}}` | Project 名（番号は GitHub で確定） | {{PROJECT_NAME}} Tasks |

### GitHub セットアップ（初回のみ）

```bash
# 1) origin/HEAD を設定（/security-review が必要とする）
git remote set-head origin -a

# 2) type:* ラベルを作成（状態は Project カラムで管理。status ラベルは作らない）
for t in bug feature content i18n legal billing data mobile ops; do \
  gh label create "type:$t" --color ededed 2>/dev/null || true; done

# 3) GitHub Project（Board）を作成し、カラムを Inbox/Ready/Waiting/Doing/PR/Prod Check/Done に
#    （gh project create か Web UI。番号を AGENTS.md の {{PROJECT_BOARD}} 近くに反映）

# 4) デプロイ基盤の Git 連携（Vercel 等）: Production Branch = main、PR ごとに Preview 発行を有効化
```

> 注: 適用範囲が「自分の端末の自分のプロジェクト中心」なら、`~/.claude/`（グローバル）にも同じ
> 非依存ルールを置くと設定ゼロで効く。ただし他人の端末・CI には伝播しないため、**リポ同梱（このテンプレ）が正**。
