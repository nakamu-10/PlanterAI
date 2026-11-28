import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  layerWeights,
  moodLevels,
  partPoses,
  partWilts,
  restStep,
  TEARS_FROM,
} from "./mood.js";
import { touchRoleOf } from "./home.logic.js";
import { modelUrl } from "./models.js";
import { createRoomLook, loadRoom, spotOf } from "./room3d.js";
import {
  holdRange,
  planWander,
  planWelcome,
  replanTrip,
  wanderPoint,
  welcomeStartX,
} from "./walk.logic.js";

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
// 目とまぶたの骨。寝るときは混ぜずに切り替える（mood.js の partPoses）
const isEyeTrack = (track) => /^(eye|lid)_/.test(track.name);
// 根元と脚の骨。座るときは、ここだけを座る動きに入れ替える
const isSeatTrack = (track) => /^(root|leg_)/.test(track.name);
const keepTracks = (clip, name, keep) =>
  new THREE.AnimationClip(name, clip.duration, clip.tracks.filter(keep));

// 持ち上げられる高さ（足元の高さ）。カメラの写す範囲に合わせる
const MAX_LIFT = 0.35;

// 部屋の中での大きさ。カラ美（元の背 0.975m）を、チェスト（0.66m）2台分の背にする
const CHARACTER_SCALE = 1.35;
// 立ったままではとれないポーズと、その動きの名前。座るは腰から下だけを入れ替え、顔・頭・葉は
// 気分のまま動かす（夕方のソファでも、しおれや涙が分かるように）。寝るは布団をかぶるので体ごと
const POSE_CLIPS = {
  sit: { clip: "Sit", seatOnly: true },
  sleep: { clip: "Sleep", seatOnly: false },
};
// 歩くとき、家具をよける広さ[m]（足元の半径）
const WALK_RADIUS = 0.2;
// Walk の1歩で足が進む距離（大きさ 1 のとき。karami_walk.py の stride()）。
// Walk は1秒で2歩なので、歩く速さ[m/秒]はこの2倍に部屋の中での大きさを掛けたもの
const STRIDES = { karami: 0.097, cactus: 0.127, everfresh: 0.127 };
// 家具に跳び上がる・跳び下りるのにかける秒数と、跳ぶ高さ[m]
const HOP_SECONDS = 0.5;
const HOP_HEIGHT = 0.15;
// 機嫌のよいとき、立ち位置のまわりをうろうろ歩く。歩くのは、この立ち位置にいて涙が出ていないとき
// だけ（座る・寝る・日照不足の窓辺・不安・苛立ちでは、訴えやポーズが見えなくならないよう歩かない）
const WANDER_POSES = new Set(["stand", "sunbathe"]);
// 立ち位置から歩く先までの最大の距離[m]と、歩き出すまでの秒数（この間で毎回選ぶ）と、先で待つ秒数
const WANDER_REACH = 0.6;
const WANDER_EVERY = [15, 30];
const WANDER_PAUSE = 3;
// うろうろ歩く先を、画面の左右の端からこれだけ内側[m]に収める（キャラの半分の幅ほど）
const WANDER_MARGIN = 0.35;
const nextWander = () =>
  WANDER_EVERY[0] + Math.random() * (WANDER_EVERY[1] - WANDER_EVERY[0]);
// 久しぶりに開いたとき、キャラが歩き出す所の、部屋の右の床の縁からの距離[m]と、画面の右の端からの距離[m]。
// 広い画面で部屋が全部写っていても、写っていない所から歩いてくるように
const WELCOME_OUTSIDE = 0.6;
// 向きを変える速さ[rad/秒]
const TURN_SPEED = 6;
// 座っている・寝ている所を触ると立ち上がり、この秒数さわられなければ戻る
const WAKE_SECONDS = 10;
// 写す高さ[m]。部屋全体だとスマホではキャラが小さすぎるので、キャラのまわりだけ写し、
// 残りは横にスワイプして見回す
const VIEW_HEIGHT = 2.8;
// 写す中心の、立ち位置からの高さ[m]。頭の上の壁（時計・棚）まで入れる
const FOCUS_HEIGHT = 1.15;
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
const SHADOW_OPACITY = 0.8;

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
    new THREE.PlaneGeometry(0.9, 0.9),
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
  const [gltf, { room, walkArea, viewArea }] = await Promise.all([
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
  // 1本の動きを、葉・マントの部分と口と、根元と脚と、それ以外に分けて流す
  const split = (name) => ({
    leaves: playBody(name, "_leaves", isLeafTrack).play(),
    mouth: playBody(name, "_mouth", isMouthTrack).play(),
    seat: playBody(name, "_seat", isSeatTrack).play(),
    eyes: playBody(name, "_eyes", isEyeTrack).play(),
    body: playBody(
      name,
      "_body",
      (t) =>
        !isLeafTrack(t) && !isMouthTrack(t) && !isSeatTrack(t) &&
        !isEyeTrack(t),
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
  // 座る・寝るは、その居場所にいる間くり返す。glb に無い動きは居場所ごと使わない（setSpot）
  const poses = {};
  for (const [pose, { clip, seatOnly }] of Object.entries(POSE_CLIPS)) {
    if (THREE.AnimationClip.findByName(gltf.animations, clip)) {
      const keep = seatOnly ? isSeatTrack : (t) => !isEyeTrack(t);
      const action = playBody(clip, "", keep).play();
      action.setEffectiveWeight(0);
      const eyes = seatOnly ? null : playBody(clip, "_eyes", isEyeTrack).play();
      eyes?.setEffectiveWeight(0);
      poses[pose] = { action, eyes, seatOnly };
    }
  }
  // 歩く間は根元と脚だけを Walk に入れ替える。重みは歩く度合い（stepping）で上げ下げする
  const walk = playBody("Walk", "", isSeatTrack).play();
  walk.setEffectiveWeight(0);
  const walkSpeed = 2 * STRIDES[modelName] * CHARACTER_SCALE;
  const walkRoom = { ...walkArea, radius: WALK_RADIUS };
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
  // 窓・日だまり・ランプ・時計。照度は鉢のデータを読むたびに setLux で受け取る
  const roomLook = createRoomLook(room);
  let lux = null;

  // キャラは立ち位置に置いた台（actor）に乗せる。動きの計算は台の上（足元が原点、
  // 正面が +z）のままで済み、立ち位置と大きさは台だけで決まる
  const actor = new THREE.Group();
  const spot = spotOf(room, "center");
  let spotName = "center";
  function placeAt({ at, look }) {
    actor.position.copy(at);
    actor.lookAt(look.x, at.y, look.z);
    actor.updateMatrixWorld(true);
  }
  placeAt(spot);
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
  // 床と壁は部屋の外へも続くので、部屋そのものの範囲（view_area）で測る
  for (const x of [viewArea.min.x, viewArea.max.x]) {
    for (const z of [viewArea.min.z, viewArea.max.z]) {
      const along = new THREE.Vector3(x, focus.y, z).sub(focus).dot(right);
      roomSpan.min = Math.min(roomSpan.min, along);
      roomSpan.max = Math.max(roomSpan.max, along);
    }
  }
  let pan = 0;
  // 画面の端が部屋の端に来る所までだけ動かす。画面が部屋より広ければ真ん中に置く
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
  // 今の居場所のポーズの動きと、その度合い（0=立つ、1=ポーズ）。触って起きている残りの秒数と、
  // 起き上がってから流す1回だけの動き
  let pose = null;
  let posed = 0;
  let awake = 0;
  let pending = null;
  // 居場所を移る道のり（walk.logic.js の planTrip）と、跳んでいる途中の様子と、歩く度合い（0〜1）。
  // 開いたときは歩かずに、最初から居場所にいる
  let trip = [];
  let hop = null;
  let stepping = 0;
  let placed = false;
  // 今の居場所と、画面が歩くキャラについていくか（うろうろ歩くときは、部屋を動かせるままにする）、
  // 次にうろうろ歩き出すまでの秒数
  let here = spot;
  let following = false;
  let wanderIn = nextWander();
  // うろうろ歩いている途中か。途中で機嫌が悪くなったら、立ち位置へ戻る
  let wandering = false;
  const clock = new THREE.Clock();

  // 体をつかんで回した向き。離してしばらくすると、顔が見える正面へ戻る
  let yaw = 0;
  let turning = false;
  let sinceTurn = 0;

  // 持ち上げ。指の位置は、台の上でカラ美の立つ面（z=0）の上の点に直して追う
  const stand = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const raycaster = new THREE.Raycaster();
  let held = null; // { grip: つかんだ点（足元から）, target: 指の位置, range: 足元を動かせる横の範囲 }
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
    // 台は居場所を変えると動くので、そのつど台の上の座標に直す
    const toActor = actor.matrixWorld.clone().invert();
    return raycaster.ray.clone().applyMatrix4(toActor)
      .intersectPlane(stand, new THREE.Vector3());
  }

  function play(action) {
    if (current && current !== action) current.stop();
    current = action;
    action.reset().play();
  }
  // point の方へ向きを変える。向き終わったら true
  function turnToward(point, dt) {
    const dx = point.x - actor.position.x;
    const dz = point.z - actor.position.z;
    if (Math.hypot(dx, dz) < 1e-3) return true;
    const facing = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.atan2(dx, dz),
    );
    actor.quaternion.rotateTowards(facing, TURN_SPEED * dt);
    return actor.quaternion.angleTo(facing) < 0.05;
  }

  // 道のりを1フレーム進める。床を歩いている間は true。pace：しおれているほど小さく、歩く・跳ぶが遅くなる
  function travel(dt, pace) {
    const step = trip[0];
    if (!step) return false;
    if (step.kind === "stand") {
      awake = Infinity;
      if (posed < 0.05) {
        pose = null;
        trip.shift();
      }
      return false;
    }
    if (step.kind === "walk") {
      const to = new THREE.Vector3(step.to.x, step.to.y, step.to.z);
      const left = to.clone().sub(actor.position);
      const flat = Math.hypot(left.x, left.z);
      turnToward(to, dt * pace);
      const move = walkSpeed * dt * pace;
      if (flat <= move) {
        actor.position.copy(to);
        trip.shift();
      } else {
        actor.position.addScaledVector(left, move / flat);
      }
      return true;
    }
    if (step.kind === "cheer") {
      trip.shift();
      playOnce("joy");
      return false;
    }
    if (step.kind === "pause") {
      step.left = (step.left ?? step.seconds) - dt;
      if (step.left <= 0) trip.shift();
      return false;
    }
    if (step.kind === "hop") {
      hop ??= { from: actor.position.clone(), t: 0 };
      hop.t = Math.min(hop.t + dt * pace / HOP_SECONDS, 1);
      actor.position.lerpVectors(hop.from, step.to, hop.t);
      actor.position.y += HOP_HEIGHT * Math.sin(Math.PI * hop.t);
      if (hop.t === 1) {
        hop = null;
        trip.shift();
      }
      return false;
    }
    // 座る・寝るのポーズは、向く先を向いてからとる。横を向いたまま座ると、背もたれからずれる
    if (turnToward(step.spot.look, dt)) {
      pose = poses[step.spot.pose] ?? null;
      posed = 0;
      awake = 0;
      trip.shift();
    }
    return false;
  }

  // 座っている・寝ている所を触ったら立たせる。ポーズのまま1回だけの動きを流すと急に立ち上がる
  // ので、立ってから流す
  const wake = () => {
    if (pose) awake = WAKE_SECONDS;
    return posed > 0.05;
  };
  // 持っている間はジタバタを続ける（水やりの喜びなどで止めると、そのまま動かなくなる）
  const playOnce = (name) => {
    if (held) return;
    if (wake()) pending = name;
    else play(oneShots[name]);
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
    roomLook.update(Date.now(), lux);
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
    const rest = restStep({
      hasPose: pose !== null,
      awake,
      posed,
      pending,
      held: held !== null,
      dt,
    });
    ({ awake, posed, pending } = rest);
    // 持ち上げている間と、1回だけの動きの間は、その場で止まる
    const pace = 1 - 0.5 * level.body;
    const walking = !held && !playing && travel(dt, pace);
    stepping += ((walking ? 1 : 0) - stepping) * (1 - Math.exp(-dt * 8));
    walk.timeScale = pace;
    walk.setEffectiveWeight(stepping * (1 - shot));
    // 機嫌は、追いつく途中の level でなく目標の target で見る。悪くなったらすぐ歩くのをやめる
    const calm = here !== null && WANDER_POSES.has(here.pose) &&
      target.body < TEARS_FROM;
    if (trip.length === 0) wandering = false;
    if (wandering && !calm) {
      wandering = false;
      trip = replanTrip(actor.position, hop ? trip[0] : null, here, walkRoom);
    }
    if (calm && trip.length === 0 && !held && !playing && !turning) {
      wanderIn -= dt;
      if (wanderIn <= 0) {
        wanderIn = nextWander();
        // 画面はついていかないので、今写っている所から出ない先を選ぶ
        const fits = (p) =>
          Math.abs(
            (p.x - focus.x) * right.x + (p.z - focus.z) * right.z - pan,
          ) <
            camera.right - WANDER_MARGIN;
        const point = wanderPoint(here.at, walkRoom, WANDER_REACH, { fits });
        if (point) {
          trip = planWander(here, point, WANDER_PAUSE, walkRoom);
          following = false;
          wandering = true;
          // 回したあと正面へ戻りきる前でも、すぐ戻す。横を向いたまま歩かないように
          sinceTurn = Infinity;
        }
      }
    }
    if (following && trip.length > 0) {
      const follow = actor.position.clone().sub(focus).dot(right);
      panTo(pan + (follow - pan) * (1 - Math.exp(-dt * 3)));
    }
    if (rest.play) play(oneShots[rest.play]);
    level.leaves += (target.leaves - level.leaves) * k;
    level.body += (target.body - level.body) * k;
    const wiltOf = partWilts({
      leaves: level.leaves,
      body: level.body,
      frown: target.frown,
    });
    // 部位の名前は partPoses から取る。split に無い名前なら、idle[part] で止まる
    const posedParts = partPoses({
      seatOnly: pose?.seatOnly ?? null,
      posed,
      stepping,
    });
    for (const [part, posePart] of Object.entries(posedParts)) {
      const wilt = wiltOf[part];
      const weights = layerWeights({ wilt, pose: posePart, shot });
      idle[part].setEffectiveWeight(weights.idle);
      wiltLoop[part].setEffectiveWeight(weights.wilt);
      if (part !== "mouth") {
        // しおれているほど、ゆっくり動く
        idle[part].timeScale = wiltLoop[part].timeScale = 1 - 0.5 * wilt;
      }
    }
    for (const candidate of Object.values(poses)) {
      const chosen = candidate === pose;
      candidate.action.setEffectiveWeight(chosen ? posed * (1 - shot) : 0);
      candidate.eyes?.setEffectiveWeight(
        chosen ? posedParts.eyes * (1 - shot) : 0,
      );
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
      // 指の位置を収めても、振れた分だけ足元が範囲の外へ出るので、足元でも収める
      model.position.set(
        THREE.MathUtils.clamp(
          held.at.x - (x * Math.cos(swing) - y * Math.sin(swing)),
          held.range.min,
          held.range.max,
        ),
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
    // 座る・寝るの間は足元が家具の上なので、影を出さない（家具より広く、宙に浮いて見える）
    shadow.material.opacity = SHADOW_OPACITY / (1 + lift * 4) * (1 - posed);

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
    // 鉢の照度[lx]。分からなければ null
    setLux(next) {
      lux = next;
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
    // 部屋の立ち位置（spot_* の名前）へ移る。開いて最初はその場に置き、画面をそこへ向ける。
    // 2回目からは、家具をよけて歩いて移り、画面もついていく。
    // 座る・寝るの動きが glb に無いうちは、ソファやベッドの上に立たせず真ん中にいる
    setSpot(name) {
      // 持ち上げている途中で動かすと、指から離れてしまう。次の読み直しで移る
      if (held) return;
      const next = spotOf(room, name);
      const placeable = !POSE_CLIPS[next.pose] || Boolean(poses[next.pose]);
      const chosen = placeable ? name : "center";
      const first = !placed;
      placed = true;
      if (chosen === spotName) return;
      spotName = chosen;
      const destination = chosen === name ? next : spot;
      if (!first) {
        trip = replanTrip(
          actor.position,
          hop ? trip[0] : null,
          destination,
          walkRoom,
        );
        here = destination;
        following = true;
        // 回している途中でも、歩き出したらすぐ正面へ戻す。横を向いたまま進まないように
        turning = false;
        sinceTurn = Infinity;
        return;
      }
      placeAt(destination);
      here = destination;
      // 移った先で立った姿から始める。ポーズの所なら、そこで横になる・座る
      pose = poses[destination.pose] ?? null;
      posed = 0;
      awake = 0;
      panTo(destination.at.clone().sub(focus).dot(right));
    },
    // 久しぶりに開いたとき：部屋の右の外から今の居場所まで歩いてきて、機嫌がよければ喜ぶ。
    // 涙が出る機嫌のときは、喜ぶと涙が引っ込んで訴えが見えなくなるので、歩いてくるだけにする
    // 迎えたら true。持ち上げている間は迎えない。居場所を移っている途中やうろうろ歩いている途中
    // なら、それをやめて、画面の外から今の居場所へ歩いてくる（久しぶりに戻ると、時刻で居場所が
    // 変わって移り始めていることが多いため）
    welcome() {
      if (held) return false;
      const outsideX = welcomeStartX(
        walkArea.floor,
        { focus, right, halfWidth: camera.right, pan },
        WELCOME_OUTSIDE,
      );
      const { entry, steps } = planWelcome(here, outsideX, walkRoom);
      placeAt({ at: new THREE.Vector3(entry.x, 0, entry.z), look: here.at });
      // 跳んでいる途中で迎えたとき、残った跳ぶ様子で、あとの跳ぶ一歩が前の所から始まらないように
      hop = null;
      pose = null;
      posed = 0;
      awake = 0;
      const cheer = target.body < TEARS_FROM ? [{ kind: "cheer" }] : [];
      trip = [...steps, ...cheer];
      following = true;
      wandering = false;
      return true;
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
        top: Math.min(...ys),
        bottom: Math.max(...ys),
        centerY: (Math.min(...ys) + Math.max(...ys)) / 2,
      };
    },
    // dx: 横にドラッグした画素数。画面の半分ほどで半回転する
    turn(dx) {
      // ポーズのまま回すと、体が家具の上で回ってしまう。立たせるだけにする。
      // 歩いている間に回すと、横を向いたまま進むので回さない
      if (wake() || trip.length > 0) return;
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
      wake();
      // 持ち上げたら、起き上がってから流すはずだった動きはやめる
      pending = null;
      const grip = point.clone().sub(model.position);
      // 台の横（+x）の向きに、床の中で動かせる範囲。台の上の座標に直すので、大きさで割る
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(actor.quaternion);
      const { min, max } = holdRange(
        actor.position,
        side,
        walkArea.floor,
        WALK_RADIUS,
      );
      held = {
        grip,
        at: point.clone(),
        target: point.clone().add(new THREE.Vector3(0, 0.08, 0)),
        range: { min: min / CHARACTER_SCALE, max: max / CHARACTER_SCALE },
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
      // 足元が壁を抜けないよう、床の中に収める
      point.x = THREE.MathUtils.clamp(
        point.x,
        held.range.min + held.grip.x,
        held.range.max + held.grip.x,
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
