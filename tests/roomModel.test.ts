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
  accessors: {
    min?: number[];
    max?: number[];
    bufferView?: number;
    byteOffset?: number;
    count: number;
  }[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
  materials: { name: string }[];
};

const glb = readFileSync("app/public/models/room.glb");
const jsonLength = glb.readUInt32LE(12);
const gltf: Gltf = JSON.parse(
  glb.subarray(20, 20 + jsonLength).toString("utf8"),
);
const binary = glb.subarray(20 + jsonLength + 8);

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

// 頂点の位置を [x, y, z] で読む。移動・回転・拡大のある node は bounds と同じく測らない
function positions(name: string) {
  const node = gltf.nodes.find((n) => n.name === name);
  if (node?.mesh === undefined) return [];
  if (node.translation || node.rotation || node.scale) return [];
  const accessor = gltf.accessors[
    gltf.meshes[node.mesh].primitives[0].attributes.POSITION
  ];
  const view = gltf.bufferViews[accessor.bufferView ?? 0];
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? 12;
  return Array.from(
    { length: accessor.count },
    (_, i) =>
      [0, 1, 2].map((k) => binary.readFloatLE(start + i * stride + k * 4)),
  );
}

const maxOf = (points: number[][], axis: number) =>
  Math.max(...points.map((point) => point[axis]));

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
// 写らないように（#156、ADR 0019）。外の部品は1つのメッシュに結合してあるので、
// 床の板の下面（y < -0.1）と壁の上の方（y > 2）の頂点に分けて測る。
// 床の上の木目は、最後の列が 5.5m より少し先まで出ているので測らない。
// 右と手前の床は角で重なるので、部屋の幅・奥行きの内側に絞って測る
assert(
  "外の部品は1つのメッシュ static_outside",
  bounds("static_outside") !== null,
);
const outside = positions("static_outside");
const floor = outside.filter(([, y]) => y < -0.1);
const wall = outside.filter(([, y]) => y > 2);
const floorBeside = floor.filter(([, , z]) => z < 1.4);
const floorInFront = floor.filter(([x]) => x < 1.9);
assert(
  "床が右へ 4m 続く",
  floorBeside.length > 0 && near(maxOf(floorBeside, 0), 6.0),
);
assert(
  "床が手前へ 4m 続く",
  floorInFront.length > 0 && near(maxOf(floorInFront, 2), 5.5),
);
assert("奥の壁が右へ 4m 続く", wall.length > 0 && near(maxOf(wall, 0), 6.0));
assert("左の壁が手前へ 4m 続く", wall.length > 0 && near(maxOf(wall, 2), 5.5));
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
