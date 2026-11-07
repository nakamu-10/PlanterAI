import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { moodLevels } from "./mood.js";

// 触ったかを調べる、押した点からのずれ[px]。指の腹くらいの広さ
const TOUCH_OFFSETS = [
  [0, 0],
  [12, 0],
  [-12, 0],
  [0, 12],
  [0, -12],
  [9, 9],
  [-9, 9],
  [9, -9],
  [-9, -9],
];

// 動きを足したら v を上げる。古い glb がキャッシュに残った端末で、足した動きが無くて 2D に落ちるため
const MODEL_VERSIONS = { karami: 2, cactus: 1 };
const modelUrl = (name) =>
  `${import.meta.env.BASE_URL}models/${name}.glb?v=${MODEL_VERSIONS[name]}`;

// 葉とマントの骨。しおれの動きのうち、ここだけ土の水分で動かす
const isLeafTrack = (track) => /^(leaf|cape)_/.test(track.name);
// 涙の骨。glb の書き出しで全部の動きに止まったままのトラックが入るので、
// 涙の動きは Cry からだけ取り、ほかの動きからは外す（混ぜると流れる距離が縮む）
const isTearTrack = (track) => /^(cry|tear)_/.test(track.name);
const keepTracks = (clip, name, keep) =>
  new THREE.AnimationClip(name, clip.duration, clip.tracks.filter(keep));

// 持ち上げられる高さ（足元の高さ）。カメラの写す範囲に合わせる
const MAX_LIFT = 0.35;

// 動きは Blender で作り、glb に入れてある（app/models-src/*.blend）。
// どのモデルも骨と動きの名前をカラ美にそろえてあるので、同じ操作で動く。
// 待機（Idle）としおれ（Wilt）は常に流して混ぜ、ほかは1回だけ流す
export async function createKarami(container, modelName = "karami") {
  const gltf = await new GLTFLoader().loadAsync(modelUrl(modelName));
  const model = gltf.scene;

  // glb に足りないものがあれば、画面に何も足さないうちに投げる
  // （呼び出し側が 2D 版に切り替える。古い glb がキャッシュに残っている端末で起きる）
  const mixer = new THREE.AnimationMixer(model);
  const findClip = (name) => {
    const found = THREE.AnimationClip.findByName(gltf.animations, name);
    if (!found) throw new Error(`アニメーション ${name} が glb にありません`);
    return found;
  };
  const findNode = (name) => {
    const found = model.getObjectByName(name);
    if (!found) throw new Error(`${name} が glb にありません`);
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
  // 持ち上げている間だけ、くり返し流す
  const struggle = playBody("Struggle");
  // 涙は常に流しておき、目のうるみごと骨 cry_* の大きさで出し入れする
  mixer.clipAction(keepTracks(findClip("Cry"), "Cry", isTearTrack)).play();
  const cryBones = [findNode("cry_L"), findNode("cry_R")];
  const headMesh = findNode("HeadMesh");

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // 頭の上を空けておき、持ち上げても画面からはみ出さないようにする
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  camera.position.set(0, 0.72, 2.6);
  camera.lookAt(0, 0.6, 0);

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

  // 体をつかんで回した向き。離してしばらくすると、顔が見える正面へ戻る
  let yaw = 0;
  let turning = false;
  let sinceTurn = 0;

  // 持ち上げ。指の位置は、カラ美の立つ面（z=0）の上の点に直して追う
  const stand = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const raycaster = new THREE.Raycaster();
  let held = null; // { grip: つかんだ点（足元から）, target: 指の位置 }
  let swing = 0; // 指を横に動かしたときの、ぶら下がった体の振れ
  let fallSpeed = 0;

  function aim(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
  }

  function toStand(clientX, clientY) {
    aim(clientX, clientY);
    return raycaster.ray.intersectPlane(stand, new THREE.Vector3());
  }

  function play(action) {
    if (current && current !== action) current.stop();
    current = action;
    action.reset().play();
  }
  // 持っている間はジタバタを続ける（水やりの喜びなどで止めると、そのまま動かなくなる）
  const playOnce = (name) => {
    if (!held) play(oneShots[name]);
  };

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
    const playing = current !== null &&
      (current === struggle ? held !== null : !current.paused);
    shot += ((playing ? 1 : 0) - shot) * (1 - Math.exp(-dt * 20));
    current?.setEffectiveWeight(shot);
    if (!playing && shot < 0.001 && current) {
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

    if (turning) {
      sinceTurn = 0;
    } else if ((sinceTurn += dt) > 1.5) {
      const front = Math.round(yaw / (Math.PI * 2)) * Math.PI * 2;
      yaw += (front - yaw) * (1 - Math.exp(-dt * 3));
    }
    model.rotation.y = yaw;

    if (held) {
      // 指に遅れてついてくる。横に速く動かすほど、体が後ろへ振れる
      const toward = 1 - Math.exp(-dt * 12);
      const lastX = held.at.x;
      held.at.lerp(held.target, toward);
      // 描画の間隔が 0 のフレームで割ると NaN になり、カラ美が消える
      const speed = dt > 0 ? (held.at.x - lastX) / dt : 0;
      const pull = THREE.MathUtils.clamp(
        speed * 0.25,
        -0.6,
        0.6,
      );
      swing += (-pull - swing) * (1 - Math.exp(-dt * 6));
      // つかんだ点が指の位置に来るよう、振れた分だけ足元をずらす
      const { x, y } = held.grip;
      model.position.set(
        held.at.x - (x * Math.cos(swing) - y * Math.sin(swing)),
        // 振れた分だけ足元が下がっても、床には埋めない
        Math.max(held.at.y - (x * Math.sin(swing) + y * Math.cos(swing)), 0),
        0,
      );
    } else if (model.position.y > 0) {
      fallSpeed += 6 * dt;
      model.position.y = Math.max(model.position.y - fallSpeed * dt, 0);
      swing *= Math.exp(-dt * 4);
      if (model.position.y === 0) {
        fallSpeed = 0;
        playOnce("surprise");
      }
    } else {
      // 着地したら、ステージの真ん中へ戻る
      model.position.x *= Math.exp(-dt * 2);
      swing *= Math.exp(-dt * 6);
    }
    model.rotation.z = swing;

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
      target.leaves = next.leaves;
      target.body = next.body;
      target.tears = next.tears;
    },
    // 画面のこの点のそばに、カラ美の体（葉・マント・足を含む）があるか。
    // キャンバスはステージ全体に広がっているので、何もない所を触っても反応させない。
    // 細い葉の先や足でも指で触れるよう、押した点のまわりも少し調べる
    touches(clientX, clientY) {
      return TOUCH_OFFSETS.some(([dx, dy]) => {
        aim(clientX + dx, clientY + dy);
        return raycaster.intersectObject(model, true).length > 0;
      });
    },
    // 画面のこの高さが、頭の中心より上か（上をドラッグするとなでる、下なら回す）
    isAboveHead(clientY) {
      const center = new THREE.Box3()
        .setFromObject(headMesh)
        .getCenter(new THREE.Vector3())
        .project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return clientY < rect.top + ((1 - center.y) / 2) * rect.height;
    },
    // dx: 横にドラッグした画素数。画面の半分ほどで半回転する
    turn(dx) {
      turning = true;
      yaw += dx * 0.01;
    },
    endTurn() {
      turning = false;
    },
    // 長押しでつかむ。つかんだ点が指についてきて、少し持ち上がる
    grab(clientX, clientY) {
      const point = toStand(clientX, clientY);
      if (!point) return;
      const grip = point.clone().sub(model.position);
      held = {
        grip,
        at: point.clone(),
        target: point.clone().add(new THREE.Vector3(0, 0.08, 0)),
      };
      play(struggle);
    },
    moveHeld(clientX, clientY) {
      const point = toStand(clientX, clientY);
      if (!held || !point) return;
      // 足が床より下に行かず、頭が画面の上からはみ出さない高さに収める
      point.y = THREE.MathUtils.clamp(
        point.y,
        held.grip.y + 0.02,
        held.grip.y + MAX_LIFT,
      );
      held.target.copy(point);
    },
    drop() {
      held = null;
    },
    poke: () => playOnce("surprise"),
    pet: () => playOnce("pet"),
    cheer: () => playOnce("joy"),
  };
}
