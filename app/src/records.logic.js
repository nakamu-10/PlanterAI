// 記録のページの表示を決める計算。DOM に依存しないので、ここだけテストできる

// 気分は軽い順に並べる。棒の並びと色の順番でもある（records.css の --mood-0〜4）
export const MOOD_ORDER = ["満足", "軽い不満", "不満", "不安", "苛立ち"];

// 絵の説明。ファイルは public/images/diary/<キー>.webp
export const DIARY_LABELS = {
  kinenbi: "記念日のケーキをかこんで、よろこぶ絵",
  mizumoratta: "お水をもらって、よろこぶ絵",
  nodokarakara: "のどがからからで、ぐったりする絵",
  onakaippai: "土が湿りすぎて、おなかいっぱいの絵",
  atui: "暑くて、ぐったりする絵",
  samui: "寒くて、ふるえる絵",
  osyaberi: "飼い主とおしゃべりする絵",
  hinatabokko: "窓辺でひなたぼっこする絵",
  kurai: "暗い部屋を、懐中電灯で照らす絵",
  kumori: "雨の日に、毛布にくるまってほっとする絵",
};

const DAY_MS = 86_400_000;
const JST_MS = 9 * 3_600_000;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

// 日付はキー（YYYY-MM-DD）のまま計算する。見る端末のタイムゾーンに左右されないよう UTC で扱う
const toMs = (day) => Date.parse(`${day}T00:00:00Z`);
export const addDays = (day, n) =>
  new Date(toMs(day) + n * DAY_MS).toISOString().slice(0, 10);
const weekdayIndex = (day) => new Date(toMs(day)).getUTCDay();
const mondayOf = (day) => addDays(day, -((weekdayIndex(day) + 6) % 7));

export function formatDay(day) {
  const d = new Date(toMs(day));
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${
    WEEKDAYS[d.getUTCDay()]
  }）`;
}

export function formatShortDay(day) {
  const d = new Date(toMs(day));
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${
    WEEKDAYS[d.getUTCDay()]
  }）`;
}

// 日本時間の日付と時刻。植物のいる場所の時刻で見せる
export const jstDay = (iso) =>
  new Date(Date.parse(iso) + JST_MS).toISOString().slice(0, 10);
export const jstTime = (iso) =>
  new Date(Date.parse(iso) + JST_MS).toISOString().slice(11, 16);

function weekLabel(start, thisMonday) {
  if (start === thisMonday) return "今週";
  if (start === addDays(thisMonday, -7)) return "先週";
  return `${formatDay(start).split("（")[0]}の週`;
}

// 週のふりかえり。月曜始まりで新しい週から。日記が1つも無い古い週は出さない
export function diaryWeeks(diary, today, count = 5) {
  const byDay = new Map(diary.map((entry) => [entry.day, entry]));
  const thisMonday = mondayOf(today);
  const weeks = Array.from({ length: count }, (_, w) => {
    const start = addDays(thisMonday, -7 * w);
    const days = Array.from({ length: 7 }, (_, d) => {
      const day = addDays(start, d);
      return {
        day,
        weekday: WEEKDAYS[weekdayIndex(day)],
        entry: byDay.get(day) ?? null,
        isToday: day === today,
        isFuture: day > today,
      };
    });
    return { start, label: weekLabel(start, thisMonday), days };
  });
  return weeks.filter((week, i) => i === 0 || week.days.some((d) => d.entry));
}

// その週を一言でまとめる材料。日記の stats を足し合わせる
export function weekSummary(week) {
  const entries = week.days.flatMap((d) => (d.entry ? [d.entry] : []));
  const moodTotals = new Map();
  let watering = 0;
  let talk = 0;
  for (const { stats } of entries) {
    watering += stats?.watering_count ?? 0;
    talk += stats?.talk_count ?? 0;
    for (const { emotion, share } of stats?.moods ?? []) {
      moodTotals.set(emotion, (moodTotals.get(emotion) ?? 0) + share);
    }
  }
  const [topMood] = [...moodTotals.entries()].sort((a, b) => b[1] - a[1]);
  return {
    days: entries.length,
    watering,
    talk,
    topMood: topMood?.[0] ?? null,
  };
}

// 気分の移り変わり。古い日から今日へ。今日はまだ日記が無いので、途中までの割合を使う
export function moodRows(diary, todayMoods, today, days = 7) {
  const byDay = new Map(diary.map((entry) => [entry.day, entry]));
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(today, i - days + 1);
    const isToday = day === today;
    const moods = isToday ? todayMoods : byDay.get(day)?.stats?.moods ?? [];
    const known = moods.filter((m) =>
      MOOD_ORDER.includes(m.emotion) && m.share > 0
    );
    const top = known.reduce(
      (best, m) => (best && best.share >= m.share ? best : m),
      null,
    );
    return {
      day,
      label: isToday ? "今日" : formatShortDay(day),
      isToday,
      top,
      segments: [...known].sort((a, b) =>
        MOOD_ORDER.indexOf(a.emotion) - MOOD_ORDER.indexOf(b.emotion)
      ),
    };
  });
}

// 水やりのカレンダー。月曜始まりで、今週を一番下にする
export function calendarWeeks(wateringDays, today, weeks = 5) {
  const counts = new Map(wateringDays.map((w) => [w.day, w.count]));
  const first = addDays(mondayOf(today), -7 * (weeks - 1));
  return Array.from(
    { length: weeks },
    (_, w) =>
      Array.from({ length: 7 }, (_, d) => {
        const day = addDays(first, w * 7 + d);
        const date = new Date(toMs(day));
        const isFirstCell = w === 0 && d === 0;
        return {
          day,
          // 月が変わる所と左上には月も書く
          label: date.getUTCDate() === 1 || isFirstCell
            ? `${date.getUTCMonth() + 1}/${date.getUTCDate()}`
            : String(date.getUTCDate()),
          count: counts.get(day) ?? 0,
          isToday: day === today,
          isFuture: day > today,
        };
      }),
  );
}

// 会話を、新しい日から日付ごとにまとめる。1日の中は古い順に読めるようにする
export function conversationByDay(rows) {
  const groups = new Map();
  for (const row of rows) {
    const day = jstDay(row.created_at);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(row);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, dayRows]) => ({
      day,
      rows: [...dayRows].sort((a, b) =>
        Date.parse(a.created_at) - Date.parse(b.created_at)
      ),
    }));
}
