// カラ美の日記（ADR 0009）。その日の記録から絵を1枚選び、文の材料を作る。
// DB に依存しないので、ここだけテストできる（daily-diary と記録のページが使う）

import type { PlantProfile } from "./config.ts";
import { integrateLuxHours, jstDateKey } from "./dailyLight.ts";
import { CHARACTERS } from "./llm.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const JST_MS = 9 * HOUR_MS;

export const DIARY_PICTURES = [
  "kinenbi",
  "mizumoratta",
  "nodokarakara",
  "onakaippai",
  "atui",
  "samui",
  "osyaberi",
  "hinatabokko",
  "kurai",
  "kumori",
] as const;
export type DiaryPicture = typeof DIARY_PICTURES[number];

// LLM には選ばせず、ここで選ぶ。文に書く「今日のできごと」も、絵と食い違わないよう絵から決める
const PICTURE_EVENTS: Record<DiaryPicture, string> = {
  kinenbi: "一緒に過ごし始めてからの節目の日",
  mizumoratta: "飼い主に水をもらった",
  nodokarakara: "土が乾いて、のどがからからだった",
  onakaippai: "土が湿りすぎて、おなかがいっぱいだった",
  atui: "暑い、または光が強すぎる時間が長かった",
  samui: "寒い時間が長かった",
  osyaberi: "飼い主とたくさんおしゃべりした",
  hinatabokko: "日がたっぷり当たった",
  kurai: "あまり日が当たらず、暗かった",
  kumori: "特に変わったことのない、おだやかな日だった",
};

// Gemini が失敗したときの定型文。性格によらず読めるよう、一人称を使わない
const FALLBACK_BODIES: Record<DiaryPicture, string> = {
  kinenbi: "今日は記念の日。これからも一緒にいられるとうれしいな。",
  mizumoratta: "今日はお水をもらったの。土がしっとりして、ほっとしたよ。",
  nodokarakara: "今日は土がからからだったの。のどがかわいた一日だったな。",
  onakaippai: "今日は土がずっと湿っていたの。おなかがいっぱいの一日だったよ。",
  atui: "今日はなんだか暑かったの。葉っぱがぐったりしちゃった。",
  samui: "今日は寒かったの。葉っぱをちぢめて過ごしたよ。",
  osyaberi: "今日はたくさんおしゃべりしたの。楽しい一日だったな。",
  hinatabokko: "今日は日がたっぷり当たったの。ぽかぽかして気持ちよかったよ。",
  kurai: "今日はあまり日が当たらなかったの。明日は明るいといいな。",
  kumori: "今日はおだやかな一日だったの。のんびり過ごせたよ。",
};

// 週に1回の LINE で「ひなたぼっこの日が3日」のように数える
const PICTURE_LABELS: Record<DiaryPicture, string> = {
  kinenbi: "記念日",
  mizumoratta: "お水をもらった日",
  nodokarakara: "のどがからからの日",
  onakaippai: "おなかいっぱいの日",
  atui: "暑かった日",
  samui: "寒かった日",
  osyaberi: "おしゃべりした日",
  hinatabokko: "ひなたぼっこの日",
  kurai: "暗かった日",
  kumori: "おだやかな日",
};

// センサーの主訴のうち、絵があるもの。湿度の低さは「のど」の絵にすると
// 土の水やりと混同するので（#25）、絵を割り当てず、他の材料で選ぶ
const COMPLAINT_PICTURES: Record<string, DiaryPicture> = {
  "水分不足": "nodokarakara",
  "水分過多": "onakaippai",
  "温度高すぎ": "atui",
  "日照過剰": "atui",
  "温度低すぎ": "samui",
  "湿度高すぎ": "kumori",
};

// 1日のうち、これより長く続いた主訴を「その日のできごと」とみなす
const COMPLAINT_MIN_SHARE = 0.25;
// これ以上話しかけられた日を「おしゃべりした日」とみなす
const TALKATIVE_COUNT = 3;
// 日照が目標のこれより少なければ「暗かった日」
const DARK_LIGHT_RATIO = 0.5;
// 送信が抜けた時間を、前の気分が続いていたとは数えない上限（日照の積算と同じ考え方）
const MOOD_MAX_GAP_MS = 20 * 60_000;

export interface MoodLogRow {
  emotion: string;
  complaint: string | null;
  created_at: string;
  // 日照の日次判定の行。その日の予報と結果で、その時刻の気分ではない
  daily_light?: unknown;
}

export interface MoodShare {
  emotion: string;
  share: number;
}

export interface DiaryStats {
  day_number: number; // 一緒に過ごして何日目か
  watering_count: number;
  talk_count: number; // 飼い主が話しかけた回数。文の中身は使わない
  light_ratio: number | null; // 目標に対する日照の割合。送信が抜けて分からなければ null
  moods: MoodShare[]; // 多い順
  top_complaint: { complaint: string; share: number } | null;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

// 気分の割合。行の数ではなく時間で測る（?demo の5秒おきの行に引っぱられない）
export function moodShares(
  rows: MoodLogRow[],
  dayEnd: Date,
): { moods: MoodShare[]; complaints: MoodShare[] } {
  const sorted = rows
    .filter((r) => r.daily_light === null || r.daily_light === undefined)
    .map((r) => ({ ...r, t: Date.parse(r.created_at) }))
    .sort((a, b) => a.t - b.t);
  const moodMs = new Map<string, number>();
  const complaintMs = new Map<string, number>();
  let total = 0;
  sorted.forEach((row, i) => {
    const next = sorted[i + 1]?.t ?? dayEnd.getTime();
    const ms = Math.max(0, Math.min(next - row.t, MOOD_MAX_GAP_MS));
    total += ms;
    moodMs.set(row.emotion, (moodMs.get(row.emotion) ?? 0) + ms);
    if (row.complaint) {
      complaintMs.set(
        row.complaint,
        (complaintMs.get(row.complaint) ?? 0) + ms,
      );
    }
  });
  const shares = (map: Map<string, number>) =>
    [...map.entries()]
      .map(([emotion, ms]) => ({
        emotion,
        share: total > 0 ? round2(ms / total) : 0,
      }))
      .sort((a, b) => b.share - a.share);
  return { moods: shares(moodMs), complaints: shares(complaintMs) };
}

const jstDayNumber = (ms: number) => Math.floor((ms + JST_MS) / DAY_MS);

export function buildDayStats(args: {
  dayStart: Date;
  dayEnd: Date;
  deviceCreatedAt: string;
  profile: PlantProfile;
  luxSamples: { at: string; lux: number }[];
  moodRows: MoodLogRow[];
  wateringCount: number;
  talkCount: number;
}): DiaryStats {
  const light = integrateLuxHours(
    args.luxSamples,
    args.dayStart,
    args.dayEnd,
  );
  const target = args.profile.lightDaily.comfortLow;
  // 送信が抜けていても、目標に届いていれば足りたことは確か
  const lightKnown = light.reliable || light.luxHours >= target;
  const { moods, complaints } = moodShares(args.moodRows, args.dayEnd);
  const top = complaints[0];
  return {
    day_number: jstDayNumber(args.dayStart.getTime()) -
      jstDayNumber(Date.parse(args.deviceCreatedAt)) + 1,
    watering_count: args.wateringCount,
    talk_count: args.talkCount,
    light_ratio: lightKnown ? round2(light.luxHours / target) : null,
    moods,
    top_complaint: top ? { complaint: top.emotion, share: top.share } : null,
  };
}

export function isAnniversary(dayNumber: number): boolean {
  return dayNumber === 1 || dayNumber === 7 || dayNumber === 30 ||
    dayNumber % 50 === 0;
}

// 順番は「その日に一番残りそうなできごと」から。困っていた日でも、水をもらえたらその絵にする
export function choosePicture(stats: DiaryStats): DiaryPicture {
  if (isAnniversary(stats.day_number)) return "kinenbi";
  if (stats.watering_count > 0) return "mizumoratta";
  const complaint = stats.top_complaint;
  if (complaint && complaint.share >= COMPLAINT_MIN_SHARE) {
    const picture = COMPLAINT_PICTURES[complaint.complaint];
    if (picture) return picture;
  }
  if (stats.talk_count >= TALKATIVE_COUNT) return "osyaberi";
  if (stats.light_ratio !== null) {
    if (stats.light_ratio >= 1) return "hinatabokko";
    if (stats.light_ratio < DARK_LIGHT_RATIO) return "kurai";
  }
  return "kumori";
}

export const fallbackDiaryBody = (picture: DiaryPicture) =>
  FALLBACK_BODIES[picture];

// 会話の中身と関係のまとめは渡さない。人が書いた文が混ざらないので、鍵なしの画面でも出せる（ADR 0006）
export function buildDiaryPrompt(opts: {
  plantName: string;
  characterId: string;
  picture: DiaryPicture;
  stats: DiaryStats;
  recentBodies: string[];
}): string {
  const character = CHARACTERS[opts.characterId] ?? CHARACTERS.amaenbo;
  const { stats } = opts;
  const moods = stats.moods
    .slice(0, 2)
    .map((m) => `${m.emotion}（${Math.round(m.share * 100)}%）`)
    .join("、") || "記録なし";
  const facts = [
    `今日のできごと: ${PICTURE_EVENTS[opts.picture]}`,
    `一緒に過ごして${stats.day_number}日目`,
    `気分: ${moods}`,
    stats.top_complaint && stats.top_complaint.share >= COMPLAINT_MIN_SHARE
      ? `長く続いた不調: ${stats.top_complaint.complaint}`
      : null,
    `水やり: ${stats.watering_count}回`,
    stats.light_ratio === null
      ? null
      : `日当たり: 目標の${Math.round(stats.light_ratio * 100)}%`,
    `飼い主に話しかけられた回数: ${stats.talk_count}回`,
  ].filter((line) => line !== null).map((line) => `- ${line}`).join("\n");
  const recent = opts.recentBodies.length > 0
    ? opts.recentBodies.map((body) => `「${body}」`).join("\n")
    : "（まだありません）";

  return `${character.persona}
あなたの名前は「${opts.plantName}」です。今夜の絵日記を書きます。

# 今日の記録（センサーと記録からの確定情報）
${facts}

# 最近の日記（新しい順）
${recent}

# 指示
- 上の記録をもとに、あなたの性格・口調で、今日の絵日記の文を1〜2文で書いてください。
- 記録に書かれていないこと（天気、来客、飼い主の行動や話した内容など）を書いてはいけません。
- 数字やパーセントをそのまま書かず、気持ちの言葉にしてください。
- 最近の日記と、同じ言い回しや同じ文末を使わないでください。
- 絵文字は使わないでください。
- 文は必ず「。」「！」「？」のどれかで終えてください。
- 70文字以内。文だけを出力し、日付や引用符や説明は付けないでください。`;
}

export function isSundayJst(d: Date): boolean {
  return new Date(d.getTime() + JST_MS).getUTCDay() === 0;
}

// 週に1回の LINE。定型文で、文の種類は絵の数え方だけ
export function weeklyDiaryMessage(opts: {
  pictures: string[];
  recordsUrl: string | null;
}): string {
  const counts = new Map<string, number>();
  for (const picture of opts.pictures) {
    const label = PICTURE_LABELS[picture as DiaryPicture];
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const summary = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label, count]) => `${label}が${count}日`)
    .join("、");
  return [
    "今週の日記がそろったよ。",
    summary ? `${summary}あったの。` : null,
    opts.recordsUrl ? `読んでみてね。\n${opts.recordsUrl}` : null,
  ].filter((line) => line !== null).join("\n");
}

// 記録のページの「最近の変化」（新しい順）。日照の目標に届いた行は、重複判定のため
// 主訴を「日照不足」のまま満足で記録しているので、満足なら主訴なしにする。
// 同じ状態が続く行はまとめ、変わった時刻（続きの一番古い行）を残す
export function describeMoodChanges(
  rows: { emotion: string; complaint: string | null; created_at: string }[],
) {
  const changes = rows.map((row) => ({
    emotion: row.emotion,
    complaint: row.emotion === "満足" ? null : row.complaint,
    created_at: row.created_at,
  }));
  return changes.filter((change, i) => {
    const older = changes[i + 1];
    return !older || older.emotion !== change.emotion ||
      older.complaint !== change.complaint;
  });
}

// 水やりカレンダー用に、日本時間の日付ごとに数える
export function wateringByDay(
  rows: { created_at: string }[],
): { day: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const day = jstDateKey(new Date(row.created_at));
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day));
}
