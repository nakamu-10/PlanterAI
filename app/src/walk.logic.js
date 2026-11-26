// 部屋の中を歩く道を決める計算。床と家具は、上から見た四角 { minX, maxX, minZ, maxZ } で扱う。
// three.js に依存しないので、ここだけテストできる

// 家具の縁ちょうどの点を、家具の中と見なさないためのすき間[m]
const MARGIN = 0.01;

export const grow = (rect, by) => ({
  minX: rect.minX - by,
  maxX: rect.maxX + by,
  minZ: rect.minZ - by,
  maxZ: rect.maxZ + by,
});

// 縁の上は中に入れない
export const isInside = (p, rect) =>
  p.x > rect.minX && p.x < rect.maxX && p.z > rect.minZ && p.z < rect.maxZ;

// ソファやベッドの上の立ち位置は、家具の中にある。いちばん近い縁から、キャラの半径だけ外の床へ出す。
// 壁ぎわの家具の、壁の側と、となりの家具の中へは出さない。
// 出られる縁が無ければ、その場の点を返す（歩かずに跳んで移る）
export function approachPoint(point, { floor, blocks, radius }) {
  const block = blocks.find((rect) => isInside(point, rect));
  if (!block) return point;
  const out = grow(block, radius + MARGIN);
  const walkable = grow(floor, -radius);
  const exits = [
    { x: out.minX, z: point.z },
    { x: out.maxX, z: point.z },
    { x: point.x, z: out.minZ },
    { x: point.x, z: out.maxZ },
  ].filter((p) =>
    isInside(p, walkable) &&
    !blocks.some((rect) => rect !== block && isInside(p, grow(rect, radius)))
  );
  const distance = (p) => Math.hypot(p.x - point.x, p.z - point.z);
  return exits.reduce(
    (best, p) => distance(p) < distance(best) ? p : best,
    exits[0] ?? point,
  );
}

// 線分 a→b が四角の内側を通るか。縁をなぞるだけなら通らない
function crosses(a, b, rect) {
  let enter = 0;
  let leave = 1;
  for (const axis of ["x", "z"]) {
    const min = axis === "x" ? rect.minX : rect.minZ;
    const max = axis === "x" ? rect.maxX : rect.maxZ;
    const d = b[axis] - a[axis];
    if (Math.abs(d) < 1e-9) {
      if (a[axis] <= min || a[axis] >= max) return false;
      continue;
    }
    const t1 = (min - a[axis]) / d;
    const t2 = (max - a[axis]) / d;
    enter = Math.max(enter, Math.min(t1, t2));
    leave = Math.min(leave, Math.max(t1, t2));
  }
  return leave - enter > 1e-6;
}

// from から to までの、家具をよけた道。家具をキャラの半径だけ広げ、その角をたどる最短の道を探す。
// 戻り値は from の次から to までの点の並び。道が見つからなければ、まっすぐ to へ向かう。
// 置かれた所や行き先が広げた家具にかかっているときは、そこから出る・そこへ入る1本だけ、広げる前の
// 家具をよければよいことにする（家具のすぐそばに降ろされると、どこへも出られなくなるため）
export function planPath(from, to, { floor, blocks, radius }) {
  const obstacles = blocks.map((rect) => ({ rect, grown: grow(rect, radius) }));
  const grown = obstacles.map((obstacle) => obstacle.grown);
  const walkable = grow(floor, -radius);
  const corners = grown.flatMap((rect) => {
    const out = grow(rect, MARGIN);
    return [
      { x: out.minX, z: out.minZ },
      { x: out.minX, z: out.maxZ },
      { x: out.maxX, z: out.minZ },
      { x: out.maxX, z: out.maxZ },
    ];
  }).filter((p) =>
    isInside(p, walkable) && !grown.some((rect) => isInside(p, rect))
  );
  const points = [from, ...corners, to];
  const endsIn = (a, b, end, rect) =>
    (a === end || b === end) && isInside(end, rect);
  const clear = (a, b) =>
    !obstacles.some(({ rect, grown }) => {
      const nearEnd = endsIn(a, b, from, grown) || endsIn(a, b, to, grown);
      return crosses(a, b, nearEnd ? rect : grown);
    });
  const goal = points.length - 1;

  const cost = points.map(() => Infinity);
  const previous = points.map(() => -1);
  const done = points.map(() => false);
  cost[0] = 0;
  for (;;) {
    let current = -1;
    for (let i = 0; i < points.length; i++) {
      if (!done[i] && (current < 0 || cost[i] < cost[current])) current = i;
    }
    if (current < 0 || cost[current] === Infinity) return [to];
    if (current === goal) break;
    done[current] = true;
    const a = points[current];
    points.forEach((b, i) => {
      if (done[i] || !clear(a, b)) return;
      const next = cost[current] + Math.hypot(b.x - a.x, b.z - a.z);
      if (next < cost[i]) {
        cost[i] = next;
        previous[i] = current;
      }
    });
  }
  const path = [];
  for (let i = goal; i > 0; i = previous[i]) path.unshift(points[i]);
  return path;
}
