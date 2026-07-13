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

### 6.1 Phase 1(出口・改札の方向修正) — 優先度高、コスト小

- fixture 3駅に複数出口・実座標・`connectedGateId` を投入
- `pickFacility` を目的地座標ベースの選定に置き換え
- 効果: 今回のような「方向が逆」の誤案内を解消

### 6.2 Phase 2(AI生成側への波及) — 優先度中

- `generateStationFacilities` のプロンプトに目的地の名前・住所・座標を渡し、「この目的地に近い出口とそれに繋がる改札」を選ばせる
- 出力は引き続き `confidence: low` 固定(設計原則「AIを事実の唯一の生成元にしない」を維持)

### 6.3 号車の目的地連動における制約

改札ごとに複数の号車データを揃えるコストは高く、公式資料でも確実に取れないことが多い。改札別の号車データが揃わない場合は、号車を言い切らず「進行方向後方・7〜8号車付近」のように範囲表現+confidence:low で提示する。Phase 1では出口・改札の修正のみを対象とし、号車の目的地連動はデータが揃った駅から段階的に対応する。

### 6.4 Phase 3(将来・本格実装)

駅構内図の画像解析・グラフ構造化・A*探索・複数ソースの整合性チェックなど、本格的な「入口逆算」システム。Phase 1の明示リンク(`connectedGateId`)は、将来ノード+重み付きエッジのグラフに拡張しても無駄にならない設計としている。プロダクトの利用状況を見てから着手する。

---

## 7. 未解決の論点

- 座標データの調達方法(公式構内図からの手動採取が基本方針だが、駅数が増えた際のスケーラビリティは未検討)
- 出口が複数の改札に繋がる場合の優先順位付け(現状は1出口:1改札の単純リンクを想定)
- 目的地が駅から離れている場合(徒歩10分以上等)の出口選定の妥当性(現状の直線距離ベースでは信号・横断歩道・高低差を考慮できない、Phase 3で対応予定)
- 座標精度とconfidenceの関係(confidenceは「facilityの実在・名称が公式構内図で確認済みか」を表すもので、座標の測量精度は保証しない。出口同士の距離差が小さい場合、概算座標の誤差で選定結果が逆転しうる。座標専用の精度指標を設けるかは今後の検討課題とし、Phase 1では実装しない)
