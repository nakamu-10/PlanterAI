// 部屋の中を歩く道（app/src/walk.logic.js）の検証
// 実行: npx tsx tests/walkLogic.test.ts
import { approachPoint, planPath, planTrip } from "../app/src/walk.logic.js";

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

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

// 部屋の glb（room.glb）の nav_floor と block_* の寸法
const floor = { minX: -1.9, maxX: 1.9, minZ: -1.35, maxZ: 1.4 };
const sofa = { minX: -1.4, maxX: 0.1, minZ: -1.5, maxZ: -0.65 };
const chest = { minX: 0.7, maxX: 1.6, minZ: -1.5, maxZ: -0.97 };
const bed = { minX: -2, maxX: -1.14, minZ: 0.27, maxZ: 1.47 };
const blocks = [sofa, chest, bed];
const radius = 0.2;
const room = { floor, blocks, radius };

{
  const p = approachPoint({ x: -0.65, z: -1.05 }, room);
  assert(
    "ソファの上の立ち位置は、ソファの前の床へ出す",
    near(p.x, -0.65) && near(p.z, -0.44),
  );
}
{
  const p = approachPoint({ x: -1.58, z: 0.72 }, room);
  assert(
    "ベッドの上の立ち位置は、いちばん近い縁（部屋の内側）へ出す",
    near(p.x, -0.93) && near(p.z, 0.72),
  );
}
{
  const center = { x: 0.35, z: 0.35 };
  assert(
    "家具の外の立ち位置は、そのまま",
    approachPoint(center, room) === center,
  );
}
{
  const to = { x: -0.65, z: -0.44 };
  const path = planPath({ x: 0.35, z: 0.35 }, to, room);
  assert(
    "間に家具が無ければ、まっすぐ向かう",
    path.length === 1 && path[0] === to,
  );
}
{
  const to = { x: -0.65, z: -0.44 };
  const path = planPath({ x: 1.15, z: -0.7 }, to, room);
  assert(
    "窓辺からソファの前へは、ソファの角を回る",
    path.length === 2 && near(path[0].x, 0.31) && near(path[0].z, -0.44) &&
      path[1] === to,
  );
}
{
  const to = { x: 0.35, z: 0.35 };
  const path = planPath({ x: 0, z: -0.5 }, to, room);
  assert(
    "家具のすぐそばに置かれても、そこから出られる",
    path.length === 1 && path[0] === to,
  );
}
{
  const to = { x: 1, z: 0 };
  const wall = { minX: -0.1, maxX: 0.1, minZ: -2, maxZ: 2 };
  const path = planPath({ x: -1, z: 0 }, to, {
    floor,
    blocks: [wall],
    radius,
  });
  assert(
    "道が見つからなければ、まっすぐ向かう",
    path.length === 1 && path[0] === to,
  );
}
{
  const sofaSpot = {
    at: { x: -0.65, y: 0.42, z: -1.05 },
    look: { x: 0, y: 0, z: 4 },
    pose: "sit",
  };
  const kinds = planTrip({ x: 0.35, y: 0.016, z: 0.35 }, sofaSpot, room)
    .map((step) => step.kind);
  assert(
    "床からソファへは、前まで歩いて跳び上がり、座る",
    kinds.join() === "walk,hop,settle",
  );
}
{
  const center = {
    at: { x: 0.35, y: 0.016, z: 0.35 },
    look: { x: 2.65, y: 0, z: 2.65 },
    pose: "stand",
  };
  const steps = planTrip({ x: -1.58, y: 0.27, z: 0.72 }, center, room);
  const last = steps.findLast((step) => step.kind === "walk");
  assert(
    "ベッドから真ん中へは、立って跳び下り、歩いて向きを変える",
    steps.map((step) => step.kind).join() === "stand,hop,walk,settle" &&
      steps[1].to.y === 0 && last.to.y === 0.016,
  );
}
{
  const shelf = { minX: -1.1, maxX: -0.7, minZ: 0.5, maxZ: 1 };
  const p = approachPoint({ x: -1.58, z: 0.72 }, {
    floor,
    blocks: [bed, shelf],
    radius,
  });
  assert(
    "となりの家具の中へは出さず、別の縁から出る",
    near(p.x, -1.58) && near(p.z, 0.06),
  );
}
{
  const point = { x: 0, z: 0 };
  const box = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
  assert(
    "出られる縁が無ければ、その場の点を返す",
    approachPoint(point, { floor: box, blocks: [box], radius }) === point,
  );
}
{
  const table = { minX: -0.3, maxX: 0.3, minZ: -0.3, maxZ: 0.3 };
  const path = planPath({ x: -0.45, z: 0 }, { x: 0.8, z: 0 }, {
    floor,
    blocks: [table],
    radius,
  });
  assert(
    "家具のすぐそばに置かれても、その家具を突き抜けずに回る",
    path.length === 3 && Math.abs(path[0].z) > 0.3 &&
      Math.abs(path[1].z) > 0.3,
  );
}

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
