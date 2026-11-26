// アプリが読むアバターの glb（app/public/models/*.glb）に、歩く動きが入っているかの検証
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
  accessors: { max?: number[] }[];
  animations: {
    name: string;
    channels: { sampler: number; target: { node: number } }[];
    samplers: { input: number }[];
  }[];
};

// glb の頭の12バイトのあとに、JSON のかたまり（長さ・種類・中身）が続く
function readGltf(name: string): Gltf {
  const glb = readFileSync(`app/public/models/${name}.glb`);
  const length = glb.readUInt32LE(12);
  return JSON.parse(glb.subarray(20, 20 + length).toString("utf8"));
}

for (const name of ["karami", "cactus", "everfresh"]) {
  const gltf = readGltf(name);
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
}

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
