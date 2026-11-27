import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { modelUrl } from "./models.js";

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
