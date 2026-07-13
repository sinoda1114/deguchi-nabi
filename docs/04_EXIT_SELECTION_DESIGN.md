# 04 目的地連動の出口・改札・号車選定 設計

## 1. 文書目的

本書は、経路案内の出口・改札・乗車号車を「目的地の座標」に応じて選定するための、データモデル拡張と選定アルゴリズムの設計を定義する。実装計画そのものではなく、実装に着手する際に参照する設計の基準を示す。

---

## 2. 背景・問題

### 2.1 実例

出発地: 西谷駅 / 目的地: 「渋谷横丁」(宮下パーク内、神宮前6丁目、渋谷駅の明治通り沿い北側)

案内結果: 8号車付近に乗車 → ヒカリエ改札 → B5出口

ヒカリエ改札・B5出口は渋谷駅の東〜南東側であり、渋谷横丁とは方向が食い違う。

### 2.2 原因

`src/lib/services/route-search.ts` の `pickFacility` は、駅に登録された facility のうち **その種別の最初の1件** を返すだけで、目的地の座標を一切参照しない。

```ts
function pickFacility(
  facilities: StationFacility[],
  type: StationFacility["facilityType"]
): StationFacility | null {
  return facilities.find((f) => f.facilityType === type) ?? null;
}
```

fixture収録駅(西谷・渋谷・新宿)は各種別1件しか facility を持たず、`StationFacility.coordinates` は型に存在するが全件 `null` のまま埋められていない。fixture外駅のAI生成(`generateStationFacilities`)も、目的地の情報をプロンプトに渡していないため同じ問題を抱える。

つまり「目的地に応じた出口選定」という機能自体が存在しない。実装ミスではなく、この機能の不在が原因。

---

## 3. 既存モデルの再評価

逆算チェーン(目的地 → 出口 → 改札 → 号車)に必要な骨格の一部は、既に型として存在する。

- `StationFacility.coordinates: {lat, lng} | null` — 座標を持てる。未使用のまま。
- `BoardingPosition.targetFacilityId: string | null` — 号車 → 改札の紐付けは既に存在する。fixtureの西谷→渋谷の号車データは `targetFacilityId: "fac_shibuya_hikarie_gate"` を持つ。

欠けているのは以下の3点のみ。

1. `StationFacility.coordinates` の実データ
2. 「出口 → 改札」の明示リンク
3. 目的地座標を使った選定ロジック

---

## 4. データモデル変更

### 4.1 出口→改札の明示リンク

出口facilityに、接続する改札facilityのIDを持たせる。座標の近さだけで連結を推定すると、物理的に近くても連絡していない改札を誤選択するリスクがあるため、明示リンクを採用する。

```ts
export interface StationFacility {
  facilityId: string;
  stationId: string;
  facilityType: FacilityType;
  name: string;
  level: string;
  accessible: boolean;
  coordinates: { lat: number; lng: number } | null;
  connectedGateId: string | null; // 追加: facilityType === "exit" の場合のみ意味を持つ
  confidence: Confidence;
  verifiedAt: string | null;
}
```

`BoardingPosition.targetFacilityId`(号車→改札)と対になる形にすることで、既存の型設計との一貫性を保つ。

### 4.2 座標の実データ投入

fixture 3駅の出口・改札に実座標を付与し、各駅で複数の出口候補を登録する(例: 渋谷駅ならヒカリエ改札・宮益坂口・南口・宮下パーク方面など)。座標調査は人手で行い、`confidence: high`(公式構内図で確認済み)を維持する。

---

## 5. 選定アルゴリズム

```
目的地座標
  → 全出口候補との距離を計算し、最も近い出口を選ぶ
  → 選んだ出口の connectedGateId から改札を特定
  → targetFacilityId === その改札ID の BoardingPosition を探す
    → 見つかれば号車を提示(confidence はそのデータの値をそのまま使う)
    → 見つからなければ号車は「確認できません」または将来的に「進行方向後方・7〜8号車付近」のような
      範囲表現+confidence:low で補う(下記6.2)
```

`route-search.ts` の `pickFacility` を「目的地座標最近傍選定」に置き換え、`buildTransferAndExitSegments` / `buildTrainSegments` の呼び出し順を「出口確定 → 改札確定 → 号車確定」の順に組み替える。

---

## 6. 段階的実装計画

### 6.1 Phase 1(出口・改札の方向修正) — 実施済み

- fixture 3駅に複数出口・実座標・`connectedGateId` を投入
- `pickFacility` を目的地座標ベースの選定に置き換え
- 効果: 今回のような「方向が逆」の誤案内を解消

### 6.2 Phase 1.5(閉世界仮定の誤りへの対処) — 実施済み

**背景**: Phase 1実装後も、渋谷駅で「Shibuya Sakura Stage」(桜丘町、駅の南西側)への案内が
東側の宮益坂口を指す誤りが再発した。原因はPhase 1のアルゴリズム自体ではなく、
**候補集合が不完全であることを一切考慮せず、あたかも網羅的であるかのように扱っていたこと**
(閉世界仮定の誤り)。渋谷fixtureの出口は当時2件(ヒカリエ改札/B5出口、宮益坂改札/宮益坂口)
のみで、両方とも駅の東側に偏っていたため、「その中で一番近い方」を正確に計算しても
実際の最寄り出口にはならなかった。

この診断はCodex(別LLM)との相互レビューで確認・精緻化した。Codexの指摘の要点:

- 座標の有無だけでなく、**候補が目的地の方角に存在するかどうか**を判定する必要がある
- Geminiに座標まで生成させる案(旧Phase 2案)は、架空または誤った出口名にもっともらしい
  座標が付き、誤案内の説得力を増す危険があるため**採用しない**
- 低信頼時は「間違っているかもしれません」と付記した具体的な出口名より、
  「南西側の出口をご利用ください」という**方角のみの誠実な案内の方が有用**

**対処**:

1. `resolveExitRecommendation`(`route-search.ts`)で、最寄り候補出口の方位角と、
   駅中心から見た目的地の方位角の差を計算する(`src/lib/geo/bearing.ts`)。
2. 差が90度(四半円)を超える場合、候補集合が目的地側を網羅していないとみなし、
   出口を名指しせず「目的地は◯◯側です」という方角のみの案内(`tier: "approximate"`)に格下げする。
3. 出口が確定しない場合、その出口に紐づく改札も確信度高く名指ししない(gateはexitに従属)。
4. 渋谷fixtureに南西側の出口(桜丘口)を追加し、今回の事例を回帰テストにした
   (座標は一般的な地図情報による概算のため `confidence: medium`。既存の東側2件のような
   公式構内図確認済みの `high` とは区別する)。

### 6.3 Phase 2(AI生成側への波及) — 方針転換、保留

旧案(Geminiに座標まで生成させる)はCodexのレビューで**採用しない**方針に転換した。
AI生成facility(fixture外の全国ほぼ全駅)は引き続き `coordinates: null` を維持し、
`resolveExitRecommendation` の「候補はあるが座標が無い」分岐により、自動的に
方角のみの案内(`approximate`)に格下げされる。これは機能低下ではなく、
根拠のない具体性を排除する意図的な設計(6.2参照)。

将来的にAIを使うとしても、最終データの生成元ではなく補助役(候補URL探索・表記揺れ正規化・
既存データとの照合)に限定する。全国向けの実在候補を得る一次ソースとしては、
OpenStreetMap(`railway=subway_entrance` 等)を優先候補として検討する(§7参照)。

### 6.4 号車の目的地連動における制約

改札ごとに複数の号車データを揃えるコストは高く、公式資料でも確実に取れないことが多い。改札別の号車データが揃わない場合は、号車を言い切らず「進行方向後方・7〜8号車付近」のように範囲表現+confidence:low で提示する。Phase 1では出口・改札の修正のみを対象とし、号車の目的地連動はデータが揃った駅から段階的に対応する。

### 6.5 Phase 2.5(改札後導線の閉世界仮定対処) — 設計確定・実装中

**背景**: Phase 1〜1.5は「出口・改札」の2点情報にとどまっており、大規模駅(渋谷・新宿・東京等)では
改札を出た後の進行方向・自由通路・地下街を経て地上出口に至る**一続きの導線**が必要というフィードバックを受けた。
一方で「全駅を対象にAIにも詳細を生成させる」という要求は、Phase 1.5で対策した閉世界仮定の誤り
(存在しない/誤った出口・改札名をAIがもっともらしく生成する)を、より実害の大きい粒度で再燃させる
リスクがある(改札を出た後の左右方向を誤ると、逆方向へ数百メートル誘導しうる)。

この論点はClaude(architectエージェント)とCodex(別LLM)の両方に個別に相談し、以下の方針で合意した。

**データモデル**:

- 新しい `GuideStepType`(`boarding` / `alighting` / `platform_facility` / `ticket_gate` /
  `post_gate_direction` / `public_passage` / `underground_mall` / `street_exit` /
  `destination_direction`)と `GuideStep` 型を追加(`src/lib/domain/route.ts`)。
- `ConfidenceLevel`(high/medium/low/unavailable の4段)は変更しない。代わりに **`provenance`
  (出所: `surveyed`(現地調査済み) / `map_estimate`(地図で確認) / `ai_inferred`(AI推定))を
  confidenceとは直交する別軸として `GuideStep` に持たせる**(`src/lib/domain/confidence.ts`)。
  信頼度に「AI専用」の段階を追加すると、既存の `worstConfidenceLevel` 等の集約ロジック・
  `ConfidenceBadge` 等のUIに広く波及するため、既存4段のまま出所を分離する設計を採った。
- `RouteGuide` に `arrivalGuide: ArrivalGuide | null` を**加算的**に追加(既存の `segments` /
  `summary.recommendedExit` は維持し、API後方互換を保つ)。`destinationDirection`(方角案内)は
  `streetExit` 等の具体的ステップが確認不能でも独立して持てるようにし、**方角を出口名の代わりに
  使わない**(Phase 1.5の近似ラベル機構とは別フィールドとして扱う)。

**表示ゲート(信頼度×リスク種別)**:

- `unavailable` はどの種別でも非表示(根拠のない詳細を捏造しない)。
- `high` はどの種別でも表示。
- **高リスク種別**(`post_gate_direction` / `public_passage` / `underground_mall` /
  `street_exit`。誤ると逆方向へ数百メートル誘導しうる)は `medium` 以上でのみ表示。
  検索グラウンディングありのAI推定は `medium` まで許容するが、`low` は非表示にする。
- **低リスク種別**(`boarding` / `alighting` / `platform_facility` / `ticket_gate` /
  `destination_direction`。誤っても実害が小さい、または方角のみの安全な案内)は
  `low` でも表示する。
- 実装: `src/lib/services/guide-step-visibility.ts` の `isGuideStepVisible()`。

**AI生成側の制約(今後の実装フェーズで適用)**:

- 改札後方向・自由通路・地下街等の生成は、既存の経路生成AI(`GeminiClient.searchAndGenerateStructuredContent`)
  と同様に**検索グラウンディング必須**とし、根拠が取れなければステップ自体を生成しない
  (facility生成の既存経路である検索なし `generateStructuredContent` は使わない)。
- 実在しない改札名・地下街名・出口記号を創作しない。方向(右/左)は視点の基準を明示できる場合のみ
  生成し、基準が確定できない場合は生成しない。
- モデル自身が申告する confidence は参考値に留め、GuideStepを構築する箇所は必ず
  `capConfidenceForProvenance()`(`src/lib/domain/confidence.ts`)を経由して最終 confidence を
  決定する。`ai_inferred` は検索裏付けがあっても `medium` が上限(AIレビューで、provenanceを
  分離しただけでは表示ゲートの安全性を担保できないと指摘されたための対策)。

**「全駅対象」の再定義**: 「全駅で詳細を必ず埋める」ではなく、**「全駅で `GuideStep` モデルと
安全なフォールバックを提供できる」**と定義する。データ生成(AI呼び出し)は全駅で行ってよいが、
表示は上記ゲートを通った範囲に限定する。根拠のない具体性は機能ではなく欠陥、という
Phase 1.5からの不変条件をここでも維持する。

**設計上の既知の未解決点(§7にも追記)**:

- ステップ種別ごとのリスク階層(`STEP_RISK_TIER`)は `Record<GuideStepType, RiskTier>` として
  全種別を網羅させ、新種別追加時に分類漏れがあればコンパイルエラーになるようにしている
  (fail-open防止)。
- `boarding` / `alighting` / `ticket_gate` は現状「低リスク種別」に分類しているが、実際に
  格納する文章に固有の路線名・方面・左右方向を含める場合は、内容次第で高リスク種別と
  同程度の実害があり得る(AIレビュー指摘)。生成ロジック実装時に、文章の具体性に応じた
  再分類が必要かどうかを再検討する。
- `ArrivalGuide.destinationDirection` と `destination_direction` 型の `GuideStep` は同じ
  情報を異なる形で表現しうる。生成側は両方を同じ入力から導出し、矛盾しないようにする
  (`route.ts` のインターフェースコメントに不変条件として明記済み)。

### 6.6 Phase 3(将来・本格実装)

駅構内図の画像解析・グラフ構造化・A*探索・複数ソースの整合性チェックなど、本格的な「入口逆算」システム。Phase 1の明示リンク(`connectedGateId`)は、将来ノード+重み付きエッジのグラフに拡張しても無駄にならない設計としている。プロダクトの利用状況を見てから着手する。

歩行経路API(Google Directions等)による出口の再順位付けもPhase 3候補。ただし
Codexの指摘通り、これは「候補が十分揃っている」ことが前提の改善(直線距離→歩行経路距離の
精緻化)であり、候補欠落問題そのもの(6.2の根本原因)は解決しない。導入する場合も
上位2〜3候補の再順位付けに限定し、候補列挙の網羅性向上(OSM取り込み等)を先に行う。

---

## 7. 未解決の論点

- **「全駅対応」の定義**: 9000駅すべてで出口名まで正確に案内することは、ソロ開発の
  現段階では現実的ではない。「全駅で目的地検索と駅方向案内ができる」ことと
  「データが十分な駅だけ出口・改札を具体案内する」ことを分けて捉える。
  根拠のない具体性は機能ではなく欠陥、という前提を維持する。
- 全国向け実在出口データの調達方法。人手によるfixture拡充は代表駅の回帰テスト・
  データモデル検証には有効だが、駅数に対してスケールしない。OpenStreetMapを
  一次候補ソースとして取り込む案が有力だが、日本の地下街接続の網羅性・改札情報の
  欠如など限界もあるため、fixture/公式データ→OSM→AI補助照合という優先順位で
  段階的に検証する。
- 出口が複数の改札に繋がる場合の優先順位付け(現状は1出口:1改札の単純リンクを想定)
- 目的地が駅から離れている場合(徒歩10分以上等)の出口選定の妥当性(現状の直線距離ベースでは信号・横断歩道・高低差を考慮できない、Phase 3で対応予定)
- 座標精度とconfidenceの関係(confidenceは「facilityの実在・名称が公式構内図で確認済みか」を表すもので、座標の測量精度は保証しない。出口同士の距離差が小さい場合、概算座標の誤差で選定結果が逆転しうる。座標専用の精度指標を設けるかは今後の検討課題とし、Phase 1では実装しない)
- 方位角ベースの網羅性判定(6.2)は距離・方角のみを見ており、駅の登録出口数・
  データソースの信頼度・出口と改札の接続データの有無等は考慮していない
  (Codexの指摘。閾値90度は経験的な初期値であり、実運用のフィードバックで調整する)
- ユーザーフィードバックループ(「この出口案内は正しかった/違った」を軽量に記録し、
  誤案内率の高い駅をfixture整備の優先順位付けに使う)は未着手。自由入力ではなく
  構造化された選択式にし、即時反映せず複数報告や確認を経て昇格させる設計が必要
