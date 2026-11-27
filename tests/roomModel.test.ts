// アプリが読む部屋の glb（app/public/models/room.glb）の検証
// 実行: npx tsx tests/roomModel.test.ts
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;

function assert(name: string, condition: boolean) {
  if (condition) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}`);
  }
}

type Gltf = {
  nodes: {
    name: string;
    mesh?: number;
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }[];
  meshes: {
    primitives: { attributes: { POSITION: number }; material: number }[];
  }[];
  accessors: { min?: number[]; max?: number[] }[];
  materials: { name: string }[];
};

const glb = readFileSync("app/public/models/room.glb");
const gltf: Gltf = JSON.parse(
  glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"),
);

// 頂点の min/max だけを見る。node に移動・回転・拡大があると、アプリが測る範囲と
// ずれるので、測らずに null を返して落とす
function bounds(name: string) {
  const node = gltf.nodes.find((n) => n.name === name);
  if (node?.mesh === undefined) return null;
  if (node.translation || node.rotation || node.scale) return null;
  const position = gltf.accessors[
    gltf.meshes[node.mesh].primitives[0].attributes.POSITION
  ];
  return { min: position.min ?? [], max: position.max ?? [] };
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;

// 見回せる範囲は、床と壁を延ばす前の部屋（床 4m × 3m と壁の厚み）のまま（#156）
const view = bounds("view_area");
assert("view_area がある", view !== null);
if (view) {
  assert(
    "view_area は部屋の横の範囲（-2.1〜2.0m）",
    near(view.min[0], -2.1) && near(view.max[0], 2.0),
  );
  assert(
    "view_area は部屋の奥行きの範囲（-1.6〜1.5m）",
    near(view.min[2], -1.6) && near(view.max[2], 1.5),
  );
}

// 床と壁は、部屋の端（右 x=2.0m、手前 z=1.5m）から外へ 4m 続く。切り口が画面に
// 写らないように（#156、ADR 0019）。外の部品は1つのメッシュに結合してある
const outside = bounds("static_outside");
assert("外の部品は1つのメッシュ static_outside", outside !== null);
if (outside) {
  assert("床と奥の壁が右へ 4m 続く", near(outside.max[0], 6.0));
  assert("床と左の壁が手前へ 4m 続く", outside.max[2] >= 5.5);
  assert("外に壁の高さがある", outside.max[1] > 2.3);
}
assert(
  "外の部品は static_outside のほかに無い",
  !gltf.nodes.some((n) => /_out(_|$)/.test(n.name)),
);

// 部屋の中と外は別の絵に焼く。部屋の中の細かさを落とさないように
const materialOf = (name: string) => {
  const node = gltf.nodes.find((n) => n.name === name);
  if (node?.mesh === undefined) return undefined;
  return gltf.materials[gltf.meshes[node.mesh].primitives[0].material]?.name;
};
assert("部屋の床は baked", materialOf("slab") === "baked");
assert(
  "外の部品は baked_outside",
  materialOf("static_outside") === "baked_outside",
);

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
