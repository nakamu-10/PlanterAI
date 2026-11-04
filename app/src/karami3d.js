import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { isRecovery, moodLevels } from "./mood.js";

const MODEL_URL = `${import.meta.env.BASE_URL}models/karami.glb`;

// 葉とマントの骨。しおれの動きのうち、ここだけ土の水分で動かす
const isLeafTrack = (track) => /^(leaf|cape)_/.test(track.name);
// 涙の骨。glb の書き出しで全部の動きに止まったままのトラックが入るので、
// 涙の動きは Cry からだけ取り、ほかの動きからは外す（混ぜると流れる距離が縮む）
const isTearTrack = (track) => /^(cry|tear)_/.test(track.name);
const keepTracks = (clip, name, keep) =>
  new THREE.AnimationClip(name, clip.duration, clip.tracks.filter(keep));

// 動きは Blender で作り、glb に入れてある（app/models-src/karami.blend）。
// 待機（Idle）としおれ（Wilt）は常に流して混ぜ、ほかは1回だけ流す
export async function createKarami(container) {
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  const model = gltf.scene;

  // glb に足りないものがあれば、画面に何も足さないうちに投げる
  // （呼び出し側が 2D 版に切り替える。古い glb がキャッシュに残っている端末で起きる）
  const mixer = new THREE.AnimationMixer(model);
  const findClip = (name) => {
    const found = THREE.AnimationClip.findByName(gltf.animations, name);
    if (!found) throw new Error(`アニメーション ${name} が glb にありません`);
    return found;
  };
  const findBone = (name) => {
    const found = model.getObjectByName(name);
    if (!found) throw new Error(`骨 ${name} が glb にありません`);
    return found;
  };
  // 涙以外の動きを流す
  const playBody = (name, suffix = "", keep = () => true) =>
    mixer.clipAction(
      keepTracks(
        findClip(name),
        name + suffix,
        (t) => !isTearTrack(t) && keep(t),
      ),
    );
  // 1本の動きを、葉・マントの部分とそれ以外に分けて流す
  const split = (name) => ({
    leaves: playBody(name, "_leaves", isLeafTrack).play(),
    body: playBody(name, "_body", (t) => !isLeafTrack(t)).play(),
  });
  const idle = split("Idle");
  const wiltLoop = split("Wilt");
  const oneShots = {
    joy: playBody("Joy"),
    surprise: playBody("Surprise"),
    pet: playBody("Pet"),
  };
  for (const action of Object.values(oneShots)) {
    action.setLoop(THREE.LoopOnce, 1);
    // 終わったら最後の姿勢で止め、重みを下げきるまで残す
    action.clampWhenFinished = true;
  }
  // 涙は常に流しておき、目のうるみごと骨 cry_* の大きさで出し入れする
  mixer.clipAction(keepTracks(findClip("Cry"), "Cry", isTearTrack)).play();
  const cryBones = [findBone("cry_L"), findBone("cry_R")];

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

  scene.add(model);

  // 葉（土の水分）・体（気分）・涙を別々に、目標へなめらかに近づける
  const level = { leaves: 0, body: 0, tears: 0 };
  const target = { leaves: 0, body: 0, tears: 0 };
  // 1回だけの動きと、その重み。待機・しおれと合わせた重みがいつも 1 になるよう自前で持つ
  // （足りない分は three.js が初期ポーズで埋め、隠している顔のパーツが全部出てしまう）
  let current = null;
  let shot = 0;
  const clock = new THREE.Clock();

  function playOnce(name) {
    const action = oneShots[name];
    if (current && current !== action) current.stop();
    current = action;
    action.reset().play();
  }

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
    // 1回だけの動きを流している間は、待機としおれを弱める（約0.1秒で入れ替わる）
    const playing = current !== null && !current.paused;
    shot += ((playing ? 1 : 0) - shot) * (1 - Math.exp(-dt * 20));
    current?.setEffectiveWeight(shot);
    if (current?.paused && shot < 0.001) {
      current.stop();
      current = null;
    }
    for (const part of ["leaves", "body"]) {
      level[part] += (target[part] - level[part]) * k;
      idle[part].setEffectiveWeight((1 - level[part]) * (1 - shot));
      wiltLoop[part].setEffectiveWeight(level[part] * (1 - shot));
      // しおれているほど、ゆっくり動く
      idle[part].timeScale = wiltLoop[part].timeScale = 1 - 0.5 * level[part];
    }

    mixer.update(dt);
    // 1回だけの動き（喜ぶなど）の間は涙を引っ込める。0 にすると向きが壊れるので小さく残す
    level.tears += (target.tears - level.tears) * k;
    const tearSize = Math.max(level.tears * (1 - shot), 0.001);
    for (const bone of cryBones) {
      bone.visible = tearSize > 0.001;
      bone.scale.setScalar(tearSize);
    }
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
      target.tears = next.tears;
    },
    poke: () => playOnce("surprise"),
    pet: () => playOnce("pet"),
    cheer: () => playOnce("joy"),
  };
}
