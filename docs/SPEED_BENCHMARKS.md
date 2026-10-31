# Speed Benchmarks / 速度ベンチマーク

## Overview / 概要

This document records the three-point speed comparison plan for the `deguchi-nabi` route navigation feature and actual measurement results.

このドキュメントは `deguchi-nabi` のルート案内機能における3ポイント速度比較計画と実測結果を記録します。

## Three-Point Speed Comparison Plan / 3ポイント速度比較計画

The goal is to measure end-to-end route calculation performance across three configurations:

1. **Baseline (PRODUCTION)** — gemini-3.6-flash model on production environment
2. **Model upgrade (PREVIEW)** — gemini-3.8-flash model on preview deployment
3. **Post-JEV Phase 1** — After JEV (JSON Extraction Validation) Phase 1 implementation and deployment

目標は、3つの構成でエンドツーエンドのルート計算パフォーマンスを計測することです：

1. **ベースライン（本番環境）** — 本番環境で gemini-3.6-flash モデルを使用
2. **モデルアップグレード（プレビュー）** — プレビューデプロイで gemini-3.8-flash モデルを使用
3. **JEV Phase 1 後** — JEV（JSON抽出バリデーション）Phase 1 実装・デプロイ後

## Measurement Results / 計測結果

### Test Fixture / テストフィクスチャ

- **Start:** 西谷 (Nishitani)
- **Destination:** ウエチャベ (Uechabe)
- **Date:** 2026-09-19 JST

### 1. gemini-3.6-flash PRODUCTION

- **Environment:** Production (https://deguchi-nabi.vercel.app)
- **Model:** gemini-3.6-flash
- **Duration:** ≈107 seconds
- **Result:** Success — 道玄坂改札/A2 exit
- **Measured:** 2026-09-19 JST

### 2. gemini-3.8-flash PREVIEW

- **Environment:** Preview deployment (PR #118 Vercel preview)
- **Model:** gemini-3.8-flash
- **Duration:** ≈60 seconds
- **Result:** Success — 道玄坂改札/A1 exit
- **Measured:** 2026-09-19 JST
- **Performance improvement:** ~44% faster than baseline (107s → 60s)

### 3. Post-JEV Phase 1

- **Status:** TBD (To Be Determined)
- **Environment:** Production after merge and deployment
- **Test:** Same fixture (西谷 → ウエチャベ) will be re-measured

## How to Re-measure / 再計測方法

### On Production After PR #118 Merges / PR #118 マージ後の本番環境での再計測

1. Wait for PR #118 to be merged to `main` branch
2. Verify Vercel production deployment completes successfully
3. Access https://deguchi-nabi.vercel.app
4. Enter the same test fixture:
   - Start: 西谷
   - Destination: ウエチャベ
5. Start timer when submitting the form
6. Stop timer when the result page with exit recommendation is displayed
7. Record the duration and the recommended exit

PR #118 が `main` ブランチにマージされるのを待ちます。Vercel 本番デプロイが正常に完了したことを確認してから、https://deguchi-nabi.vercel.app にアクセスし、同じテストフィクスチャ（西谷 → ウエチャベ）を入力して計測します。

### Important Notes / 重要な注意事項

- **Preview ≠ Production:** Preview deployments may have different performance characteristics than production. Cold start times, resource allocation, and geographic distribution can affect measurements.
- **Network conditions:** Actual timing includes client-server round-trip time. Measurements should be taken from similar network conditions for fair comparison.
- **Model availability:** Ensure the correct model is configured in the environment variables for each deployment.

**プレビュー環境 ≠ 本番環境：** プレビューデプロイと本番環境ではパフォーマンス特性が異なる場合があります。コールドスタート時間、リソース配分、地理的分散などが計測に影響します。

## Related Pull Requests / 関連 PR

- [PR #116](https://github.com/sinoda1114/deguchi-nabi/pull/116) — Related infrastructure/configuration changes
- [PR #117](https://github.com/sinoda1114/deguchi-nabi/pull/117) — Related feature updates
- [PR #118](https://github.com/sinoda1114/deguchi-nabi/pull/118) — gemini-3.8-flash model upgrade (measured at ~60s)

## Next Steps / 次のステップ

1. Merge PR #118 to deploy gemini-3.8-flash to production
2. Measure production performance with the new model
3. Implement JEV Phase 1
4. Re-measure with the same fixture after JEV deployment
5. Update this document with final results
6. Analyze the full performance trajectory across all three points

---

*Last updated: 2026-09-19*
