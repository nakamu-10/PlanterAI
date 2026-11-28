// 部屋の中を歩く道（app/src/walk.logic.js）の検証
// 実行: npx tsx tests/walkLogic.test.ts
import {
  approachPoint,
  holdRange,
  planPath,
  planTrip,
  planWander,
  planWelcome,
  replanTrip,
  wanderPoint,
  welcomeStartX,
} from "../app/src/walk.logic.js";

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
{
  const table = { minX: -0.3, maxX: 0.3, minZ: -0.3, maxZ: 0.3 };
  const path = planPath({ x: -0.8, z: 0 }, { x: 0.45, z: 0 }, {
    floor,
    blocks: [table],
    radius,
  });
  assert(
    "行き先が家具のすぐそばでも、その家具を突き抜けずに回る",
    path.length === 3 && Math.abs(path[0].z) > 0.3 &&
      Math.abs(path[1].z) > 0.3,
  );
}
{
  const box = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
  const boxed = { floor: box, blocks: [box], radius };
  const inside = { at: { x: 0.5, y: 0.4, z: 0 }, look: { x: 3, y: 0, z: 0 } };
  const leaving = planTrip({ x: 0, y: 0.4, z: 0 }, inside, boxed);
  assert(
    "家具から出られる縁が無ければ、立って行き先へ跳んで移る",
    leaving.map((step) => step.kind).join() === "stand,hop,settle" &&
      leaving[1].to === inside.at,
  );
  const arriving = planTrip({ x: 1.5, y: 0, z: 0 }, inside, {
    floor,
    blocks: [box],
    radius: 2,
  });
  assert(
    "行き先の家具に入る縁が無ければ、床から跳んで移る",
    arriving.map((step) => step.kind).join() === "hop,settle",
  );
}
{
  const sofaSpot = {
    at: { x: -0.65, y: 0.42, z: -1.05 },
    look: { x: 0, y: 0, z: 4 },
    pose: "sit",
  };
  const center = {
    at: { x: 0.35, y: 0.016, z: 0.35 },
    look: { x: 2.65, y: 0, z: 2.65 },
    pose: "stand",
  };
  const hopping = { kind: "hop", to: sofaSpot.at };
  const steps = replanTrip(
    { x: -0.65, y: 0.3, z: -0.6 },
    hopping,
    center,
    room,
  );
  assert(
    "跳び上がっている途中に行き先が変わったら、跳び終えてから下りて歩く",
    steps[0] === hopping &&
      steps.map((step) => step.kind).join() === "hop,stand,hop,walk,settle",
  );
  const walking = replanTrip({ x: 0, y: 0, z: 0 }, null, center, room);
  assert(
    "跳んでいなければ、今いる所から決め直す",
    walking.map((step) => step.kind).join() === "walk,settle",
  );
}
{
  const home = { x: 0.35, z: 0.35 };
  const sequence = (values: number[]) => () => values.shift() ?? 0;
  // 角度は 0（+x の向き）、距離は reach × (0.5 + 0.5 × 1)
  const p = wanderPoint(home, room, 0.6, { random: sequence([0, 1]) });
  assert(
    "うろうろ歩く先は、立ち位置から reach までの床の点",
    p !== null && near(p.x, 0.95) && near(p.z, 0.35),
  );
  // 窓辺から奥（-z）はタンスにかかるので、選び直して手前（+z）へ行く
  const nearChest = { x: 1.15, z: -0.6 };
  const q = wanderPoint(nearChest, room, 0.6, {
    random: sequence([0.75, 1, 0.25, 1]),
  });
  assert(
    "家具にかかる点は選び直す",
    q !== null && near(q.x, 1.15) && near(q.z, 0),
  );
  assert(
    "何度選んでも家具にかかるなら null",
    wanderPoint(nearChest, room, 0.6, { random: () => 0.75 }) === null,
  );
  // 1回目の +x の点は画面の外として外し、2回目の +z の点を選ぶ
  const r = wanderPoint(home, room, 0.6, {
    random: sequence([0, 1, 0.25, 1]),
    fits: (point) => point.x < 0.6,
  });
  assert(
    "fits に合わない点は選び直す",
    r !== null && near(r.x, 0.35) && near(r.z, 0.95),
  );
}
{
  const center = {
    at: { x: 0.35, y: 0.016, z: 0.35 },
    look: { x: 2.65, y: 0, z: 2.65 },
    pose: "stand",
  };
  const steps = planWander(center, { x: 0.95, z: 0.35 }, 3, room);
  assert(
    "うろうろは、歩いて待って、戻って向きを直す",
    steps.map((step) => step.kind).join() === "walk,pause,walk,settle" &&
      steps[0].to.y === 0 && steps[2].to.y === 0.016 &&
      near(steps[2].to.x, 0.35),
  );
}
{
  // 部屋の立ち位置（room.glb の spot_*）。どこへ迎えに来ても、家具の上を通らないこと
  const spots = {
    center: { at: { x: 0.35, y: 0.016, z: 0.35 }, look: { x: 3, y: 0, z: 3 } },
    window: { at: { x: 1.15, y: 0, z: -0.7 }, look: { x: 0, y: 0, z: -3 } },
    sofa: { at: { x: -0.65, y: 0.42, z: -1.05 }, look: { x: 0, y: 0, z: 4 } },
    bed: { at: { x: -1.58, y: 0.27, z: 0.72 }, look: { x: 0, y: 0, z: 3 } },
  };
  // 道を細かく区切って、どの点も（家具の上の行き先の手前までは）広げた家具にかからないかを見る
  const touchesFurniture = (points: { x: number; z: number }[]) =>
    points.slice(1).some((b, i) => {
      const a = points[i];
      return Array.from({ length: 41 }, (_, k) => k / 40).some((t) => {
        const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
        return blocks.some((rect) =>
          p.x > rect.minX - radius + 1e-3 && p.x < rect.maxX + radius - 1e-3 &&
          p.z > rect.minZ - radius + 1e-3 && p.z < rect.maxZ + radius - 1e-3
        );
      });
    });
  for (const [name, spot] of Object.entries(spots)) {
    const { entry, steps } = planWelcome(spot, 2.5, room);
    const walked = [
      entry,
      ...steps.filter((step) => step.kind === "walk").map((step) => step.to),
    ];
    assert(
      `${name} へ迎えに来るとき、部屋の右の外から入り、家具を通らない`,
      entry.x === 2.5 && !touchesFurniture(walked) &&
        steps.at(-1).kind === "settle",
    );
  }
}
{
  const focus = { x: 0.35, z: 0.35 };
  const right = { x: Math.SQRT1_2, z: -Math.SQRT1_2 };
  // 画面の上で、写す中心から右へどれだけ離れているか
  const along = (p: { x: number; z: number }, pan: number) =>
    (p.x - focus.x) * right.x + (p.z - focus.z) * right.z - pan;
  const wide = { focus, right, halfWidth: 2.5, pan: 0 };
  const x = welcomeStartX(floor, wide, 0.6);
  assert(
    "広い画面では、床のいちばん手前の点でも画面の右の外から歩き出す",
    near(along({ x, z: floor.maxZ }, 0), 2.5 + 0.6) && x > floor.maxX + 0.6,
  );
  const shifted = { focus, right, halfWidth: 0, pan: -1.5 };
  assert(
    "画面の端が床の縁より内側なら、床の縁の外から歩き出す",
    near(welcomeStartX(floor, shifted, 0.6), floor.maxX + 0.6),
  );
}

{
  const radius = 0.2;
  const across = holdRange({ x: 0, z: 0 }, { x: 1, z: 0 }, floor, radius);
  assert(
    "持ち上げて横へ動かすと、両側の壁の半径だけ手前で止まる",
    near(across.min, -1.7) && near(across.max, 1.7),
  );
  const slant = { x: Math.SQRT1_2, z: -Math.SQRT1_2 };
  const tilted = holdRange({ x: 0, z: 0 }, slant, floor, radius);
  assert(
    "斜めの向きでも、先に当たる壁の手前で止まる",
    near(tilted.max, 1.15 * Math.SQRT2) && near(tilted.min, -1.2 * Math.SQRT2),
  );
  const byWall = holdRange({ x: -1.65, z: 0 }, { x: 1, z: 0 }, floor, radius);
  assert(
    "壁ぎわにいると、壁の側へはほとんど動かせない",
    near(byWall.min, -0.05) && near(byWall.max, 3.35),
  );
  const onBed = holdRange({ x: -1.8, z: 0 }, { x: 1, z: 0 }, floor, radius);
  assert(
    "壁ぎわの家具の上にいても、その場は動かせる範囲に入る",
    onBed.min === 0 && near(onBed.max, 3.5),
  );
}

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
