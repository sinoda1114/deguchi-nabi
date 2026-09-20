# 出口品質 Phase 1 — 決定的データ + 改札・出口の生成分離

**ステータス**: 実装中（マージしない。Coordinator が Preview 証明後に判断）  
**合格線（変更禁止）**: ユーザーに **改札 AND 出口** の両方が出ること。出口のみ / 改札のみ / 方角だけは不合格（部分表示は可、合格率に数えない）。PR #133 Option A（gate-only 成功化）は不採用。

## なぜ

PR #132（プロンプト精緻化 + 方角フォールバック + 厳格 retry）は BothHit 60%、タイムアウト 30%。原因は生成層が Gemini 1 呼び出しに改札・出口を同居させ、片方欠落で全体 retry していたこと。プロンプトだけでは検索結果に出口名が無いケースを埋められない。

合意した Phase 1 は **決定的データ（収録 / OSM）を先に使い、足りないときだけ改札と出口を別生成する**。

## 形

1. `src/lib/data/station-facility-catalog.ts` — 駅名キー（`hr_*` ではない）。Phase 1 は渋谷。
2. `resolveFacilityFromCatalog` — 既存の座標選定（最近傍 + 90° 方角 + `connectedGateId` 明示リンク）。
3. OSM `railway=subway_entrance` — 収録駅の不足出口を足す。失敗は空配列。
4. 分割 Gemini（改札 ∥ 出口、各 25 秒・1 回）— 収録が不完全なときだけ。
5. 既存 single-call `.final` — 収録の無い駅、または上記が BothHit にならなかったとき。

`AiStationAdapter.getUnifiedArrivalGuide` がオーケストレーションする。収録で BothHit なら **Gemini `.final` を待たない**（経路ヘッダの `.first` は従来どおり）。

合格判定は `isScoringBothHit`（`confirmed`/`alternatives` で gate と exit が両方非 null）。片方だけ・方角だけは不合格。

## 品質ゲート

西谷 → 居酒屋ウエチャベ（道玄坂2-9-2）。収録上は **道玄坂改札 + A1出口**。主指標 BothHit ≥80%（N≥20 推奨）。タイムアウト率は副指標 ≤10%。

## 残すもの / 捨てるもの

- 残す: #128 二段階ストリーミング、#129 JEV 判断スライス、Gemini 経路生成。
- マージしない: #132（superseded）、#133 Option A。
- やらない: 旧 `st_*` fixture 全体復活、方角フォールバックを合格に数えること、無制限 retry。
- 収録 BothHit 時は号車の独立 AI 生成を抑制する（改札と無関係な号車を出さない）。号車は未確認のまま。

## 残存リスク

ハチ公 vs 道玄坂の **正確性** は Presence とは別。西側 allowlist では両方許容するが、東側（ヒカリエ / B5）を選んだら失敗。
