#!/usr/bin/env tsx
/**
 * Baseline Performance Benchmark for Route Generation (「一回生成」)
 * 
 * Measures the end-to-end latency of the slow path in deguchi-nabi:
 * POST /api/routes/search → resolveAndSearchRoute → searchRouteGuide
 * 
 * This harness is designed to be reusable for BEFORE/AFTER comparisons
 * when integrating JEV (TypeSafe System One) speedups.
 * 
 * Usage:
 *   GEMINI_API_KEY=xxx npm run benchmark
 * 
 * Or directly:
 *   GEMINI_API_KEY=xxx tsx benchmarks/route-generation-baseline.ts
 */

import { resolveAndSearchRoute } from "../src/lib/services/route-search-orchestrator";
import type { RouteMode } from "../src/lib/domain/route";

// ========== CONFIGURATION ==========

const BENCHMARK_CONFIG = {
  // Number of runs to execute (N)
  runs: 10,
  
  // Fixture test case: 西谷駅 (Nishiya) → 横浜駅 (Yokohama)
  // This is a real-world case that exercises:
  // - Route generation (AI search + extract)
  // - Unified generation (gate/exit/boarding via single-call-navigator)
  fixture: {
    origin: {
      type: "station" as const,
      stationId: "nishiya", // 西谷駅
    },
    destination: {
      type: "station" as const,
      stationId: "yokohama", // 横浜駅
    },
    mode: "easy" as RouteMode,
    originLabel: "西谷駅",
    destinationLabel: "横浜駅",
  },
  
  // Alternative fixture with place destination (exercises destinationCoordinates path)
  // Uncomment to test:
  // fixture: {
  //   origin: { type: "station", stationId: "nishiya" },
  //   destination: { type: "place", placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4" }, // Example Place ID
  //   mode: "easy" as RouteMode,
  //   originLabel: "西谷駅",
  //   destinationLabel: "kawara CAFE&DINING横浜店",
  // },
};

// ========== TIMING UTILITIES ==========

interface TimingResult {
  runNumber: number;
  success: boolean;
  durationMs: number;
  error?: string;
}

interface BenchmarkSummary {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  timings: number[];
  mean: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
  range: number;
}

function calculateStats(timings: number[]): Omit<BenchmarkSummary, "totalRuns" | "successfulRuns" | "failedRuns" | "timings"> {
  const sorted = [...timings].sort((a, b) => a - b);
  const mean = timings.reduce((a, b) => a + b, 0) / timings.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const range = max - min;
  
  return { mean, p50, p95, min, max, range };
}

// ========== BENCHMARK RUNNER ==========

async function runSingleIteration(runNumber: number): Promise<TimingResult> {
  console.log(`\n[Run ${runNumber}/${BENCHMARK_CONFIG.runs}] Starting...`);
  
  const startTime = performance.now();
  
  try {
    const result = await resolveAndSearchRoute(
      BENCHMARK_CONFIG.fixture,
      null // sessionUser
    );
    
    const endTime = performance.now();
    const durationMs = endTime - startTime;
    
    if (result.ok) {
      console.log(`[Run ${runNumber}] ✅ Success in ${durationMs.toFixed(0)}ms`);
      console.log(`  → Route: ${result.route.segments.length} segments`);
      console.log(`  → Arrival guide: ${result.route.arrivalGuide?.steps.length ?? 0} steps`);
      return { runNumber, success: true, durationMs };
    } else {
      console.log(`[Run ${runNumber}] ❌ Failed with status ${result.status}: ${result.error}`);
      return { runNumber, success: false, durationMs, error: result.error };
    }
  } catch (error) {
    const endTime = performance.now();
    const durationMs = endTime - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.log(`[Run ${runNumber}] ❌ Exception: ${errorMsg}`);
    return { runNumber, success: false, durationMs, error: errorMsg };
  }
}

async function runBenchmark(): Promise<BenchmarkSummary> {
  console.log("=".repeat(70));
  console.log("BASELINE PERFORMANCE BENCHMARK: Route Generation (「一回生成」)");
  console.log("=".repeat(70));
  console.log(`\nTest case: ${BENCHMARK_CONFIG.fixture.originLabel} → ${BENCHMARK_CONFIG.fixture.destinationLabel}`);
  console.log(`Mode: ${BENCHMARK_CONFIG.fixture.mode}`);
  console.log(`Runs: ${BENCHMARK_CONFIG.runs}`);
  console.log(`\nPath being measured:`);
  console.log(`  1. POST /api/routes/search`);
  console.log(`  2. → resolveAndSearchRoute()`);
  console.log(`  3.   → searchRouteGuide()`);
  console.log(`  4.     → resolveRouteCandidate() [AI route generation: ~70s]`);
  console.log(`  5.     → buildTransferAndExitSegments() [unified generation: ~105s]`);
  console.log(`\nExpected latency: 70-175s (per src/app/api/routes/search/route.ts comments)`);
  
  const results: TimingResult[] = [];
  
  for (let i = 1; i <= BENCHMARK_CONFIG.runs; i++) {
    const result = await runSingleIteration(i);
    results.push(result);
    
    // Brief pause between runs to avoid rate limiting
    if (i < BENCHMARK_CONFIG.runs) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  const successfulTimings = results.filter(r => r.success).map(r => r.durationMs);
  const stats = successfulTimings.length > 0 ? calculateStats(successfulTimings) : {
    mean: 0, p50: 0, p95: 0, min: 0, max: 0, range: 0
  };
  
  return {
    totalRuns: results.length,
    successfulRuns: successfulTimings.length,
    failedRuns: results.length - successfulTimings.length,
    timings: successfulTimings,
    ...stats,
  };
}

// ========== RESULTS REPORTING ==========

function printSummary(summary: BenchmarkSummary): void {
  console.log("\n" + "=".repeat(70));
  console.log("BENCHMARK RESULTS SUMMARY");
  console.log("=".repeat(70));
  
  console.log(`\nRuns: ${summary.successfulRuns}/${summary.totalRuns} successful`);
  
  if (summary.successfulRuns === 0) {
    console.log("\n❌ No successful runs. Cannot compute statistics.");
    return;
  }
  
  console.log(`\nLatency (milliseconds):`);
  console.log(`  Mean:  ${summary.mean.toFixed(0)} ms (${(summary.mean / 1000).toFixed(1)}s)`);
  console.log(`  P50:   ${summary.p50.toFixed(0)} ms (${(summary.p50 / 1000).toFixed(1)}s)`);
  console.log(`  P95:   ${summary.p95.toFixed(0)} ms (${(summary.p95 / 1000).toFixed(1)}s)`);
  console.log(`  Min:   ${summary.min.toFixed(0)} ms (${(summary.min / 1000).toFixed(1)}s)`);
  console.log(`  Max:   ${summary.max.toFixed(0)} ms (${(summary.max / 1000).toFixed(1)}s)`);
  console.log(`  Range: ${summary.range.toFixed(0)} ms (${(summary.range / 1000).toFixed(1)}s)`);
  
  console.log(`\nAll timings (seconds):`);
  console.log(`  ${summary.timings.map(t => (t / 1000).toFixed(1)).join(", ")}`);
  
  console.log(`\n${"=".repeat(70)}`);
}

// ========== ENVIRONMENT CHECK ==========

function checkEnvironment(): { ok: boolean; missing: string[] } {
  const required = ["GEMINI_API_KEY"];
  const missing: string[] = [];
  
  for (const key of required) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }
  
  return { ok: missing.length === 0, missing };
}

// ========== MAIN ==========

async function main(): Promise<void> {
  const envCheck = checkEnvironment();
  
  if (!envCheck.ok) {
    console.error("\n❌ BLOCKED: Missing required environment variables:");
    for (const key of envCheck.missing) {
      console.error(`   - ${key}`);
    }
    console.error("\nTo run this benchmark:");
    console.error(`   GEMINI_API_KEY=your_key_here npm run benchmark`);
    console.error("\nOr set the variables in your shell and run:");
    console.error(`   npm run benchmark`);
    console.error("\nSee .env.example for more details.");
    process.exit(1);
  }
  
  console.log("✅ Environment check passed. Required API keys are set.");
  
  try {
    const summary = await runBenchmark();
    printSummary(summary);
    
    // Exit with non-zero if all runs failed
    if (summary.successfulRuns === 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ Benchmark failed with exception:");
    console.error(error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}
