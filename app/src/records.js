import { fetchRecords, isPublicView } from "./api.js";
import { daysTogether } from "./home.logic.js";
import {
  calendarWeeks,
  conversationByDay,
  DIARY_LABELS,
  diaryWeeks,
  formatDay,
  formatShortDay,
  jstDay,
  jstTime,
  MOOD_ORDER,
  moodRows,
  weekSummary,
} from "./records.logic.js";

const $ = (id) => document.getElementById(id);

// 値はサーバーからの文字列なので、innerHTML を使わず textContent で入れる
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const pictureSrc = (picture) =>
  `${import.meta.env.BASE_URL}images/diary/${picture}.webp`;
const percent = (share) => `${Math.round(share * 100)}%`;
const moodClass = (emotion) => `mood-${MOOD_ORDER.indexOf(emotion)}`;

let entries = []; // 日記。古い順
let selectedDay = null;

function selectDay(day) {
  selectedDay = day;
  renderDiaryPage();
  for (const button of document.querySelectorAll(".week-day__button")) {
    const isSelected = button.dataset.day === day;
    button.classList.toggle("is-selected", isSelected);
    if (isSelected) button.setAttribute("aria-current", "date");
    else button.removeAttribute("aria-current");
  }
}

function renderDiaryPage() {
  const index = entries.findIndex((entry) => entry.day === selectedDay);
  const entry = entries[index];
  $("diaryEmpty").hidden = Boolean(entry);
  $("diaryEmpty").textContent =
    "日記はまだありません。毎晩、その日の分を書きます。";
  $("diaryPage").hidden = !entry;
  if (!entry) return;

  $("diaryDate").textContent = formatDay(entry.day);
  const dayNumber = entry.stats?.day_number;
  $("diaryDayNumber").textContent = dayNumber ? `${dayNumber}日目` : "";
  const picture = $("diaryPicture");
  picture.src = pictureSrc(entry.picture);
  picture.alt = DIARY_LABELS[entry.picture] ?? "";
  $("diaryBody").textContent = entry.body;
  $("diaryPrev").disabled = index <= 0;
  $("diaryNext").disabled = index >= entries.length - 1;
}

function moveDiary(step) {
  const index = entries.findIndex((entry) => entry.day === selectedDay);
  const next = entries[index + step];
  if (next) selectDay(next.day);
}

function renderWeeks(data) {
  const list = $("weekList");
  list.replaceChildren();
  for (const week of diaryWeeks(data.diary, data.today)) {
    const section = el("section", "week");
    const heading = el("div", "week__head");
    heading.append(el("h3", "week__label", week.label));

    const summary = weekSummary(week);
    const parts = [
      summary.topMood && `いちばん多かった気分：${summary.topMood}`,
      summary.watering > 0 && `水やり ${summary.watering}回`,
      summary.talk > 0 && `おしゃべり ${summary.talk}回`,
    ].filter(Boolean);
    if (parts.length > 0) {
      heading.append(el("p", "week__summary", parts.join("　")));
    }
    section.append(heading);

    const days = el("ol", "week__days");
    for (const cell of week.days) {
      const item = el("li", "week-day");
      item.append(el("span", "week-day__weekday", cell.weekday));
      if (cell.entry) {
        const button = el("button", "week-day__button");
        button.type = "button";
        button.dataset.day = cell.day;
        button.setAttribute("aria-label", `${formatDay(cell.day)}の日記を開く`);
        const thumb = el("img");
        thumb.src = pictureSrc(cell.entry.picture);
        thumb.alt = "";
        thumb.loading = "lazy";
        thumb.width = 96;
        thumb.height = 64;
        button.append(thumb);
        button.addEventListener("click", () => {
          selectDay(cell.day);
          $("diaryCard").scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        });
        item.append(button);
      } else {
        // 今夜書くのか、書かれなかったのかが分かるように
        const blank = el(
          "span",
          cell.isToday ? "week-day__blank is-today" : "week-day__blank",
          cell.isToday ? "今夜" : "",
        );
        if (cell.isFuture) blank.classList.add("is-future");
        item.append(blank);
      }
      days.append(item);
    }
    section.append(days);
    list.append(section);
  }
}

function renderMoods(data) {
  const legend = $("moodLegend");
  legend.replaceChildren();
  for (const emotion of MOOD_ORDER) {
    const item = el("li", "mood-legend__item");
    item.append(el("span", `mood-swatch ${moodClass(emotion)}`), emotion);
    legend.append(item);
  }

  const rows = $("moodRows");
  rows.replaceChildren();
  for (const row of moodRows(data.diary, data.today_moods, data.today)) {
    const item = el("li", "mood-row");
    item.append(el("span", "mood-row__day", row.label));
    const bar = el("div", "mood-row__bar");
    if (row.segments.length === 0) {
      bar.classList.add("is-empty");
    }
    for (const segment of row.segments) {
      const part = el("span", `mood-row__part ${moodClass(segment.emotion)}`);
      part.style.flexGrow = String(segment.share);
      part.title = `${row.label}　${segment.emotion} ${percent(segment.share)}`;
      bar.append(part);
    }
    // 色だけに頼らず、一番多かった気分を文字でも出す
    const breakdown = row.segments
      .map((s) => `${s.emotion} ${percent(s.share)}`)
      .join("、");
    bar.setAttribute("role", "img");
    bar.setAttribute(
      "aria-label",
      `${row.label}：${breakdown || "記録なし"}`,
    );
    item.append(bar);
    item.append(
      el(
        "span",
        "mood-row__top",
        row.top ? `${row.top.emotion} ${percent(row.top.share)}` : "記録なし",
      ),
    );
    rows.append(item);
  }

  const changes = $("moodChanges");
  changes.replaceChildren();
  for (const change of data.mood_changes.slice(0, 6)) {
    const item = el("li", "mood-change");
    item.append(
      el(
        "span",
        "mood-change__when",
        `${formatShortDay(jstDay(change.created_at))} ${
          jstTime(change.created_at)
        }`,
      ),
      el("span", `mood-swatch ${moodClass(change.emotion)}`),
      el(
        "span",
        "mood-change__what",
        change.complaint
          ? `${change.emotion}（${change.complaint}）`
          : change.emotion,
      ),
    );
    changes.append(item);
  }
  $("moodChangesBlock").hidden = data.mood_changes.length === 0;
}

function renderCalendar(data) {
  const grid = $("wateringCalendar");
  grid.replaceChildren();
  for (const weekday of ["月", "火", "水", "木", "金", "土", "日"]) {
    grid.append(el("span", "calendar__weekday", weekday));
  }
  for (const week of calendarWeeks(data.watering_days, data.today)) {
    for (const cell of week) {
      const item = el("span", "calendar__day", cell.label);
      if (cell.count > 0) {
        item.classList.add("is-watered");
        item.setAttribute(
          "aria-label",
          `${formatDay(cell.day)}、水やり${cell.count}回`,
        );
        item.title = `${formatDay(cell.day)}　水やり${cell.count}回`;
        if (cell.count > 1) {
          item.append(el("small", "calendar__count", `×${cell.count}`));
        }
      }
      if (cell.isToday) item.classList.add("is-today");
      if (cell.isFuture) item.classList.add("is-future");
      grid.append(item);
    }
  }

  const total = data.watering_days.reduce((sum, w) => sum + w.count, 0);
  const last = data.watering_days.at(-1);
  $("wateringSummary").textContent = last
    ? `この5週間で${total}回。最後は${formatDay(last.day)}です。`
    : "この5週間の水やりは、まだ記録されていません。";
}

function renderConversation(data) {
  $("conversationNote").hidden = !isPublicView;
  const list = $("conversationList");
  list.replaceChildren();
  const groups = conversationByDay(data.conversation);
  if (groups.length === 0) {
    list.append(el("p", "records-card__note", "まだ会話がありません。"));
    return;
  }
  for (const group of groups) {
    list.append(el("h3", "talk-day", formatDay(group.day)));
    for (const row of group.rows) {
      const item = el("div", `talk talk--${row.role}`);
      item.append(
        el("p", "talk__message", row.message),
        el("span", "talk__time", jstTime(row.created_at)),
      );
      list.append(item);
    }
  }
}

async function load() {
  try {
    const data = await fetchRecords();
    const name = data.device.plant_name;
    document.title = `${name}の記録｜PlanterAIアプリ`;
    $("plantName").textContent = `${name}の記録`;
    $("plantDays").textContent = `一緒に過ごして ${
      daysTogether(data.device.created_at)
    }日目`;
    $("diaryTitle").textContent = `${name}の日記`;

    entries = [...data.diary].sort((a, b) => a.day.localeCompare(b.day));
    renderWeeks(data);
    selectDay(entries.at(-1)?.day ?? null);
    renderMoods(data);
    renderCalendar(data);
    renderConversation(data);
    $("recordsError").hidden = true;
  } catch (err) {
    console.error(err);
    const message = $("recordsError");
    message.textContent = "記録を読み込めませんでした。";
    message.hidden = false;
  }
}

$("toHome").href = `/app/${location.search}`;
$("diaryPrev").addEventListener("click", () => moveDiary(-1));
$("diaryNext").addEventListener("click", () => moveDiary(1));
load();
