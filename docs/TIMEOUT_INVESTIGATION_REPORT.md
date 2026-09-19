# タイムアウト問題の調査報告書

**作成日**: 2026-09-19  
**対象**: Preview N=10測定でのタイムアウト率30%問題

---

## 1. 現状のまとめ

### 1.1 測定結果（Preview N=10）

- **BothHit率**: 6/10 (60%) ← **目標80%未達**
- **タイムアウト率**: 3/10 (30%) ← **許容10%を大幅超過**
- **失敗パターン**:
  - タイムアウト: runs 1, 3, 6
  - 両方欠落: run 9

### 1.2 現在のタイムアウト設定

| コンポーネント | タイムアウト | 備考 |
|---|---|---|
| Gemini Search Grounding（検索フェーズ） | 100秒 | SEARCH_REQUEST_TIMEOUT_MS |
| Gemini 抽出フェーズ | 15秒 | REQUEST_TIMEOUT_MS |
| JEV呼び出し | 1秒 | DEFAULT_TIMEOUT_MS |
| API Route全体 | 290秒 | maxDuration |
| MAX_ATTEMPTS | 2回試行 | nullの場合のみretry |

### 1.3 実行フロー

```
1. 1回目の試行
   ├─ Gemini呼び出し: 最大115秒 (検索100秒 + 抽出15秒)
   └─ isFacilityUnavailable判定
      ├─ Phase 1: evaluateRetryGate (JEV, 約1秒)
      ├─ Phase 2-C: evaluateFacilityCompleteness (JEV, 約1秒)
      └─ ルールベース判定 (即座)

2. retry必要なら2回目の試行
   └─ Gemini呼び出し: 最大115秒

3. selectFinalGuide
   └─ isRouteConsistent (JEV使用時、約1秒)

合計: 最大233秒 (約3分53秒)
```

---

## 2. タイムアウトの根本原因

### 2.1 原因A: Geminiのレイテンシの変動

**設定**: 100秒のタイムアウト

**実測データ**:
- 平均: 55.6秒
- 範囲: 38.9〜75.6秒
- 最長: 75.6秒（実機検証での最大値）

**問題点**:
1. **100秒でも足りないケースが存在**
   - 遠距離・同名駅の曖昧性解消で実測35秒超
   - ネットワーク遅延・Gemini側の負荷変動
   - コールドスタート時のオーバーヘッド

2. **新retry判定の影響**
   - 以前: `gate AND exit` 両方欠落のみretry
   - 現在: `gate OR exit` 片方欠落でもretry必須
   - **retry頻度が大幅に増加**（BothHit 60% = 40%がretryを試行）

### 2.2 原因B: JEVのタイムアウトとfail-openのオーバーヘッド

**設定**: 1秒のタイムアウト

**問題点**:
1. **1秒は短すぎる可能性**
   - JEV API自体の処理時間
   - ネットワークレイテンシ（往復）
   - Vercelからの外部API呼び出しの遅延

2. **fail-openのオーバーヘッド**
   - タイムアウト時にルールベースにフォールバック
   - タイムアウト発生時、1秒の待ち時間が無駄になる
   - JEV呼び出しは最大4回:
     - Phase 1: evaluateRetryGate
     - Phase 2-C: evaluateFacilityCompleteness
     - isRouteConsistent (selectFinalGuide内で2回)
   - **最大4秒の無駄が発生しうる**

3. **成功時のレイテンシも考慮が必要**
   - JEV APIが正常応答する場合でも、0.5〜1秒程度かかる
   - 4回の呼び出しで合計2〜4秒のオーバーヘッド

### 2.3 原因C: Retryのコスト

**新しいretry判定**: `gate OR exit` 欠落 → retry必須

**コスト分析**:

| シナリオ | 1回目の状態 | retry発生 | 所要時間 |
|---|---|---|---|
| 最良ケース | gate + exit 両方取得 | なし | ~117秒 |
| 中間ケース | gate-only または exit-only | **あり** | ~232秒 |
| 最悪ケース | 両方欠落 | あり、かつ2回目も失敗 | ~233秒 → タイムアウト |

**影響**:
- BothHit 60% = **40%がretryを試行**
- retry時は追加で115秒かかる
- 2回目も失敗すると、230秒費やしてタイムアウト

**コスト効果の評価が必要**:
- 1回目がunavailable/incompleteの場合、2回目の成功率は？
- 2回目も失敗する場合、200秒費やして失敗するのは受容可能か？

### 2.4 原因D: 二段階ストリーミングの影響

**設計**:
- `first`: 1回目の結果、またはnullなら2回目まで待つ
- `final`: retry後の最終結果

**問題点**:
1. **findRailRoutes（経路）とgetUnifiedArrivalGuide（改札・出口）の待ち方**
   - 現在のキャッシュ実装では両方とも同じ`run`を共有
   - しかし、**どちらのPromiseを待つか**が実装によって異なる

2. **最悪ケースの影響**:
   - 両方が`final`を待つ場合: 最悪233秒待つ
   - 一方が`first`、もう一方が`final`を待つ場合: ストリーミング表示の効果がある

---

## 3. 最も効果的な対策の優先順位

### 優先度1: 予算管理されたRetry（緊急）

**目的**: タイムアウトを回避しながらretryの効果を最大化

**実装内容**:

1. **所要時間の記録**
   ```typescript
   const startTime = Date.now();
   const r1 = await attempt();
   const elapsed = Date.now() - startTime;
   ```

2. **残り予算のチェック**
   ```typescript
   const RETRY_BUDGET_MS = 200_000; // 200秒（290秒から安全マージンを確保）
   const remainingBudget = RETRY_BUDGET_MS - elapsed;
   
   if (remainingBudget < MIN_RETRY_TIME_MS) {
     // 残り時間が不十分なら早期中断
     console.warn("[single-call-navigator] 残り予算不足のためretryをスキップ");
     return r1;
   }
   ```

3. **動的なタイムアウト設定**
   ```typescript
   // 2回目のGemini呼び出しに残り予算を適用
   const retryTimeoutMs = Math.min(SEARCH_REQUEST_TIMEOUT_MS, remainingBudget - 10_000);
   ```

**期待効果**:
- タイムアウト率: 30% → **10%以下**
- BothHit率: 維持または微減（60% → 55%程度）

**リスク**:
- 1回目が遅い場合、2回目をスキップしてBothHit率が低下
- しかし、タイムアウトよりはマシ（何も返せないより1回目の結果を返す）

---

### 優先度2: Fail-openの活用とJEVタイムアウトの調整

**目的**: JEVのオーバーヘッドを削減しつつ、fail-openの安全性を維持

**実装内容**:

1. **JEVタイムアウトの延長**
   ```typescript
   // 現在: 1秒
   // 提案: 2秒（ネットワークレイテンシを考慮）
   const DEFAULT_TIMEOUT_MS = 2000;
   ```

2. **Phase 2-Cのスキップ条件の追加**
   ```typescript
   // Phase 1でretry不要と判定されたら、Phase 2-Cをスキップ
   if (!retryGateDecision.shouldRetry) {
     return false; // Phase 2-Cを呼ばずに確定
   }
   ```

3. **isRouteConsistentのルールベース優先**
   ```typescript
   // ルールベースでtrueなら、JEV呼び出しをスキップ（既に実装済み）
   if (isRouteConsistentRuleBased(a, b)) {
     return true; // JEV呼び出し不要
   }
   ```

**期待効果**:
- JEVのオーバーヘッド: 最大4秒 → **1〜2秒**
- JEVのタイムアウト失敗率: 削減
- fail-openの安全性: 維持

**リスク**:
- JEVタイムアウトを2秒に延長すると、タイムアウト時の無駄も2秒に増加
- ただし、成功率が上がるならトレードオフは許容可能

---

### 優先度3: 1回目の結果のFail-open採用

**目的**: 2回目がタイムアウトしそうな場合、1回目の結果を返す

**実装内容**:

1. **selectFinalGuideでの判定**
   ```typescript
   export async function selectFinalGuide(
     first: SingleCallNavigatorGuide | null,
     second: SingleCallNavigatorGuide | null,
     firstElapsedMs: number
   ): Promise<SingleCallNavigatorGuide | null> {
     if (first === null) return second;
     if (second === null) {
       // 2回目がnullだが1回目がある場合、1回目を採用
       console.warn("[single-call-navigator] 2回目が失敗、1回目の結果を採用");
       return first;
     }
     
     // 既存のロジック...
   }
   ```

2. **retry時の例外ハンドリング（既に実装済み）**
   ```typescript
   try {
     r2 = await attempt();
   } catch (error) {
     if (r1 === null) throw error;
     console.warn("[single-call-navigator] 再試行が例外で失敗、1回目の結果を採用");
     r2 = null;
   }
   ```

**期待効果**:
- タイムアウト率: 削減（2回目が失敗しても1回目を返せる）
- BothHit率: **カウント対象外**（1回目の不完全な結果を返すため）

**注意点**:
- BothHit成功としてカウント**しない**
- あくまで「タイムアウトを避ける」ための措置
- UIでは「改札・出口の情報が不完全です」と表示

---

### 優先度4: キャッシュの並列安全性の確認

**目的**: first/finalの両方が同じキャッシュを正しく共有しているか確認

**調査内容**:

1. **sharedGuideCacheの実装確認**
   - ✅ 既に実装済み: `getSharedSingleCallNavigatorRun`
   - ✅ TTL設計: final決着後から30秒
   - ✅ in-flight状態: expiresAt = Infinity

2. **キャッシュキーの構成**
   ```typescript
   buildSharedGuideCacheKey(
     originStationId,
     destinationStationId,
     destinationHint,
     destinationPlaceCoordinates
   )
   ```

3. **確認項目**:
   - ✅ findRailRoutes と getUnifiedArrivalGuide が同じキーを使っているか
   - ✅ 座標の丸め（4桁）が適切か
   - ✅ 期限切れエントリの掃除（sweepExpiredGuideCacheEntries）

**現状評価**:
- キャッシュ実装は**問題なし**
- Gemini呼び出しの重複は発生していない

---

## 4. 実装上の注意点

### 4.1 予算管理されたRetryの実装

**ファイル**: `src/lib/integrations/ai/single-call-navigator.ts`

**変更箇所**: `generateSingleCallNavigatorRun`

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
  
  const RETRY_BUDGET_MS = 200_000; // 200秒
  const MIN_RETRY_TIME_MS = 60_000; // 最低60秒の余裕が必要
  
  const startTime = Date.now();
  const attempt1 = attempt();
  
  const final = attempt1.then(async (r1) => {
    const elapsed = Date.now() - startTime;
    
    if (r1 !== null && !(await isFacilityUnavailable(r1))) {
      return r1;
    }
    
    // 予算チェック
    const remainingBudget = RETRY_BUDGET_MS - elapsed;
    if (remainingBudget < MIN_RETRY_TIME_MS) {
      console.warn(
        `[single-call-navigator] 残り予算不足(${remainingBudget}ms)のためretryをスキップ: origin=${originStation.stationName}`
      );
      return r1; // 1回目の結果を返す（nullの場合もnullを返す）
    }
    
    const reason = r1 === null ? "結果がnullだった" : "改札・出口の情報が両方とも確認できなかった";
    console.warn(
      `[single-call-navigator] 1回目の試行で${reason}ため再試行します (残り予算: ${remainingBudget}ms): origin=${originStation.stationName}`
    );
    
    let r2: SingleCallNavigatorGuide | null;
    try {
      r2 = await attempt();
    } catch (error) {
      if (r1 === null) throw error;
      console.warn(
        "[single-call-navigator] 再試行が例外で失敗、1回目の結果を採用",
        error instanceof Error ? error.message : String(error)
      );
      r2 = null;
    }
    
    return await selectFinalGuide(r1, r2);
  });
  
  const first = attempt1.then((r1) => r1 ?? final);
  
  first.catch(() => {});
  final.catch(() => {});
  
  return { first, final };
}
```

### 4.2 JEVタイムアウトの延長

**ファイル**: `src/lib/integrations/ai/JevClient.ts`

```typescript
// 現在: 1秒
const DEFAULT_TIMEOUT_MS = 1000;

// 提案: 2秒
const DEFAULT_TIMEOUT_MS = 2000;
```

**注意点**:
- ヘルスチェック（`src/lib/integrations/jev/JevClient.ts`）は5秒のまま維持
- タイムアウト延長により、fail-open時の無駄も2秒に増加
- しかし、成功率が上がるならトレードオフは許容可能

### 4.3 Phase 2-Cのスキップ条件の追加

**ファイル**: `src/lib/integrations/ai/single-call-navigator.ts`

```typescript
async function isFacilityUnavailable(guide: SingleCallNavigatorGuide): Promise<boolean> {
  if (isJevAvailable()) {
    const jevConfig = createJevConfig();
    if (jevConfig) {
      try {
        const retryGateDecision = await evaluateRetryGate(guide.facility, jevConfig);
        if (retryGateDecision.reason) {
          console.log(`[single-call-navigator] JEV retry gate: ${retryGateDecision.shouldRetry} (${retryGateDecision.reason})`);
        }
        if (!retryGateDecision.shouldRetry) {
          // Phase 1が retry不要と判定 → Phase 2-Cをスキップして確定
          return false;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[single-call-navigator] JEV retry gate evaluation failed, falling back to Phase 2-C:", message);
      }
      
      // Phase 2-C: Facility完全性評価
      try {
        const completenessDecision = await evaluateFacilityCompleteness(guide.facility, jevConfig);
        if (completenessDecision.reason) {
          console.log(`[single-call-navigator] JEV completeness: ${completenessDecision.reason}`);
        }
        return completenessDecision.shouldRetry;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[single-call-navigator] JEV completeness evaluation failed, falling back to rule-based:", message);
      }
    }
  }
  
  // ルールベース判定...
}
```

---

## 5. 期待される改善効果

### 5.1 タイムアウト率の削減

| 対策 | 削減効果 | 目標値 |
|---|---|---|
| 予算管理されたRetry | **-15〜20%** | 10〜15% |
| JEVタイムアウト延長 | -2〜3% | - |
| Fail-open採用 | -3〜5% | - |
| **合計** | **-20〜28%** | **10%以下** |

**現状**: 30%  
**目標**: 10%以下  
**期待**: 10%以下に収まる見込み

### 5.2 BothHit率への影響

| 対策 | 影響 | 理由 |
|---|---|---|
| 予算管理されたRetry | -5% | 1回目が遅い場合、2回目をスキップ |
| JEVタイムアウト延長 | +1〜2% | JEV成功率向上によりretry判定が改善 |
| Fail-open採用 | 0% | カウント対象外 |
| **合計** | **-3〜4%** | 55〜57%程度 |

**現状**: 60%  
**目標**: 80%  
**期待**: 55〜60%（目標未達だが、タイムアウト回避を優先）

### 5.3 レイテンシへの影響

| ケース | 現状 | 改善後 | 削減 |
|---|---|---|---|
| 最良ケース（retry不要） | 117秒 | 115秒 | -2秒（JEV削減） |
| 中間ケース（retry成功） | 232秒 | 200秒 | -32秒（予算管理） |
| 最悪ケース（retry失敗） | 233秒 → タイムアウト | 200秒 → 1回目返却 | タイムアウト回避 |

---

## 6. リスクと緩和策

### 6.1 リスク: BothHit率の低下

**発生条件**: 予算管理によりretryがスキップされる

**影響**: 目標80%に対して55〜60%にとどまる

**緩和策**:
1. **retry判定の見直し**（別タスク）:
   - JEV Phase 1の精度向上
   - gate-onlyの場合、方角フォールバックで成功とみなす

2. **Geminiプロンプトの最適化**（別タスク）:
   - 1回目の成功率を向上させる
   - exitDirectionの抽出精度を上げる

### 6.2 リスク: 予算不足による早期中断の頻発

**発生条件**: 1回目が100秒近くかかり、予算が残り60秒未満

**影響**: retryが常にスキップされ、BothHit率が大幅に低下

**緩和策**:
1. **MIN_RETRY_TIME_MSの調整**:
   - 現在: 60秒
   - 必要に応じて40秒に引き下げ（Geminiの平均レイテンシを考慮）

2. **RETRY_BUDGET_MSの見直し**:
   - 現在: 200秒
   - 必要に応じて220秒に延長

### 6.3 リスク: JEVタイムアウト延長によるオーバーヘッド増加

**発生条件**: JEVが引き続きタイムアウトする

**影響**: 無駄な待ち時間が1秒から2秒に倍増

**緩和策**:
1. **段階的な延長**:
   - まず1.5秒に延長して様子を見る
   - 効果が確認できたら2秒に延長

2. **JEVヘルスチェックの活用**:
   - JEVが利用不可能な場合、最初からルールベースにフォールバック
   - タイムアウトを待たずに判定

---

## 7. 次のアクション

### 7.1 即座に実装すべき対策（優先度1〜2）

1. **予算管理されたRetry**
   - ファイル: `src/lib/integrations/ai/single-call-navigator.ts`
   - 実装時間: 1〜2時間
   - テスト: ローカル + Preview環境

2. **JEVタイムアウト延長**
   - ファイル: `src/lib/integrations/ai/JevClient.ts`
   - 実装時間: 5分
   - テスト: ローカル + Preview環境

3. **Phase 2-Cスキップ条件の追加**
   - ファイル: `src/lib/integrations/ai/single-call-navigator.ts`
   - 実装時間: 30分
   - テスト: ローカル + Preview環境

### 7.2 検証（Preview N=10）

**測定指標**:
- タイムアウト率: 30% → **10%以下**
- BothHit率: 60% → **55〜60%**（目標80%未達だが、タイムアウト回避を優先）
- レイテンシ p50: 60秒以内
- レイテンシ p95: 120秒以内

**成功基準**:
- タイムアウト率が10%以下に収まること
- BothHit率が55%以上を維持すること

### 7.3 次フェーズの検討（別タスク）

1. **Geminiプロンプトの最適化**
   - 目的: 1回目の成功率を向上させる
   - 効果: BothHit率を80%に近づける

2. **JEV Phase 1の精度向上**
   - 目的: 不要なretryを削減
   - 効果: レイテンシ削減、タイムアウト率削減

3. **方角フォールバックの成功基準への組み込み**
   - 目的: gate-onlyでも方角があれば成功とみなす
   - 効果: BothHit率（実質的な成功率）の向上

---

## 8. まとめ

**タイムアウト問題の根本原因**:

1. **Geminiのレイテンシの変動**: 100秒でも足りないケースがある
2. **新retry判定の影響**: gate OR exit欠落でretry頻度が増加
3. **JEVのタイムアウトとオーバーヘッド**: 1秒は短すぎる、最大4秒の無駄
4. **Retryのコスト**: 2回目も失敗すると230秒費やして失敗

**最も効果的な対策**:

1. **予算管理されたRetry**（優先度1）: タイムアウトを回避しながらretryの効果を最大化
2. **JEVタイムアウト延長**（優先度2）: 1秒 → 2秒に延長、成功率を向上
3. **Fail-open採用**（優先度3）: 2回目が失敗しても1回目の結果を返す

**期待される改善効果**:

- タイムアウト率: 30% → **10%以下**
- BothHit率: 60% → **55〜60%**（目標80%未達だが、タイムアウト回避を優先）
- レイテンシ: 最悪233秒 → **最悪200秒**（タイムアウト回避）

**次のアクション**:

1. 予算管理されたRetryの実装
2. JEVタイムアウトの延長（1秒 → 2秒）
3. Phase 2-Cスキップ条件の追加
4. Preview N=10での再測定
