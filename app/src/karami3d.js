import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { moodLevels } from "./mood.js";
import { touchRoleOf } from "./home.logic.js";
import { modelUrl } from "./models.js";
import { loadRoom, spotOf } from "./room3d.js";

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

// 葉とマントの骨。しおれの動きのうち、ここだけ土の水分で動かす
const isLeafTrack = (track) => /^(leaf|cape)_/.test(track.name);
// 口の骨。笑った口とへの字の口は大きさで出し入れしているので、混ぜると両方が縮んで重なって見える。
// 口だけは、待機としおれのどちらか一方から取る
const isMouthTrack = (track) => /^mouth(_frown)?\./.test(track.name);
// 涙の骨。glb の書き出しで全部の動きに止まったままのトラックが入るので、
// 涙の動きは Cry からだけ取り、ほかの動きからは外す（混ぜると流れる距離が縮む）
const isTearTrack = (track) => /^(cry|tear)_/.test(track.name);
const keepTracks = (clip, name, keep) =>
  new THREE.AnimationClip(name, clip.duration, clip.tracks.filter(keep));

// 持ち上げられる高さ（足元の高さ）。カメラの写す範囲に合わせる
const MAX_LIFT = 0.35;

// 部屋の中での大きさ。カラ美（元の背 0.975m）を、チェスト（0.66m）2台分の背にする
const CHARACTER_SCALE = 1.35;
// 写す高さ[m]。部屋全体だとスマホではキャラが小さすぎるので、キャラのまわりだけ写し、
// 残りは横にスワイプして見回す
const VIEW_HEIGHT = 2.8;
// 写す中心の、立ち位置からの高さ[m]。頭の上の壁（時計・棚）まで入れる
const FOCUS_HEIGHT = 0.95;
// 部屋を焼いたときと同じ斜めの向きから、少しだけ見下ろす（12°）。
// 正面から見ていた前の構図に近づけ、キャラの顔がよく見えるようにする
const VIEW_ELEVATION = THREE.MathUtils.degToRad(12);
const VIEW_DIRECTION = new THREE.Vector3(
  Math.cos(VIEW_ELEVATION) * Math.SQRT1_2,
  Math.sin(VIEW_ELEVATION),
  Math.cos(VIEW_ELEVATION) * Math.SQRT1_2,
);

// 焼いた部屋に、キャラの色の明るさを合わせる値（目で見て決めた）
const ROOM_EXPOSURE = 1.0;
const SHADOW_OPACITY = 0.55;

// 足元の丸い影。部屋は光を焼き込んであって影を落とせないので、ぼかした円を床に敷く
function createContactShadow() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, "rgba(60, 35, 20, 1)");
  gradient.addColorStop(0.5, "rgba(60, 35, 20, 0.6)");
  gradient.addColorStop(1, "rgba(60, 35, 20, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.75, 0.75),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: SHADOW_OPACITY,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  // 床とちらつかないよう、ほんの少し浮かせる
  shadow.position.y = 0.004;
  return shadow;
}

// 動きは Blender で作り、glb に入れてある（app/models-src/*.blend）。
// どのモデルも骨と動きの名前をカラ美にそろえてあるので、同じ操作で動く。
// 待機（Idle）としおれ（Wilt）は常に流して混ぜ、ほかは1回だけ流す
export async function createKarami(container, modelName = "karami") {
  const [gltf, room] = await Promise.all([
    new GLTFLoader().loadAsync(modelUrl(modelName)),
    loadRoom(),
  ]);
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
  // 1本の動きを、葉・マントの部分と口と、それ以外に分けて流す
  const split = (name) => ({
    leaves: playBody(name, "_leaves", isLeafTrack).play(),
    mouth: playBody(name, "_mouth", isMouthTrack).play(),
    body: playBody(
      name,
      "_body",
      (t) => !isLeafTrack(t) && !isMouthTrack(t),
    ).play(),
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
  // 明るい所を部屋の焼いた絵のように柔らかく落とす。three.js の AgX は Blender の
  // High Contrast より色が抜けてキャラがくすむので、色を保つ Neutral にする
  // （焼いた部屋は toneMapped: false なので、二重にはかからない）
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = ROOM_EXPOSURE;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(room);

  // キャラは立ち位置に置いた台（actor）に乗せる。動きの計算は台の上（足元が原点、
  // 正面が +z）のままで済み、立ち位置と大きさは台だけで決まる
  const actor = new THREE.Group();
  const spot = spotOf(room, "center");
  actor.position.copy(spot.at);
  actor.lookAt(spot.look.x, spot.at.y, spot.look.z);
  actor.scale.setScalar(CHARACTER_SCALE);
  actor.add(model);
  const shadow = createContactShadow();
  actor.add(shadow);
  scene.add(actor);
  actor.updateMatrixWorld(true);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 40);
  const focus = spot.at.clone().add(new THREE.Vector3(0, FOCUS_HEIGHT, 0));
  camera.position.copy(focus).addScaledVector(VIEW_DIRECTION, 12);
  camera.lookAt(focus);
  // 見回すときにカメラを動かす向き（画面の右）と、部屋が画面の横に広がる範囲
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const roomSpan = { min: Infinity, max: -Infinity };
  const roomBox = new THREE.Box3().setFromObject(room);
  for (const x of [roomBox.min.x, roomBox.max.x]) {
    for (const z of [roomBox.min.z, roomBox.max.z]) {
      const along = new THREE.Vector3(x, focus.y, z).sub(focus).dot(right);
      roomSpan.min = Math.min(roomSpan.min, along);
      roomSpan.max = Math.max(roomSpan.max, along);
    }
  }
  let pan = 0;
  // 部屋の外が写らない所までだけ動かす。画面が部屋より広ければ真ん中に置く
  function panTo(next) {
    const halfWidth = camera.right;
    const low = roomSpan.min + halfWidth;
    const high = roomSpan.max - halfWidth;
    pan = low < high
      ? THREE.MathUtils.clamp(next, low, high)
      : (low + high) / 2;
    camera.position.copy(focus)
      .addScaledVector(right, pan)
      .addScaledVector(VIEW_DIRECTION, 12);
  }

  // 部屋を焼いたときの暖かい光に合わせる。下からの照り返しは床の茶色
  scene.add(new THREE.HemisphereLight(0xfff1e0, 0xa57a55, 2.4));
  const sun = new THREE.DirectionalLight(0xffe2c4, 2.0);
  // カメラから見て右前の、やや低い所から当てる。カメラがほぼ正面にあるので、
  // 上からだと前を向いた顔に光が届かず暗く見える
  sun.position.set(0.8, 1.0, 2).applyQuaternion(actor.quaternion);
  scene.add(sun);

  // 葉（土の水分）・体（気分）・涙を別々に、目標へなめらかに近づける
  const level = { leaves: 0, body: 0, tears: 0 };
  const target = { leaves: 0, body: 0, tears: 0, frown: 0 };
  // 1回だけの動きと、その重み。待機・しおれと合わせた重みがいつも 1 になるよう自前で持つ
  // （足りない分は three.js が初期ポーズで埋め、隠している顔のパーツが全部出てしまう）
  let current = null;
  let shot = 0;
  const clock = new THREE.Clock();

  // 体をつかんで回した向き。離してしばらくすると、顔が見える正面へ戻る
  let yaw = 0;
  let turning = false;
  let sinceTurn = 0;

  // 持ち上げ。指の位置は、台の上でカラ美の立つ面（z=0）の上の点に直して追う
  const toActor = actor.matrixWorld.clone().invert();
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
    return raycaster.ray.clone().applyMatrix4(toActor)
      .intersectPlane(stand, new THREE.Vector3());
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
    // 隠れたタブなどで大きさが 0 のときに比を取ると NaN になり、カメラが戻らなくなる
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    const half = VIEW_HEIGHT / 2;
    camera.left = -half * (w / h);
    camera.right = half * (w / h);
    camera.top = half;
    camera.bottom = -half;
    camera.updateProjectionMatrix();
    panTo(pan);
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
    idle.mouth.setEffectiveWeight((1 - target.frown) * (1 - shot));
    wiltLoop.mouth.setEffectiveWeight(target.frown * (1 - shot));

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
    // 影は足元の真下の床に残し、持ち上げるほど小さく薄くする
    const lift = model.position.y;
    shadow.position.x = model.position.x;
    shadow.scale.setScalar(1 / (1 + lift * 2));
    shadow.material.opacity = SHADOW_OPACITY / (1 + lift * 4);

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
      target.frown = next.frown;
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
    // dx: 部屋の何もない所を横にドラッグした画素数。指と一緒に部屋が動く
    pan(dx) {
      if (container.clientHeight > 0) {
        panTo(pan - dx * VIEW_HEIGHT / container.clientHeight);
      }
    },
    // 画面のこの点に見える家具の、触ったときの役目（calendar など）。何もなければ null
    touchedProp(clientX, clientY) {
      aim(clientX, clientY);
      const [hit] = raycaster.intersectObject(room, true);
      return hit ? touchRoleOf(hit.object) : null;
    },
    // 画面上で頭を囲む四角と、頭の中心の高さ（頭の箱の8つの角を、画面に写して囲む）
    headRect() {
      const box = new THREE.Box3().setFromObject(headMesh);
      const rect = renderer.domElement.getBoundingClientRect();
      const xs = [];
      const ys = [];
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            const p = new THREE.Vector3(x, y, z).project(camera);
            xs.push(rect.left + ((p.x + 1) / 2) * rect.width);
            ys.push(rect.top + ((1 - p.y) / 2) * rect.height);
          }
        }
      }
      return {
        left: Math.min(...xs),
        right: Math.max(...xs),
        bottom: Math.max(...ys),
        centerY: (Math.min(...ys) + Math.max(...ys)) / 2,
      };
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
