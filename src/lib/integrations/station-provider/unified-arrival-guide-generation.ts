import { searchAndGenerateStructuredContent } from "@/lib/integrations/ai/GeminiAiSdkClient";
import type { ConfidenceLevel } from "@/lib/domain/confidence";
import type { Coordinates } from "@/lib/domain/station";
import { locationHint } from "./ai-generation";

/**
 * 乗車位置・改札・出口・改札後の徒歩ルートを1回の検索セッションで統合生成する
 * バックエンド。
 *
 * council議論(2026-07-20): 実機比較で「西谷駅から目的地までの号車・改札・出口・
 * 徒歩ルートを1つのシステムプロンプトで一括検索させる」方式(Geminiチャットでの
 * 実演)が、既存の分割方式(facilities一覧生成→座標ベースの出口選定→改札後導線を
 * 別セッションでさらに推測)より明確に高精度だった。分割方式の弱点は主に2つ:
 * (1) AI生成facilityは座標を持たないため、目的地座標に基づく出口選定ロジック
 * (route-search.ts resolveExitRecommendation)の対象外になり、目的地が駅そのもの
 * でない限り常に「確認できません」に落ちる構造的な問題があった。
 * (2) 改札後導線(arrival-guide-ai-generation.ts)は、既に(不確かな)AI推定で
 * 決まった改札・出口の「間」をさらに別セッションで推測する二段重ねの設計で、
 * canGenerateNarrative(arrival-guide.ts)がgate/exitのどちらかがAI推定の場合は
 * 生成自体を止める安全策を取っていた(不確かな情報の上に不確かな情報を重ねる
 * リスクを避けるため)。統合生成は同一検索セッションで改札・出口・徒歩ルートを
 * 一貫して回答させるため、この「別々の推測を重ねる」問題自体が発生しない。
 *
 * 乗車位置(号車・ドア位置)も2026-07-20に統合生成へ組み込んだ
 * (fix/unified-guide-boarding-and-operator-disambiguation)。従来は
 * ai-generation.tsのgenerateBoardingPositionが完全に独立したAIセッションで
 * 「改札に近い停止位置」とだけ検索していたため、到着駅に同一事業者の改札が
 * 複数ある場合(例: 横浜駅の相鉄1階改札・2階改札)、統合生成が選んだ改札とは
 * 無関係な改札を基準に号車を回答してしまう実例が確認された(西谷駅→kawara
 * CAFE&DINING横浜店の実機検証で、統合生成は「相鉄1階改札」を選んだのに、
 * 独立した乗車位置生成は「2階改札」寄りの号車を回答していた)。乗車位置も
 * 同一検索セッションで「1で確定した改札」を明示的な基準にして決めさせることで、
 * 号車と改札・出口の不整合を構造的に防ぐ。副次効果として、AI生成駅への
 * 1リクエストあたりの課金対象AI呼び出しが1回減る(号車の独立呼び出しが不要に
 * なるため)。
 *
 * モデルはgemini-3.5-flashを使う(gemini-3.1-pro-previewとの比較で、検索実行の
 * 安定性・応答速度・コストのバランスが良かったため。gemini-3.1-flash-liteは
 * ツール呼び出し判断が弱く検索を実行しないケースがあり不採用)。
 *
 * 目的地がplace由来(destinationHintあり)の場合、絞り込み型の指示
 * (「目的地に最も近い改札・出口を検索して」)を使う。旧Groundingモデル+旧分割
 * プロンプトでは絞り込み型が「確認できない設備は創作しない」という保守的ルールと
 * 相互作用し駅全体の回答まで抑制する回帰が実測されていたが(ai-generation.ts
 * generateStationFacilitiesのコメント参照)、gemini-3.5-flash+この統合プロンプト
 * では同じ問題は再現しなかった(西谷駅→kawara CAFE&DINING横浜店のドライランで
 * 改札名・出口名・徒歩ルートまで具体的に取得できることを確認済み)。
 *
 * 複数事業者が乗り入れる結節点駅(例: 横浜駅の相鉄・JR・東急・市営地下鉄)では、
 * 検索で見つかりやすい他社共用の連絡改札名や他社の番号出口案内を誤って
 * 採用する実例が確認された(西谷駅→横浜駅で「JR・相鉄連絡改札口」「出口5」
 * (いずれも地下鉄側の案内)を誤答し、正しくは相鉄自身の「相鉄線1階改札」
 * 「みなみ西口(相鉄口)」だった)。プロンプトに事業者固有設備の優先指示を
 * 追加して対応する。
 *
 * 事業者名は乗車路線名(originLine)を根拠にする。到着駅のoperator
 * (destinationOperator)ではない — HeartRails Express APIは事業者名を
 * 提供しないため、fixture廃止(2026-07-20)後はdestinationOperatorが常に
 * 空文字になり、これを条件にした注意書きは実質発火しない不具合だった。
 * originLine(経路生成AIが検索で確認した乗車路線)は必ず存在し、「この路線に
 * 乗車した時点で到着事業者は一意に確定する」という事実で代替できる。
 *
 * 回答項目の順序を「改札→出口」から「出口→改札→徒歩→号車」へ組み替えた
 * (2026-07-20 fix/unified-guide-exit-first-derivation)。旧fixture時代の
 * 座標ベース選定(resolveExitRecommendation→pickGateForExit、目的地に最も
 * 近い出口を先に選び、その出口のconnectedGateIdから改札を逆引きする設計)と
 * 同じ「目的地から逆算する」依存関係にプロンプトの指示も揃える。旧順序
 * (改札を先に単独で決め、出口をその従属物として聞く)では、改札が目的地への
 * 近さという直接の根拠なく決まってしまい、実機検証で号車の理由文が実際に
 * 選んだ改札と異なる階の改札(例: 「1階改札」を選んだのに理由文は「2階改札」
 * 基準)を参照する不整合が3回中2回の頻度で再現した。出口を先に(目的地への
 * 近さで)決め、改札をその出口から逆引きさせることで、後続の号車判断も
 * 曖昧さの少ない改札を基準にできる。
 */

const MODEL = "gemini-3.5-flash";
// 抽出フェーズ(検索で得たテキストを構造化データに変換するのみ、検索能力は
// 要求しない)はsearch phaseより軽量なモデルで足りるかをA/B評価する対象
// (chore/pin-models-pattern-a: 検索を伴わない純粋な構造化抽出はコストの
// 低いモデルでも精度が落ちないという仮説の検証)。
const EXTRACTION_MODEL = "gemini-3.1-flash-lite";
// GeminiAiSdkClientのデフォルト検索タイムアウト(55秒)を上書きする。出口→改札→
// 徒歩→乗車位置の依存関係を明示する指示を追加した結果プロンプトが長くなり、
// 実機検証(Preview環境)で55秒ではTimeoutErrorが発生することを確認したため
// (2026-07-20 fix/unified-guide-exit-first-derivation)。他のsearchAndGenerate
// StructuredContent呼び出し元(経路生成・facilities生成・乗車位置独立生成)は
// この統合生成ほど複雑な指示を持たないため、デフォルト値のままでよい。
const SEARCH_TIMEOUT_MS = 90000;
const MAX_TEXT_LENGTH = 200;
const MAX_REASON_LENGTH = 150;
const MAX_WALKING_STEPS = 6;
const MAX_CAR_NUMBER = 16;

const VALID_CONFIDENCE_LEVELS: ConfidenceLevel[] = ["high", "medium", "low"];
const VALID_DOOR_POSITIONS = ["前方", "中央", "後方"] as const;
type DoorPosition = (typeof VALID_DOOR_POSITIONS)[number];

export interface UnifiedArrivalGuideResult {
  boardingPosition: {
    carNumber: number;
    doorPosition: DoorPosition;
    reason: string;
    confidenceLevel: ConfidenceLevel;
  } | null;
  gate: { name: string; confidenceLevel: ConfidenceLevel } | null;
  exit: { name: string; confidenceLevel: ConfidenceLevel } | null;
  walkingSteps: { title: string; instruction: string; confidenceLevel: ConfidenceLevel }[];
}

interface GeneratedUnifiedArrivalGuide {
  boardingCarNumber?: number;
  boardingDoorPosition?: DoorPosition;
  boardingReason?: string;
  boardingConfidence?: ConfidenceLevel;
  gateName?: string;
  gateConfidence?: ConfidenceLevel;
  exitName?: string;
  exitConfidence?: ConfidenceLevel;
  walkingSteps?: { title: string; instruction: string; confidence: ConfidenceLevel }[];
}

const UNIFIED_ARRIVAL_GUIDE_SCHEMA = {
  type: "object",
  properties: {
    boardingCarNumber: { type: "integer" },
    boardingDoorPosition: { type: "string", enum: VALID_DOOR_POSITIONS },
    boardingReason: { type: "string" },
    boardingConfidence: { type: "string", enum: VALID_CONFIDENCE_LEVELS },
    gateName: { type: "string" },
    gateConfidence: { type: "string", enum: VALID_CONFIDENCE_LEVELS },
    exitName: { type: "string" },
    exitConfidence: { type: "string", enum: VALID_CONFIDENCE_LEVELS },
    walkingSteps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          instruction: { type: "string" },
          confidence: { type: "string", enum: VALID_CONFIDENCE_LEVELS },
        },
        required: ["title", "instruction", "confidence"],
      },
    },
  },
  required: ["walkingSteps"],
};

function isNonEmptyText(value: unknown, maxLength: number = MAX_TEXT_LENGTH): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isValidConfidenceLevel(value: unknown): value is ConfidenceLevel {
  return typeof value === "string" && VALID_CONFIDENCE_LEVELS.includes(value as ConfidenceLevel);
}

function isValidDoorPosition(value: unknown): value is DoorPosition {
  return typeof value === "string" && (VALID_DOOR_POSITIONS as readonly string[]).includes(value);
}

function isValidWalkingStep(
  value: unknown
): value is { title: string; instruction: string; confidence: ConfidenceLevel } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNonEmptyText(candidate.title) &&
    isNonEmptyText(candidate.instruction) &&
    isValidConfidenceLevel(candidate.confidence)
  );
}

export async function generateUnifiedArrivalGuide(
  apiKey: string,
  originStationName: string,
  originLine: string,
  originDirection: string,
  destinationStationName: string,
  destinationOperator: string,
  destinationLines: string[],
  destinationHint: string | null,
  stationCoordinates: Coordinates | null,
  destinationPlaceCoordinates: Coordinates | null,
  fixedExit: { name: string; confidenceLevel: ConfidenceLevel } | null = null
): Promise<UnifiedArrivalGuideResult | null> {
  const stationLabel = destinationOperator
    ? `${destinationStationName}駅(${destinationOperator}、${destinationLines.join("・")})${locationHint(stationCoordinates)}`
    : `${destinationStationName}駅(${destinationLines.join("・")})${locationHint(stationCoordinates)}`;

  // destinationHint(目的地施設名)自体は駅名等と曖昧衝突しうる一般的な名称の
  // 場合があるため、目的地自体の実座標(stationCoordinatesとは別物、駅の
  // 中心座標ではなく目的地施設の座標)も併記して曖昧性解消のヒントにする
  // (/ai-review指摘、Medium: 旧実装は駅座標のみを渡し目的地の実座標を
  // AIへ渡していなかった)。
  const destinationLabel = destinationHint
    ? `${stationLabel}付近の「${destinationHint}」${locationHint(destinationPlaceCoordinates)}`
    : stationLabel;

  // 事業者名(destinationOperator)はHeartRails由来の駅では常に空文字になる
  // (HeartRails Express APIが事業者名を提供しないため。heartrails.ts参照。
  // fixture廃止(2026-07-20)によりHeartRailsが唯一の駅データ源になったため、
  // destinationOperatorを条件にした注意書きは実質発火しなくなっていた
  // 不具合をここで修正)。代わりに、乗車路線(originLine)は経路生成AIが
  // 検索で確認した値のため確実に存在し、かつ「この路線に乗車した時点で
  // 到着に使う事業者は一意に確定する(自動で他社線に乗り入れない限り)」
  // という事実を根拠にできる。事業者名の代わりに乗車路線名を軸に
  // 事業者固有設備への絞り込みを指示する。
  const operatorDisambiguationNote = originLine
    ? `\n\n【複数事業者駅の注意】\n${destinationStationName}駅は複数の鉄道会社が乗り入れる駅である可能性があります。今回${originStationName}駅から乗車したのは${originLine}です。直通運転・相互乗り入れが無い区間であれば、到着に使う事業者はこの${originLine}を運行する会社に絞り込めます。ただし直通運転区間では到着時点の運行会社が変わっている場合があるため、路線名だけで事業者を断定せず、到着ホームの案内表示や公式構内図で実際の運行会社を確認したうえで回答してください。回答する乗車位置・改札名・出口名は、その(到着時点で実際に案内に使われている)会社の名称にしてください。他社線専用の連絡改札や、その会社が使わない番号のみの出口案内(例:地下鉄や他社線の「出口5」等)を、確認せずそのまま採用しないでください。`
    : "";

  // 目的地公式サイト優先検索(destinationAccessPriorityNote)・有名性バイアス
  // 禁止(antiLandmarkBiasNote)というプロンプト指示ベースの対策は、いずれも
  // 実機検証(fix/destination-first-access-priority)で効果が確認できず撤回した。
  // 「みなみ西口」「ハチ公口」のような有名な出口への収束自体は、実際に食べログ・
  // ホットペッパーグルメ等の公開情報が案内している内容と一致していることが
  // 別途の専用検索(diag-dest-access)で確認できたため、「最短距離」より
  // 「広く案内されている迷いにくい出口」を優先する方針とし、有名性の排除は
  // もう試みない。
  //
  // 代わりに、呼び出し元(route-search.ts)が別の専用検索で確認した「目的地が
  // 明言する出口」をfixedExitとして渡せるようにし、渡された場合はこの関数
  // 自身に出口を選ばせず、その出口を起点に改札を選ばせる設計に変更した。
  // 改札名まで目的地の公開情報から機械的に固定しないのは、目的地のページが
  // 「渋谷駅から徒歩3分」のように鉄道会社を意識せず書かれていることが多く、
  // 今回の乗車路線(originLine)の運行会社と無関係な改札名(例: 東急利用者なのに
  // 京王井の頭線側の改札)を拾ってしまうリスクがあるため。改札は事業者の
  // 整合性を保てるこの関数(統合生成)側で、確定した出口を起点に選ばせる。
  const fixedExitNote = fixedExit
    ? `\n\n【出口は既に確定済み】\n目的地の公式情報の検索により、出口は既に「${fixedExit.name}」と判明しています。この出口名をそのまま採用してください(別の出口を提案しないでください)。あなたが行うべきなのは、この「${fixedExit.name}」に直接つながる、またはこの出口を利用する際に必ず通る改札名を、今回の乗車事業者(${originLine}を運行する会社)基準で選ぶことです。`
    : "";

  const searchPrompt = `あなたは日本の鉄道に詳しい乗換えナビゲーターです。ユーザーは「${originStationName}駅」から${originLine}(${originDirection})に乗車し、「${destinationLabel}」へ向かうルートを知りたいと考えています。
回答時には必ずインターネット検索を行い、最新かつ正確な乗車位置・改札・出口・徒歩ルート情報を取得し、出力前にファクトチェックを行います。

【回答の考え方(重要)】
以下の4項目は目的地から逆算した依存関係にあります。必ずこの順序で考え、後の項目は前の項目の結果を踏まえて決めてください(改札を先に単独で決めて、それに合わせて出口を選ぶという逆の順序にはしないでください)。
出口(目的地に最も近い/最も直接的にたどり着けるもの) → 改札(その出口に直接つながる、またはその出口を利用する際に必ず通るもの) → その出口を経由する徒歩ルート → 乗車位置(その改札に最短で着ける号車)${fixedExitNote}

【回答すべき情報】
1. ${fixedExit ? `出口名は「${fixedExit.name}」で確定済みです(そのまま回答してください)` : destinationHint ? `${destinationLabel}に最も直接的にたどり着ける出口名(徒歩距離が最短になるものを優先してください)` : `${stationLabel}の主要な出口名`}
2. 1の出口に直接つながる、またはその出口を利用する際に必ず通る改札名(1で決めた出口を起点に選んでください)
3. 2の改札を出て1の出口を通り、目的地までの徒歩ルート(目印を含む、簡潔に)
4. ${originStationName}駅で${originLine}(${originDirection})に乗車する場合、2の改札に到着ホーム上の階段・エスカレーターで最短で向かえる号車・ドア位置(列車の進行方向・編成両数と照合して決めてください。到着番線や編成によって結果が変わる場合はその条件を含めてください)${operatorDisambiguationNote}

【制約】
- 鉄道会社公式の駅構内図・公式サイトを最優先の情報源としてください。
- 同じ駅名が他にも存在する場合は、必ず上記の位置に最も近い駅を対象にしてください。
- 確証がない場合は「確認できません」と明示し、推測による回答は行わない。実在しない乗車位置・改札名・出口名を創作しないでください。`;

  const extractionInstruction = `以下の文章から、出口名・改札名・徒歩ルート・乗車位置(号車・ドア位置・理由)の情報をJSON形式で抽出してください。
確信が持てない項目は含めないでください(改札名・出口名が確認できない場合はgateName/exitNameのプロパティ自体を省略、乗車位置が確認できない場合はboardingCarNumber等のプロパティ自体を省略してください)。
boardingReasonには、到着番線や編成によって結果が変わる場合の条件(例:◯番線着の場合は◯号車)を含めてください。ただし150字程度までの簡潔な文章にまとめてください。
徒歩ルートの各ステップには、短い見出し(title、例:「改札を出て直進」)と詳しい説明(instruction)の両方を含めてください。
各項目について、あなた自身がその情報にどれだけ自信があるかをhigh/medium/lowで自己申告してください。`;

  const result = await searchAndGenerateStructuredContent<GeneratedUnifiedArrivalGuide>(
    apiKey,
    searchPrompt,
    extractionInstruction,
    UNIFIED_ARRIVAL_GUIDE_SCHEMA,
    "unified-arrival-guide-generation",
    MODEL,
    EXTRACTION_MODEL,
    SEARCH_TIMEOUT_MS
  );

  if (!result) return null;

  const boardingPosition =
    typeof result.boardingCarNumber === "number" &&
    Number.isInteger(result.boardingCarNumber) &&
    result.boardingCarNumber >= 1 &&
    result.boardingCarNumber <= MAX_CAR_NUMBER &&
    isValidDoorPosition(result.boardingDoorPosition) &&
    isNonEmptyText(result.boardingReason, MAX_REASON_LENGTH) &&
    isValidConfidenceLevel(result.boardingConfidence)
      ? {
          carNumber: result.boardingCarNumber,
          doorPosition: result.boardingDoorPosition,
          reason: result.boardingReason,
          confidenceLevel: result.boardingConfidence,
        }
      : null;
  const gate =
    isNonEmptyText(result.gateName) && isValidConfidenceLevel(result.gateConfidence)
      ? { name: result.gateName, confidenceLevel: result.gateConfidence }
      : null;
  // fixedExitが渡された場合は、抽出結果のexitNameより優先してそのまま採用する
  // (モデルが「出口名は確定済み」という指示に従わず別の出口を返した場合の
  // 揺らぎを吸収するため。改札はfixedExit起点で選ばせた抽出結果をそのまま使う)。
  const exit = fixedExit
    ? fixedExit
    : isNonEmptyText(result.exitName) && isValidConfidenceLevel(result.exitConfidence)
      ? { name: result.exitName, confidenceLevel: result.exitConfidence }
      : null;
  const walkingSteps = Array.isArray(result.walkingSteps)
    ? result.walkingSteps
        .filter(isValidWalkingStep)
        .slice(0, MAX_WALKING_STEPS)
        .map((step) => ({
          title: step.title,
          instruction: step.instruction,
          confidenceLevel: step.confidence,
        }))
    : [];

  return { boardingPosition, gate, exit, walkingSteps };
}

