import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { modelUrl } from "./models.js";
import { clockAngles, roomLook } from "./room.logic.js";

// 歩ける床と障害物と、見回せる範囲は、Blender で置いた目印。見せず、触っても当たらないよう外す
const isMarker = (name) => /^(nav_floor|block_|view_area)/.test(name);

// 目印を、上から見た四角にする（walk.logic.js が使う形）
function footprint(marker) {
  const box = new THREE.Box3().setFromObject(marker);
  return { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
}

// 部屋の光は、Blender で絵に焼き込んである（材質 baked。.blend はリポジトリの外）。
// 部屋の外へ続く床と壁は、別の小さい絵に焼いてある（材質 baked_outside。#156）。
// 焼いた絵には光も色の調子も入っているので、光を当てずにそのまま出す。
// 時刻などで変える部品（dyn_*）は焼かずに、ふつうの材質のまま光を当てる。
// 歩ける床と家具（walkArea）と、見回せる範囲（viewArea）は、目印を外す前に読んでおく
export async function loadRoom() {
  const gltf = await new GLTFLoader().loadAsync(modelUrl("room"));
  const room = gltf.scene;
  const markers = [];
  room.traverse((object) => {
    if (isMarker(object.name)) markers.push(object);
    if (object.isMesh && object.material.name.startsWith("baked")) {
      const baked = object.material;
      object.material = new THREE.MeshBasicMaterial({
        map: baked.map,
        side: baked.side,
        toneMapped: false,
      });
      baked.dispose();
    }
  });
  room.updateMatrixWorld(true);
  const walkArea = {
    floor: footprint(markers.find((marker) => marker.name === "nav_floor")),
    blocks: markers
      .filter((marker) => marker.name.startsWith("block_"))
      .map(footprint),
  };
  const viewMarker = markers.find((marker) => marker.name === "view_area");
  if (!viewMarker) throw new Error("view_area が部屋にありません");
  const viewArea = new THREE.Box3().setFromObject(viewMarker);
  for (const marker of markers) marker.removeFromParent();
  return { room, walkArea, viewArea };
}

// 立ち位置（spot_*）の床の点と、向く先の点と、そこでとるポーズ
export function spotOf(room, name) {
  const spot = room.getObjectByName(`spot_${name}`);
  const look = room.getObjectByName(`spot_${name}_look`);
  if (!spot || !look) throw new Error(`spot_${name} が部屋にありません`);
  return {
    at: spot.getWorldPosition(new THREE.Vector3()),
    look: look.getWorldPosition(new THREE.Vector3()),
    pose: spot.userData.pose,
  };
}

// 空の色（上・下）。昼と夕方は、晴れの色と曇りの色を窓の明るさで混ぜる
const SKY = {
  day: { clear: ["#74b3ee", "#c4e2f8"], dull: ["#8f9ba7", "#bcc4cc"] },
  twilight: { clear: ["#6f7fb8", "#f2b48a"], dull: ["#6d7380", "#a49a94"] },
  night: { clear: ["#1d2547", "#3b4670"], dull: ["#1d2547", "#3b4670"] },
};
const LAMP_GLOW = new THREE.Color("#ffd9a0");

function mixColor(dull, clear, t) {
  return `#${
    new THREE.Color(dull).lerp(new THREE.Color(clear), t).getHexString()
  }`;
}

function drawSky(ctx, { phase, daylight }) {
  const { width: w, height: h } = ctx.canvas;
  const { clear, dull } = SKY[phase];
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, mixColor(dull[0], clear[0], daylight));
  gradient.addColorStop(1, mixColor(dull[1], clear[1], daylight));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  if (phase !== "night") return;
  ctx.fillStyle = "#f5efcf";
  ctx.beginPath();
  ctx.arc(w * 0.7, h * 0.3, h * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  for (const [x, y] of [[0.2, 0.2], [0.35, 0.45], [0.85, 0.6], [0.15, 0.6]]) {
    ctx.fillRect(w * x, h * y, 2, 2);
  }
}

// 窓の空・日だまり・ランプ・時計の針（dyn_*）を、時刻と照度に合わせる。
// update は毎フレーム呼んでよい。見た目が変わるときだけ描き直す
export function createRoomLook(room) {
  const find = (name) => {
    const found = room.getObjectByName(name);
    if (!found) throw new Error(`${name} が部屋にありません`);
    return found;
  };
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const skyTexture = new THREE.CanvasTexture(canvas);
  skyTexture.colorSpace = THREE.SRGBColorSpace;
  // 空の面は、上の頂点が v=0 になっている。既定の上下反転のままだと、月が下に出る
  skyTexture.flipY = false;
  const sky = find("dyn_sky");
  sky.material.dispose();
  sky.material = new THREE.MeshBasicMaterial({
    map: skyTexture,
    toneMapped: false,
  });
  const sunpatch = find("dyn_sunpatch");
  const sunOpacity = sunpatch.material.opacity;
  const shade = find("dyn_lamp_shade").material;
  const hourHand = find("dyn_clock_hour");
  const minuteHand = find("dyn_clock_minute");
  let drawn = "";

  return {
    update(now, lux) {
      const look = roomLook({ now, lux });
      // 照度の細かな揺れで毎回描き直さないよう、明るさは 10 段階に丸めて比べる
      const key = `${look.phase}:${
        Math.round(look.daylight * 10)
      }:${look.lamp}`;
      if (key !== drawn) {
        drawn = key;
        drawSky(canvas.getContext("2d"), look);
        skyTexture.needsUpdate = true;
        sunpatch.visible = look.sunpatch > 0.01;
        sunpatch.material.opacity = sunOpacity * look.sunpatch;
        shade.emissive.copy(look.lamp ? LAMP_GLOW : new THREE.Color(0));
        shade.emissiveIntensity = look.lamp ? 1 : 0;
      }
      // 壁から部屋の中へ向く軸（+z）で回す。部屋から見て時計回りなので負の向き
      const angles = clockAngles(now);
      hourHand.rotation.z = -angles.hour;
      minuteHand.rotation.z = -angles.minute;
    },
  };
}
