/**
 * 改札・出口AI生成のバックエンド比較評価(facilities-backend-eval.test.ts)用
 * データセット。destination-hint-verification.test.tsの既存6駅(hint有り)に、
 * JR各社・私鉄・東京メトロ・公営地下鉄・地方都市の主要駅を加えて20駅まで
 * 拡張した。destinationHint有り10駅・無し10駅でバランスさせている。
 *
 * ユニットテストのモックデータで頻出する駅名(西谷駅・渋谷駅・新宿駅)は、
 * 紛らわしくなるため意図的に避けている。
 */
export interface EvalPair {
  label: string;
  stationName: string;
  operator: string;
  lines: string[];
  /** nullなら駅そのものが目的地(hint無し)。駅全体の改札・出口生成を評価する。 */
  destinationHint: string | null;
}

export const FACILITIES_EVAL_DATASET: EvalPair[] = [
  // --- destinationHint有り(10駅) ---
  {
    label: "横浜駅(横浜市営地下鉄ブルーライン)/ kawara CAFE＆DINING 横浜店",
    stationName: "横浜駅",
    operator: "横浜市交通局",
    lines: ["横浜市営地下鉄ブルーライン"],
    destinationHint: "kawara CAFE＆DINING 横浜店",
  },
  {
    label: "東京駅(JR東日本)/ KITTE丸の内",
    stationName: "東京駅",
    operator: "JR東日本",
    lines: ["JR東海道本線", "JR中央線", "JR京浜東北線"],
    destinationHint: "KITTE丸の内",
  },
  {
    label: "吉祥寺駅(JR中央線)/ 井の頭恩賜公園",
    stationName: "吉祥寺駅",
    operator: "JR東日本",
    lines: ["JR中央線"],
    destinationHint: "井の頭恩賜公園",
  },
  {
    label: "表参道駅(東京メトロ)/ 表参道ヒルズ",
    stationName: "表参道駅",
    operator: "東京メトロ",
    lines: ["東京メトロ銀座線", "東京メトロ千代田線", "東京メトロ半蔵門線"],
    destinationHint: "表参道ヒルズ",
  },
  {
    label: "池袋駅(JR東日本)/ サンシャインシティ",
    stationName: "池袋駅",
    operator: "JR東日本",
    lines: ["JR山手線", "JR埼京線", "JR湘南新宿ライン"],
    destinationHint: "サンシャインシティ",
  },
  {
    label: "秋葉原駅(JR東日本)/ ヨドバシAkiba",
    stationName: "秋葉原駅",
    operator: "JR東日本",
    lines: ["JR山手線", "JR京浜東北線", "JR総武線"],
    destinationHint: "ヨドバシAkiba",
  },
  {
    label: "大宮駅(JR東日本)/ そごう大宮店",
    stationName: "大宮駅",
    operator: "JR東日本",
    lines: ["JR京浜東北線", "JR埼京線", "JR宇都宮線"],
    destinationHint: "そごう大宮店",
  },
  {
    label: "名古屋駅(JR東海)/ JRゲートタワー",
    stationName: "名古屋駅",
    operator: "JR東海",
    lines: ["JR東海道本線", "JR中央本線", "東海道新幹線"],
    destinationHint: "JRゲートタワー",
  },
  {
    label: "梅田駅(阪急電鉄)/ 阪急うめだ本店",
    stationName: "梅田駅",
    operator: "阪急電鉄",
    lines: ["阪急神戸本線", "阪急宝塚本線", "阪急京都本線"],
    destinationHint: "阪急うめだ本店",
  },
  {
    label: "博多駅(JR九州)/ 博多阪急",
    stationName: "博多駅",
    operator: "JR九州",
    lines: ["JR鹿児島本線", "JR博多南線", "九州新幹線"],
    destinationHint: "博多阪急",
  },

  // --- destinationHint無し(10駅、駅全体の改札・出口生成を評価) ---
  {
    label: "立川駅(JR東日本)",
    stationName: "立川駅",
    operator: "JR東日本",
    lines: ["JR中央線", "JR南武線", "JR青梅線"],
    destinationHint: null,
  },
  {
    label: "栄駅(名古屋市営地下鉄)",
    stationName: "栄駅",
    operator: "名古屋市交通局",
    lines: ["名古屋市営地下鉄東山線", "名古屋市営地下鉄名城線"],
    destinationHint: null,
  },
  {
    label: "なんば駅(Osaka Metro)",
    stationName: "なんば駅",
    operator: "Osaka Metro",
    lines: ["Osaka Metro御堂筋線", "Osaka Metro四つ橋線", "Osaka Metro千日前線"],
    destinationHint: null,
  },
  {
    label: "神戸三宮駅(阪神電気鉄道)",
    stationName: "神戸三宮駅",
    operator: "阪神電気鉄道",
    lines: ["阪神本線"],
    destinationHint: null,
  },
  {
    label: "札幌駅(JR北海道)",
    stationName: "札幌駅",
    operator: "JR北海道",
    lines: ["JR函館本線", "JR千歳線"],
    destinationHint: null,
  },
  {
    label: "仙台駅(JR東日本)",
    stationName: "仙台駅",
    operator: "JR東日本",
    lines: ["JR東北本線", "JR仙山線"],
    destinationHint: null,
  },
  {
    label: "広島駅(JR西日本)",
    stationName: "広島駅",
    operator: "JR西日本",
    lines: ["JR山陽本線", "JR呉線", "JR芸備線"],
    destinationHint: null,
  },
  {
    label: "川崎駅(JR東日本)",
    stationName: "川崎駅",
    operator: "JR東日本",
    lines: ["JR東海道線", "JR京浜東北線", "JR南武線"],
    destinationHint: null,
  },
  {
    label: "西鉄福岡(天神)駅(西日本鉄道)",
    stationName: "西鉄福岡(天神)駅",
    operator: "西日本鉄道",
    lines: ["西鉄天神大牟田線"],
    destinationHint: null,
  },
  {
    label: "京都駅(JR西日本)",
    stationName: "京都駅",
    operator: "JR西日本",
    lines: ["JR東海道本線", "JR奈良線", "JR山陰本線"],
    destinationHint: null,
  },
];
