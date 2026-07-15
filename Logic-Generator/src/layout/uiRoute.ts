// Orthogonal cable router for the on-screen circuit visualization.
//
// This is a *pixel-space* router used only by `CircuitCanvas`. It is independent
// of the game-grid cable routing in `layout.ts` (which drives the real blueprint
// export). Its job is purely cosmetic: connect the ports exactly where they are
// drawn, keep cables out from under blocks, and fan parallel cables into
// separate lanes so they don't stack on top of each other.
//
// Approach: A* over a Hanan-style grid built from block edges, port anchors and
// a few channel lanes per inter-column gap. Segments that pass through the
// interior of an (inflated) block are forbidden, so routes hug block borders
// instead of crossing them. Segments already used by earlier cables are
// penalized so later cables pick a different lane.

export interface UiRect {
  /** Left edge in px. */
  x: number;
  /** Top edge in px. */
  y: number;
  w: number;
  h: number;
}

export interface UiPoint {
  x: number;
  y: number;
}

export interface RouteRequest {
  id: string;
  /** Source port anchor (right edge of the source block). */
  from: UiPoint;
  /** Target port anchor (left edge of the target block). */
  to: UiPoint;
}

export interface RoutedCable {
  id: string;
  /** Polyline points in px, including the port anchors at both ends. */
  points: UiPoint[];
}

export interface RouteOptions {
  /** Clearance kept around every block, in px. */
  pad: number;
  /** Extra channel lanes inserted into each inter-column gap. */
  lanesPerGap: number;
  /** Cost added per unit length. */
  lengthCost: number;
  /** Cost added for each 90° turn. */
  turnCost: number;
  /** Cost added for reusing a segment already taken by another cable. */
  sharedCost: number;
}

export const DEFAULT_ROUTE_OPTIONS: RouteOptions = {
  pad: 7,
  lanesPerGap: 3,
  lengthCost: 1,
  turnCost: 14,
  sharedCost: 40,
};

interface InflatedRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

// Tolerance for geometry/blocking tests (keeps boundary-hugging from counting
// as a crossing).
const EPS = 0.5;
// Much tighter tolerance for merging grid coordinates: distinct port anchors can
// sit fractions of a pixel apart and must stay distinct, otherwise a stub lands
// slightly off its port and shows a tiny diagonal jog.
const MERGE_EPS = 1e-4;

function inflate(r: UiRect, pad: number): InflatedRect {
  return {
    left: r.x - pad,
    right: r.x + r.w + pad,
    top: r.y - pad,
    bottom: r.y + r.h + pad,
  };
}

/** Sort + dedupe near-equal coordinates so the grid stays compact. */
function uniqSorted(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length === 0 || Math.abs(v - out[out.length - 1]) > MERGE_EPS) out.push(v);
  }
  return out;
}

/**
 * Route every request as an orthogonal polyline. Requests are routed in the
 * given order; later cables avoid segments earlier ones already occupy.
 */
export function routeCables(
  blocks: UiRect[],
  requests: RouteRequest[],
  opts: RouteOptions = DEFAULT_ROUTE_OPTIONS,
): RoutedCable[] {
  const rects = blocks.map((b) => inflate(b, opts.pad));

  // A port anchor sits *on* a block edge. Seeding A* there would trap it inside
  // the inflated obstacle, so we route from/to an "exit" point just outside the
  // block (on the inflated edge) and draw a short straight stub to the anchor.
  const exitPoint = (pt: UiPoint): UiPoint => {
    for (const b of blocks) {
      const onLeft = Math.abs(pt.x - b.x) < EPS;
      const onRight = Math.abs(pt.x - (b.x + b.w)) < EPS;
      const withinY = pt.y >= b.y - EPS && pt.y <= b.y + b.h + EPS;
      if (withinY && onLeft) return { x: b.x - opts.pad, y: pt.y };
      if (withinY && onRight) return { x: b.x + b.w + opts.pad, y: pt.y };
    }
    return pt;
  };

  const exits = requests.map((req) => ({
    from: exitPoint(req.from),
    to: exitPoint(req.to),
  }));

  // --- Build candidate grid lines -------------------------------------------
  const xsRaw: number[] = [];
  const ysRaw: number[] = [];
  for (const r of rects) {
    xsRaw.push(r.left, r.right);
    ysRaw.push(r.top, r.bottom);
  }
  for (let i = 0; i < requests.length; i++) {
    xsRaw.push(exits[i].from.x, exits[i].to.x);
    ysRaw.push(requests[i].from.y, requests[i].to.y);
  }

  // Channel lanes inside each inter-column gap: take the distinct block right
  // edges and the next block left edges, and drop evenly spaced lanes between.
  const rights = uniqSorted(rects.map((r) => r.right));
  const lefts = uniqSorted(rects.map((r) => r.left));
  for (const right of rights) {
    // nearest left edge strictly to the right of this right edge
    let nextLeft = Infinity;
    for (const l of lefts) if (l > right + EPS && l < nextLeft) nextLeft = l;
    if (!Number.isFinite(nextLeft)) continue;
    const span = nextLeft - right;
    if (span <= 0) continue;
    for (let i = 1; i <= opts.lanesPerGap; i++) {
      xsRaw.push(right + (span * i) / (opts.lanesPerGap + 1));
    }
  }

  // Outer margins so cables can detour around when a direct path is blocked
  // (e.g. same-column or backward edges).
  const minX = Math.min(...xsRaw);
  const maxX = Math.max(...xsRaw);
  const minY = Math.min(...ysRaw);
  const maxY = Math.max(...ysRaw);
  const margin = 2 * opts.pad + 12;
  xsRaw.push(minX - margin, maxX + margin);
  ysRaw.push(minY - margin, maxY + margin);

  const xs = uniqSorted(xsRaw);
  const ys = uniqSorted(ysRaw);

  const nearestIndex = (values: number[], v: number): number => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < values.length; i++) {
      const d = Math.abs(values[i] - v);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };

  // --- Obstacle test for a single axis-aligned segment ----------------------
  // A segment is blocked if it passes through the *interior* of any block.
  // Travelling exactly along an (inflated) edge is allowed, so cables hug blocks.
  const horizBlocked = (y: number, x0: number, x1: number): boolean => {
    const lo = Math.min(x0, x1);
    const hi = Math.max(x0, x1);
    for (const r of rects) {
      if (r.top + EPS < y && y < r.bottom - EPS && r.left + EPS < hi && lo < r.right - EPS) {
        return true;
      }
    }
    return false;
  };
  const vertBlocked = (x: number, y0: number, y1: number): boolean => {
    const lo = Math.min(y0, y1);
    const hi = Math.max(y0, y1);
    for (const r of rects) {
      if (r.left + EPS < x && x < r.right - EPS && r.top + EPS < hi && lo < r.bottom - EPS) {
        return true;
      }
    }
    return false;
  };

  const used = new Set<string>();
  const segKey = (ax: number, ay: number, bx: number, by: number): string => {
    // undirected key on grid indices
    return ax < bx || (ax === bx && ay <= by)
      ? `${ax},${ay}|${bx},${by}`
      : `${bx},${by}|${ax},${ay}`;
  };

  const results: RoutedCable[] = [];

  for (let ri = 0; ri < requests.length; ri++) {
    const req = requests[ri];
    const exit = exits[ri];
    const startXi = nearestIndex(xs, exit.from.x);
    const startYi = nearestIndex(ys, req.from.y);
    const goalXi = nearestIndex(xs, exit.to.x);
    const goalYi = nearestIndex(ys, req.to.y);

    const path = astar(
      xs,
      ys,
      startXi,
      startYi,
      goalXi,
      goalYi,
      horizBlocked,
      vertBlocked,
      used,
      segKey,
      opts,
    );

    // Build the drawn polyline: real port anchor -> grid path -> real anchor.
    const pts: UiPoint[] = [];
    pts.push({ x: req.from.x, y: req.from.y });
    if (path) {
      for (const [xi, yi] of path) {
        const p = { x: xs[xi], y: ys[yi] };
        const last = pts[pts.length - 1];
        if (Math.abs(last.x - p.x) > EPS || Math.abs(last.y - p.y) > EPS) pts.push(p);
      }
      // mark segments used for lane separation
      for (let i = 1; i < path.length; i++) {
        used.add(
          segKey(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]),
        );
      }
    }
    pts.push({ x: req.to.x, y: req.to.y });

    results.push({ id: req.id, points: simplify(pts) });
  }

  return results;
}

type Dir = 0 | 1 | 2; // 0 = none, 1 = horizontal, 2 = vertical

function astar(
  xs: number[],
  ys: number[],
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  horizBlocked: (y: number, x0: number, x1: number) => boolean,
  vertBlocked: (x: number, y0: number, y1: number) => boolean,
  used: Set<string>,
  segKey: (ax: number, ay: number, bx: number, by: number) => string,
  opts: RouteOptions,
): Array<[number, number]> | null {
  const key = (x: number, y: number, d: Dir) => (x * ys.length + y) * 3 + d;
  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  // Simple binary-heap-free priority via array; graphs here are small.
  const open: Array<{ x: number; y: number; d: Dir; f: number }> = [];
  const push = (x: number, y: number, d: Dir, f: number) => {
    open.push({ x, y, d, f });
  };
  const heuristic = (x: number, y: number) =>
    (Math.abs(xs[x] - xs[gx]) + Math.abs(ys[y] - ys[gy])) * opts.lengthCost;

  const startKey = key(sx, sy, 0);
  gScore.set(startKey, 0);
  push(sx, sy, 0, heuristic(sx, sy));

  while (open.length > 0) {
    // pop lowest f
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    const curKey = key(cur.x, cur.y, cur.d);
    const curG = gScore.get(curKey);
    if (curG === undefined || cur.f - heuristic(cur.x, cur.y) > curG + EPS) continue;

    if (cur.x === gx && cur.y === gy) {
      return reconstruct(cameFrom, curKey, xs.length, ys.length);
    }

    // neighbors: step to adjacent grid line in each of 4 directions
    const tryStep = (nx: number, ny: number, stepDir: Dir) => {
      if (nx < 0 || nx >= xs.length || ny < 0 || ny >= ys.length) return;
      if (stepDir === 1) {
        if (horizBlocked(ys[cur.y], xs[cur.x], xs[nx])) return;
      } else {
        if (vertBlocked(xs[cur.x], ys[cur.y], ys[ny])) return;
      }
      const len =
        (Math.abs(xs[nx] - xs[cur.x]) + Math.abs(ys[ny] - ys[cur.y])) *
        opts.lengthCost;
      const turn = cur.d !== 0 && cur.d !== stepDir ? opts.turnCost : 0;
      const shared = used.has(segKey(cur.x, cur.y, nx, ny)) ? opts.sharedCost : 0;
      const tentative = curG + len + turn + shared;
      const nKey = key(nx, ny, stepDir);
      const prev = gScore.get(nKey);
      if (prev === undefined || tentative < prev - EPS) {
        gScore.set(nKey, tentative);
        cameFrom.set(nKey, curKey);
        push(nx, ny, stepDir, tentative + heuristic(nx, ny));
      }
    };

    tryStep(cur.x + 1, cur.y, 1);
    tryStep(cur.x - 1, cur.y, 1);
    tryStep(cur.x, cur.y + 1, 2);
    tryStep(cur.x, cur.y - 1, 2);
  }

  return null;
}

function reconstruct(
  cameFrom: Map<number, number>,
  endKey: number,
  nx: number,
  ny: number,
): Array<[number, number]> {
  void nx;
  const decode = (k: number): [number, number] => {
    const cell = Math.floor(k / 3);
    return [Math.floor(cell / ny), cell % ny];
  };
  const path: Array<[number, number]> = [];
  let k: number | undefined = endKey;
  while (k !== undefined) {
    path.push(decode(k));
    k = cameFrom.get(k);
  }
  path.reverse();
  return path;
}

/** Drop collinear intermediate points so the SVG path is compact. */
function simplify(pts: UiPoint[]): UiPoint[] {
  if (pts.length <= 2) return pts;
  const out: UiPoint[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const collinear =
      (Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS) ||
      (Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS);
    if (!collinear) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
