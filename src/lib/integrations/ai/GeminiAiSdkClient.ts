import { createGoogle } from "@ai-sdk/google";
import { generateObject, generateText, jsonSchema } from "ai";
import * as aiModuleStatic from "ai";
import { scheduleLangfuseFlush } from "./langfuse-flush";

declare global {
  var __diagAiModuleRegisterTelemetryRef: unknown;
}

/**
 * [DIAG2] instrumentation.tsが動的import("ai")で取得したモジュールと、
 * このファイルが静的importした"ai"モジュールが、Next.js/Turbopackの
 * バンドル分割によって別インスタンスになっていないかを確認する一時的な
 * 診断コード。registerTelemetryが登録された"ai"モジュールインスタンスと、
 * 実際にgenerateObject/generateTextを呼び出す"ai"モジュールインスタンスが
 * 食い違っていると、telemetryイベントの購読者が実際の呼び出しに
 * 気づけずスパンが1件も生成されない可能性がある。
 */
function diagLogAiModuleIdentity(): void {
  const stored = globalThis.__diagAiModuleRegisterTelemetryRef;
  console.log(
    "[DIAG2] GeminiAiSdkClient.ts: static ai module registerTelemetry === instrumentation.ts stored ref?",
    stored !== undefined ? stored === aiModuleStatic.registerTelemetry : "NOT_YET_REGISTERED"
  );
}

const MODEL_ID = "gemini-flash-latest";
const REQUEST_TIMEOUT_MS = 15000;
// Google Search Grounding は実際にWeb検索を行うため、単発の構造化生成より大幅に時間がかかる
// (GeminiClient.tsのSEARCH_REQUEST_TIMEOUT_MSと同じ根拠。西谷駅→国際センター駅(名駅)の
// ような遠距離・同名駅の曖昧性解消が絡む検索で実測35秒超のため55秒を確保する)。
const SEARCH_REQUEST_TIMEOUT_MS = 55000;

interface GoogleGroundingMetadata {
  webSearchQueries?: string[];
}

interface GoogleProviderTelemetryMetadata {
  groundingMetadata?: GoogleGroundingMetadata;
}

/**
 * apiKeyをDIパターンで受け取り、都度Google providerインスタンスを生成する。
 * integrations/index.tsでの既存DIパターン(GEMINI_API_KEYをコンストラクタ引数として
 * 渡す設計)を踏襲し、providerの生成をこのモジュール内に閉じ込める
 * (呼び出し側にVercel AI SDKの生成処理を漏らさないため)。
 */
function googleProvider(apiKey: string) {
  return createGoogle({ apiKey });
}

/**
 * generateObjectの型シグネチャは、schemaへ渡すジェネリック型引数Tがネイキッドな
 * (制約のない)型変数だと、OUTPUT("enum"/"object"等)の条件型解決がTS側で
 * 保留されてしまい、呼び出し引数の型チェックが破綻する(AI SDK 7時点の既知の制約)。
 * そのため schema 自体は unknown で構築してgenerateObjectへは具体的でない型として渡し、
 * 戻り値をこの関数の呼び出し元が期待する型Tへキャストする(既存GeminiClient.tsの
 * `JSON.parse(text) as T` と同じく、呼び出し元がスキーマとTの整合に責任を持つ設計を踏襲)。
 */
function toObjectSchema(responseSchema: object) {
  // Validate that responseSchema has safe structure
  if (!responseSchema || typeof responseSchema !== 'object' || Array.isArray(responseSchema)) {
    throw new TypeError('Invalid schema: must be a plain object');
  }
  
  // Validate required JSON Schema properties
  const schema = responseSchema as Record<string, unknown>;
  if (!schema.type || typeof schema.type !== 'string') {
    throw new TypeError('Invalid schema: missing or invalid "type" property');
  }
  
  return jsonSchema<unknown>(responseSchema as Parameters<typeof jsonSchema<unknown>>[0]);
}

/**
 * Vercel AI SDK(generateObject)ベースのJSON構造化出力を生成する薄いラッパー。
 * GeminiClient.ts の generateStructuredContent と同じ契約(シグネチャ・
 * エラーハンドリング方針・タイムアウト値)を維持する。
 *
 * ネットワーク障害・タイムアウト・不正な応答(NoObjectGeneratedError等)は
 * 全て null を返す(例外を投げない)。AI生成はあくまで補助的なフォールバックであり、
 * その障害で呼び出し元の処理全体を落としてはならないため。
 *
 * experimental_telemetry(AI SDK 7では `telemetry` に改称、旧名は非推奨エイリアスとして
 * 引き続き利用可)を有効化し、Langfuse等のOpenTelemetry連携で呼び出し元をトレース上で
 * 識別できるよう functionId に callerId(呼び出し元の識別子)を付与する
 * (telemetryのmetadataフィールドはAI SDK 7の型定義上、関数によって受け付ける形が
 * 異なり型エラーになったため今回は使わず、functionIdのみで識別する)。
 */
export async function generateStructuredContent<T>(
  apiKey: string,
  prompt: string,
  responseSchema: object,
  callerId: string = "gemini-ai-sdk.generateStructuredContent"
): Promise<T | null> {
  diagLogAiModuleIdentity();
  try {
    const google = googleProvider(apiKey);
    const { object } = await generateObject({
      model: google(MODEL_ID),
      // 既存コードは生のJSON Schemaオブジェクトを扱っており(Zodスキーマ化はしていない)、
      // その資産をそのまま流用できるよう jsonSchema() でAI SDK互換の型にラップする。
      schema: toObjectSchema(responseSchema),
      prompt,
      abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      telemetry: {
        isEnabled: true,
        functionId: callerId,
      },
    });
    return object as T;
  } catch {
    return null;
  } finally {
    // 成否に関わらずtelemetryは送る(失敗時の原因調査こそLangfuseで見たい対象のため)。
    scheduleLangfuseFlush();
  }
}

/**
 * Google Search Grounding + 構造化出力の2段階呼び出し(Vercel AI SDK版)。
 *
 * AI SDKの Google provider も、生のGemini APIと同様に `tools`(google_search)と
 * `responseSchema` 相当の構造化出力オプションを同一呼び出しで併用すると検索が
 * 実行されない制約を引き継いでいるため、GeminiClient.ts の
 * searchAndGenerateStructuredContent と同じ2段階設計を踏襲する:
 * 1回目は generateText + google.tools.googleSearch() で検索を実行してテキスト回答を得て、
 * providerMetadata.google.groundingMetadata で検索実行の有無を確認する。
 * 2回目でそのテキストを generateObject で構造化データに変換する。
 *
 * 1回目で検索が実行されなかった場合や、いずれかのフェーズが失敗した場合は
 * 根拠のない推測を避けるため null を返す(例外を投げない)。
 */
export async function searchAndGenerateStructuredContent<T>(
  apiKey: string,
  searchPrompt: string,
  extractionInstruction: string,
  responseSchema: object,
  callerId: string = "gemini-ai-sdk.searchAndGenerateStructuredContent",
  searchModel: string = MODEL_ID
): Promise<T | null> {
  diagLogAiModuleIdentity();
  try {
    const google = googleProvider(apiKey);

    const searchResult = await generateText({
      model: google(searchModel),
      tools: { google_search: google.tools.googleSearch({}) },
      prompt: searchPrompt,
      abortSignal: AbortSignal.timeout(SEARCH_REQUEST_TIMEOUT_MS),
      telemetry: {
        isEnabled: true,
        functionId: `${callerId}.search`,
      },
    });

    const groundingMetadata = (
      searchResult.providerMetadata?.google as GoogleProviderTelemetryMetadata | undefined
    )?.groundingMetadata;
    const searchExecuted = (groundingMetadata?.webSearchQueries?.length ?? 0) > 0;
    if (!searchResult.text || !searchExecuted) return null;

    // 抽出フェーズ(構造化データへの変換のみ)は検索能力を要求しないため、
    // searchModelに関わらず常にデフォルトモデルを使う(GeminiClient.tsの
    // extractStructuredContentと同方針)。
    const { object } = await generateObject({
      model: google(MODEL_ID),
      schema: toObjectSchema(responseSchema),
      prompt: `${extractionInstruction}\n\n${searchResult.text}`,
      abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      telemetry: {
        isEnabled: true,
        functionId: `${callerId}.extract`,
      },
    });
    return object as T;
  } catch {
    return null;
  } finally {
    scheduleLangfuseFlush();
  }
}
