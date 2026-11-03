import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const MODEL_URL = `${import.meta.env.BASE_URL}models/karami.glb`;

// 気分ごとのしおれ具合（0=元気、1=ぐったり）。土の水分と連動させるまでの仮の対応
const WILT_BY_EMOTION = {
  "満足": 0,
  "軽い不満": 0.25,
  "不満": 0.5,
  "不安": 0.7,
  "苛立ち": 0.85,
};

// しおれ具合がこれ以上よくなったら「元気になった」とみなして喜ぶ（水やりの場面）
const RECOVERY_STEP = 0.3;

// 動きは Blender で作り、glb に入れてある（app/models-src/karami.blend）
// 待機（Idle）としおれ（Wilt）は常に流して混ぜ、ほかは1回だけ流す
export async function createKarami(container) {
  // 読み込みに失敗したら、画面に何も足さずに投げる（呼び出し側が 2D 版に切り替える）
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
  camera.position.set(0, 0.55, 2.3);
  camera.lookAt(0, 0.47, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8d8a8, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(1, 2, 2);
  scene.add(sun);

  const model = gltf.scene;
  scene.add(model);

  const mixer = new THREE.AnimationMixer(model);
  const clip = (name) => {
    const found = THREE.AnimationClip.findByName(gltf.animations, name);
    if (!found) throw new Error(`アニメーション ${name} が glb にありません`);
    return mixer.clipAction(found);
  };
  const idle = clip("Idle").play();
  const wiltLoop = clip("Wilt").play();
  const oneShots = {
    joy: clip("Joy"),
    surprise: clip("Surprise"),
    pet: clip("Pet"),
  };
  for (const action of Object.values(oneShots)) {
    action.setLoop(THREE.LoopOnce, 1);
  }

  let wilt = 0;
  let targetWilt = 0;
  let current = null;
  const clock = new THREE.Clock();

  function playOnce(name) {
    const action = oneShots[name];
    current?.fadeOut(0.15);
    action.reset().fadeIn(0.12).play();
    current = action;
  }

  mixer.addEventListener("finished", (e) => {
    if (e.action === current) {
      current.fadeOut(0.25);
      current = null;
    }
  });

  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  renderer.setAnimationLoop(() => {
    // 描画の間隔が端末によって違うので、経過時間で近づける（約1秒で8割）
    const dt = Math.min(clock.getDelta(), 0.5);
    wilt += (targetWilt - wilt) * (1 - Math.exp(-dt * 1.6));

    // 1回だけの動きを流している間は、待機としおれを弱める
    const shot = current ? current.getEffectiveWeight() : 0;
    idle.setEffectiveWeight((1 - wilt) * (1 - shot));
    wiltLoop.setEffectiveWeight(wilt * (1 - shot));
    // しおれているほど、ゆっくり動く
    idle.timeScale = wiltLoop.timeScale = 1 - 0.5 * wilt;

    mixer.update(dt);
    renderer.render(scene, camera);
  });

  return {
    canvas: renderer.domElement,
    setEmotion(emotion) {
      const next = WILT_BY_EMOTION[emotion] ?? 0;
      if (targetWilt - next >= RECOVERY_STEP) playOnce("joy");
      targetWilt = next;
    },
    poke: () => playOnce("surprise"),
    pet: () => playOnce("pet"),
    cheer: () => playOnce("joy"),
  };
}
