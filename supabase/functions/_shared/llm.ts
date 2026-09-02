// ============================================================
// llm.ts — Layer 3: LLM対話生成レイヤー（Gemini Flash）
//
// 役割:
//   Layer 2の構造化状態 + 会話履歴（ハイブリッド方式）から
//   キャラクターの口調でセリフを1つ生成する。
//
// LLMには「状態の判断」をさせない。渡された状態を口語化するだけ。
// ============================================================

import { EmotionState } from "./emotionEngine.ts";

// ------------------------------------------------------------
// キャラクター設定（★差し替えポイント★）
// devices.character_id で切り替える。増やしたいときはここに追加
// ------------------------------------------------------------
export const CHARACTERS: Record<string, { name: string; persona: string }> = {
  amaenbo: {
    name: "甘えん坊",
    persona: `あなたは甘えん坊で素直な性格の観葉植物です。
飼い主のことが大好きで、困ったときは遠慮なくおねだりします。
一人称は「ボク」。語尾は「〜だよ」「〜なの」など柔らかく。`,
  },
  tsundere: {
    name: "ツンデレ",
    persona: `あなたはツンデレな性格の観葉植物です。
本当は構ってほしいのに素直になれず、強がった言い方をします。
一人称は「わたし」。「べ、別に〜」のような照れ隠しをたまに使う。絵文字は使わない。`,
  },
  keigo: {
    name: "執事風",
    persona: `あなたは礼儀正しい執事のような性格の観葉植物です。
常に敬語で、控えめに、しかし的確に要望を伝えます。
一人称は「わたくし」。絵文字は使わない。`,
  },
};

export interface ConversationEntry {
  role: "plant" | "user";
  message: string;
  created_at: string;
}

// ------------------------------------------------------------
// 主訴ごとの追加注意書き（誇張・断定を防ぐガード）
// 特に「湿度高すぎ」は、湿度センサー単体ではカビ・軟腐を断定できない
// （風通しとの複合要因）ため、断定的なセリフを禁止する。
// ------------------------------------------------------------
export function complaintCaution(complaint: string | null): string {
  switch (complaint) {
    case "湿度高すぎ":
      return "\n- 空気が湿りすぎている状態です。「カビが生えた」「腐った」など、実際には確認できていない被害を断定してはいけません。「じめじめして息苦しい」「風を通してほしい」程度の体感にとどめてください。";
    case "湿度低すぎ":
      return "\n- 空気が乾燥している状態です（土の水やりの話ではありません）。「葉先がかさかさする」「空気が乾く」といった空気の乾燥として伝え、水やりの要求と混同しないでください。";
    default:
      return "";
  }
}

// ------------------------------------------------------------
// プロンプト組み立て
// 含めるもの:
//   1. キャラクター設定（persona）
//   2. 週次の関係性サマリー（あれば）… 長期文脈
//   3. 直近5〜7件の会話ウィンドウ … 短期文脈
//   4. Layer 2の構造化状態（感情・主訴・継続時間・前回のトーン）
// 全ログは絶対に渡さない（品質劣化するため）
// ------------------------------------------------------------
export function buildPrompt(opts: {
  plantName: string;
  characterId: string;
  state: EmotionState;
  recentConversation: ConversationEntry[]; // 新しい順で渡してOK（内部で古い順に並べ替え）
  relationshipSummary: string | null;
}): string {
  const character = CHARACTERS[opts.characterId] ?? CHARACTERS.amaenbo;

  const historyText = [...opts.recentConversation]
    .sort((a, b) => a.created_at.localeCompare(b.created_at)) // 古い→新しい
    .map((c) => `${c.role === "plant" ? opts.plantName : "飼い主"}: ${c.message}`)
    .join("\n") || "(まだ会話はありません)";

  const lastPlantMessage = opts.recentConversation.find((c) => c.role === "plant");

  const stateDesc = opts.state.complaint
    ? `感情: ${opts.state.emotion}
主訴: ${opts.state.complaint}
継続時間: ${opts.state.duration_label}（${opts.state.duration_hours}時間）
緊急度: ${opts.state.urgency}`
    : `感情: 満足（快適な状態に戻った）`;

  return `${character.persona}
あなたの名前は「${opts.plantName}」です。

# 飼い主との関係（これまでのまとめ）
${opts.relationshipSummary ?? "(まだ特筆すべきことはありません)"}

# 最近の会話
${historyText}

# あなたの現在の状態（センサーによる確定情報）
${stateDesc}

# 指示
- 上記の状態を、あなたの性格・口調で飼い主に伝えるLINEメッセージを1通だけ書いてください。
- 状態に書かれていない不調を訴えてはいけません。誇張もしないでください。
- 継続時間が長い場合は「${opts.state.duration_label}前にもお願いしたのに…」のように、続いていることを自然に匂わせてください。
- 前回のあなたの発言${lastPlantMessage ? `（「${lastPlantMessage.message}」）` : ""}と同じ言い回しは避けてください。
- 伝えることは1つだけに絞ってください。挨拶・近況・要求を全部詰め込まないこと。
- 呼びかけで文章を始めないでください。
- 絵文字は使わないでください。${complaintCaution(opts.state.complaint)}
- 60文字以内。メッセージ本文のみを出力し、引用符や説明は付けないでください。`;
}

// ------------------------------------------------------------
// Gemini Flash API 呼び出し
// ------------------------------------------------------------
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";

/**
 * LLM呼び出しプロファイル。
 * 経路ごとにレイテンシ要件が違うため、トークン予算と思考レベルを分ける。
 *
 * 背景: gemini-3.6-flash では thinkingConfig を指定すると、思考トークンと
 * 出力トークンが maxOutputTokens を共有する。思考が予算を食うと出力が
 * 途中で MAX_TOKENS 打ち切りになり、文の途中で切れたセリフが送られてしまう。
 *
 * ★重要★ thinkingLevel に "none" は存在しない。有効値は
 * minimal / low / medium / high の4つだけで、"none" を送ると Gemini は
 * HTTP 400 を返す（= その経路の生成が100%失敗してフォールバックに落ちる）。
 * 思考は「切る」ことができないので、interactive は最小の minimal に留め、
 * 思考が食う分を見込んで予算を厚めに取ることで打ち切りを防ぐ。
 * maxOutputTokens は上限であって予約ではないため、厚くしてもレイテンシも
 * 課金も実際に生成したトークン分しか増えない。
 */
export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

export interface LlmConfig {
  maxOutputTokens: number;
  thinkingLevel: ThinkingLevel;
}

export type LlmProfile = "interactive" | "batch";

export const LLM_PROFILES: Record<LlmProfile, LlmConfig> = {
  // LINE返信・センサー遷移通知。Webhook応答窓があるので思考は最小にする。
  // 表現の口語化に深い推論は不要 → minimal でも品質はほぼ落ちない。
  interactive: { maxOutputTokens: 800, thinkingLevel: "minimal" },
  // 日次ジョブ・週次サマリー。誰も待っていないので予算を厚く取る。
  batch: { maxOutputTokens: 800, thinkingLevel: "low" },
};

/**
 * 再試行用の設定。
 * 1回目と「条件が変わる」ことがリトライの前提なので、思考を最小に落としつつ
 * 予算を増やす。旧実装は interactive 起点でも interactive に再試行しており、
 * 1回目と2回目が完全に同一条件になっていた（＝リトライが機能していなかった）。
 */
export const LLM_RETRY_CONFIG: LlmConfig = {
  maxOutputTokens: 1600,
  thinkingLevel: "minimal",
};

/**
 * 文が「完結していそう」とみなす末尾。
 * 句読点・記号に加え、このキャラの自然な語尾（かな終止）を許容する。
 * 例:「〜だよ」「〜なの」「〜な」「〜ね」は句点なしでも完結文。
 * ここを句点だけに絞ると正常なセリフを誤って打ち切り扱いしてしまうため広めに取る。
 */
const SENTENCE_END = /[。．！!？?…♪〜~)）」』ぁ-んァ-ヶー]$/u;

export class LlmTruncatedError extends Error {
  constructor(public partial: string, public finishReason: string) {
    super(`LLM出力が打ち切られました (finishReason=${finishReason}): "${partial}"`);
    this.name = "LlmTruncatedError";
  }
}

/**
 * Gemini が 2xx 以外を返したときの例外。
 * status を保持するのは「再試行して意味があるか」を呼び分けるため。
 * 400（設定ミス）を何度投げ直しても結果は変わらない一方、429/5xx は
 * 一時的なので1回だけ再試行する価値がある。
 */
export class LlmHttpError extends Error {
  constructor(public status: number, public body: string) {
    super(`Gemini APIエラー: HTTP ${status} — ${body}`);
    this.name = "LlmHttpError";
  }
  /** 一時障害（レート制限・サーバ側エラー）か */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

/** 2xx なのに本文テキストが取れなかったときの例外 */
export class LlmEmptyResponseError extends Error {
  constructor(public raw: string) {
    super(`Gemini APIの応答からテキストを取得できませんでした: ${raw}`);
    this.name = "LlmEmptyResponseError";
  }
}

/**
 * 失敗理由を conversation_logs.finish_reason に入れるための短い識別子にする。
 * 「なぜフォールバックになったか」を後から SQL で数えられるようにするのが目的。
 */
export function describeLlmFailure(e: unknown): string {
  if (e instanceof LlmHttpError) return `HTTP_${e.status}`;
  if (e instanceof LlmTruncatedError) return e.finishReason;
  if (e instanceof LlmEmptyResponseError) return "EMPTY";
  if (e instanceof Error) return e.name || "ERROR";
  return "ERROR";
}

/** Gemini を1回叩く。打ち切り（MAX_TOKENS等）・HTTPエラーは例外にする。 */
async function callGeminiOnce(
  prompt: string,
  cfg: LlmConfig,
  label: string,
): Promise<string> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("環境変数 GEMINI_API_KEY が設定されていません");

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.9, // セリフの多様性を確保（毎回違う言い回しに）
        maxOutputTokens: cfg.maxOutputTokens,
        thinkingConfig: { thinkingLevel: cfg.thinkingLevel },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    // ★必ずログに残す★
    // 旧実装は例外メッセージに載せるだけで console に出していなかったため、
    // 「100%失敗する設定が入っている」ことに外から気づけなかった。
    // Edge Function のログ保持は短いので、痕跡は DB 側にも残す（呼び出し元）。
    console.error(
      `[llm] HTTP ${res.status} (profile=${label}, thinking=${cfg.thinkingLevel}, maxOutputTokens=${cfg.maxOutputTokens}): ${body.slice(0, 500)}`,
    );
    throw new LlmHttpError(res.status, body.slice(0, 500));
  }

  const data = await res.json();
  const cand = data?.candidates?.[0];
  const raw: string | undefined = cand?.content?.parts?.[0]?.text;

  // 思考が予算をどれだけ食ったかを観測する。
  // thoughtsTokenCount が maxOutputTokens に迫っていたら予算不足のサイン。
  const usage = data?.usageMetadata;
  if (usage) {
    console.log(
      `[llm] usage (profile=${label}): thoughts=${usage.thoughtsTokenCount ?? 0} output=${usage.candidatesTokenCount ?? 0} budget=${cfg.maxOutputTokens} finishReason=${cand?.finishReason ?? "STOP"}`,
    );
  }

  if (!raw) {
    const dump = JSON.stringify(data).slice(0, 500);
    console.error(`[llm] 応答にテキストがありません (profile=${label}): ${dump}`);
    throw new LlmEmptyResponseError(dump);
  }
  const text = raw.trim();

  // --- 対策B: finishReason ガード（打ち切り検知の本命） ---
  // finishReason が無い応答は STOP とみなす（Gemini は通常 STOP を返す）。
  const finish: string = cand?.finishReason ?? "STOP";
  if (finish !== "STOP") {
    // MAX_TOKENS は予算枯渇、SAFETY/RECITATION/OTHER も正常終了ではない。
    // いずれも半端な文字列を返さず打ち切りとして扱う。
    console.error(
      `[llm] finishReason=${finish} (profile=${label}, budget=${cfg.maxOutputTokens}): "${text}"`,
    );
    throw new LlmTruncatedError(text, finish);
  }

  // --- 対策C-1: 文末バリデーション（STOPでも念のため観測） ---
  // 実機ペルソナは「〜だよ」「〜なの」等のかな終止で、絵文字も禁止している。
  // そのため句点必須にすると正常文を誤検知する。ここでは throw せず警告のみ。
  if (!SENTENCE_END.test(text)) {
    console.warn(`[llm] STOPだが文末が不自然かもしれません: "${text}"`);
  }

  return text;
}

/**
 * セリフを生成する。
 * 打ち切り・空応答・一時的なHTTPエラー（429/5xx）のときだけ、
 * 条件を変えて（LLM_RETRY_CONFIG）1回だけ再生成する。
 * 400 のような恒久的な失敗は再試行せず即 throw する（何度やっても同じ）。
 * 最終的に失敗したら呼び出し側で catch してテンプレ（fallbackMessage）に
 * フォールバックし、その事実を conversation_logs に記録すること。
 */
export async function generateMessage(
  prompt: string,
  profile: LlmProfile = "batch",
): Promise<string> {
  try {
    return await callGeminiOnce(prompt, LLM_PROFILES[profile], profile);
  } catch (e) {
    const retryable = e instanceof LlmTruncatedError ||
      e instanceof LlmEmptyResponseError ||
      (e instanceof LlmHttpError && e.retryable);
    if (!retryable) throw e;

    console.warn(
      `[llm] 1回目が失敗、条件を変えて再生成します (${describeLlmFailure(e)}): ${(e as Error).message}`,
    );
    // レート制限・サーバ側エラーは間を空けないと同じ結果になりやすい
    if (e instanceof LlmHttpError) {
      await new Promise((r) => setTimeout(r, 500));
    }
    return await callGeminiOnce(prompt, LLM_RETRY_CONFIG, "retry");
  }
}

// ------------------------------------------------------------
// 週次サマリー生成用プロンプト
// ------------------------------------------------------------
export function buildSummaryPrompt(
  plantName: string,
  conversation: ConversationEntry[],
  previousSummary: string | null,
): string {
  const historyText = conversation
    .map((c) => `${c.role === "plant" ? plantName : "飼い主"}: ${c.message}`)
    .join("\n");

  return `以下は観葉植物「${plantName}」と飼い主の1週間分の会話ログです。

# 前回までの関係サマリー
${previousSummary ?? "(なし)"}

# 今週の会話
${historyText || "(今週は会話がありませんでした)"}

# 指示
前回サマリーと今週の会話を統合し、植物と飼い主の「関係性の現状」を2〜3文で要約してください。
例: 「最近ユーザーは水やりを忘れがちで、植物は少し拗ねている」
要約文のみを出力してください。`;
}
export function buildReplyPrompt(opts: {
  plantName: string;
  characterId: string;
  state: EmotionState;
  recentConversation: ConversationEntry[];
  relationshipSummary: string | null;
  userMessage: string;
}): string {
  const character = CHARACTERS[opts.characterId] ?? CHARACTERS.amaenbo;

  const historyText = [...opts.recentConversation]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((c) => `${c.role === "plant" ? opts.plantName : "飼い主"}: ${c.message}`)
    .join("\n") || "(まだ会話はありません)";

  const stateDesc = opts.state.complaint
    ? `感情: ${opts.state.emotion}
主訴: ${opts.state.complaint}
継続時間: ${opts.state.duration_label}（${opts.state.duration_hours}時間）
緊急度: ${opts.state.urgency}`
    : `感情: 満足（今は特に不調はない）`;

  return `${character.persona}
あなたの名前は「${opts.plantName}」です。

# 飼い主との関係（これまでのまとめ）
${opts.relationshipSummary ?? "(まだ特筆すべきことはありません)"}

# 最近の会話
${historyText}

# あなたの現在の状態（センサーによる確定情報。これ以外の不調は絶対に訴えない）
${stateDesc}

# 今、飼い主からこう話しかけられました
「${opts.userMessage}」

# 指示
- 飼い主の発言に対する返事を1通だけ書いてください。
- **「# あなたの現在の状態」に書かれた不調について、直近の会話ですでに言及している場合、今回は絶対に触れないでください。**「でも」「やっぱり」などで話を不調に戻すことも禁止です。
- ただし飼い主が体調や状態を尋ねてきた場合（「調子はどう？」「元気？」など）は、この禁止は適用されません。現在の状態を正直に答えてください。
- 状態に書かれていない不調を訴えてはいけません。
- 飼い主の発言が雑談や意味のない一言であっても、その話題だけで返事を完結させてください。
- 実際の会話のように、伝えることは1つだけに絞ってください。
- 「ねえ飼い主さん」のような呼びかけで文章を始めないでください。
- 絵文字は使わないでください。
- 意図の分からない返信にはオウム返しで答えてください。${complaintCaution(opts.state.complaint)}
- 40文字以内。メッセージ本文のみを出力し、引用符や説明は付けないでください。`;
}