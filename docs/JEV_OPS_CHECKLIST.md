# JEV運用チェックリスト

## 文書目的

本書は、JEV（TypeSafe.ai SystemOne）推論エンジンの運用において、APIキーの設定、デプロイ、パフォーマンス測定に関する手順を定義する。

関連PR：
- [#116](https://github.com/sinoda1114/deguchi-nabi/pull/116) - JEV基盤導入
- [#117](https://github.com/sinoda1114/deguchi-nabi/pull/117) - JEV構造準備
- [#118](https://github.com/sinoda1114/deguchi-nabi/pull/118) - JEV Phase 1実装
- [#119](https://github.com/sinoda1114/deguchi-nabi/pull/119) - 速度ベンチマーク記録

---

## 1. JEV_API_KEYの設定

### 1.1 Vercel環境変数設定

JEV_API_KEYは以下の3つの環境で設定する必要がある：

#### Production（本番環境）
```
Vercelダッシュボード → プロジェクト設定 → Environment Variables
Name: JEV_API_KEY
Value: [本番用APIキー]
Environment: Production
```

#### Preview（プレビュー環境）
```
Name: JEV_API_KEY
Value: [プレビュー用APIキー]
Environment: Preview
```

#### Development（開発環境）
```
Name: JEV_API_KEY
Value: [開発用APIキー]
Environment: Development
```

**重要：APIキーは絶対にコミットしない。** `.env.local` や `.env` ファイルには含めず、Vercelダッシュボードでのみ管理する。

### 1.2 Cursor Cloud Agents環境シークレット設定

Cloud Agentsから実行するテストやスクリプトでJEV APIを利用する場合：

```
Cursor Dashboard → Cloud Agents → Secrets
Name: JEV_API_KEY
Value: [Agent用APIキー]
Scope: Runtime Secret（実行時シークレット）
Repository: sinoda1114/deguchi-nabi
```

---

## 2. スモークテスト

APIキー設定後、以下のcurlコマンドでJEV APIの疎通を確認する。

### 2.1 テストコマンド

```bash
curl -X POST https://api.typesafe.ai/v1/systemone \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY_HERE" \
  -d '{
    "model": "systemone",
    "messages": [
      {
        "role": "user",
        "content": "Hello"
      }
    ]
  }'
```

**注意：** `YOUR_API_KEY_HERE` は実際のAPIキーに置き換える。ドキュメントやログにはAPIキーを記載しない。

### 2.2 期待される応答

正常な場合：
```json
{
  "id": "...",
  "object": "chat.completion",
  "created": ...,
  "model": "systemone",
  "choices": [...]
}
```

エラーの場合：
- `401 Unauthorized`: APIキーが無効
- `403 Forbidden`: APIキーの権限不足
- `429 Too Many Requests`: レート制限超過

---

## 3. PR #118マージ後の手順

PR #118（JEV Phase 1実装）がmainブランチにマージされた後、以下を実行する。

### 3.1 本番環境へのデプロイ確認

1. Vercelダッシュボードで本番デプロイが成功したことを確認
2. https://deguchi-nabi.vercel.app でアプリケーションが正常に動作することを確認

### 3.2 パフォーマンス再測定

以下の固定テストケースで測定を実施：

**テストケース：西谷駅 → ウエチャベ**

測定項目：
- 検索開始から結果表示までの時間（ミリ秒）
- JEV推論時間（ミリ秒）
- 総レスポンスタイム（ミリ秒）

測定条件：
- 本番環境（https://deguchi-nabi.vercel.app）
- キャッシュクリア状態
- 同一ブラウザ、同一ネットワーク環境で3回測定し平均値を算出

### 3.3 結果の記録

測定結果は以下に記録する：

**`docs/SPEED_BENCHMARKS.md` が存在する場合：**
```markdown
## JEV Phase 1導入後（PR #118マージ後）

測定日時: YYYY-MM-DD HH:MM
テストケース: 西谷駅 → ウエチャベ

| 項目 | 測定値 |
|---|---|
| 検索〜結果表示 | XXXXms |
| JEV推論時間 | XXXXms |
| 総レスポンスタイム | XXXXms |
```

**`docs/SPEED_BENCHMARKS.md` が存在しない場合：**

PR #119でベンチマークドキュメントを作成する際に記録する旨を、PR #118のコメントまたはIssueに記載する。

---

## 4. JEV Phase 1完全導入後の再測定

JEV Phase 1がすべて完了し、3点比較が可能になった時点で、同じテストケースで再測定を実施する。

### 4.1 3点比較の構成

1. **ベースライン（JEV導入前）**
2. **PR #118マージ後（Phase 1初期）**
3. **Phase 1完全導入後（本測定）**

### 4.2 測定と記録

上記「3.2 パフォーマンス再測定」と同じ条件で測定し、`docs/SPEED_BENCHMARKS.md` に追記する。

```markdown
## JEV Phase 1完全導入後

測定日時: YYYY-MM-DD HH:MM
テストケース: 西谷駅 → ウエチャベ

| 項目 | 測定値 |
|---|---|
| 検索〜結果表示 | XXXXms |
| JEV推論時間 | XXXXms |
| 総レスポンスタイム | XXXXms |

### 3点比較

| 段階 | 総レスポンスタイム |
|---|---|
| JEV導入前 | XXXXms |
| PR #118後 | XXXXms |
| Phase 1完了後 | XXXXms |
```

---

## 5. チェックリストサマリー

- [ ] Vercel Production環境にJEV_API_KEYを設定
- [ ] Vercel Preview環境にJEV_API_KEYを設定
- [ ] Vercel Development環境にJEV_API_KEYを設定
- [ ] Cursor Cloud AgentsシークレットにJEV_API_KEYを設定（必要に応じて）
- [ ] curl疎通テストを実行し、API応答を確認
- [ ] PR #118マージ後、本番デプロイ成功を確認
- [ ] 西谷→ウエチャベのパフォーマンス測定を実施（PR #118後）
- [ ] 測定結果をdocs/SPEED_BENCHMARKS.mdに記録（存在する場合）
- [ ] Phase 1完全導入後、再度パフォーマンス測定を実施
- [ ] 3点比較結果をドキュメントに記録

---

## 6. 注意事項

- APIキーは環境変数またはシークレット管理システムでのみ管理する
- `.env.local`、`.env`、コードコメント、ドキュメント、ログにAPIキーを含めない
- スモークテストのcurlコマンド実行時、コマンド履歴にAPIキーが残らないよう注意する
- 測定は同一条件（ブラウザ、ネットワーク、キャッシュ状態）で実施する
- パフォーマンス測定は3回実施し、平均値を採用する
