# タイムアウト対策の実装設計書

**作成日**: 2026-09-19  
**関連文書**: [TIMEOUT_INVESTIGATION_REPORT.md](./TIMEOUT_INVESTIGATION_REPORT.md)  
**目的**: タイムアウト率を30%から10%以下に削減

---

## 1. 実装の優先順位

### 優先度1: 予算管理されたRetry（必須）

**効果**: タイムアウト率 -15〜20%

**実装箇所**: `src/lib/integrations/ai/single-call-navigator.ts`

### 優先度2: JEVタイムアウトの延長（推奨）

**効果**: タイムアウト率 -2〜3%、retry判定の精度向上

**実装箇所**: `src/lib/integrations/ai/JevClient.ts`

### 優先度3: Phase 2-Cスキップ条件の追加（推奨）

**効果**: レイテンシ削減 -1秒

**実装箇所**: `src/lib/integrations/ai/single-call-navigator.ts`

---

## 2. 実装内容

### 2.1 予算管理されたRetry

#### 変更ファイル

`src/lib/integrations/ai/single-call-navigator.ts`

#### 変更内容

```typescript
export function generateSingleCallNavigatorRun(
  apiKey: string,
  originStation: Station,
  destinationStation: Station,
  destinationHint: string | null,
  destinationPlaceCoordinates: Coordinates | null = null
): SingleCallNavigatorRun {
  const attempt = () =>
    attemptGenerateSingleCallNavigatorGuide(
      apiKey,
      originStation,
      destinationStation,
      destinationHint,
      destinationPlaceCoordinates
    );
  
  // タイムアウト予算: API Route全体の290秒から安全マージンを確保
  const RETRY_BUDGET_MS = 200_000; // 200秒
  // 2回目の試行に最低限必要な時間（Gemini平均55秒 + マージン）
  const MIN_RETRY_TIME_MS = 60_000; // 60秒
  
  const startTime = Date.now();
  const attempt1 = attempt();
  
  const final = attempt1.then(async (r1) => {
    const elapsed = Date.now() - startTime;
    
    // 1回目で完了（confirmed/alternatives または null）
    if (r1 !== null && !(await isFacilityUnavailable(r1))) {
      return r1;
    }
    
    // 予算チェック: 残り時間が不十分ならretryをスキップ
    const remainingBudget = RETRY_BUDGET_MS - elapsed;
    if (remainingBudget < MIN_RETRY_TIME_MS) {
      console.warn(
        `[single-call-navigator] 残り予算不足(${remainingBudget}ms)のためretryをスキップ: ` +
        `origin=${originStation.stationName}, elapsed=${elapsed}ms`
      );
      // 1回目の結果を返す（nullの場合もnullを返す）
      // nullの場合、呼び出し元でエラーハンドリングされる
      return r1;
    }
    
    // 再試行を実行
    const reason = r1 === null ? "結果がnullだった" : "改札・出口の情報が両方とも確認できなかった";
    console.warn(
      `[single-call-navigator] 1回目の試行で${reason}ため再試行します ` +
      `(残り予算: ${remainingBudget}ms): origin=${originStation.stationName}, destination=${destinationStation.stationName}`
    );
    
    let r2: SingleCallNavigatorGuide | null;
    try {
      r2 = await attempt();
    } catch (error) {
      // 2回目が例外で失敗
      if (r1 === null) throw error; // 見せられる結果が無い
      console.warn(
        "[single-call-navigator] 再試行が例外で失敗、1回目の結果を採用",
        error instanceof Error ? error.message : String(error)
      );
      r2 = null;
    }
    
    // Phase 2: selectFinalGuide()の非同期化に対応
    return await selectFinalGuide(r1, r2);
  });
  
  // first: 1回目の結果、またはnullならfinalと同時に決着
  const first = attempt1.then((r1) => r1 ?? final);
  
  // 未購読側の未処理rejection防止（accessibleモードではfinal、逆経路ではfirst）
  // 呼び出し元がawaitしたrejectionはそのまま観測できる
  first.catch(() => {});
  final.catch(() => {});
  
  return { first, final };
}
```

#### 設定パラメータの調整

| パラメータ | 値 | 理由 |
|---|---|---|
| RETRY_BUDGET_MS | 200秒 | API Route全体の290秒から、Vercelオーバーヘッド・ネットワーク遅延を考慮した安全マージン |
| MIN_RETRY_TIME_MS | 60秒 | Gemini平均55秒 + 抽出15秒の一部 + マージン |

**調整の余地**:
- MIN_RETRY_TIME_MSを40秒に引き下げ → retryの機会を増やす（リスク: 2回目がタイムアウトする確率が上がる）
- RETRY_BUDGET_MSを220秒に延長 → より多くのケースでretryを試行（リスク: API Route全体のタイムアウトに近づく）

---

### 2.2 JEVタイムアウトの延長

#### 変更ファイル

`src/lib/integrations/ai/JevClient.ts`

#### 変更内容

```typescript
// 現在: 1秒
const DEFAULT_TIMEOUT_MS = 1000;

// 変更後: 2秒
const DEFAULT_TIMEOUT_MS = 2000;
```

#### 段階的な延長戦略

**推奨アプローチ**: まず1.5秒に延長して効果を測定

```typescript
// Step 1: 1.5秒に延長
const DEFAULT_TIMEOUT_MS = 1500;

// Preview N=10 で測定:
// - JEVの成功率が向上したか？
// - タイムアウト率は削減されたか？

// Step 2: 効果が確認できたら2秒に延長
const DEFAULT_TIMEOUT_MS = 2000;
```

#### 注意点

1. **ヘルスチェックのタイムアウトは変更しない**
   - `src/lib/integrations/jev/JevClient.ts`の`HEALTH_CHECK_TIMEOUT_MS`は5秒のまま
   - ヘルスチェックは起動時のみで、リクエストごとには呼ばれない

2. **fail-openのオーバーヘッド**
   - タイムアウト延長により、fail-open時の無駄も2秒に増加
   - しかし、成功率が上がるならトレードオフは許容可能

3. **JEV呼び出し回数**
   - 最大4回: Phase 1, Phase 2-C, isRouteConsistent × 2
   - すべてがタイムアウトした場合: 4 × 2秒 = 8秒の無駄
   - しかし、ルールベース判定がほとんどの場合をカバーするため、実際には1〜2回程度

---

### 2.3 Phase 2-Cスキップ条件の追加

#### 変更ファイル

`src/lib/integrations/ai/single-call-navigator.ts`

#### 変更内容

```typescript
async function isFacilityUnavailable(guide: SingleCallNavigatorGuide): Promise<boolean> {
  // JEVが利用可能な場合、段階的判定を実施
  if (isJevAvailable()) {
    const jevConfig = createJevConfig();
    if (jevConfig) {
      // Phase 1: Retry gate判定（unavailableの意味的判定によるretry削減）
      try {
        const retryGateDecision = await evaluateRetryGate(guide.facility, jevConfig);
        if (retryGateDecision.reason) {
          console.log(`[single-call-navigator] JEV retry gate: ${retryGateDecision.shouldRetry} (${retryGateDecision.reason})`);
        }
        // Phase 1が retry不要と判定 → 確定（Phase 2-Cは呼ばない）
        if (!retryGateDecision.shouldRetry) {
          console.log(`[single-call-navigator] Phase 1でretry不要と判定、Phase 2-Cをスキップ`);
          return false;
        }
        // Phase 1が retry必要と判定 → Phase 2-Cでさらに詳細判定
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[single-call-navigator] JEV retry gate evaluation failed, falling back to Phase 2-C:", message);
        // Phase 2-Cへフォールバック
      }
      
      // Phase 2-C: Facility完全性評価（confirmedでgate/exitの片方のみをキャッチ）
      try {
        const completenessDecision = await evaluateFacilityCompleteness(guide.facility, jevConfig);
        if (completenessDecision.reason) {
          console.log(`[single-call-navigator] JEV completeness: ${completenessDecision.reason}`);
        }
        return completenessDecision.shouldRetry;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[single-call-navigator] JEV completeness evaluation failed, falling back to rule-based:", message);
        // ルールベースへフォールバック
      }
    }
  }
  
  // 最終フォールバック: gate AND exit 必須のルールベース判定
  // （既存コードのまま）
  // ...
}
```

#### 効果

- Phase 1でretry不要と判定された場合、Phase 2-Cの呼び出し（約1秒）をスキップ
- retry不要ケース（confirmed + gate + exit）では、レイテンシが約1秒削減

---

## 3. テスト計画

### 3.1 ローカルテスト

**目的**: 実装の動作確認、基本的なバグの検出

**手順**:

1. **単体テスト**
   ```bash
   npm test -- single-call-navigator.test.ts
   npm test -- JevClient.test.ts
   ```

2. **統合テスト**
   ```bash
   npm run dev
   # ブラウザで西谷駅→横浜駅を実行
   # ログで予算管理・JEVタイムアウトを確認
   ```

### 3.2 Preview環境テスト（N=10）

**目的**: タイムアウト率・BothHit率の測定

**手順**:

1. **feature branchをプッシュ**
   ```bash
   git checkout -b cursor/timeout-mitigation-5610
   git add .
   git commit -m "feat: タイムアウト対策（予算管理されたRetry + JEVタイムアウト延長）"
   git push -u origin cursor/timeout-mitigation-5610
   ```

2. **Vercel Preview URLを取得**
   - GitHub PR作成後、VercelがPreview URLをコメント

3. **N=10 テスト実行**
   - 西谷駅→横浜駅を10回実行
   - 各実行で以下を記録:
     - タイムアウトしたか？
     - BothHit（gate + exit）が取得できたか？
     - レイテンシ（first / final）
     - ログ: 予算不足でretryをスキップしたか？

4. **結果集計**

| 実行# | タイムアウト | BothHit | first (秒) | final (秒) | retryスキップ | 備考 |
|------|-------------|---------|-----------|-----------|--------------|------|
| 1    | -           | ✓       | 56        | 56        | -            | -    |
| 2    | -           | ✓       | 58        | 72        | -            | 2回目実行 |
| 3    | -           | ✗       | 60        | 60        | ✓            | 予算不足でスキップ |
| ...  | ...         | ...     | ...       | ...       | ...          | ...  |

**成功基準**:
- タイムアウト率: **10%以下**（1回以下）
- BothHit率: **55%以上**
- レイテンシ p50: 60秒以内
- レイテンシ p95: 120秒以内

### 3.3 本番デプロイ前の確認

**チェックリスト**:

- [ ] Preview N=10 テストで成功基準を達成
- [ ] ログに異常なエラーが無い
- [ ] retryスキップが適切に動作している
- [ ] JEVタイムアウト延長の効果が確認できた
- [ ] TypeScriptのコンパイルエラーが無い
- [ ] 既存のテストが通る

---

## 4. ロールバック計画

### 4.1 Preview環境での失敗

**条件**: N=10 テストで成功基準を達成できない

**対処**:
1. feature branchを本番マージせず放置
2. パラメータ調整（MIN_RETRY_TIME_MS、RETRY_BUDGET_MS）を試行
3. 再度Preview N=10テスト

### 4.2 本番環境での問題発覚

**条件**: 本番デプロイ後、ユーザーからの不具合報告または監視アラート

**対処**:
1. **即座にrevert PR作成**
   ```bash
   git checkout main
   git pull origin main
   git revert <commit-hash>
   git push origin revert-timeout-mitigation
   gh pr create --title "revert: タイムアウト対策のロールバック" --body "本番環境で問題が発覚したため、一時的にロールバックします。"
   ```

2. revert PRをマージして本番を以前の状態に戻す
3. Preview環境で再検証し、問題を修正
4. 修正版を再度テスト → 本番デプロイ

---

## 5. モニタリング指標

### 5.1 Vercelログ

**監視対象**:

```typescript
console.warn("[single-call-navigator] 残り予算不足のためretryをスキップ");
console.warn("[single-call-navigator] 再試行が例外で失敗、1回目の結果を採用");
console.log("[single-call-navigator] Phase 1でretry不要と判定、Phase 2-Cをスキップ");
```

**確認項目**:
- retryスキップの頻度
- 1回目の例外の頻度
- Phase 2-Cスキップの頻度

### 5.2 Langfuse（LLM監視）

**監視対象**:
- Gemini呼び出しの所要時間
- Geminiの成功率
- JEV呼び出しの所要時間
- JEVの成功率

**確認項目**:
- Geminiのp50/p95レイテンシ
- Geminiのエラー率
- JEVのタイムアウト率

---

## 6. パラメータ調整ガイド

### 6.1 RETRY_BUDGET_MS

**現在値**: 200秒

**調整の指針**:

| 値 | 効果 | リスク |
|---|---|---|
| 180秒 | retryスキップ頻度が増加 → タイムアウト率削減 | BothHit率低下 |
| 200秒（現在） | バランス | - |
| 220秒 | retry機会が増加 → BothHit率向上 | タイムアウトリスク増加 |

**調整タイミング**:
- Preview N=10でタイムアウト率が15%を超える場合: 180秒に短縮
- retryスキップ頻度が50%を超える場合: 220秒に延長

### 6.2 MIN_RETRY_TIME_MS

**現在値**: 60秒

**調整の指針**:

| 値 | 効果 | リスク |
|---|---|---|
| 40秒 | retry機会が増加 → BothHit率向上 | 2回目がタイムアウトする確率増加 |
| 60秒（現在） | バランス | - |
| 80秒 | retryスキップ頻度が増加 → タイムアウト率削減 | BothHit率低下 |

**調整タイミング**:
- retryスキップ頻度が50%を超える場合: 40秒に短縮
- 2回目のタイムアウト頻度が高い場合: 80秒に延長

### 6.3 JEV DEFAULT_TIMEOUT_MS

**現在値**: 1秒 → 変更後: 2秒

**調整の指針**:

| 値 | 効果 | リスク |
|---|---|---|
| 1.5秒 | JEV成功率向上（控えめ） | fail-open時のオーバーヘッド増加（控えめ） |
| 2秒（推奨） | JEV成功率向上 | fail-open時のオーバーヘッド増加 |
| 3秒 | JEV成功率向上（最大） | fail-open時のオーバーヘッド増加（大） |

**調整タイミング**:
- まず1.5秒に延長して効果を測定
- JEV成功率が改善されたら2秒に延長
- 2秒でも成功率が低い場合: 3秒に延長（最終手段）

---

## 7. まとめ

### 7.1 実装の優先順位

1. **予算管理されたRetry**（必須）
   - 効果: タイムアウト率 -15〜20%
   - 実装時間: 1〜2時間

2. **JEVタイムアウトの延長**（推奨）
   - 効果: タイムアウト率 -2〜3%
   - 実装時間: 5分

3. **Phase 2-Cスキップ条件**（推奨）
   - 効果: レイテンシ削減 -1秒
   - 実装時間: 30分

### 7.2 期待される改善効果

- **タイムアウト率**: 30% → **10%以下**
- **BothHit率**: 60% → **55〜60%**（目標80%未達だが、タイムアウト回避を優先）
- **レイテンシ**: 最悪233秒 → **最悪200秒**

### 7.3 次のアクション

1. feature branch作成: `cursor/timeout-mitigation-5610`
2. 実装（優先度1〜3）
3. ローカルテスト
4. Preview N=10テスト
5. 成功基準達成 → PR作成 → レビュー → 本番マージ
