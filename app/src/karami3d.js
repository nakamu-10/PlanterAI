import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { isRecovery, moodLevels } from "./mood.js";

const MODEL_URL = `${import.meta.env.BASE_URL}models/karami.glb`;

// 葉とマントの骨。しおれの動きのうち、ここだけ土の水分で動かす
const isLeafTrack = (track) => /^(leaf|cape)_/.test(track.name);

// 動きは Blender で作り、glb に入れてある（app/models-src/karami.blend）。
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
  const findClip = (name) => {
    const found = THREE.AnimationClip.findByName(gltf.animations, name);
    if (!found) throw new Error(`アニメーション ${name} が glb にありません`);
    return found;
  };
  // 1本の動きを、葉・マントの部分とそれ以外に分けて流す
  const split = (name) => {
    const clip = findClip(name);
    const part = (suffix, keep) =>
      mixer.clipAction(
        new THREE.AnimationClip(
          `${name}_${suffix}`,
          clip.duration,
          clip.tracks.filter(keep),
        ),
      ).play();
    return {
      leaves: part("leaves", isLeafTrack),
      body: part("body", (t) => !isLeafTrack(t)),
    };
  };
  const idle = split("Idle");
  const wiltLoop = split("Wilt");
  const oneShots = {
    joy: mixer.clipAction(findClip("Joy")),
    surprise: mixer.clipAction(findClip("Surprise")),
    pet: mixer.clipAction(findClip("Pet")),
  };
  for (const action of Object.values(oneShots)) {
    action.setLoop(THREE.LoopOnce, 1);
  }

  // 葉（土の水分）と体（気分）を別々に、目標へなめらかに近づける
  const level = { leaves: 0, body: 0 };
  const target = { leaves: 0, body: 0 };
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
    const k = 1 - Math.exp(-dt * 1.6);
    // 1回だけの動きを流している間は、待機としおれを弱める
    const shot = current ? current.getEffectiveWeight() : 0;
    for (const part of ["leaves", "body"]) {
      level[part] += (target[part] - level[part]) * k;
      idle[part].setEffectiveWeight((1 - level[part]) * (1 - shot));
      wiltLoop[part].setEffectiveWeight(level[part] * (1 - shot));
      // しおれているほど、ゆっくり動く
      idle[part].timeScale = wiltLoop[part].timeScale = 1 - 0.5 * level[part];
    }

    mixer.update(dt);
    renderer.render(scene, camera);
  });

  return {
    canvas: renderer.domElement,
    // mood: { emotion: 気分の名前, moistureScore: 土の水分の快適度（0〜100、なければ null） }
    setMood(mood) {
      const next = moodLevels(mood);
      if (isRecovery(target.leaves, next.leaves)) playOnce("joy");
      target.leaves = next.leaves;
      target.body = next.body;
    },
    poke: () => playOnce("surprise"),
    pet: () => playOnce("pet"),
    cheer: () => playOnce("joy"),
  };
}
