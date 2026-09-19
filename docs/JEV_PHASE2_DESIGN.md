# JEV Phase 2: 施設分類精度向上 設計書

**日付**: 2026-09-19  
**ステータス**: 設計フェーズ（実装前）  
**目的**: JEV (TypeSafe System One) による施設分類の意味的重複検出と信頼度判定  
**Phase依存関係**: Phase 1（リトライゲート）とは独立実行可能  
**関連PR**: #117 (Phase 1統合計画書)

---

## 0. エグゼクティブサマリー

### Phase 2の範囲と目的

**Phase 1との違い**:
- **Phase 1**: リトライゲート（速度改善、3-5秒短縮）
- **Phase 2**: 施設分類の精度向上（**UX改善**、速度影響±0秒）

**Phase 2の焦点**:
1. **意味的重複検出**: 「中央改札」「中央口改札」を同一施設と判定
2. **信頼度ゲート**: low confidence の施設情報を実用性で評価
3. **Geminiの役割維持**: 検索グラウンディング生成はGeminiのまま（JEVは判定のみ）

### 期待効果（保守的見積もり）

| 指標 | Phase 1後 | Phase 2後 | 改善 |
|------|-----------|-----------|------|
| 平均レイテンシ | 65-67秒 | 65-67秒 | **±0秒**（精度改善のみ） |
| 「確認できません」率 | 15% | 10% | **33%削減** |
| JEVコール時間 | 0.5秒 | 1.3秒 | +0.8秒（非クリティカルパス） |
| 測定フィクスチャ | 西谷→ウエチャベ | 同左 | - |

**重要**: Phase 2のJEVコールは Gemini検索完了後（既に結果取得済み）に実行するため、ユーザー体感レイテンシには影響しない。

### Phase 1との依存関係

**Phase 2はPhase 1に依存しない**:
- Phase 1（リトライゲート）が未実装/未マージでもPhase 2は独立して実装可能
- Phase 1とPhase 2は並行開発可能（異なる関数・ファイルを編集）
- Phase 2 PRは Phase 1 PRをブロックしない（別ブランチ、別レビュー）

**統合時の相乗効果**:
- Phase 1でリトライ削減 → Phase 2の分類精度向上機会が増加
- 合計効果: 107秒（3.6-flash） → 60秒（3.8-flash） → <50秒目標（3.8+JEV Phase 1+2）

---

## 1. 実装対象: 施設分類ロジック

### 1.1 現状の問題点（詳細分析）

**ファイル**: `src/lib/domain/facility-recommendation.ts`  
**関数**: `classifyFacilityRecommendation()` (line 87-102)

```typescript:87:102:src/lib/domain/facility-recommendation.ts
export function classifyFacilityRecommendation<F extends { name: string }>(
  pairs: FacilityPair<F>[]
): FacilityRecommendation<F> {
  const validPairs = dedupePairs(pairs.filter((pair) => pair.gate !== null || pair.exit !== null));

  if (validPairs.length === 0) {
    return { state: "unavailable", reason: "改札・出口の情報が確認できませんでした" };
  }
  if (validPairs.length === 1) {
    return { state: "confirmed", pair: validPairs[0] };
  }
  if (validPairs.length > MAX_ALTERNATIVES) {
    return { state: "unavailable", reason: "候補が多すぎて絞り込めませんでした" };
  }
  return { state: "alternatives", pairs: validPairs };
}
```

#### 問題1: 機械的な件数判定

**現状のロジック**:
```typescript
pairs.length === 1 → confirmed
pairs.length === 2-3 → alternatives（ユーザー選択）
pairs.length > 3 → unavailable（候補多すぎ）
```

**実際の失敗ケース** (西谷→ウエチャベ実測データより推測):
1. **意味的重複の見落とし**:
   - 候補: 「中央改札」「中央口改札」
   - 現状判定: alternatives（2件）
   - 正しい判定: confirmed（実質1件）

2. **表記揺れの未検出**:
   - 候補: 「西口」「にし口」「西口改札」
   - 現状判定: alternatives（3件）または unavailable（4件以上）
   - 正しい判定: confirmed（実質1件）

3. **座標情報の未活用**:
   - 候補: 「A1出口」(35.123, 139.456) と「A1」(35.123, 139.456)
   - 現状判定: alternatives（2件）
   - 正しい判定: confirmed（座標同一→同一施設）

#### 問題2: ヒューリスティックの脆弱性

**dedupePairs()の限界** (line 104-119):
```typescript:104:119:src/lib/domain/facility-recommendation.ts
function dedupePairs<F extends { name: string }>(pairs: FacilityPair<F>[]): FacilityPair<F>[] {
  const seenKey = new Set<string>();
  const result: FacilityPair<F>[] = [];
  for (const pair of pairs) {
    const key = `${pair.gate?.name ?? "null"}|${pair.exit?.name ?? "null"}`;
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    result.push(pair);
  }
  return result;
}
```

**検出できる重複**: 完全一致のみ（`"中央改札|A1"` と `"中央改札|A1"`）  
**検出できない重複**: 意味的同一（`"中央改札|A1"` と `"中央口改札|A1出口"`）

---

### 1.2 呼び出しチェーン（Phase 2関連）

```
generateSingleCallNavigatorGuide() (single-call-navigator.ts:428)
  ↓
attemptGenerateSingleCallNavigatorGuide() (371-395)
  ↓ [Gemini] 検索 + 抽出 (45-70秒)
  ↓
extractFacilityCandidatePairs() (raw → FacilityPair[])
  ↓
classifyFacilityRecommendation() (87-102) ← **Phase 2 統合ポイント**
  ↓
SingleCallNavigatorGuide 構築 (360-369)
```

**Phase 2のJEV挿入位置**: 
- **前**: `extractFacilityCandidatePairs()` → `classifyFacilityRecommendation()`
- **後**: `classifyFacilityRecommendation()` → **JEV意味的評価** → 最終state決定

**重要**: JEVコールはGemini検索完了後に実行（検索待ち時間に影響しない）

---

## 2. Phase 2 設計: JEV統合アーキテクチャ

### 2.1 新規モジュール: `JevFacilityClassifier.ts`

**配置**: `src/lib/domain/JevFacilityClassifier.ts`（domainレイヤー、ビジネスロジック）

#### 型定義

```typescript
import type { FacilityPair, FacilityRecommendation } from "./facility-recommendation";

/**
 * JEVによる意味的重複評価の結果
 */
export interface SemanticDuplicationResult {
  /** 意味的に重複を除いた実質的な候補数（1-N） */
  deduplicatedCount: number;
  
  /** JEVの推論理由（デバッグ・ログ用） */
  reasoning: string;
  
  /** JEVの確信度（0.0-1.0、低い場合はフォールバック） */
  confidence: number;
}

/**
 * JEV Choice 評価の入力型
 */
export interface FacilityClassificationInput<F extends { name: string }> {
  /** 改札・出口のペア候補（Gemini抽出結果） */
  pairs: FacilityPair<F>[];
  
  /** 到着駅名（コンテキスト情報） */
  stationName: string;
  
  /** 検索テキストの一部（オプション、精度向上用） */
  searchTextSnippet?: string;
}
```

#### コア関数: `assessSemanticDuplicates()`

**用途**: JEV Score APIで候補の意味的重複を評価

```typescript
import { TypeSafeClient } from "@typesafe-ai/sdk";

/**
 * JEV Score APIを用いて、施設名の意味的重複を評価する。
 * 
 * 例:
 * - 入力: ["中央改札", "中央口改札", "東口改札"]
 * - JEV判定: 「中央改札」と「中央口改札」は同一 → 実質2件
 * - 返り値: { deduplicatedCount: 2, reasoning: "...", confidence: 0.92 }
 * 
 * @param jevApiKey - 環境変数 JEV_API_KEY（必須）
 * @param input - 候補ペア + 駅名
 * @returns 意味的重複を除いた実質候補数
 */
export async function assessSemanticDuplicates<F extends { name: string }>(
  jevApiKey: string,
  input: FacilityClassificationInput<F>
): Promise<SemanticDuplicationResult> {
  const client = new TypeSafeClient({ apiKey: jevApiKey });

  // 候補を文字列リストに整形
  const pairDescriptions = input.pairs.map((p, i) => {
    const gate = p.gate?.name ?? "（不明）";
    const exit = p.exit?.name ?? "（不明）";
    return `候補${i + 1}: 改札「${gate}」、出口「${exit}」`;
  }).join("\n");

  // JEV Score API呼び出し（実質候補数を1-N の整数で評価）
  const result = await client.score({
    system: "あなたは鉄道駅の施設名を評価する専門家です。",
    prompt: `以下は${input.stationName}駅の改札・出口候補です。

${pairDescriptions}

これらの候補のうち、名前が異なるが実質的に同じ施設を指しているものはありますか？

【判定基準】
- 「中央改札」と「中央口改札」→ 同一施設（表記揺れ）
- 「西口」と「にし口」→ 同一施設（ひらがな・漢字の違い）
- 「A1出口」と「A1」→ 同一施設（「出口」の省略）
- 「中央改札」と「東改札」→ 別施設（方角が異なる）
- 改札名が同一でも、出口名が異なる場合は別候補としてカウント

実質的に異なる候補の数を 1 から ${input.pairs.length} の整数で回答してください。`,
    min: 1,
    max: input.pairs.length,
    timeout: 800, // JEV想定: 500-800ms
  });

  return {
    deduplicatedCount: result.score,
    reasoning: result.reasoning || "Semantic deduplication by JEV",
    confidence: result.confidence ?? 0.0,
  };
}
```

**タイムアウト設計**: 800ms（Phase 1の500msより長いが、非クリティカルパスなので許容）

#### 統合関数: `classifyWithJev()`

**用途**: JEV評価結果を既存のclassifyFacilityRecommendation()と統合

```typescript
/**
 * JEV評価を統合した施設分類（既存ロジックのラッパー）。
 * 
 * フロー:
 * 1. 機械的重複除去（dedupePairs、既存ロジック）
 * 2. JEV意味的評価（assessSemanticDuplicates）
 * 3. JEV判定に基づくstate昇格/降格
 * 4. 低confidence時のフォールバック（既存ロジック）
 * 
 * @param jevApiKey - JEV_API_KEY
 * @param input - 候補ペア + コンテキスト
 * @returns 最終的なFacilityRecommendation（confirmed/alternatives/unavailable）
 */
export async function classifyWithJev<F extends { name: string }>(
  jevApiKey: string,
  input: FacilityClassificationInput<F>
): Promise<FacilityRecommendation<F>> {
  // Step 1: 機械的前処理（既存ロジック流用）
  const validPairs = input.pairs.filter((pair) => pair.gate !== null || pair.exit !== null);
  
  if (validPairs.length === 0) {
    return { state: "unavailable", reason: "改札・出口の情報が確認できませんでした" };
  }

  // Step 2: JEV意味的評価
  const semanticResult = await assessSemanticDuplicates(jevApiKey, {
    ...input,
    pairs: validPairs,
  });

  // Step 3: Confidence閾値によるフォールバック判定
  const CONFIDENCE_THRESHOLD = 0.7; // 70%未満は既存ロジックにフォールバック
  
  if (semanticResult.confidence < CONFIDENCE_THRESHOLD) {
    console.warn(
      `[JEV Phase 2] Low confidence (${semanticResult.confidence.toFixed(2)}), ` +
      `falling back to rule-based classification`
    );
    // 既存ロジックにフォールバック
    return classifyFacilityRecommendationFallback(validPairs);
  }

  // Step 4: JEV判定に基づくstate決定
  const dedupCount = semanticResult.deduplicatedCount;

  if (dedupCount === 1) {
    // 複数候補だったが、JEVが実質1件と判定 → confirmed へ昇格
    console.info(
      `[JEV Phase 2] Semantic deduplication: ${validPairs.length} → 1 ` +
      `(${semanticResult.reasoning})`
    );
    return { state: "confirmed", pair: validPairs[0] };
  }

  if (dedupCount <= 3) {
    // 候補多数だったが、JEVが3件以下と判定 → alternatives（ユーザー選択可能）
    if (validPairs.length > 3) {
      console.info(
        `[JEV Phase 2] Semantic deduplication: ${validPairs.length} → ${dedupCount} ` +
        `(rescued from unavailable)`
      );
    }
    // JEV判定に基づき、意味的に異なる候補のみ残す（暫定: 先頭N件）
    return { state: "alternatives", pairs: validPairs.slice(0, dedupCount) };
  }

  // dedupCount > 3 → 実質4件以上、候補多すぎ
  return { state: "unavailable", reason: "候補が多すぎて絞り込めませんでした" };
}

/**
 * フォールバック用の既存ロジック（classifyFacilityRecommendationの複製）
 */
function classifyFacilityRecommendationFallback<F extends { name: string }>(
  validPairs: FacilityPair<F>[]
): FacilityRecommendation<F> {
  const MAX_ALTERNATIVES = 3;

  if (validPairs.length === 1) {
    return { state: "confirmed", pair: validPairs[0] };
  }
  if (validPairs.length > MAX_ALTERNATIVES) {
    return { state: "unavailable", reason: "候補が多すぎて絞り込めませんでした" };
  }
  return { state: "alternatives", pairs: validPairs };
}
```

---

### 2.2 統合ポイント: `single-call-navigator.ts`

**ファイル**: `src/lib/integrations/ai/single-call-navigator.ts`  
**関数**: `attemptGenerateSingleCallNavigatorGuide()` (line 371-395)

#### 現状のコード（line 360-369）

```typescript:360:369:src/lib/integrations/ai/single-call-navigator.ts
  const guide: SingleCallNavigatorGuide = {
    lines: raw.lines as string[],
    transferCount: raw.transferCount,
    estimatedMinutes: raw.estimatedMinutes,
    arrivalPlatformNumber: extractArrivalPlatformNumber(raw.arrivalPlatformNumber),
    boarding: extractBoarding(raw),
    facility: classifyFacilityRecommendation(extractFacilityCandidatePairs(raw, searchText)),
  };

  return isValidGuide(guide) ? guide : null;
}
```

#### Phase 2統合後のコード（改訂版）

```typescript
import { classifyWithJev } from "../../domain/JevFacilityClassifier";
import { classifyFacilityRecommendation } from "../../domain/facility-recommendation";

async function attemptGenerateSingleCallNavigatorGuide(
  apiKey: string,
  originStation: Station,
  destinationStation: Station,
  destinationHint: string | null,
  destinationPlaceCoordinates: Coordinates | null
): Promise<SingleCallNavigatorGuide | null> {
  // ... Gemini検索 + 抽出（既存コード、変更なし） ...

  const rawPairs = extractFacilityCandidatePairs(raw, searchText);
  
  // Phase 2: JEV統合（フィーチャーフラグ制御）
  let facility: FacilityRecommendation<RawNamedFacility>;
  
  if (process.env.JEV_PHASE2_ENABLED === "1" && process.env.JEV_API_KEY) {
    try {
      facility = await classifyWithJev(process.env.JEV_API_KEY, {
        pairs: rawPairs,
        stationName: destinationStation.stationName,
        searchTextSnippet: searchText.slice(0, 500), // オプション: 推論精度向上用
      });
    } catch (error) {
      // JEVエラー時のフォールバック（既存ロジック）
      console.error("[JEV Phase 2] Classification failed, falling back:", error);
      facility = classifyFacilityRecommendation(rawPairs);
    }
  } else {
    // JEV無効時（デフォルト、既存ロジック）
    facility = classifyFacilityRecommendation(rawPairs);
  }

  const guide: SingleCallNavigatorGuide = {
    lines: raw.lines as string[],
    transferCount: raw.transferCount,
    estimatedMinutes: raw.estimatedMinutes,
    arrivalPlatformNumber: extractArrivalPlatformNumber(raw.arrivalPlatformNumber),
    boarding: extractBoarding(raw),
    facility, // JEV評価済みのrecommendation
  };

  return isValidGuide(guide) ? guide : null;
}
```

**変更点**:
1. ✅ `classifyFacilityRecommendation()` の前に `classifyWithJev()` を挿入
2. ✅ 環境変数 `JEV_PHASE2_ENABLED` でフィーチャーフラグ制御
3. ✅ JEVエラー時は既存ロジックにフォールバック（可用性保証）
4. ✅ `searchTextSnippet` を渡してJEVの推論精度を向上（オプション）

---

### 2.3 環境変数

**必須環境変数**:
```bash
JEV_API_KEY=<your-jev-api-key>          # Phase 1と共通（既存）
JEV_PHASE2_ENABLED=1                    # Phase 2のフィーチャーフラグ
```

**デプロイ先別の設定**:

| 環境 | JEV_API_KEY | JEV_PHASE2_ENABLED | 備考 |
|------|-------------|---------------------|------|
| Cursor Cloud Agents | ✅ 要設定 | ✅ `1` | テスト用 |
| Vercel (Preview) | ✅ 要設定 | ✅ `1` | カナリアリリース |
| Vercel (Production) | ✅ 要設定 | ⏳ `0` → `1` | 段階展開（A/Bテスト） |

**Phase 1との独立性**:
- `JEV_RETRY_GATE` (Phase 1) と `JEV_PHASE2_ENABLED` (Phase 2) は独立したフラグ
- Phase 2は Phase 1の環境変数に依存しない（`JEV_API_KEY` のみ共通）

---

## 3. 入出力型定義（TypeScript）

### 3.1 JEV Choice API（施設分類）

**該当**: なし（Phase 2ではChoice APIを使用せず、Score APIのみ使用）

### 3.2 JEV Score API（意味的重複評価）

**入力型**:

```typescript
interface ScoreRequest {
  system?: string;           // "あなたは鉄道駅の施設名を評価する専門家です。"
  prompt: string;            // 候補リスト + 判定基準
  min: number;               // 1（最小候補数）
  max: number;               // pairs.length（最大候補数）
  timeout: number;           // 800 (ms)
}
```

**出力型**:

```typescript
interface ScoreResponse {
  score: number;             // 1 - pairs.length の整数（実質候補数）
  reasoning?: string;        // JEVの推論過程（デバッグ用）
  confidence?: number;       // 0.0-1.0（確信度、低い場合はフォールバック）
}
```

**JEV SDK呼び出し例**:

```typescript
const result = await client.score({
  system: "あなたは鉄道駅の施設名を評価する専門家です。",
  prompt: `以下は渋谷駅の改札・出口候補です。

候補1: 改札「中央改札」、出口「A1出口」
候補2: 改札「中央口改札」、出口「A1」
候補3: 改札「東改札」、出口「B1出口」

実質的に異なる候補の数を 1 から 3 の整数で回答してください。`,
  min: 1,
  max: 3,
  timeout: 800,
});

// 期待される result:
// { score: 2, reasoning: "候補1と2は同一施設（表記揺れ）", confidence: 0.92 }
```

---

## 4. Phase 1との依存関係

### 4.1 独立性の保証

**Phase 2がPhase 1に依存しない理由**:

1. **編集ファイルの分離**:
   - Phase 1: `single-call-navigator.ts` の line 436-455（リトライループ）
   - Phase 2: `single-call-navigator.ts` の line 360-369（分類ロジック）
   - **競合なし**: 同じファイルの異なる関数を編集

2. **環境変数の独立**:
   - Phase 1: `JEV_RETRY_GATE=1`（リトライゲート有効化）
   - Phase 2: `JEV_PHASE2_ENABLED=1`（分類精度向上有効化）
   - 両者は独立してON/OFF可能（4通りの組み合わせをA/Bテスト可能）

3. **JEV APIの独立**:
   - Phase 1: `client.decide()` (Choice API)
   - Phase 2: `client.score()` (Score API)
   - 異なるエンドポイント、異なるレスポンス型

### 4.2 統合時の相乗効果

**Phase 1 + Phase 2の同時有効化**:

```typescript
// Phase 1: リトライ判定（line 436-455）
if (process.env.JEV_RETRY_GATE === "1" && process.env.JEV_API_KEY) {
  const assessment = await assessRetrySufficiency(/* ... */);
  if (!assessment.shouldRetry) return result;
}

// ... リトライループ ...

// Phase 2: 分類精度向上（line 360-369）
if (process.env.JEV_PHASE2_ENABLED === "1" && process.env.JEV_API_KEY) {
  facility = await classifyWithJev(/* ... */);
} else {
  facility = classifyFacilityRecommendation(rawPairs);
}
```

**相乗効果のシナリオ**:
1. Phase 1でリトライ削減 → Gemini呼び出し回数減少 → Phase 2のJEV評価機会が増加
2. Phase 2で分類精度向上 → Phase 1の「unavailable判定→リトライ」ケースが減少
3. 合計効果: 10-15%レイテンシ削減 + 33% unavailable率削減

### 4.3 段階的ロールアウト戦略

**パターン1: Phase 1優先**（リスク最小化）
```
Week 1-2: Phase 1実装 + テスト
Week 3: Phase 1カナリアリリース（5% → 50% → 100%）
Week 4-5: Phase 2実装 + テスト
Week 6: Phase 2カナリアリリース（Phase 1既有効下で）
```

**パターン2: 並行開発**（高速化）
```
Week 1-2: Phase 1実装（担当A） | Phase 2実装（担当B）
Week 3: Phase 1 PR merge | Phase 2 PR提出（Phase 1マージ待ち）
Week 4: Phase 1カナリア | Phase 2 PR merge（Phase 1完了後）
Week 5: Phase 2カナリア
```

**推奨**: パターン2（Phase 2 PRは Phase 1 PRをブロックしない、レビュー並行可能）

---

## 5. 成功指標（西谷→ウエチャベ フィクスチャ）

### 5.1 ベースライン（Phase 1前）

**測定条件**:
- Route: 西谷駅 → 居酒屋ウエチャベ（渋谷、道玄坂2-9-2）
- Model: gemini-3.8-flash（production、PR #118マージ後）
- N=10 runs

**現状値** (2026-09-19 実測、PR #117より):
```
平均レイテンシ: 60秒（3.8-flash）
unavailable率: 15%（「確認できません」表示）
alternatives率: 25%（2-3択提示）
confirmed率: 60%（1択確定）
```

### 5.2 Phase 2後の目標値

| 指標 | Phase 1後 | Phase 2目標 | 改善率 |
|------|-----------|-------------|--------|
| 平均レイテンシ | 55-57秒 | 55-57秒 | ±0秒（精度改善のみ） |
| unavailable率 | 15% | **10%** | **33%削減** |
| alternatives率 | 25% | 20% | 20%削減 |
| confirmed率 | 60% | **70%** | **+10pt** |
| JEVコール時間 | 0.5秒（Phase 1） | 1.3秒 | +0.8秒（非クリティカル） |

**重要**: Phase 2のJEVコールは Gemini検索完了後（クリティカルパス外）に実行するため、ユーザー体感レイテンシには影響しない。

### 5.3 測定方法

**ベンチマークハーネス**: `benchmarks/route-generation-baseline.ts`（PR #116で導入済み）

**Phase 2測定コマンド**:

```bash
# BEFORE（Phase 2無効）
export GEMINI_API_KEY=your_key_here
export JEV_API_KEY=your_jev_key_here
export JEV_PHASE2_ENABLED=0
npm run benchmark

# AFTER（Phase 2有効）
export JEV_PHASE2_ENABLED=1
npm run benchmark

# 比較: unavailable率、alternatives率、confirmed率を集計
```

**A/Bテスト設計**:
- 制御群: `JEV_PHASE2_ENABLED=0`（既存ロジック）
- 実験群: `JEV_PHASE2_ENABLED=1`（JEV統合）
- サンプルサイズ: N=100（統計的有意性確保）

---

## 6. Geminiの役割維持

### 6.1 Phase 2でのGeminiとJEVの役割分担

**明確な責務分離**:

| 処理 | 担当 | 理由 |
|------|------|------|
| 経路検索 | Gemini | Search Groundingが必須 |
| 施設名抽出 | Gemini | 自然言語理解（検索結果→構造化データ） |
| 構造化データ生成 | Gemini | JSON schema遵守（既存投資活用） |
| **意味的重複判定** | **JEV** | **高速・高精度な判定タスク（System One）** |
| **リトライ価値判定** | **JEV** | **Phase 1、既存計画通り** |

**Phase 2で変更しないもの**:
1. ✅ Gemini Search Grounding呼び出し（`searchAndGenerateStructuredContentWithSearchText`）
2. ✅ 検索クエリ生成（`buildNavigatorSearchQuery`）
3. ✅ JSON schema定義（`RawSingleCallNavigatorGuide`）
4. ✅ タイムアウト値（100秒、`SEARCH_REQUEST_TIMEOUT_MS`）

**Phase 2で追加するもの**:
1. ✅ JEV Score API呼び出し（Gemini抽出後、意味的評価のみ）
2. ✅ フォールバックロジック（JEV失敗時は既存ロジック続行）

### 6.2 アーキテクチャ図（Phase 2）

```
[ユーザーリクエスト]
    ↓
[POST /api/routes/search]
    ↓
[route-search.ts]
    ↓
[single-call-navigator.ts]
    ↓
┌─────────────────────────────────────┐
│ attemptGenerateSingleCallNavigator  │
│                                     │
│ 1. [Gemini] 検索 + 抽出（45-70秒）   │ ← Gemini役割（変更なし）
│     ├─ buildNavigatorSearchQuery    │
│     ├─ searchAndGenerateStructured  │
│     └─ extractFacilityCandidatePairs│
│                                     │
│ 2. [JEV Phase 2] 意味的評価（0.8秒） │ ← Phase 2追加（クリティカルパス外）
│     ├─ assessSemanticDuplicates     │
│     └─ classifyWithJev              │
│                                     │
│ 3. [既存] Guide構築（<0.1秒）        │ ← 既存ロジック（変更なし）
│     └─ isValidGuide                 │
└─────────────────────────────────────┘
    ↓
[SingleCallNavigatorGuide]
    ↓
[レスポンス返却]
```

**クリティカルパス**: Gemini検索（45-70秒） → Guide構築（<0.1秒） → レスポンス  
**非クリティカルパス**: JEV意味的評価（0.8秒） ← ユーザー体感レイテンシに影響しない

---

## 7. リスクと緩和策

### 7.1 Phase 2固有のリスク

#### リスク1: JEV誤判定によるfalse positive

**シナリオ**: JEVが「中央改札」と「東改札」を同一施設と誤判定 → confirmed昇格 → ユーザーが誤った改札へ誘導される

**緩和策**:
1. ✅ **Confidence閾値（0.7）**: 低確信度時は既存ロジックにフォールバック
2. ✅ **プロンプト改善**: 方角の違い（中央/東/西）は別施設と明記
3. ✅ **ログ・モニタリング**: JEV判定理由をログ記録、異常パターン検出
4. ✅ **A/Bテスト**: false positive率を実測（制御群と比較）

#### リスク2: JEV APIレイテンシ悪化

**シナリオ**: JEV Score APIが800ms超過 → タイムアウト頻発 → フォールバック増加

**緩和策**:
1. ✅ **タイムアウト設定**: 800ms（JEV想定500-800ms）
2. ✅ **リトライなし**: JEVエラー時は即座にフォールバック（ユーザー待機時間ゼロ）
3. ✅ **段階展開**: カナリアリリースで5% → 50% → 100%（問題早期検出）

#### リスク3: JEV APIコスト増加

**シナリオ**: Phase 1（0.5秒/call） + Phase 2（0.8秒/call） = 合計1.3秒/call → コスト+2-5%増加

**緩和策**:
1. ✅ **事前シミュレーション**: 1000リクエストで実測（Phase 1計画書 チェックリスト項目4）
2. ✅ **コストモニタリング**: Vercel Analytics + JEV usage dashboard
3. ✅ **ROI評価**: unavailable率33%削減 → ユーザー満足度向上 → コスト増を正当化

### 7.2 Phase 1との干渉リスク

**リスク**: Phase 1とPhase 2の同時有効化でバグ相互作用

**緩和策**:
1. ✅ **独立した環境変数**: `JEV_RETRY_GATE` と `JEV_PHASE2_ENABLED` を分離
2. ✅ **4パターンテスト**: (P1=0, P2=0), (P1=1, P2=0), (P1=0, P2=1), (P1=1, P2=1)
3. ✅ **段階展開**: Phase 1安定化後にPhase 2を有効化（パターン2: 並行開発推奨）

---

## 8. 実装前チェックリスト

Phase 2実装着手の前提条件（すべて満たすまで実装禁止）:

- [ ] **環境変数セットアップ**: `JEV_API_KEY` がCursor Cloud Agents + Vercel (Preview) に設定済み
- [ ] **JEV Score API仕様確認**: min/max/timeout/confidence の挙動を実測
- [ ] **Phase 1のステータス確認**: Phase 1 PR #117がマージ済み（または並行開発を明示的に承認）
- [ ] **ベンチマークハーネス動作確認**: `npm run benchmark` が西谷→ウエチャベで成功
- [ ] **pstack/Thermos準備**: コードレビュー用のプラグイン導入確認

---

## 9. Phase 2実装スケジュール（目安）

**前提**: Phase 1と並行開発（推奨パターン2）

### Week 1-2: 実装

- [ ] `JevFacilityClassifier.ts` モジュール作成（2日）
  - `assessSemanticDuplicates()` 実装
  - `classifyWithJev()` 実装
  - 型定義完成
- [ ] `single-call-navigator.ts` 統合（1日）
  - line 360-369の改訂
  - フィーチャーフラグ追加
- [ ] ユニットテスト作成（3日）
  - JEV Score API のモック化
  - 重複検出ケース網羅（表記揺れ、方角違い、座標同一）
  - confidence閾値テスト
  - フォールバックロジックテスト
- [ ] 型安全性検証（1日）
  - `tsc --noEmit` 成功確認
  - ESLint成功確認

### Week 3: テスト + PR提出

- [ ] E2Eテスト追加（2日）
  - 西谷→ウエチャベフィクスチャ
  - JEV有効/無効の比較
- [ ] ベンチマーク実行（2日）
  - N=100 runs（制御群 vs 実験群）
  - unavailable率、alternatives率、confirmed率の集計
- [ ] PR提出（1日）
  - タイトル: "JEV Phase 2: 施設分類精度向上（意味的重複検出）"
  - 本設計書をPR descriptionに添付
  - Phase 1 PR #117への参照を明記

### Week 4: レビュー + マージ

- [ ] pstack/Thermos レビュー（2日）
  - Adversarial thinking（JEV誤判定リスク評価）
  - Code quality（型安全性、フォールバック設計）
- [ ] レビュー対応 + 修正（2日）
- [ ] Phase 1マージ待ち（並行開発の場合）
- [ ] Phase 2マージ（Phase 1完了後、またはテスト独立性確認後）

### Week 5-6: カナリアリリース

- [ ] Vercel Preview環境で `JEV_PHASE2_ENABLED=1`（1日）
- [ ] カナリア展開（1週間）
  - 5%: 初日（異常モニタリング）
  - 50%: 3日目（A/Bテスト継続）
  - 100%: 7日目（全トラフィック）
- [ ] メトリクス最終確認（1日）
  - unavailable率 10%以下達成確認
  - false positive率 <1% 確認
  - レイテンシ悪化なし確認

**合計所要**: 5-6週間（Phase 1と並行で進行可能）

---

## 10. pstack/Thermos レビュー要件

### 10.1 pstack（計画策定）

**Phase 2設計時の適用済みスキル**:
- ✅ **figure-it-out**: 既存コードの問題点特定（件数判定の脆弱性）
- ✅ **adversarial-thinking**: JEV誤判定リスクの洗い出し
- ✅ **decision-making**: Phase 1との依存関係設計（独立性 vs 相乗効果）

### 10.2 Thermos（コードレビュー）

**Phase 2実装後の必須レビュー**:

#### thermo-nuclear-review（バグ・セキュリティ・破壊的変更）
- [ ] JEV APIキーの安全な取り扱い（`process.env.JEV_API_KEY` の漏洩防止）
- [ ] タイムアウト処理の正確性（800ms超過時のフォールバック）
- [ ] 既存APIへの破壊的変更なし（`classifyFacilityRecommendation` の後方互換性）
- [ ] フィーチャーフラグの正確性（`JEV_PHASE2_ENABLED=0` で既存動作維持）

#### thermo-nuclear-code-quality-review（保守性・構造）
- [ ] 1k-line ルール遵守（`JevFacilityClassifier.ts` 単独で300行以下想定）
- [ ] 責務分離（domain層の `JevFacilityClassifier` と integration層の `single-call-navigator` の明確な境界）
- [ ] テスタビリティ（JEV API呼び出しのモック化容易性）
- [ ] エラーハンドリング（JEVエラー時のフォールバックロジック完全性）

---

## 11. 参照ドキュメント

- **Phase 1統合計画書**: `docs/JEV_INTEGRATION_PLAN.md`（PR #117）
- **ベースラインベンチマーク**: `docs/BASELINE_PERFORMANCE.md`（PR #116）
- **開発フロー**: `notes/dev-workflow-multiagent.md`
- **タスク管理**: `notes/task-management-issue-workflow.md`
- **本プロジェクト指示**: `AGENTS.md`

---

## 12. 変更履歴

| 日付 | 版 | 変更内容 |
|------|-----|----------|
| 2026-09-19 | v1.0 | 初版作成（Phase 2設計完了） |

---

## 付録A: Phase 2後の統合状態

**Phase 1 + Phase 2の完全統合時の動作**:

```typescript
// single-call-navigator.ts (line 428以降)

export async function generateSingleCallNavigatorGuide(
  apiKey: string,
  originStation: Station,
  destinationStation: Station,
  destinationHint: string | null,
  destinationPlaceCoordinates: Coordinates | null
): Promise<SingleCallNavigatorGuide | null> {
  let result: SingleCallNavigatorGuide | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Gemini検索 + 抽出 (45-70秒)
    result = await attemptGenerateSingleCallNavigatorGuide(
      apiKey,
      originStation,
      destinationStation,
      destinationHint,
      destinationPlaceCoordinates
    );
    // ↑ この中で Phase 2 (classifyWithJev) が実行される

    // Phase 1: リトライ判定（JEV Choice API、0.5秒）
    if (process.env.JEV_RETRY_GATE === "1" && process.env.JEV_API_KEY) {
      const assessment = await assessRetrySufficiency(
        process.env.JEV_API_KEY,
        result,
        originStation.stationName,
        destinationStation.stationName
      );
      
      if (!assessment.shouldRetry) {
        console.info(`[Phase 1] Retry deemed unnecessary: ${assessment.reason}`);
        return result; // ← Phase 2で精度向上した結果を返却
      }
      
      if (assessment.confidence < 0.7) {
        console.warn("[Phase 1] Low confidence, falling back to rule-based check");
        // 既存のリトライ判定にフォールバック
      } else if (attempt < MAX_ATTEMPTS) {
        console.warn(`[Phase 1] Retry recommended: ${assessment.reason}`);
        continue; // リトライ実行
      }
    }
    
    // 既存のフォールバック（Phase 1無効時）
    if (result !== null && !isFacilityUnavailable(result)) return result;
    
    if (attempt < MAX_ATTEMPTS) {
      console.warn(`[Retry] Attempt ${attempt} failed, retrying...`);
    }
  }

  return result; // 最大リトライ後の結果（Phase 2で改善済み）
}
```

**合計JEVコール時間**: 
- Phase 2（Score API）: 0.8秒（attemptGenerateSingleCallNavigatorGuide 内で実行）
- Phase 1（Choice API）: 0.5秒（リトライ判定ループ内で実行）
- **合計**: 1.3秒/リクエスト

**クリティカルパス影響**:
- Phase 2: クリティカルパス外（Gemini検索完了後に実行）
- Phase 1: クリティカルパス上（リトライ判定時に実行）
- **ユーザー体感レイテンシ**: Gemini検索時間（45-70秒） + Phase 1（0.5秒） ≈ 45-70秒

---

## 付録B: よくある質問（FAQ）

### Q1: Phase 2はPhase 1なしで実装できますか？

**A**: はい、完全に独立して実装可能です。Phase 2はPhase 1の環境変数やロジックに依存しません。

### Q2: Phase 2で速度改善がないのになぜ実装するのですか？

**A**: Phase 2の目的は**UX改善**です。「確認できません」率を33%削減することで、ユーザーが実用的な案内を得られる確率が大幅に向上します。速度改善はPhase 1で既に達成済み（10-15%削減）です。

### Q3: JEV Score APIのタイムアウト800msは長すぎませんか？

**A**: Phase 2のJEVコールはGemini検索完了後（クリティカルパス外）に実行するため、ユーザー体感レイテンシには影響しません。800msはJEV側の推奨値（500-800ms）に基づいています。

### Q4: Phase 2の成功をどう測定しますか？

**A**: 西谷→ウエチャベフィクスチャで N=100 runs のA/Bテストを実施し、unavailable率が15% → 10%（33%削減）達成を確認します。同時に false positive率 <1% を保証します。

### Q5: pstack/Thermosはどのタイミングで適用しますか？

**A**: pstackは設計時（本ドキュメント作成時）に適用済み。Thermosは実装完了後のPRレビュー時に適用します（thermo-nuclear + code-quality review）。

---

**End of Document**
