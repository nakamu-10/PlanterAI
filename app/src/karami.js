import { gsap } from "gsap";
import { Draggable } from "gsap/Draggable";
import { fetchDashboard } from "./api.js";
import { createKarami } from "./karami3d.js";

gsap.registerPlugin(Draggable);

const REACTIONS = {
  "満足": {
    poke: ["わっ、なに？", "ふふ、くすぐったいよ", "げんきだよ〜"],
    pet: ["気持ちいい…もっとして", "ふにゃ〜", "ありがとう、うれしいな"],
  },
  "軽い不満": {
    poke: ["んー、ちょっとかまってほしい気分", "つんつんしないでよ、もう"],
    pet: ["……まあ、悪くないけど", "ちょっとだけ、元気出た"],
  },
  "不満": {
    poke: ["もう、いい加減にして", "それより早く助けてよ"],
    pet: ["……少し落ち着いた、かも", "なでなで、ありがとう"],
  },
  "不安": {
    poke: ["どうしよう、大丈夫かな……", "ねえ、そばにいて"],
    pet: ["ちょっと安心した……", "そばにいてくれると心強いよ"],
  },
  "苛立ち": {
    poke: ["もう限界かも……早くなんとかして", "つらいよ、ほんとに"],
    pet: ["……ありがとう、少し楽になった", "お願い、早く様子見てね"],
  },
};

const stage = document.getElementById("karamiStage");
const img = document.getElementById("karamiImg");
const loading = document.getElementById("karamiLoading");
const bubble = document.getElementById("karamiBubble");
const stateLabel = document.getElementById("karamiState");

// ?emotion=不安 や ?moisture=20（土の水分の快適度 0〜100）を付けると、
// その状態に固定する（デモの練習用）。片方だけでもよい
const params = new URLSearchParams(location.search);
const forcedEmotion = params.get("emotion");
const forcedMoisture = params.has("moisture")
  ? Number(params.get("moisture"))
  : null;
const isForced = forcedEmotion !== null || forcedMoisture !== null;
let currentEmotion = forcedEmotion ?? "満足";
let currentMoisture = forcedMoisture;
let bubbleTimeout = null;
let karami3d = null;

function showReaction(kind) {
  const pool = REACTIONS[currentEmotion]?.[kind] ?? REACTIONS["満足"][kind];
  const line = pool[Math.floor(Math.random() * pool.length)];
  bubble.textContent = line;
  bubble.classList.add("is-visible");
  clearTimeout(bubbleTimeout);
  bubbleTimeout = setTimeout(() => bubble.classList.remove("is-visible"), 2200);
}

// ---- 3D が使えないときの 2D 版 ----
function setup2d() {
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

// ---- 3D 版：短く押して離す＝つつく、ドラッグ＝なでる ----
async function setup3d() {
  karami3d = await createKarami(stage);
  loading.remove();
  karami3d.setMood({
    emotion: currentEmotion,
    moistureScore: currentMoisture,
  });
  // ?debug を付けると、コンソールから karami.cheer() などで動きを試せる（デモの練習用）
  if (new URLSearchParams(location.search).has("debug")) {
    window.karami = karami3d;
  }

  let downAt = null;
  karami3d.canvas.addEventListener("pointerdown", (e) => {
    downAt = { x: e.clientX, y: e.clientY };
  });
  karami3d.canvas.addEventListener("pointerup", (e) => {
    if (!downAt) return;
    const distance = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = null;
    if (distance > 10) {
      karami3d.pet();
      showReaction("pet");
    } else {
      karami3d.poke();
      showReaction("poke");
    }
  });
}

function describeState(complaint) {
  const mood = complaint
    ? `いまの気分：${currentEmotion}（${complaint}）`
    : `いまの気分：${currentEmotion}`;
  const water = currentMoisture === null
    ? ""
    : `　土の水分：${Math.round(currentMoisture)}/100`;
  return mood + water + (isForced ? "（固定）" : "");
}

async function refreshState() {
  if (isForced) {
    stateLabel.textContent = describeState(null);
    return;
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
    stateLabel.textContent = describeState(latest?.complaint);
  } catch (err) {
    console.error(err);
    stateLabel.textContent = "状態を取得できませんでした";
  }
}

setup3d().catch((err) => {
  console.error("3Dモデルを表示できないので、画像で表示します:", err);
  setup2d();
});
refreshState();
setInterval(refreshState, 60_000);
