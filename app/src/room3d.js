import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { modelUrl } from "./models.js";

// 歩ける床と障害物は、Blender で置いた目印。見せず、触っても当たらないよう外す
const isMarker = (name) => /^(nav_floor|block_)/.test(name);

// 部屋の光は、Blender で1枚の絵に焼き込んである（材質 baked。.blend はリポジトリの外）。
// 焼いた絵には光も色の調子も入っているので、光を当てずにそのまま出す。
// 時刻などで変える部品（dyn_*）は焼かずに、ふつうの材質のまま光を当てる
export async function loadRoom() {
  const gltf = await new GLTFLoader().loadAsync(modelUrl("room"));
  const room = gltf.scene;
  const markers = [];
  room.traverse((object) => {
    if (isMarker(object.name)) markers.push(object);
    if (object.isMesh && object.material.name === "baked") {
      const baked = object.material;
      object.material = new THREE.MeshBasicMaterial({
        map: baked.map,
        side: baked.side,
        toneMapped: false,
      });
      baked.dispose();
    }
  });
  for (const marker of markers) marker.removeFromParent();
  room.updateMatrixWorld(true);
  return room;
}

// 立ち位置（spot_*）の床の点と、向く先の点
export function spotOf(room, name) {
  const spot = room.getObjectByName(`spot_${name}`);
  const look = room.getObjectByName(`spot_${name}_look`);
  if (!spot || !look) throw new Error(`spot_${name} が部屋にありません`);
  return {
    at: spot.getWorldPosition(new THREE.Vector3()),
    look: look.getWorldPosition(new THREE.Vector3()),
  };
}
