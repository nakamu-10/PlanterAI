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

// size: 1つのキーの数の個数（位置は3、回転は4）
function readKeys(
  gltf: Gltf,
  bin: Buffer,
  accessorIndex: number,
  size: number,
) {
  const accessor = gltf.accessors[accessorIndex];
  const start = (gltf.bufferViews[accessor.bufferView].byteOffset ?? 0) +
    (accessor.byteOffset ?? 0);
  return Array.from(
    { length: accessor.count },
    (_, i) =>
      Array.from(
        { length: size },
        (_, k) => bin.readFloatLE(start + (i * size + k) * 4),
      ),
  );
}

// 寝るときの根元の前後の位置（glTF の z）。足先がマットレスの足元に収まる値で、#139 で作ったときのもの。
// 前に作った布団まで測ると、布団の長さだけ枕の外へずれる
const SLEEP_ROOT_Z: Record<string, number> = {
  karami: 0.54,
  cactus: 0.59,
  everfresh: 0.59,
};

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
  const sleepKeys = (bone: string, path: string, size: number) => {
    const channel = sleep.channels.find((c) =>
      gltf.nodes[c.target.node].name === bone && c.target.path === path
    );
    return channel
      ? readKeys(gltf, bin, sleep.samplers[channel.sampler].output, size)
      : [];
  };
  const rootZ = sleepKeys("root", "translation", 3).map((key) => key[2]);
  assert(
    `${name}: Sleep は枕に頭をのせる位置に寝る`,
    rootZ.length > 0 &&
      rootZ.every((z) => Math.abs(z - SLEEP_ROOT_Z[name]) < 0.01),
  );
  for (const side of ["L", "R"]) {
    const keys = sleepKeys(`eye_happy_${side}`, "rotation", 4);
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
