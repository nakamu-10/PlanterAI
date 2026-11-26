// アプリが読むアバターの glb（app/public/models/*.glb）の、歩く動きと寝る動きの検証
// 実行: npx tsx tests/avatarModels.test.ts
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
  nodes: { name: string }[];
  accessors: {
    bufferView: number;
    byteOffset?: number;
    count: number;
    max?: number[];
  }[];
  bufferViews: { byteOffset?: number }[];
  animations: {
    name: string;
    channels: {
      sampler: number;
      target: { node: number; path: string };
    }[];
    samplers: { input: number; output: number }[];
  }[];
};

// glb の頭の12バイトのあとに、JSON のかたまり（長さ・種類・中身）が続き、そのあとにバイナリのかたまりが続く
function readGlb(name: string): { gltf: Gltf; bin: Buffer } {
  const glb = readFileSync(`app/public/models/${name}.glb`);
  const length = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.subarray(20, 20 + length).toString("utf8"));
  const binStart = 20 + length;
  const binLength = glb.readUInt32LE(binStart);
  return { gltf, bin: glb.subarray(binStart + 8, binStart + 8 + binLength) };
}

function readQuaternions(gltf: Gltf, bin: Buffer, accessorIndex: number) {
  const accessor = gltf.accessors[accessorIndex];
  const start = (gltf.bufferViews[accessor.bufferView].byteOffset ?? 0) +
    (accessor.byteOffset ?? 0);
  return Array.from(
    { length: accessor.count },
    (_, i) => [0, 1, 2, 3].map((k) => bin.readFloatLE(start + (i * 4 + k) * 4)),
  );
}

for (const name of ["karami", "cactus", "everfresh"]) {
  const { gltf, bin } = readGlb(name);
  const walk = gltf.animations.find((animation) => animation.name === "Walk");
  assert(`${name}: Walk がある`, walk !== undefined);
  if (!walk) continue;
  const bones = new Set(
    walk.channels.map((channel) => gltf.nodes[channel.target.node].name),
  );
  assert(
    `${name}: Walk に根元と両脚の骨がある`,
    ["root", "leg_L", "leg_R"].every((bone) => bones.has(bone)),
  );
  // karami3d.js の歩く速さは、Walk が1秒で2歩のものとして決めている
  const seconds = gltf.accessors[walk.samplers[0].input].max?.[0] ?? 0;
  assert(`${name}: Walk は1秒`, Math.abs(seconds - 1) < 1e-3);

  const sleep = gltf.animations.find((animation) => animation.name === "Sleep");
  assert(`${name}: Sleep がある`, sleep !== undefined);
  if (!sleep) continue;
  for (const side of ["L", "R"]) {
    const channel = sleep.channels.find((c) =>
      gltf.nodes[c.target.node].name === `eye_happy_${side}` &&
      c.target.path === "rotation"
    );
    const keys = channel
      ? readQuaternions(gltf, bin, sleep.samplers[channel.sampler].output)
      : [];
    // q と -q は同じ向きなので、内積の絶対値で比べる。キーごとに向きが変わると、寝ている間に目が回る（#154）
    const sameAsFirst = (q: number[]) =>
      Math.abs(q.reduce((sum, v, k) => sum + v * keys[0][k], 0)) > 0.999;
    assert(
      `${name}: Sleep の閉じた目（${side}）は回らない`,
      keys.length > 0 && keys.every(sameAsFirst),
    );
  }
}

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
