// アプリでカラ美に触った記録を、返事のプロンプトに入れる言葉にする。
// DB に依存しないので、ここだけテストできる

export const TOUCH_KINDS = ["poke", "pet", "lift"] as const;
export type TouchKind = typeof TOUCH_KINDS[number];

export interface TouchEntry {
  kind: TouchKind;
  created_at: string;
}

// これより前に触られたことは、もう話題にしない
export const TOUCH_MEMORY_HOURS = 6;

const TOUCH_WORDS: Record<TouchKind, string> = {
  poke: "つつかれた",
  pet: "なでられた",
  lift: "持ち上げられた",
};

export const isTouchKind = (value: unknown): value is TouchKind =>
  TOUCH_KINDS.includes(value as TouchKind);

function describeMinutesAgo(minutes: number): string {
  if (minutes < 5) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  return `${Math.floor(minutes / 60)}時間前`;
}

// 例: 「つつかれた（3回、最後は10分前）」を1行ずつ。無ければ null
export function describeTouches(
  touches: TouchEntry[],
  now: Date,
): string | null {
  const since = now.getTime() - TOUCH_MEMORY_HOURS * 3_600_000;
  const lines = TOUCH_KINDS.flatMap((kind) => {
    const times = touches
      .filter((t) => t.kind === kind)
      .map((t) => Date.parse(t.created_at))
      .filter((t) => t >= since && t <= now.getTime());
    if (times.length === 0) return [];
    const minutes = Math.floor((now.getTime() - Math.max(...times)) / 60_000);
    return [
      `- ${TOUCH_WORDS[kind]}（${times.length}回、最後は${
        describeMinutesAgo(minutes)
      }）`,
    ];
  });
  return lines.length > 0 ? lines.join("\n") : null;
}
