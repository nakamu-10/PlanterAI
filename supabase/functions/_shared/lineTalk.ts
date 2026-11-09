// LINE のトーク（1対1・グループ）から、話しかけられた鉢を決める

export interface LineSource {
  type?: string;
  userId?: string;
  groupId?: string;
  roomId?: string;
}

// 鉢の devices.line_user_id と比べる、トークの ID。グループならグループの ID
export function talkIdOf(source: LineSource | undefined): string | null {
  return source?.groupId ?? source?.roomId ?? source?.userId ?? null;
}

export interface LineTextMessage {
  text?: string;
  mention?: {
    mentionees?: {
      type?: string;
      isSelf?: boolean;
      index?: number;
      length?: number;
    }[];
  };
}

// 公式アカウント（植物）にメンションしたか。@All（type が all）には isSelf が無いので数えない
export function mentionsBot(message: LineTextMessage | undefined): boolean {
  return message?.mention?.mentionees?.some((m) => m.isSelf === true) ?? false;
}

// 「@PlanterAI おはよう」から公式アカウントへのメンションを除き、植物への言葉だけにする。
// 残すと Gemini と会話の記録に「@PlanterAI」が入る
export function withoutBotMention(message: LineTextMessage): string {
  let text = message.text ?? "";
  const mine = (message.mention?.mentionees ?? [])
    .filter((m) => m.isSelf === true && m.index !== undefined && m.length)
    .sort((a, b) => (b.index ?? 0) - (a.index ?? 0));
  for (const m of mine) {
    text = text.slice(0, m.index) +
      text.slice((m.index ?? 0) + (m.length ?? 0));
  }
  return text.trim();
}

export function isGroupTalk(source: LineSource | undefined): boolean {
  return source?.type === "group" || source?.type === "room";
}

// 名前を呼ばれた鉢を選ぶ。グループでは家族どうしの会話に割り込まないよう、
// 名前を呼ばれたか、公式アカウントにメンションされたときだけ返事をする。
// 1対1かメンションなら、名前がなくても最初の鉢が答える
export function pickDevice<T extends { plant_name: string }>(
  devices: T[],
  text: string,
  { group, mentioned }: { group: boolean; mentioned: boolean },
): T | null {
  // 「カラ美」と「カラ」のように重なる名前は、長いほうを先に見る
  const byNameLength = [...devices].sort((a, b) =>
    [...b.plant_name].length - [...a.plant_name].length
  );
  const named = byNameLength.find((d) => text.includes(d.plant_name));
  if (named) return named;
  if (group && !mentioned) return null;
  return devices[0] ?? null;
}
