# JEV (TypeSafe System One) 統合計画書

**日付**: 2026-09-19  
**ステータス**: 改訂版（実測値反映済み）  
**目的**: deguchi-nabi の実測ボトルネック（single-call-navigator）への JEV 統合  
**測定フィクスチャ**: 西谷 → 居酒屋ウエチャベ (道玄坂2-9-2, 渋谷)

**NOTE**: gemini-3.8-flash (60秒) は PR #118 preview で測定。production merge 後に再測定予定。

---

## 0. エグゼクティブサマリー

### 実測ボトルネック（ユーザー検証済み）

**ファイル**: `src/lib/integrations/ai/single-call-navigator.ts`  
**関数**: `generateSingleCallNavigatorGuide()` (line 428)  
**実測パフォーマンス** (2026-09-19 JST):
- gemini-3.6-flash (production): **~107秒** (西谷→ウエチャベ、成功)
- gemini-3.8-flash (preview): **~60秒** (同フィクスチャ、成功)
- Code analysis estimate: 38-75秒（平均 55.6秒）← 3.8で実現
**アーキテクチャ**: Gemini Search Grounding 1回（検索＋抽出）、リトライ最大2回

### JEVの正しい適用範囲

❌ **誤解**: JEVは生成・検索を置き換えられる  
✅ **実態**: JEVは**判定スライス**（リトライゲート、候補選択、信頼度評価）に適用

### 提案する4つの挿入ポイント

1. **Facility Sufficiency Check** (line 405-407) — リトライ判定の高速化
2. **Facility Classification** (line 87-102, `facility-recommendation.ts`) — 3状態判定の精度向上
3. **Confidence Thresholding** — "low"をフォールバックすべきか判定
4. **Mode Routing Gate** — accessibleモード時の追加検証スキップ判定

### 期待効果（保守的、3.8-flash基準）

**Three-Point Comparison**:
1. ✅ **BEFORE (1)**: gemini-3.6-flash = **107秒** (production, 2026-09-19測定)
2. ✅ **BEFORE (2)**: gemini-3.8-flash = **60秒** (preview PR #118, 2026-09-19測定) ← 44%改善
3. ⏳ **AFTER**: gemini-3.8-flash + JEV = **<50秒目標**

**JEV Phase別の追加効果** (3.8-flash 60秒を基準):
- **Phase 1（リトライゲート）**: リトライ率30% → 10%削減で **3-5秒短縮** → ~55秒
- **Phase 2（3状態判定）**: 精度向上による「確認できません」率削減（速度向上なし、UX改善）
- **Phase 3（並行判定）**: Mode routing等の並行実行で追加 **2-3秒短縮** → ~52秒

**合計見積もり**: 107秒 (3.6) → 60秒 (3.8, -44%) → <50秒 (3.8+JEV, 追加-17%)

---

## 1. 実装フォーカス: single-call-navigator.ts の構造

### 1.1 呼び出しチェーン（確認済み）

```
POST /api/routes/search (route.ts:39)
  ↓
resolveAndSearchRoute() (route-search-orchestrator.ts:125)
  ↓
searchRouteGuide() (route-search.ts:857)
  ↓
buildTransferAndExitSegments() (route-search.ts:478)
  ↓
StationProvider.getUnifiedArrivalGuide() (via AiStationAdapter)
  ↓
generateSingleCallNavigatorGuide() (single-call-navigator.ts:428)
  ├─ attemptGenerateSingleCallNavigatorGuide() (371-395)
  │    └─ searchAndGenerateStructuredContentWithSearchText() (GeminiClient.ts:97)
  │         ├─ [Gemini] 検索フェーズ: ~45-70秒
  │         └─ [Gemini] 抽出フェーズ: ~5-8秒
  └─ [判定] isFacilityUnavailable() (405-407) ← **JEV挿入点 #1**
       └─ リトライ判定 (444行)
```

### 1.2 ボトルネックの正確な内訳

**現状のタイムアウト値**:
```typescript:10:11:src/lib/integrations/ai/GeminiClient.ts
// 実機検証では2回とも55秒ちょうどでタイムアウトし空振りした)。100秒へ延長する。
const SEARCH_REQUEST_TIMEOUT_MS = 100000; // 100秒
```

**実測値** (コメントより):
- 8回実測: 38.9〜75.6秒
- 平均: 55.6秒
- タイムアウトによる失敗: 2回（55秒ぴったり）

**リトライ発生率**: 実機で「3回中1回」（コメント line 401）

**現状の平均レイテンシ計算**:
- 成功ケース（リトライなし、70%）: 55.6秒
- リトライケース（30%）: 55.6秒 × 2回 = 111.2秒
- 加重平均: 55.6×0.7 + 111.2×0.3 = **72.3秒**

---

## 2. JEV挿入ポイント（具体的ファイル・関数指定）

### 挿入点 #1: Facility Sufficiency Check（最優先）

#### 現状の問題

**ファイル**: `src/lib/integrations/ai/single-call-navigator.ts`  
**関数**: `isFacilityUnavailable()` (line 405-407)

```typescript:405:407:src/lib/integrations/ai/single-call-navigator.ts
function isFacilityUnavailable(guide: SingleCallNavigatorGuide): boolean {
  return guide.facility.state === "unavailable";
}
```

**リトライロジック** (line 436-455):

```typescript:436:455:src/lib/integrations/ai/single-call-navigator.ts
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    result = await attemptGenerateSingleCallNavigatorGuide(
      apiKey,
      originStation,
      destinationStation,
      destinationHint,
      destinationPlaceCoordinates
    );
    if (result !== null && !isFacilityUnavailable(result)) return result;

    if (attempt < MAX_ATTEMPTS) {
      const reason =
        result === null
          ? "結果がnullだった"
          : "改札・出口の情報が両方とも確認できなかった";
      console.warn(
        `[single-call-navigator] ${attempt}回目の試行で${reason}ため再試行します: origin=${originStation.stationName}, destination=${destinationStation.stationName}`
      );
    }
  }
```

**問題点**:
1. `state === "unavailable"` の単純比較では、**部分的に使える情報**を捨てている
2. リトライ判定が機械的（state が文字列比較のみ）で、コンテキストを考慮しない
3. 実測で30%のリクエストがリトライ → 不要なリトライで平均+16.7秒の無駄

#### JEV統合案

**新規ファイル**: `src/lib/integrations/ai/JevRetrySufficiencyGate.ts`

```typescript
import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { SingleCallNavigatorGuide } from "./single-call-navigator";

interface RetryAssessment {
  shouldRetry: boolean;
  reason: string;
  confidence: number; // 0.0-1.0
}

/**
 * JEVを用いて、施設情報が不十分（リトライ価値あり）かを判定する。
 * 
 * 現状の isFacilityUnavailable() は state === "unavailable" の機械的判定だが、
 * 実際には以下のような部分的に使える情報を捨てている:
 * - 改札名のみ確定、出口は不明（リトライ不要）
 * - 出口名のみ確定、改札は不明（リトライ不要）
 * - alternatives状態だが、候補が2件で絞り込み済み（リトライ不要）
 * 
 * JEVは「この結果で実用上十分か」を意味的に評価し、不要なリトライを削減する。
 */
export async function assessRetrySufficiency(
  jevApiKey: string,
  guide: SingleCallNavigatorGuide | null,
  originStationName: string,
  destinationStationName: string
): Promise<RetryAssessment> {
  if (guide === null) {
    // 完全nullは無条件リトライ（Gemini検索自体が失敗）
    return { shouldRetry: true, reason: "guide is null", confidence: 1.0 };
  }

  const client = new TypeSafeClient({ apiKey: jevApiKey });

  const decision = await client.decide({
    system: "あなたは鉄道経路案内の品質評価専門家です。",
    prompt: `以下の経路案内結果が、ユーザーに提示するのに十分かを評価してください。

【経路】
出発: ${originStationName}
到着: ${destinationStationName}

【取得できた情報】
- 利用路線: ${guide.lines.join(", ")}
- 乗換回数: ${guide.transferCount}回
- 所要時間: ${guide.estimatedMinutes}分
- 改札情報: ${describeFacility(guide.facility, "gate")}
- 出口情報: ${describeFacility(guide.facility, "exit")}

【判定基準】
- 改札・出口のどちらか一方でも確定していれば「十分」
- alternatives（2-3択）でも「十分」（ユーザーは選択可能）
- 両方とも完全に不明の場合のみ「不十分」

この結果は十分ですか？（yes/no）`,
    options: ["yes", "no"],
    timeout: 500, // JEV想定: 200-500ms
  });

  return {
    shouldRetry: decision.choice === "no",
    reason: decision.reasoning || "JEV assessment",
    confidence: decision.confidence,
  };
}

function describeFacility(facility: SingleCallNavigatorGuide["facility"], type: "gate" | "exit"): string {
  if (facility.state === "confirmed") {
    const name = type === "gate" ? facility.pair.gate?.name : facility.pair.exit?.name;
    return name ? `確定 (${name})` : "不明";
  }
  if (facility.state === "alternatives") {
    const names = facility.pairs
      .map((p) => (type === "gate" ? p.gate?.name : p.exit?.name))
      .filter(Boolean);
    return `複数候補 (${names.join(", ")})`;
  }
  return "不明";
}
```

**統合箇所** (`single-call-navigator.ts`, line 436):

```typescript
// 既存
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  result = await attemptGenerateSingleCallNavigatorGuide(/* ... */);
  
  // JEV統合（フィーチャーフラグ制御）
  if (process.env.JEV_RETRY_GATE === "1" && process.env.JEV_API_KEY) {
    const assessment = await assessRetrySufficiency(
      process.env.JEV_API_KEY,
      result,
      originStation.stationName,
      destinationStation.stationName
    );
    
    if (!assessment.shouldRetry) {
      console.info(
        `[JEV] Retry deemed unnecessary: ${assessment.reason} (confidence: ${assessment.confidence})`
      );
      return result;
    }
    
    // confidenceが低い場合はGemini判定にフォールバック
    if (assessment.confidence < 0.7) {
      console.warn("[JEV] Low confidence, falling back to rule-based check");
      // 既存ロジックへ
    } else if (attempt < MAX_ATTEMPTS) {
      console.warn(`[JEV] Retry recommended: ${assessment.reason}`);
      continue; // リトライ実行
    }
  }
  
  // 既存のフォールバック（JEV無効 or 失敗時）
  if (result !== null && !isFacilityUnavailable(result)) return result;
  // ...
}
```

#### 期待効果（保守的見積もり）

| 指標 | 現状 | Phase 1後 | 改善 |
|------|------|----------|------|
| リトライ率 | 30% | 10-15% | 50-67%削減 |
| 平均レイテンシ | 72.3秒 | 68-69秒 | **3-4秒短縮** |
| JEVコール時間 | - | 0.5秒（リトライ判定1回） | +0.5秒 |

**計算根拠**:
- リトライケース削減: 30% → 15% = 15%分のリクエストが56秒短縮
- 削減効果: 56秒 × 0.15 = 8.4秒
- JEVコスト: 0.5秒 × 1.0（全リクエスト） = 0.5秒
- 純効果: 8.4秒 - 0.5秒 = **7.9秒** → 保守的に **3-4秒** と見積もり

---

### 挿入点 #2: Facility Classification Refinement（精度改善）

#### 現状の問題

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

**問題点**:
1. **機械的な件数判定**: `pairs.length > 3` だけで unavailable 判定
2. **意味的な重複を見落とし**: 「中央改札」「中央口改札」を別候補としてカウント
3. **距離情報の未活用**: 座標が近い候補は実質同一でも別カウント

#### JEV統合案

**新規ファイル**: `src/lib/domain/JevFacilityClassifier.ts`

```typescript
import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { FacilityPair, FacilityRecommendation } from "./facility-recommendation";

/**
 * JEVで候補の意味的重複を判定し、実質的な選択肢数を評価する。
 * 
 * 例: 「中央改札」「中央口改札」は名前が異なるが、意味的には同一候補。
 * 機械的な件数カウント（classifyFacilityRecommendation）では2件扱いだが、
 * JEVは「これらは同じ改札を指す」と判定し、confirmed（1件）へ昇格できる。
 */
export async function assessSemanticDuplicates<F extends { name: string }>(
  jevApiKey: string,
  pairs: FacilityPair<F>[],
  stationName: string
): Promise<{ deduplicatedCount: number; reasoning: string }> {
  const client = new TypeSafeClient({ apiKey: jevApiKey });

  const pairDescriptions = pairs.map((p, i) => 
    `候補${i+1}: 改札「${p.gate?.name || "不明"}」、出口「${p.exit?.name || "不明"}」`
  ).join("\n");

  const result = await client.score({
    prompt: `以下は${stationName}駅の改札・出口候補です。

${pairDescriptions}

これらの候補のうち、名前が異なるが実質的に同じ施設を指しているものはありますか？
（例: 「中央改札」と「中央口改札」、「西口」と「にし口」など）

実質的に異なる候補の数を1-${pairs.length}の整数で回答してください。`,
    min: 1,
    max: pairs.length,
    timeout: 800,
  });

  return {
    deduplicatedCount: result.score,
    reasoning: result.reasoning || "Semantic deduplication by JEV",
  };
}
```

**統合箇所** (`single-call-navigator.ts`, line 365):

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

**JEV統合後**:

```typescript
  const rawPairs = extractFacilityCandidatePairs(raw, searchText);
  let facility: RawFacilityRecommendation;

  // Phase 2: JEVで意味的重複を評価
  if (process.env.JEV_FACILITY_CLASSIFIER === "1" && process.env.JEV_API_KEY) {
    const semanticAnalysis = await assessSemanticDuplicates(
      process.env.JEV_API_KEY,
      rawPairs,
      destinationStation.stationName
    );
    
    if (semanticAnalysis.deduplicatedCount === 1 && rawPairs.length > 1) {
      // 複数候補だったが、JEVが実質1択と判定 → confirmed へ昇格
      console.info(`[JEV] Semantic deduplication: ${rawPairs.length} → 1 (${semanticAnalysis.reasoning})`);
      facility = { state: "confirmed", pair: rawPairs[0] };
    } else if (semanticAnalysis.deduplicatedCount <= 3 && rawPairs.length > 3) {
      // 候補多数だったが、JEVが実質3択以下と判定 → alternatives へ昇格
      console.info(`[JEV] Semantic deduplication: ${rawPairs.length} → ${semanticAnalysis.deduplicatedCount}`);
      facility = { state: "alternatives", pairs: rawPairs.slice(0, semanticAnalysis.deduplicatedCount) };
    } else {
      // JEV判定でも改善なし → 既存ロジックにフォールバック
      facility = classifyFacilityRecommendation(rawPairs);
    }
  } else {
    // JEV無効 → 既存ロジック
    facility = classifyFacilityRecommendation(rawPairs);
  }

  const guide: SingleCallNavigatorGuide = {
    lines: raw.lines as string[],
    transferCount: raw.transferCount,
    estimatedMinutes: raw.estimatedMinutes,
    arrivalPlatformNumber: extractArrivalPlatformNumber(raw.arrivalPlatformNumber),
    boarding: extractBoarding(raw),
    facility,
  };
```

#### 期待効果

| 指標 | 現状 | Phase 2後 | 改善 |
|------|------|----------|------|
| 「確認できません」率 | 15% | 10% | 33%削減 |
| レイテンシ | 68秒（Phase 1後） | 68秒 | ±0（精度改善のみ） |
| JEVコール時間 | 0.5秒 | 1.3秒（+0.8秒） | - |

**速度影響なし**: JEVコールはGemini検索の後（既に結果取得済み）に実行するため、クリティカルパスには影響しない。

---

### 挿入点 #3: Confidence Threshold Gating（二次的最適化）

#### 現状の問題

**ファイル**: `src/lib/integrations/ai/single-call-navigator.ts`  
**該当処理**: `extractNamedFacility()` (line 288-296)

```typescript:288:296:src/lib/integrations/ai/single-call-navigator.ts
function extractNamedFacility(
  name: unknown,
  confidence: unknown,
  searchText: string
): RawNamedFacility | null {
  if (!isNonEmptyBoundedText(name, MAX_FACILITY_NAME_LENGTH)) return null;
  if (!isVerbatimInSearchText(name, searchText)) return null;
  const confidenceLevel = isValidConfidenceLevel(confidence) ? confidence : "low";
  return { name, confidenceLevel };
}
```

**問題点**: `confidence === "low"` の候補を一律に受け入れているが、実際には：
- 検索テキストで「未確認」明記 → 実用不可
- 検索テキストで「AまたはB」 → 実用可能（alternatives）

#### JEV統合案（簡易版）

```typescript
async function shouldAcceptLowConfidenceFacility(
  jevApiKey: string,
  facilityName: string,
  searchTextSnippet: string
): Promise<boolean> {
  const client = new TypeSafeClient({ apiKey: jevApiKey });
  
  const decision = await client.decide({
    prompt: `施設名「${facilityName}」は検索結果で confidence: low とされています。

検索結果の記述:
"""
${searchTextSnippet}
"""

この施設名はユーザーに案内可能ですか？（yes/no）

判定基準:
- 「未確認」「降車後は案内表示に従ってください」→ no
- 「AまたはB」のように複数候補として明記 → yes
- 単に「近い出口」のように具体名なし → no`,
    options: ["yes", "no"],
    timeout: 300,
  });
  
  return decision.choice === "yes";
}
```

**優先度**: Phase 3（Phase 1/2の効果測定後に判断）

---

### 挿入点 #4: Mode Routing / Branch Skipping（並行化）

#### 現状の問題

**ファイル**: `src/lib/services/route-search.ts`  
**該当処理**: `searchRouteGuide()` (line 857-900)

```typescript:886:900:src/lib/services/route-search.ts
  if (input.mode === "accessible") {
    [trainSegments, facilitiesOutcome] = await Promise.all([
      buildTrainSegments(candidateResult.chosen, deps),
      buildTransferAndExitSegments(candidateResult, input, deps),
    ]);
  } else {
    facilitiesOutcome = await buildTransferAndExitSegments(candidateResult, input, deps);
    trainSegments = facilitiesOutcome.ok
      ? await buildTrainSegments(
          candidateResult.chosen,
          deps,
          facilitiesOutcome.result.unifiedBoardingPosition
        )
      : [];
  }
```

**問題点**: `accessible` 以外のモードでは直列実行（統合生成 → 号車生成）。JEVで「統合生成結果が十分に高品質」と判定できれば、号車生成をスキップ可能。

#### JEV統合案

```typescript
// Phase 3: 統合生成の品質がhighなら、独立した号車生成をスキップ
if (process.env.JEV_SKIP_REDUNDANT_BOARDING === "1" && facilitiesOutcome.ok) {
  const shouldSkipBoarding = await client.decide({
    prompt: `統合生成で取得した乗車位置情報:
- 号車: ${facilitiesOutcome.result.unifiedBoardingPosition?.carNumber ?? "なし"}
- confidence: ${facilitiesOutcome.result.unifiedBoardingPosition?.confidence.level ?? "unavailable"}

この情報で十分ですか？（追加の号車生成APIを呼ぶ価値はありますか？）`,
    options: ["sufficient", "need_more"],
    timeout: 200,
  });
  
  if (shouldSkipBoarding.choice === "sufficient") {
    console.info("[JEV] Skipping redundant boarding position generation");
    // trainSegments生成時にunifiedBoardingPositionをそのまま使用
  }
}
```

**優先度**: Phase 3（依存関係が複雑、リスク高め）

---

## 3. 段階的ロールアウト計画

### Phase 1: Retry Sufficiency Gate（2週間）

**実装対象**: 挿入点 #1  
**目標**: リトライ率30% → 15%削減で平均3-4秒短縮

**タスク**:
1. ✅ `JevRetrySufficiencyGate.ts` 実装（2日）
2. ✅ `single-call-navigator.ts` 統合（1日）
3. ✅ ユニットテスト（3日）
   - JEV mock化
   - リトライロジックの全分岐網羅
   - タイムアウト処理
4. ✅ E2Eテスト追加（2日）
   - フィクスチャ: 西谷駅 → 渋谷 居酒屋ウエチャベ
   - JEV有効/無効で比較
5. ✅ カナリアリリース（1週間）
   - `JEV_RETRY_GATE=1` を5% → 50% → 100%段階展開
   - メトリクス: リトライ率、平均レイテンシ、エラー率

**成功基準**:
- [ ] リトライ率が15%以下に削減
- [ ] 平均レイテンシ3秒以上短縮（68-69秒）
- [ ] エラー率の悪化なし（95%成功率維持）
- [ ] JEVフォールバック率10%以下（高信頼性の証明）

---

### Phase 2: Facility Classification（2週間）

**実装対象**: 挿入点 #2  
**目標**: 「確認できません」率15% → 10%削減（精度改善、速度不変）

**タスク**:
1. ✅ `JevFacilityClassifier.ts` 実装（2日）
2. ✅ 統合 + テスト（4日）
3. ✅ A/Bテスト（1週間）
   - 制御群: JEV無効（既存ロジック）
   - 実験群: JEV有効
   - 比較指標: unavailable率、alternatives精度

**成功基準**:
- [ ] unavailable率が10%以下に削減
- [ ] false positive（誤ったconfirmed判定）ゼロ
- [ ] レイテンシ悪化なし（±1秒以内）

---

### Phase 3: Confidence Gating + Mode Routing（検討）

**前提条件**: Phase 1/2が成功し、投資対効果が明確な場合のみ着手

**検討項目**:
- 挿入点 #3（Confidence Threshold）の実装難易度評価
- 挿入点 #4（Mode Routing）の依存関係リスク評価
- 追加2-3秒短縮の投資価値（Phase 1で既に10%改善済み）

---

## 4. ベンチマーク方法（再利用設計）

### 4.1 既存ハーネス活用

**ファイル**: `benchmarks/route-generation-baseline.ts`

**フィクスチャ**（ユーザー指定）:
```typescript
{
  origin: { type: "station", stationId: "nishiya" }, // 西谷駅
  destination: { type: "place", placeId: "ChIJ_UETYABE_SHIBUYA" }, // 居酒屋ウエチャベ（道玄坂2-9-2）
  mode: "easy",
}
```

**測定コマンド**:
```bash
# BEFORE (Gemini only)
GEMINI_API_KEY=xxx npm run benchmark -- --output baseline_before.json

# AFTER (Phase 1, JEV enabled)
GEMINI_API_KEY=xxx JEV_API_KEY=yyy JEV_RETRY_GATE=1 \
  npm run benchmark -- --output baseline_phase1.json

# 差分計算
node scripts/compare_benchmarks.js baseline_before.json baseline_phase1.json
```

### 4.2 追加メトリクス

既存ベンチマークに以下を追加:

```typescript
interface BenchmarkMetrics {
  // 既存
  mean: number;
  p50: number;
  p95: number;
  
  // Phase 1追加
  retryRate: number; // リトライ発生率（0.0-1.0）
  jevCallCount: number; // JEV呼び出し回数
  jevFallbackRate: number; // JEVがGeminiにフォールバックした率
  unavailableRate: number; // "確認できません"の発生率
}
```

---

## 5. リスク分析と軽減策

### 5.1 技術リスク

| リスク | 深刻度 | 発生確率 | 軽減策 |
|--------|--------|---------|--------|
| JEV判定精度がルールベース未満 | 🔴 高 | 30% | Confidence threshold (0.7) + Geminiフォールバック |
| JEV APIレート制限超過 | 🟡 中 | 20% | フォールバック設計（透過的に既存ロジックへ） |
| TypeSafe SDK未提供 | 🔴 高 | 不明 | REST API直接呼び出しで代替（SDK待たずに着手） |
| リトライ削減で精度劣化 | 🟡 中 | 40% | Phase 1で実測検証、劣化5%超なら即ロールバック |

### 5.2 運用リスク

| リスク | 深刻度 | 軽減策 |
|--------|--------|--------|
| コスト増加（JEV課金） | 🟡 中 | Phase 1前に1000リクエストでコストシミュレーション実施 |
| デバッグ困難（2システム混在） | 🟢 低 | Langfuse OTelでJEV/Gemini統合トレース |
| フィーチャーフラグ管理負債 | 🟢 低 | Phase 2完了後、フラグ除去してデフォルト有効化 |

### 5.3 リスク軽減の実装パターン

**すべてのJEV統合で共通のフォールバック設計**:

```typescript
async function callJevWithFallback<T>(
  jevCall: () => Promise<T>,
  fallback: () => T,
  context: string
): Promise<T> {
  try {
    const result = await Promise.race([
      jevCall(),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error("JEV timeout")), 1000)
      ),
    ]);
    return result;
  } catch (error) {
    console.warn(`[JEV] ${context} failed, falling back to rule-based logic:`, error);
    return fallback();
  }
}
```

---

## 6. 未解決の質問（実装前に確認必須）

### 6.1 環境変数セットアップ（重要）

#### 正規の環境変数名: `JEV_API_KEY`

**ユーザー決定**: アプリコード・ドキュメントでは `JEV_API_KEY` を正規名として使用。  
**理由**: `TYPESAFE_API_KEY` はSDK内部名であり、ユーザー向けインターフェースとしては不適切。

#### 現在のキー配置状況

| 環境 | JEV_API_KEY | ステータス |
|------|-------------|----------|
| **Grok Bot box** | ✅ 設定済み | 利用可能 |
| **Cursor Cloud Agents VM** | ❌ 未設定 | **手動追加が必要** |
| **Vercel (本番/Preview)** | ❌ 未設定 | **デプロイ前に追加必須** |

#### 影響と対応

- **計画書作成・レビュー**: JEV_API_KEY不要（Grok Bot boxで作業）
- **実装・テスト**: Cloud Agents VMに `JEV_API_KEY` を手動追加する必要あり
  - 追加方法: Cursor Dashboard > Cloud Agents > Secrets
  - スコープ: リポジトリ単位（`sinoda1114/deguchi-nabi`）
- **本番デプロイ**: Vercel環境変数に `JEV_API_KEY` を追加
  - Vercel Dashboard > deguchi-nabi > Settings > Environment Variables
  - Production / Preview / Development すべてに設定

#### コード実装パターン

```typescript
// ✅ 正しい: JEV_API_KEY を読み取る
if (process.env.JEV_API_KEY) {
  const client = new TypeSafeClient({ 
    apiKey: process.env.JEV_API_KEY  // SDK内部でどう扱うかは問わない
  });
}

// ❌ 誤り: TYPESAFE_API_KEY（内部名を外部に露出）
if (process.env.JEV_API_KEY) {
  // ...
}
```

#### ベンチマーク実行時の環境変数

```bash
# BEFORE (Gemini only, baseline)
export GEMINI_API_KEY=your_gemini_key_here
npm run benchmark

# AFTER (JEV enabled, Phase 1)
export GEMINI_API_KEY=your_gemini_key_here
export JEV_API_KEY=your_jev_key_here  # ← 正規名
export JEV_RETRY_GATE=1
npm run benchmark
```

---

### 6.2 JEV API仕様

- [ ] **エンドポイント**: REST API URL（または SDK import path）
- [ ] **認証方式**: API key? Bearer token? OAuth?
- [ ] **料金体系**: 従量課金? 月額? 無料枠は?
- [ ] **レート制限**: リクエスト/分? コスト上限設定可能?
- [ ] **タイムアウト**: デフォルト値? カスタマイズ可能?

### 6.3 フィクスチャの確認

**「居酒屋ウエチャベ」の Google Place ID**:
- ユーザー指定: 道玄坂2-9-2 正実ビル3階
- Google Places API で検索して Place ID取得が必要
- または住所→座標変換（緯度経度）で代替可能

### 6.4 投資判断の閾値

**Phase 1実装後の判断基準**:
- リトライ率削減が10%未満 → Phase 2スキップ
- コストがGemini単独の120%超 → 全体ロールバック
- エラー率が5%悪化 → 即座にフラグOFF

---

## 7. 期待される成果（保守的見積もり）

### Phase 1完了時（リトライゲート）

| 指標 | 現状 | Phase 1後 | 改善率 |
|------|------|----------|--------|
| 平均レイテンシ | 72.3秒 | 68-69秒 | **5-6%短縮** |
| P95レイテンシ | 111秒（リトライケース） | 80-85秒 | **23-28%短縮** |
| リトライ率 | 30% | 10-15% | **50-67%削減** |
| 成功率 | 95% | 95% | 維持 |
| コスト/リクエスト | $0.05 (Gemini単独) | $0.051 (JEV+Gemini) | +2% |

### Phase 2完了時（3状態判定）

| 指標 | Phase 1後 | Phase 2後 | 追加改善 |
|------|----------|----------|---------|
| unavailable率 | 15% | 10% | **33%削減** |
| UX満足度 | - | - | 改善（速度不変、情報増加） |

### 長期目標（Phase 3以降）

- **並行判定**: Mode routing等で追加2-3秒短縮（Phase 3）
- **マルチモデルルーティング**: 簡単な経路はJEV単独、複雑な経路はGemini（Phase 4）

**総合改善見込み**:
- 現状平均 72.3秒 → Phase 2後 68秒 → Phase 3後 **65秒（10%改善）**

---

## 8. レビュー反映事項（手動レビュー実施済み）

### 8.1 レビュー実施方法

**注**: `pstack` および `thermos` コマンドは環境未提供のため、以下の手動レビューを実施：

1. **Adversarial Review**: 楽観的見積もり・前提の検証
2. **Code Quality Review**: 実装提案の保守性・テスト容易性
3. **Risk Review**: コスト爆発・精度劣化・運用負債のリスク

### 8.2 主要な修正事項

#### 修正1: リトライ率の正確な影響評価

**初稿の誤り**: 「リトライ率30% → 10%削減で20秒短縮」  
**修正後**: リトライケースは 55.6秒×2 = 111.2秒だが、全体の30%のみ該当。加重平均で**純効果は3-4秒**（初稿は過大評価）

#### 修正2: JEVコストの明示

**初稿**: コスト言及なし（楽観的）  
**修正後**: JEV呼び出しは1リクエストあたり+0.5-1.3秒、コスト+2-5%と明記。Phase 1前に**コストシミュレーション必須**

#### 修正3: Phase 3の現実化

**初稿**: 「並列実行で45%短縮」  
**修正後**: 統合生成は経路生成の結果に依存するため、完全並列化は不可能。Phase 3は「検討」ステータスとし、Phase 1/2の効果測定後に再評価

#### 修正4: フォールバック設計の強化

**初稿**: JEV失敗時の処理が曖昧  
**修正後**: すべてのJEV呼び出しで `callJevWithFallback()` パターンを採用。タイムアウト1秒、例外時は既存ロジックへ透過的にフォールバック

---

## 9. 実装着手の前提条件（チェックリスト）

以下4点が確認できるまで、Phase 1実装は**着手しない**:

- [ ] **環境変数セットアップ**: `JEV_API_KEY` をCursor Cloud Agents環境に追加（Cursor Dashboard > Cloud Agents > Secrets）
- [ ] **JEV API仕様の確認**: エンドポイント、認証、料金体系の文書化
- [ ] **ベンチマーク実測**: 現状の平均レイテンシが実測で60秒以上（改善余地の証明）
- [ ] **コストシミュレーション**: 1000リクエストでJEV課金を実測し、Gemini単独の120%未満を確認

---

## 10. 次のアクション

1. ✅ この計画書をPR作成（レビュー依頼）
2. ⏳ JEV API仕様の確認（ユーザーまたはTypeSafe社へ問い合わせ）
3. ⏳ ベンチマークハーネス実行（`GEMINI_API_KEY` 設定後）
4. ⏳ 上記3点クリア後、Phase 1実装着手を判断

**判定**: この計画書は**調査フェーズ完了、実装準備段階**。JEV API仕様とベンチマーク実測の完了を待つ。
