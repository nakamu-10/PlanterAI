import { fetchDashboard } from "./api.js";
import { daysTogether, describeAgo, describeForecast } from "./home.logic.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const INK = "#16211C";
const INK_SOFT = "#56645A";
const LINE = "#1F6B4A";
const WARN = "#9A4E24";
const BAND = "#E1F1DA";
const HOUR_MS = 3_600_000;

const $ = (id) => document.getElementById(id);

// キャラ／数値を行き来しても、見ている鉢（?pot=）を保つ
$("toCharacter").href = `/app/${location.search}`;

function svg(tag, attrs, text) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

// 快適かどうかは、色だけでなく言葉でも出す
function statusLabel(score) {
  if (typeof score !== "number") return null;
  return score >= 80 ? ["快適", LINE] : ["注意", WARN];
}

function setValue(id, text, unit, status) {
  const el = $(id);
  el.textContent = "";
  if (text === null) {
    el.textContent = "—";
    return;
  }
  el.append(text);
  const u = document.createElement("small");
  u.textContent = unit;
  el.append(u);
  if (status) {
    const s = document.createElement("span");
    s.className = "numbers-value__status";
    s.style.color = status[1];
    s.textContent = status[0];
    el.append(s);
  }
}

const fixed = (v, digits) => typeof v === "number" ? v.toFixed(digits) : null;

// 1本の線のグラフ。points: [{ t: ミリ秒, v: 値 | null }]（古い順）
// 快適の帯と、注意の線は、色に加えて文字でも示す
function lineChart(container, {
  points,
  start,
  end,
  yMin,
  yMax,
  band,
  warnLine,
  forecast,
  xLabels,
  unit,
  describe,
}) {
  const W = 350, H = 180, L = 34, R = 8, T = 10, B = 24;
  const x = (t) => L + ((t - start) / (end - start)) * (W - L - R);
  const y = (v) => T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B);
  const root = svg("svg", {
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": describe,
  });

  if (band) {
    root.append(svg("rect", {
      x: L,
      y: y(band.high),
      width: W - L - R,
      height: y(band.low) - y(band.high),
      fill: BAND,
    }));
    root.append(svg("text", {
      x: W - R - 2,
      y: y(band.high) + 12,
      "text-anchor": "end",
      "font-size": 10,
      fill: LINE,
    }, band.label));
  }
  if (warnLine) {
    root.append(svg("line", {
      x1: L,
      x2: W - R,
      y1: y(warnLine.value),
      y2: y(warnLine.value),
      stroke: WARN,
      "stroke-dasharray": "3 3",
    }));
    root.append(svg("text", {
      x: W - R - 2,
      y: y(warnLine.value) - 4,
      "text-anchor": "end",
      "font-size": 10,
      fill: WARN,
    }, warnLine.label));
  }
  // 軸は控えめに：下の線と、上下の目盛りだけ
  root.append(svg("line", {
    x1: L,
    x2: W - R,
    y1: H - B,
    y2: H - B,
    stroke: "rgba(22,33,28,0.16)",
  }));
  for (const v of [yMin, yMax]) {
    root.append(svg("text", {
      x: L - 6,
      y: y(v) + 3,
      "text-anchor": "end",
      "font-size": 10,
      "font-family": "IBM Plex Mono, monospace",
      fill: INK_SOFT,
    }, String(Math.round(v))));
  }
  for (const { t, label, strong } of xLabels) {
    root.append(svg("text", {
      x: Math.min(Math.max(x(t), L + 12), W - R - 12),
      y: H - 8,
      "text-anchor": "middle",
      "font-size": 10,
      fill: strong ? INK : INK_SOFT,
      "font-weight": strong ? 700 : 400,
    }, label));
  }

  // 欠測の時間で線を切る
  let d = "";
  let pen = false;
  for (const p of points) {
    if (p.v === null) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
    pen = true;
  }
  root.append(svg("path", {
    d,
    fill: "none",
    stroke: LINE,
    "stroke-width": 2,
    "stroke-linejoin": "round",
  }));

  const last = [...points].reverse().find((p) => p.v !== null);
  if (forecast && last) {
    root.append(svg("line", {
      x1: x(last.t),
      y1: y(last.v),
      x2: x(forecast.t),
      y2: y(forecast.v),
      stroke: LINE,
      "stroke-width": 2,
      "stroke-dasharray": "4 4",
    }));
    if (forecast.reaches) {
      root.append(svg("circle", {
        cx: x(forecast.t),
        cy: y(forecast.v),
        r: 4,
        fill: "#FBFCFA",
        stroke: WARN,
        "stroke-width": 2,
      }));
    }
  }
  if (last) {
    root.append(svg("circle", {
      cx: x(last.t),
      cy: y(last.v),
      r: 4,
      fill: LINE,
      stroke: "#FBFCFA",
      "stroke-width": 2,
    }));
  }

  // なぞると、その時刻の値を出す
  const cross = svg("line", {
    y1: T,
    y2: H - B,
    stroke: INK_SOFT,
    visibility: "hidden",
  });
  const tip = svg("text", {
    y: T + 10,
    "font-size": 11,
    "font-weight": 700,
    fill: INK,
    visibility: "hidden",
  });
  root.append(cross, tip);
  const shown = points.filter((p) => p.v !== null);
  root.addEventListener("pointermove", (e) => {
    if (shown.length === 0) return;
    const box = root.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const p = shown.reduce((a, b) =>
      Math.abs(x(a.t) - px) < Math.abs(x(b.t) - px) ? a : b
    );
    const cx = x(p.t);
    cross.setAttribute("x1", cx);
    cross.setAttribute("x2", cx);
    const hour = new Date(p.t).toLocaleString("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "numeric",
    });
    tip.textContent = `${hour}　${p.v.toFixed(1)}${unit}`;
    tip.setAttribute("x", Math.min(Math.max(cx, L + 70), W - R - 70));
    tip.setAttribute("text-anchor", "middle");
    cross.setAttribute("visibility", "visible");
    tip.setAttribute("visibility", "visible");
  });
  root.addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden");
    tip.setAttribute("visibility", "hidden");
  });

  container.replaceChildren(root);
}

function renderMoisture(trends, now) {
  const m = trends.moisture;
  const points = trends.hourly.map((h) => ({
    t: Date.parse(h.at) + HOUR_MS / 2,
    v: h.moisture_pct,
  }));
  const last = [...points].reverse().find((p) => p.v !== null);
  // 見込みは明日いっぱいまで描く。それより先は、そこまでの傾きで止める
  let forecast = null;
  if (last && typeof m.hours_to_dry === "number" && m.hours_to_dry > 0) {
    const horizon = Math.min(m.hours_to_dry, 24);
    forecast = {
      t: now + horizon * HOUR_MS,
      v: last.v - (last.v - m.comfort_low) * (horizon / m.hours_to_dry),
      reaches: m.hours_to_dry <= 24,
    };
  }
  lineChart($("moistureChart"), {
    points,
    start: now - 72 * HOUR_MS,
    end: now + 24 * HOUR_MS,
    yMin: 0,
    yMax: 100,
    band: {
      low: m.comfort_low,
      high: m.comfort_high,
      label: `快適 ${m.comfort_low}–${m.comfort_high}%`,
    },
    warnLine: { value: m.danger_low, label: `危険 ${m.danger_low}%` },
    forecast,
    unit: "%",
    xLabels: [
      { t: now - 72 * HOUR_MS, label: "3日前" },
      { t: now - 48 * HOUR_MS, label: "2日前" },
      { t: now - 24 * HOUR_MS, label: "昨日" },
      { t: now, label: "今", strong: true },
      { t: now + 24 * HOUR_MS, label: "明日" },
    ],
    describe: last
      ? `土の水分の3日間の推移。今は${
        Math.round(last.v)
      }%。快適な範囲は${m.comfort_low}〜${m.comfort_high}%`
      : "土の水分の3日間の推移（データなし）",
  });

  const note = $("moistureForecast");
  note.textContent = "";
  if (m.hours_to_dry === null) {
    note.textContent = "今のペースでは、しばらく乾く心配はありません。";
  } else if (m.hours_to_dry === 0) {
    note.textContent =
      `土が乾いています（快適の下限 ${m.comfort_low}% より下）。`;
  } else {
    const strong = document.createElement("strong");
    strong.textContent = describeForecast(m.hours_to_dry);
    note.append(
      "このペースだと、",
      strong,
      `で快適の下限（${m.comfort_low}%）を下回り、のどが渇き始めます。`,
    );
  }
}

function renderTemp(trends, now) {
  const t = trends.temp;
  const points = trends.hourly.slice(-24).map((h) => ({
    t: Date.parse(h.at) + HOUR_MS / 2,
    v: h.temp,
  }));
  const values = points.map((p) => p.v).filter((v) => v !== null);
  const yMin = Math.floor(Math.min(...values, t.comfort_low) - 1);
  const yMax = Math.ceil(Math.max(...values, t.comfort_high) + 1);
  lineChart($("tempChart"), {
    points,
    start: now - 24 * HOUR_MS,
    end: now,
    yMin,
    yMax,
    band: {
      low: t.comfort_low,
      high: t.comfort_high,
      label: `快適 ${t.comfort_low}–${t.comfort_high}℃`,
    },
    unit: "℃",
    xLabels: [
      { t: now - 24 * HOUR_MS, label: "24時間前" },
      { t: now - 12 * HOUR_MS, label: "12時間前" },
      { t: now, label: "今", strong: true },
    ],
    describe: values.length
      ? `気温の24時間の推移。最低${Math.min(...values).toFixed(1)}℃、最高${
        Math.max(...values).toFixed(1)
      }℃`
      : "気温の24時間の推移（データなし）",
  });
}

async function load() {
  try {
    const data = await fetchDashboard();
    const now = Date.now();
    $("plantName").textContent = data.device.plant_name;
    $("plantDays").textContent = `一緒に過ごして ${
      daysTogether(data.device.created_at)
    }日目`;

    const f = data.latest_sensor?.filtered ?? {};
    const s = data.latest_sensor?.scores ?? {};
    setValue(
      "valueMoisture",
      fixed(f.moisture_pct, 0),
      "%",
      statusLabel(s.moisture),
    );
    setValue("valueTemp", fixed(f.temp, 1), "℃", statusLabel(s.temp));
    setValue(
      "valueHumidity",
      fixed(f.humidity_pct, 0),
      "%",
      statusLabel(s.humidity),
    );
    const light = data.trends.light_today;
    // 日中はまだ増えるので、足りたかどうかは目標に届いたときか、15時（日照の判定）を過ぎてから言う
    const jstHour = (new Date(now).getUTCHours() + 9) % 24;
    let lightStatus = null;
    if (light.lux_hours >= light.target) lightStatus = ["足りている", LINE];
    else if (jstHour >= 15) lightStatus = ["少なめ", WARN];
    setValue(
      "valueLight",
      light.lux_hours.toLocaleString("ja-JP"),
      " lx·h",
      lightStatus,
    );

    renderMoisture(data.trends, now);
    renderTemp(data.trends, now);
    $("lastReceived").textContent = data.latest_sensor
      ? `鉢から最終受信：${describeAgo(data.latest_sensor.created_at)}`
      : "鉢からまだ受信していません";
  } catch (err) {
    console.error(err);
    $("lastReceived").textContent = "状態を取得できませんでした";
  }
}

load();
setInterval(load, 60_000);
