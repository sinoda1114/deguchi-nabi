#!/usr/bin/env bash
# テンプレの {{PLACEHOLDER}} を実値へ一括置換する補助スクリプト。
#
# 使い方:
#   1) 下の値を自分のプロジェクトに合わせて書き換える
#   2) テンプレを適用した新規 repo の直下で実行: bash scripts/fill-placeholders.sh
#   3) 置換後にこのスクリプト自身と README の「使い方」節は削除してよい
#
# 対象は AGENTS.md / CLAUDE.md / notes/*.md / README.md。
set -euo pipefail

# ====== ここを編集 ======
PROJECT_NAME="My Project"
REPO_SLUG="my-project"
GH_OWNER_REPO="owner/my-project"
DEPLOY_PLATFORM="Vercel"
PROD_URL="https://my-project.vercel.app"
DOMAIN="example.com"
SITE_URL_ENV="NEXT_PUBLIC_SITE_URL"
PROJECT_BOARD="My Project Tasks"
# ========================

targets=(AGENTS.md CLAUDE.md README.md notes/dev-workflow-multiagent.md notes/task-management-issue-workflow.md)

# macOS / Linux 両対応の in-place sed
sedi() { if sed --version >/dev/null 2>&1; then sed -i "$@"; else sed -i '' "$@"; fi; }

for f in "${targets[@]}"; do
  [ -f "$f" ] || continue
  sedi \
    -e "s|{{PROJECT_NAME}}|${PROJECT_NAME}|g" \
    -e "s|{{REPO_SLUG}}|${REPO_SLUG}|g" \
    -e "s|{{GH_OWNER_REPO}}|${GH_OWNER_REPO}|g" \
    -e "s|{{DEPLOY_PLATFORM}}|${DEPLOY_PLATFORM}|g" \
    -e "s|{{PROD_URL}}|${PROD_URL}|g" \
    -e "s|{{DOMAIN}}|${DOMAIN}|g" \
    -e "s|{{SITE_URL_ENV}}|${SITE_URL_ENV}|g" \
    -e "s|{{PROJECT_BOARD}}|${PROJECT_BOARD}|g" \
    "$f"
  echo "filled: $f"
done

echo "done. 残った {{...}} が無いか確認:"
grep -RIl "{{" AGENTS.md CLAUDE.md README.md notes/ 2>/dev/null || echo "（プレースホルダ残りなし）"
