import { gsap } from "gsap";
import { Draggable } from "gsap/Draggable";
import {
  fetchDashboard,
  isPublicView,
  POT,
  recordTouch,
  sendChatMessage,
} from "./api.js";
import {
  daysTogether,
  decideBubble,
  describeAgo,
  describeForecast,
  imageFor,
  modelFor,
} from "./home.logic.js";
import { createKarami } from "./karami3d.js";
import { keepQueryOnLinks, renderPotSwitcher } from "./potSwitcher.js";

gsap.registerPlugin(Draggable);

const REACTIONS = {
  "満足": {
    poke: ["わっ、なに？", "ふふ、くすぐったいよ", "げんきだよ〜"],
    pet: ["気持ちいい…もっとして", "ふにゃ〜", "ありがとう、うれしいな"],
    lift: ["わわっ、たかいたかい！", "おろして〜！", "じたばたじたばた！"],
  },
  "軽い不満": {
    poke: ["んー、ちょっとかまってほしい気分", "つんつんしないでよ、もう"],
    pet: ["……まあ、悪くないけど", "ちょっとだけ、元気出た"],
    lift: ["ちょっと、急に持ち上げないでよ！", "おろしてってば〜"],
  },
  "不満": {
    poke: ["もう、いい加減にして", "それより早く助けてよ"],
    pet: ["……少し落ち着いた、かも", "なでなで、ありがとう"],
    lift: ["遊んでる場合じゃないってば！", "もう、おろして！"],
  },
  "不安": {
    poke: ["どうしよう、大丈夫かな……", "ねえ、そばにいて"],
    pet: ["ちょっと安心した……", "そばにいてくれると心強いよ"],
    lift: ["こ、こわいよ……おろして", "ゆらさないで〜"],
  },
  "苛立ち": {
    poke: ["もう限界かも……早くなんとかして", "つらいよ、ほんとに"],
    pet: ["……ありがとう、少し楽になった", "お願い、早く様子見てね"],
    lift: [
      "そんなことより、早くなんとかして！",
      "じたばたする元気も、もうないよ……",
    ],
  },
};

const stage = document.getElementById("karamiStage");
const img = document.getElementById("karamiImg");
const loading = document.getElementById("karamiLoading");
const bubble = document.getElementById("karamiBubble");
const recall = document.getElementById("bubbleRecall");
const plantName = document.getElementById("plantName");
const plantDays = document.getElementById("plantDays");
const statusMood = document.getElementById("statusMood");
const statusMoodNote = document.getElementById("statusMoodNote");
const statusNextWatering = document.getElementById("statusNextWatering");
const statusWatering = document.getElementById("statusWatering");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");

// 鍵なしの app-public は読み取りだけで、チャットは受けない（ADR 0006）
chatForm.hidden = isPublicView;
keepQueryOnLinks();

// ?emotion=不安 や ?moisture=20（土の水分の快適度 0〜100）を付けると、
// その状態に固定する（デモの練習用）。片方だけでもよい
const params = new URLSearchParams(location.search);
const forcedEmotion = params.get("emotion");
const forcedMoisture = params.has("moisture")
  ? Number(params.get("moisture"))
  : null;
const isForced = forcedEmotion !== null || forcedMoisture !== null;
// ?demo を付けると、状態を5秒おきに取りに行く（センサーもデモモードで5秒おきに送る）
const REFRESH_MS = params.has("demo") ? 5_000 : 60_000;
// 動かさずにこれだけ押し続けたら、持ち上げる
const LIFT_PRESS_MS = 350;
let currentEmotion = forcedEmotion ?? "満足";
let currentMoisture = forcedMoisture;
let bubbleTimeout = null;
let karami3d = null;
// 最後に見た水やりの時刻。開いたときの記録には喜ばず、その後の水やりにだけ喜ぶ
let lastWateringAt;
// 受け取った最後のセリフ（新しいかどうかを比べる相手）
let knownMessage = null;
// アイコンから出し直せるセリフ。今の気分と食い違う古いセリフは入れない
let lastMessage = null;
// 植物のセリフは読み終わるまで出し、触ったときの反応はすぐ消す
const MESSAGE_MS = 8_000;
const REACTION_MS = 2_200;
// どのセリフまで見たかは鉢ごとに覚える。共有すると、別の鉢の新しいセリフで「もう見た」になる
const SEEN_KEY = `planterai:lastSeenMessageAt:${POT}`;

function showReaction(kind) {
  // ?emotion= などで固定した練習の操作は、本物の鉢の記憶に混ぜない
  if (!isForced) {
    recordTouch(kind).catch((err) => console.error("触った記録に失敗:", err));
  }
  const pool = REACTIONS[currentEmotion]?.[kind] ?? REACTIONS["満足"][kind];
  showBubble(pool[Math.floor(Math.random() * pool.length)]);
}

function showBubble(line, durationMs = REACTION_MS) {
  bubble.textContent = line;
  bubble.classList.add("is-visible");
  recall.hidden = true;
  clearTimeout(bubbleTimeout);
  bubbleTimeout = setTimeout(hideBubble, durationMs);
}

function hideBubble() {
  bubble.classList.remove("is-visible");
  recall.hidden = lastMessage === null;
}

function showMessage(message) {
  knownMessage = message;
  lastMessage = message;
  showBubble(message.message, MESSAGE_MS);
  // どのセリフまで見たかは、この端末にだけ覚えておけばよい
  try {
    localStorage.setItem(SEEN_KEY, message.created_at);
  } catch {
    // 保存できない（プライベートブラウズなど）ときは、次に開いたときにもう一度出るだけ
  }
}

function lastSeenAt() {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

// 3D が使えないときの 2D 版。サボテンやエバーフレッシュの鉢では、その植物の画像を出す
function setup2d(model) {
  img.src = imageFor(model);
  img.alt = plantName.textContent || "カラ美";
  loading.remove();
  img.hidden = false;
  const idleTween = gsap.to(img, {
    y: -10,
    rotate: 1.5,
    duration: 2.6,
    ease: "sine.inOut",
    repeat: -1,
    yoyo: true,
  });

  function poke() {
    gsap.timeline()
      .to(img, {
        scaleY: 0.85,
        scaleX: 1.08,
        duration: 0.12,
        ease: "power2.out",
      })
      .to(img, {
        scaleY: 1.15,
        scaleX: 0.94,
        duration: 0.14,
        ease: "power2.out",
      })
      .to(img, { scaleY: 1, scaleX: 1, duration: 0.3, ease: "back.out(3)" });
    showReaction("poke");
  }

  function pet() {
    gsap.timeline()
      .to(img, { rotate: -6, duration: 0.18, ease: "sine.inOut" })
      .to(img, {
        rotate: 6,
        duration: 0.32,
        ease: "sine.inOut",
        repeat: 2,
        yoyo: true,
      })
      .to(img, { rotate: 1.5, duration: 0.2, ease: "sine.inOut" });
    showReaction("pet");
  }

  Draggable.create(img, {
    type: "x,y",
    bounds: { minX: -50, maxX: 50, minY: -50, maxY: 50 },
    onPress() {
      idleTween.pause();
    },
    onDragEnd() {
      const distance = Math.hypot(this.x, this.y);
      gsap.to(img, { x: 0, y: 0, duration: 0.5, ease: "elastic.out(1, 0.5)" });
      if (distance > 10) {
        pet();
      } else {
        poke();
      }
      idleTween.resume();
    },
    onClick() {
      poke();
      idleTween.resume();
    },
  });
}

// 3D 版：短く押して離す＝つつく、頭をドラッグ＝なでる、体をドラッグ＝回す、長押し＝持ち上げる
async function setup3d(model) {
  karami3d = await createKarami(stage, model);
  loading.remove();
  karami3d.setMood({
    emotion: currentEmotion,
    moistureScore: currentMoisture,
  });
  // ?debug を付けると、コンソールから karami.cheer() などで動きを試せる（デモの練習用）
  if (new URLSearchParams(location.search).has("debug")) {
    window.karami = karami3d;
  }

  const canvas = karami3d.canvas;
  // Android の長押しメニューも出さない
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  let press = null;
  canvas.addEventListener("pointerdown", (e) => {
    // 見学会で何人も同時に触るので、触っている指が離れるまで次の指は無視する
    // （座標が混ざって激しく回ったり、離したことに気づけなくなったりする）。
    // isPrimary では見ない。カラ美の外に置かれた1本目の指が、ほかの人の指を弾いてしまう
    if (press || e.button !== 0) return;
    if (!karami3d.touches(e.clientX, e.clientY)) return;
    canvas.setPointerCapture(e.pointerId);
    press = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      onHead: karami3d.isAboveHead(e.clientY),
      // 10px 以上動いたら "pet" か "turn"、動かさずに長押ししたら "lift" に決める
      mode: null,
      liftTimer: setTimeout(() => {
        if (press?.mode !== null) return;
        press.mode = "lift";
        karami3d.grab(press.startX, press.startY);
        showReaction("lift");
      }, LIFT_PRESS_MS),
    };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (press?.pointerId !== e.pointerId) return;
    const dx = e.clientX - press.startX;
    const dy = e.clientY - press.startY;
    if (press.mode === null && Math.hypot(dx, dy) > 10) {
      // 体でも、縦になでたときはなでる
      press.mode = press.onHead || Math.abs(dy) > Math.abs(dx) ? "pet" : "turn";
    }
    if (press.mode === "turn") karami3d.turn(e.clientX - press.lastX);
    if (press.mode === "lift") karami3d.moveHeld(e.clientX, e.clientY);
    press.lastX = e.clientX;
  });
  const release = (e, cancelled) => {
    if (press?.pointerId !== e.pointerId) return;
    clearTimeout(press.liftTimer);
    karami3d.endTurn();
    if (press.mode === "lift") {
      karami3d.drop();
    } else if (!cancelled && press.mode === "pet") {
      karami3d.pet();
      showReaction("pet");
    } else if (!cancelled && press.mode === null) {
      karami3d.poke();
      showReaction("poke");
    }
    press = null;
  };
  canvas.addEventListener("pointerup", (e) => release(e, false));
  canvas.addEventListener("pointercancel", (e) => release(e, true));
  // 離した合図が来ないまま指を見失っても、press が残ると次から触れなくなる。
  // 普通に離したときは pointerup のあとに来るが、press が空なので何もしない
  canvas.addEventListener("lostpointercapture", (e) => release(e, true));
}

function describeForced() {
  plantName.textContent = "カラ美";
  statusMood.textContent = currentEmotion;
  statusMoodNote.textContent = "（固定）";
}

function renderStatus(data, latest) {
  plantName.textContent = data.device.plant_name;
  renderPotSwitcher(document.getElementById("potSwitcher"), data.pots);
  chatInput.placeholder = `${data.device.plant_name}に話しかける`;
  plantDays.textContent = `一緒に過ごして ${
    daysTogether(data.device.created_at)
  }日目`;
  statusMood.textContent = currentEmotion;
  statusMoodNote.textContent = latest?.complaint ?? "";
  statusNextWatering.textContent = describeForecast(
    data.trends?.moisture.forecast,
  );
  statusWatering.textContent = data.latest_watering
    ? describeAgo(data.latest_watering.created_at)
    : "まだ記録なし";
}

let firstLoad = true;

// 読み込んだ鉢のデータを返す（読めなかったときと、気分を固定しているときは null）
async function refreshState() {
  if (isForced) {
    describeForced();
    return null;
  }
  try {
    const data = await fetchDashboard();
    const latest = data.emotion_history?.[0];
    currentEmotion = latest?.emotion ?? "満足";
    // 葉のしおれは、気分ではなく最新の土の水分で決める
    const moisture = data.latest_sensor?.scores?.moisture;
    currentMoisture = typeof moisture === "number" ? moisture : null;
    karami3d?.setMood({
      emotion: currentEmotion,
      moistureScore: currentMoisture,
    });
    renderStatus(data, latest);

    const wateringAt = data.latest_watering?.created_at ?? null;
    if (lastWateringAt !== undefined && wateringAt !== lastWateringAt) {
      karami3d?.cheer();
      showBubble("お水ありがとう！");
    }
    lastWateringAt = wateringAt;

    const bubbleState = decideBubble({
      known: knownMessage,
      message: data.last_plant_message,
      latestEmotion: latest,
      firstLoad,
      seenAt: lastSeenAt(),
    });
    knownMessage = bubbleState.known;
    lastMessage = bubbleState.recallable;
    if (bubbleState.show) showMessage(bubbleState.known);
    if (!bubble.classList.contains("is-visible")) {
      recall.hidden = lastMessage === null;
    }
    firstLoad = false;
    return data;
  } catch (err) {
    console.error(err);
    statusMood.textContent = "—";
    statusMoodNote.textContent = "状態を取得できませんでした";
    return null;
  }
}

recall.addEventListener("click", () => {
  if (lastMessage) showBubble(lastMessage.message, MESSAGE_MS);
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = "";
  showBubble("……", 30_000);
  try {
    const data = await sendChatMessage(text);
    // 気分も渡し、気分が変わったら返事も古いセリフとして扱う（読み込み直したときと同じに）
    showMessage({
      message: data.reply,
      emotion: data.emotion,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error(err);
    showBubble("返事を受け取れませんでした");
  }
});

// iPhone の Safari は、touch-action: none でもカラ美のダブルタップで拡大する。
// 指を離したときの既定の動作を止める（触る操作は pointer イベントで受けているので消えない）
stage.addEventListener("touchend", (e) => e.preventDefault(), {
  passive: false,
});

// どのモデルを出すかは鉢の植物で決まるので、最初のデータを読んでから 3D を用意する
let plantModel = "karami";
refreshState()
  .then((data) => {
    plantModel = modelFor(data?.device.plant_profile);
    return setup3d(plantModel);
  })
  .catch((err) => {
    console.error("3Dモデルを表示できないので、画像で表示します:", err);
    setup2d(plantModel);
  });
setInterval(refreshState, REFRESH_MS);
