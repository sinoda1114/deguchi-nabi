#!/usr/bin/env node
/**
 * Phase 1 Preview 計測: 西谷→ウエチャベ BothHit
 * Usage: PREVIEW_URL=https://... node scripts/phase1-preview-benchmark.mjs [N]
 */
const PREVIEW_URL = process.env.PREVIEW_URL;
const N = Number(process.argv[2] ?? 20);
const CLIENT_TIMEOUT_MS = 300_000;

const ORIGIN_ID = "hr_%E8%A5%BF%E8%B0%B7_139.5657_35.4781";
const PLACE_ID = "ChIJtRRBK1mLGGAR421JMiQPFpM";

const BODY = JSON.stringify({
  mode: "easy",
  origin: { type: "station", stationId: ORIGIN_ID },
  destination: { type: "place", placeId: PLACE_ID },
});

function isUnavailableTitle(title) {
  if (!title || typeof title !== "string") return true;
  const t = title.trim();
  if (t.length === 0) return true;
  return t.includes("確認できません");
}

function scoreRun(json) {
  const steps = json?.arrivalGuide?.steps ?? [];
  const gateStep = steps.find((s) => s.type === "ticket_gate");
  const exitStep = steps.find((s) => s.type === "street_exit");
  const gateOk = gateStep && !isUnavailableTitle(gateStep.title);
  const exitOk = exitStep && !isUnavailableTitle(exitStep.title);
  const onlyDirection =
    !exitOk &&
    Boolean(json?.arrivalGuide?.destinationDirection?.trim?.()) &&
    !gateOk;
  const bothHit = gateOk && exitOk;
  return {
    gate: gateStep?.title ?? "—",
    exit: exitStep?.title ?? "—",
    bothHit,
    onlyDirection,
    gateOnly: gateOk && !exitOk,
    exitOnly: exitOk && !gateOk,
  };
}

async function oneRun(runIndex) {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    const res = await fetch(`${PREVIEW_URL}/api/routes/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: BODY,
      signal: controller.signal,
    });
    const latencySec = Math.round((Date.now() - start) / 1000);
    if (res.status === 429) {
      const retry = Number(res.headers.get("retry-after") ?? "60");
      return { runIndex, status: 429, timeout: false, retryAfter: retry, latencySec };
    }
    if (res.status === 404) {
      return { runIndex, status: 404, timeout: false, latencySec };
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      return { runIndex, status: res.status, timeout: false, latencySec, error: "invalid_json" };
    }
    if (!res.ok) {
      return {
        runIndex,
        status: res.status,
        timeout: false,
        latencySec,
        error: json?.error ?? text.slice(0, 200),
      };
    }
    const scored = scoreRun(json);
    return { runIndex, status: 200, timeout: false, latencySec, ...scored };
  } catch (e) {
    const latencySec = Math.round((Date.now() - start) / 1000);
    const timeout = e?.name === "AbortError";
    return { runIndex, status: 0, timeout, latencySec, error: String(e?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  if (!PREVIEW_URL) {
    console.error("PREVIEW_URL required");
    process.exit(1);
  }
  const results = [];
  for (let i = 1; i <= N; i++) {
    let attempt = await oneRun(i);
    while (attempt.status === 429 && attempt.retryAfter) {
      const wait = attempt.retryAfter + 2;
      console.error(`run ${i}: 429, sleep ${wait}s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      attempt = await oneRun(i);
    }
    if (attempt.status === 404) {
      console.error(`run ${i}: 404 deployment not ready`);
      await new Promise((r) => setTimeout(r, 30_000));
      attempt = await oneRun(i);
    }
    results.push({ run: i, ...attempt });
    console.log(JSON.stringify(results[results.length - 1]));
  }
  const completed = results.filter((r) => r.status === 200);
  const bothHits = completed.filter((r) => r.bothHit).length;
  const timeouts = results.filter((r) => r.timeout || r.status === 0).length;
  const summary = {
    N: results.length,
    completed: completed.length,
    bothHitRate: completed.length ? bothHits / completed.length : 0,
    bothHits,
    timeoutRate: results.length ? timeouts / results.length : 0,
    timeouts,
  };
  console.log(JSON.stringify({ summary, results }));
}

main();
