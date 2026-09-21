# JEV 影響レポート（2026-09）

対象ルート: **西谷 → 居酒屋ウエチャベ（渋谷・道玄坂2-9-2）**  
作成日: 2026-09-21  
ship パス: [#135](https://github.com/sinoda1114/deguchi-nabi/pull/135)（MERGED）  
実験パス: [#136](https://github.com/sinoda1114/deguchi-nabi/pull/136)（実験として close。履歴は残す）

---

## 結論

JEV 単体では、西谷→ウエチャベの改札・出口品質を合格線まで押し上げなかった。  
#136 の判断パイプライン実験は Preview N=10 で TripleHit **5/10**（ハチ公寄りが残る）で、BothHit/TripleHit ≥80% に届かなかった。  
改札・出口の安定化に効いたのは #135 の収録カタログ経路である。同経路はゲート判定に JEV を使わず、Preview で TripleHit **10/10** を出した。

---

## 1. JEV はどこに配線されたか

JEV（TypeSafe System One、`JEV_API_KEY`）は長文を書かない。構造化判断（noul）だけを返す。長文案内と Search Grounding は Gemini のままである。

| 配線 | PR / 場所 | JEV が決めること | Gemini が決めること |
|---|---|---|---|
| Retry gate（Phase 1） | [#122](https://github.com/sinoda1114/deguchi-nabi/pull/122) → `evaluateRetryGate` / `isFacilityUnavailable` | 施設情報が「実質十分か」。不足なら retry | 経路・改札・出口・号車の生成 |
| 経路一貫性（Phase 2-A） | [#129](https://github.com/sinoda1114/deguchi-nabi/pull/129) → `evaluateRouteConsistency` | 1回目と2回目が同じ経路か（「東横線」vs「東急東横線」等） | 2回分の長文抽出 |
| 候補選択（Phase 2-B） | #129 → `selectBestFacilityPair` | alternatives から1組を選ぶ | 候補ペアの抽出 |
| 完全性（Phase 2-C） | #129 → `evaluateFacilityCompleteness` | confirmed で改札だけ／出口だけのとき、retry で改善するか。**片方十分を許し得る** | 再生成 |
| 判断パイプライン実験 | #136 → `runFacilityJudgmentPipeline` / `evaluateFacilityJudgment` | カタログ採用、Gemini 施設スキップ、候補スコア、retry を **1往復** に寄せる | 長文。経路用 Gemini は残る |
| 収録カタログ経路 | #135 → `resolveArrivalFacility` / `station-facility-catalog.ts` | **使わない**（改札・出口は収録→OSM→分割生成） | 経路ヘッダと号車。収録 BothHit なら施設の `.final` を待たない |

認証は既存の `JEV_API_KEY` だけである。#136 は二重の認証経路を作っていない。

---

## 2. 判断の論理（JEV vs Gemini）

### Gemini がやること

- Search Grounding 付きの長文生成
- 路線・乗換・所要・号車・改札名／出口名の抽出
- #135 では、収録が無い駅、または収録が BothHit にならないときだけ施設も生成する

### JEV がやること（判断スライス）

JEV は名前を発明しない。渡された state（施設状態、候補名、検索テキスト）に対して yes/no またはスコアを返す。

- **Retry gate**: unavailable でも「ユーザーが迷わない程度の情報がある」なら retry しない
- **完全性**: 改札だけ／出口だけの confirmed を「小規模駅なら片方で足りる」と判断し得る（#129）。これが Option A に近い抜け穴になる
- **候補選択**: 複数候補から目的地導線が良さそうな1つを選ぶ。渋谷ではハチ公改札に寄りやすい
- **経路一貫性**: 表記揺れで2回目の改札・出口を捨てすぎない

### #136 で論理がどう変わったか

main（#129）は判断が4関数に分散していた。

1. `evaluateRetryGate`
2. `evaluateFacilityCompleteness`（片方十分を許し得る）
3. `selectBestFacilityPair`
4. `evaluateRouteConsistency`（#136 でも残した。長文ではなく判断）

#136 は 1〜3 を消し、`evaluateFacilityJudgment`（systemOne 1往復）に寄せた。

- 合格線は `isScoringBothHit` がクランプする。JEV が「片方で十分」と言っても retry を止めない
- カタログ BothHit なら施設候補の Gemini 結果を捨てる
- ただし #136 は **#135 の収録を積んでいない**。`loadOptionalCatalogPair` は空 Map。本番で効くのは Gemini 候補のランキングと BothHit retry だけだった
- 経路と施設が同じ Gemini 呼び出しのため、カタログがあっても経路用 Gemini は走る

#135 の論理はこれと直交する。

- 渋谷＋目的地座標があるとき、改札・出口は収録（道玄坂改札 + A1出口）を先に決める
- 足りなければ OSM、次に改札∥出口の分割生成、最後に既存 single-call
- 収録 BothHit なら施設再試行も JEV 候補選択も通さない（`skip_facility_retry`）
- 号車だけ Gemini。選んだ改札と矛盾する共有号車は捨てる

---

## 3. 計測結果

合格線はユーザー向け TripleHit（**乗車位置 AND 改札 AND 出口** が具体値）。内部スコア `isScoringBothHit` は改札 AND 出口のみ。Option A（gate-only 成功）は不採用。

| 経路 | 条件 | N | TripleHit / BothHit | 備考 |
|---|---|---|---|---|
| #136 Preview | 判断を JEV 1往復に寄せる。収録カタログなし | 10 | **5/10** | ハチ公改札への寄り（Hachiko variance）。≥80% 未達 |
| #135 カタログ経路 Preview | 収録/OSM で改札・出口を決める。ゲートに JEV を使わない | 10 | **10/10** | 成功時は道玄坂改札 + A1出口。ship パス |
| #135 途中（レイテンシ修正直後） | 同じブランチの中間 | 10 → 再測5 | 7/10 → 1/5 | `.first` 待ちと null 再試行の予算。後続コミットで回復 |
| #132（プロンプト＋方角） | JEV Phase 2 上に生成側を足す | 10 | BothHit 7/10 → 6/10 | タイムアウト 3/10。supersede |

#136 は PR 作成時点では Preview 未計測だった。上表の 5/10 は作成後の Preview 計測である。  
#135 の 10/10 は、改札・出口を Gemini/JEV に任せず収録で固定したあとのカタログ経路の数字である。号車は Gemini だが、改札が先に決まっているので TripleHit が揃いやすい。

---

## 4. 西谷→ウエチャベに JEV は効いたか

正直な答えは **改札・出口の品質にはほとんど効かなかった** である。

効いたこと:

- 経路名の表記揺れで2回目を捨てすぎない（Phase 2-A）
- retry を機械的 unavailable だけにしない（Phase 1）。レイテンシの枝葉
- 失敗時 fail-open。検索全体は落とさない（#124）

効かなかった／逆効果になり得たこと:

- Phase 2-C は「片方で十分」を許し得る。合格線（両方必須）と噛み合わない
- Phase 2-B の候補選択は渋谷でハチ公に寄る。ウエチャベは西側（道玄坂改札 + A1）が正しい
- #136 は判断を一本化しても、名前の源泉が Gemini 抽出のままなので Hachiko variance が残った
- プロンプト精緻化＋厳格 retry（#132）はタイムアウトを増やし、BothHit を 60% まで下げた

#135 が効いた理由は、判断モデルを賢くしたからではない。**道玄坂改札と A1 を収録し、生成から外した** からである。JEV はゲート判定の補助に留まり、gate/exit の正を決めない。

---

## 5. 残すもの / マージしないもの

### 残す（main に既にある、または #135 で入った）

- #128 二段階ストリーミング（`.first` / `.final`）
- #129 の JEV 判断スライス（retry / 経路一貫性 / 候補選択 / 完全性）。経路一貫性と fail-open は残してよい
- #135 収録カタログ、OSM 補完、改札・出口の生成分離、`isScoringBothHit`
- Gemini 経路生成と、収録改札向け号車

### マージしない

- **#136** — 実験。TripleHit 5/10。判断一本化のアイデアは残してよいが、収録なしでは品質が足りない。履歴は残す
- **#130** — Phase 2-C 実行順の修正。#135 で supersede
- **#132** — プロンプト＋方角。BothHit 未達
- **#133 / #131** — 計画。Option A は不採用
- **#134** — #135 の重複

### 今後 JEV を触るなら

1. 改札・出口の正は収録（必要なら駅を増やす）。JEV に名前を選ばせない
2. Phase 2-C の「片方十分」は合格線と矛盾する。残すなら `isScoringBothHit` の下に閉じる（#136 のクランプはここが正しい）
3. 経路一貫性の意味的判定は安価で害が少ない。残してよい
4. #136 の単一 `systemOne` を再挑戦するなら、#135 のカタログを積んだうえで測る。空 Map のままでは再実験にならない

---

## 関連

- [#135](https://github.com/sinoda1114/deguchi-nabi/pull/135) — ship パス（MERGED）
- [#136](https://github.com/sinoda1114/deguchi-nabi/pull/136) — 実験（close、履歴残置）
- [#129](https://github.com/sinoda1114/deguchi-nabi/pull/129) — JEV Phase 2 (A+B+C)
- [#122](https://github.com/sinoda1114/deguchi-nabi/pull/122) — JEV Phase 1 retry gate
- `docs/JEV_PHASE1_IMPLEMENTATION.md`
- `docs/EXIT_QUALITY_PHASE1_DETERMINISTIC.md`
