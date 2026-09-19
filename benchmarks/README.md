# Benchmarks

## Route Generation Baseline (「一回生成」)

### Purpose

Measures the end-to-end latency of the current slow path in deguchi-nabi before JEV (TypeSafe System One) integration. This harness is designed to be reusable for BEFORE/AFTER comparisons.

### What It Measures

The exact 「一回生成／一回叩く」(one generation / one run) path:

1. **Entry Point**: `POST /api/routes/search` (src/app/api/routes/search/route.ts)
2. **Orchestration**: `resolveAndSearchRoute()` (src/lib/services/route-search-orchestrator.ts)
3. **Core Flow**: `searchRouteGuide()` (src/lib/services/route-search.ts)
   - `resolveRouteCandidate()` — AI route generation (~70s: search 55s + extract 15s)
   - `buildTransferAndExitSegments()` — Unified generation (~105s: search 90s + extract 15s)
   - Total expected: **70-175s** (per code comments, worst case 245s)

### Test Case

**Fixture**: 西谷駅 (Nishiya) → 横浜駅 (Yokohama), mode=easy

This exercises both:
- Route generation (AI search + structured extract via Google Gemini Search Grounding)
- Unified generation (gate/exit/boarding via single-call-navigator.ts)

### Running the Benchmark

#### Prerequisites

Required environment variable:
```bash
export GEMINI_API_KEY=your_gemini_api_key_here
```

See `.env.example` for details on obtaining this key.

#### Execute

```bash
npm run benchmark
```

Or directly:
```bash
GEMINI_API_KEY=xxx tsx benchmarks/route-generation-baseline.ts
```

#### Output

The benchmark runs N=10 iterations and reports:
- Mean, P50, P95 latency
- Min, Max, Range
- Success/failure rate
- Individual run timings

### Expected Baseline (from code analysis)

Based on `src/app/api/routes/search/route.ts` comments:

- **Normal case**: 70-175s
  - Route generation: 70s (search 55s + extract 15s)
  - Unified generation: 105s (search 90s + extract 15s)
  - Runs sequentially, no additional AI calls
  
- **Worst case**: 245s
  - Route generation: 70s
  - Unified generation: 105s (may fail)
  - Additional boarding position generation: 70s (fallback if unified fails)

The API route has `maxDuration = 290` seconds to accommodate these timings.

### For AFTER (JEV Integration)

When implementing JEV speedups:

1. Keep this harness unchanged (same fixture, same N=10 runs)
2. Run `npm run benchmark` to get AFTER numbers
3. Compare with BEFORE baseline
4. Document speedup: `(BEFORE - AFTER) / BEFORE * 100%`

JEV (TypeSafe System One) is designed for fast (~70-500ms) classification/routing/gating decisions, NOT prose generation. The planned speedups will replace slow LLM-based decision points (confidence gates, route quality checks, facility selection logic) while keeping LLM for actual text/structured generation where needed.

### Troubleshooting

**"Missing required environment variables"**
- Ensure `GEMINI_API_KEY` is set in your environment
- Check `.env.example` for the correct variable names
- Do not commit API keys to the repository

**Timeouts or failures**
- Network issues with Gemini API
- Rate limiting (benchmark includes 1s pauses between runs)
- Check console output for specific error messages

**Different timings than expected**
- Model version changes (code uses gemini-3.5-flash / gemini-3.6-flash)
- Network latency variations
- Google Search Grounding performance varies by query complexity
