# Baseline Performance Measurement (「一回生成」)

**Status**: 🚧 Harness created, awaiting API keys to run actual measurements

**Date**: 2026-09-19  
**Purpose**: Establish measurable baseline before JEV (TypeSafe System One) integration

---

## 1. The Slow Path (「一回生成／一回叩く」)

### Exact Location

**Entry Point**: `src/app/api/routes/search/route.ts` (POST handler)

**Call Chain**:
```
POST /api/routes/search
  ↓
resolveAndSearchRoute()
  ↓ [src/lib/services/route-search-orchestrator.ts]
searchRouteGuide()
  ↓ [src/lib/services/route-search.ts]
  ├─ resolveRouteCandidate()       [route generation: 70s]
  └─ buildTransferAndExitSegments() [unified generation: 105s]
```

### Why It's Slow

From code comments in `src/app/api/routes/search/route.ts` (lines 8-34):

1. **Route Generation** (~70s):
   - Uses `GeminiClient.ts` via `searchAndGenerateStructuredContent()`
   - Google Search Grounding: 55s timeout
   - Structured extraction: 15s timeout
   - **Total**: ~70s

2. **Unified Generation** (~105s):
   - Uses `GeminiAiSdkClient.ts` via `single-call-navigator.ts`
   - Single-call approach (改札・出口・乗車位置を1回で生成)
   - Google Search Grounding: 90s timeout (extended from 55s due to longer prompts)
   - Structured extraction: 15s timeout
   - **Total**: ~105s

3. **Sequential Execution**:
   - Route generation THEN unified generation
   - Normal case: 70s + 105s = **175s**
   - Worst case (unified fails, fallback): 70s + 105s + 70s = **245s**

The API route has `export const maxDuration = 290;` to handle worst-case timing.

---

## 2. Measurement Method

### Harness Location

`benchmarks/route-generation-baseline.ts`

### Test Case

- **Origin**: 西谷駅 (Nishitani) `stationId: "nishiya"`
- **Destination**: 渋谷駅 (Shibuya) `stationId: "shibuya"`
- **Mode**: `easy`
- **Runs**: N=10

**Note on 「うえちゃべ」**: User mentioned this phrase (possible exit/landmark or STT error). Meaning not yet confirmed. The current fixture uses station-to-station routing without additional exit specification. If the product UI supports specifying exits or POIs, this may become relevant for enhanced benchmark scenarios.

This fixture exercises both:
- AI route generation (Google Search Grounding + structured extract)
- Unified generation (single-call-navigator.ts for gate/exit/boarding)

### How to Run

```bash
# Install dependencies (if not already done)
npm install

# Set required API key
export GEMINI_API_KEY=your_key_here

# Run benchmark
npm run benchmark
```

Or directly:
```bash
GEMINI_API_KEY=xxx tsx benchmarks/route-generation-baseline.ts
```

### Output Format

The harness reports:
- **Mean**: Average latency across all successful runs
- **P50**: Median latency
- **P95**: 95th percentile latency
- **Min/Max/Range**: Spread of measurements
- **Success rate**: N successful / N total runs

---

## 3. Baseline Results

### Status: BLOCKED ON ENVIRONMENT

**Required for BEFORE (baseline)**: `GEMINI_API_KEY`

**Current Status**: Not set in cloud VM environment

**To Unblock BEFORE Measurement**:
1. Set `GEMINI_API_KEY` in your environment
2. Run `npm run benchmark`
3. Update this document with actual BEFORE numbers

**For AFTER (JEV) Measurement**:
- Will require `JEV_API_KEY` (canonical name, available on Grok Bot box)
- Cloud VMs do NOT auto-inherit box secrets
- Run AFTER measurement from environment with `JEV_API_KEY` configured
- Or configure Cloud Agents environment variable before AFTER run
- Note: App code reads `process.env.JEV_API_KEY` (not TYPESAFE_API_KEY)

### Expected Baseline (from code analysis)

Based on code comments and timeout values:

| Metric | Expected Value |
|--------|---------------|
| Normal case (sequential) | 175s (route 70s + unified 105s) |
| Worst case (with fallback) | 245s (route 70s + unified 105s + boarding 70s) |
| API timeout | 290s (`maxDuration`) |

**Real measurements pending API key availability.**

---

## 4. For AFTER Comparison (JEV Integration)

### Reusing This Harness

When implementing JEV (TypeSafe System One) speedups:

1. Keep the same test case (西谷駅 → 横浜駅, N=10 runs)
2. Run the same command: `npm run benchmark`
3. Compare AFTER results with BEFORE baseline
4. Calculate speedup: `(BEFORE - AFTER) / BEFORE × 100%`

### JEV Integration Plan

**JEV (TypeSafe System One)** is for fast (~70-500ms) probabilistic decisions:
- ✅ Classification, routing, gating, ranking, yes-no judgments
- ❌ NOT for prose generation or complex structured output

**Where JEV Can Help** (to be designed in planning phase):
- Confidence gates (should we proceed with this result?)
- Route quality assessment (is this route reasonable?)
- Facility selection decisions (which gate/exit priority?)
- Model routing (which LLM tier to use?)
- Risk checks (is this safe to show?)

**Where LLM Must Stay**:
- Actual route search with Google Grounding (prose generation)
- Structured extraction of complex JSON (facilities, boarding positions)
- Any domain where we need semantic understanding of search results

### Success Metrics

Target improvements (to be refined after baseline measurement):
- [ ] End-to-end latency reduction (specify % after baseline)
- [ ] Reduced sequential LLM calls (identify which decisions become JEV)
- [ ] Maintained or improved accuracy (no quality regression)
- [ ] Cost reduction (fewer expensive LLM tokens for simple decisions)

---

## 5. Appendix: Code References

### Main Slow Path Files

1. **API Route**: `src/app/api/routes/search/route.ts`
   - Lines 8-34: Timeout reasoning and latency breakdown
   - Line 35: `export const maxDuration = 290;`

2. **Orchestration**: `src/lib/services/route-search-orchestrator.ts`
   - `resolveAndSearchRoute()`: Main entry point

3. **Core Logic**: `src/lib/services/route-search.ts`
   - `searchRouteGuide()`: Sequential AI call orchestration
   - Lines 521-559: Unified generation attempt logic

4. **AI Clients**:
   - `src/lib/integrations/ai/GeminiClient.ts` (route generation)
   - `src/lib/integrations/ai/GeminiAiSdkClient.ts` (unified generation)
   - `src/lib/integrations/ai/single-call-navigator.ts` (unified prompt)

### Timeout Constants

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `REQUEST_TIMEOUT_MS` | 15000ms | GeminiAiSdkClient.ts:27 | Structured extraction |
| `SEARCH_REQUEST_TIMEOUT_MS` | 55000ms | GeminiAiSdkClient.ts:32 | Standard search grounding |
| `SEARCH_TIMEOUT_MS` (unified) | 90000ms | single-call-navigator.ts (passed in) | Extended for unified generation |
| `maxDuration` | 290000ms | routes/search/route.ts:35 | API route timeout |

---

## 6. Next Steps

1. **Immediate**: Get `GEMINI_API_KEY` and run baseline measurement
2. **Update this doc**: Fill in "Baseline Results" section with actual numbers
3. **Planning**: Design JEV integration points based on measured bottlenecks
4. **Implementation**: Incremental rollout with AFTER measurements at each phase
5. **Thermos Review**: Required gate before marking any JEV integration merge-ready
