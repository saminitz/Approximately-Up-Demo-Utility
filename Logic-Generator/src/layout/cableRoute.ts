// Game-grid cable router for the .bp export.
//
// Each edge is an INDEPENDENT point-to-point chain (source output port -> target
// input port). Cables may not share a cell with a block or with another cable at
// the same level. Where a cable must cross another cable — or where going
// straight over a block is cheaper than detouring around it — the cable BRIDGES:
// it rises one grid-Y level, spans the crossed cells at y+1, and descends
// (verified shape from `1b66fd4d… Cable Bridge.bp`). Other edges' port cells
// stay hard obstacles.
//
// `_gt.rot` is cosmetic (connectivity comes from cell adjacency, not orientation)
// and the game derives it from the 3D mesh in a way not recoverable from cell
// positions — so flat cells use the dominant-value table in `cableShapes.ts` and
// bridge cells use the verified arch rots below. Positions are exact; rot is
// best-effort.

import type { Cell } from "./layout";
import {
  bridgeRampRot,
  cableMetaFromDirs,
  cornerRot,
  SPAN_ROT,
  type Dir3,
  type PlaneDir,
} from "./cableShapes";

export interface RouteEdge {
  id: string;
  /** Source output-port cell (just outside the source block). */
  start: Cell;
  /** Target input-port cell (just outside the target block). */
  end: Cell;
  /** Verified `_gt.rot` for the first cable cell at each port (5 west / 0 east). */
  startRot: number;
  endRot: number;
  /** Direction from the port cell into its block, from the port offset. Needed
   * for tall router/remap blocks whose body isn't found by a footprint scan. */
  startInto?: PlaneDir;
  endInto?: PlaneDir;
}

export interface RoutedCableCell extends Cell {
  rot: number;
  trailing: number;
}

export interface RouteResult {
  cells: RoutedCableCell[];
  /** Flat (y0) A* path per edge id, for callers that need the 2D route. */
  flatPaths: Map<string, Cell[]>;
  /** Per-edge ordered 3D cable cells (incl. bridge foot/top/span), NOT globally
   * deduped — so a renderer can derive each cable's own arm connectivity without
   * falsely linking to a parallel cable in an adjacent cell. */
  chains: Map<string, RoutedCableCell[]>;
  /** Edges the router could not path (should be empty for laid-out graphs). */
  failed: string[];
}

const key = (x: number, z: number) => `${x},${z}`;
const cellKey = (c: Cell) => `${c.x},${c.y},${c.z}`;
const key3 = (x: number, y: number, z: number) => `${x},${y},${z}`;

const opposite = (d: PlaneDir): PlaneDir =>
  d === "+X" ? "-X" : d === "-X" ? "+X" : d === "+Z" ? "-Z" : "+Z";

const PLANE_DIRS: ReadonlyArray<readonly [PlaneDir, number, number]> = [
  ["+X", 1, 0],
  ["-X", -1, 0],
  ["+Z", 0, 1],
  ["-Z", 0, -1],
];

/** Direction from a port cell toward the block it connects to (the one adjacent
 * footprint cell), or null if none is adjacent. */
function intoBlockDir(c: Cell, blocked: Set<string>): PlaneDir | null {
  for (const [d, dx, dz] of PLANE_DIRS) {
    if (blocked.has(key(c.x + dx, c.z + dz))) return d;
  }
  return null;
}

type Dir = 0 | 1 | 2 | 3; // +X -X +Z -Z
const DX = [1, -1, 0, 0];
const DZ = [0, 0, 1, -1];
const axisOfDir = (d: Dir): "X" | "Z" => (d < 2 ? "X" : "Z");

interface AStarOpts {
  turnCost: number;
  bridgeCost: number;
  /** Per-cell cost of arching over a block footprint (vs detouring around). */
  blockCost: number;
}

/**
 * A* over integer (x,z) cells. `blocked` cells (other edges' ports) are hard
 * obstacles. `blocks` cells (block footprints) and cable-occupied cells are
 * passable only as a straight crossing at y+1 (a bridge) — perpendicular-only
 * over cables — at `blockCost`/`bridgeCost`. Returns the cell path
 * (start..end inclusive) or null.
 */
function astar(
  start: Cell,
  end: Cell,
  blocked: Set<string>,
  blocks: Set<string>,
  occupied: Map<string, "X" | "Z">,
  bridged: Set<string>,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  opts: AStarOpts,
): Cell[] | null {
  const H = bounds.maxZ - bounds.minZ + 1;
  const idx = (x: number, z: number, d: number) =>
    ((x - bounds.minX) * H + (z - bounds.minZ)) * 5 + d;
  const g = new Map<number, number>();
  const from = new Map<number, number>();
  const open: Array<{ x: number; z: number; d: number; f: number }> = [];
  const h = (x: number, z: number) => Math.abs(x - end.x) + Math.abs(z - end.z);

  const s0 = idx(start.x, start.z, 4);
  g.set(s0, 0);
  open.push({ x: start.x, z: start.z, d: 4, f: h(start.x, start.z) });

  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    const ck = idx(cur.x, cur.z, cur.d);
    const cg = g.get(ck);
    if (cg === undefined || cur.f - h(cur.x, cur.z) > cg + 1e-6) continue;
    if (cur.x === end.x && cur.z === end.z) {
      const path: Cell[] = [];
      let k: number | undefined = ck;
      while (k !== undefined) {
        const cell = Math.floor(k / 5);
        path.push({ x: bounds.minX + Math.floor(cell / H), y: start.y, z: bounds.minZ + (cell % H) });
        k = from.get(k);
      }
      return path.reverse();
    }
    // If standing on a crossing cell (over a cable or a block), only continue straight.
    const curK = key(cur.x, cur.z);
    const elevated =
      (occupied.has(curK) || blocks.has(curK)) && !(cur.x === start.x && cur.z === start.z);
    for (let nd = 0 as Dir; nd < 4; nd++) {
      if (elevated && cur.d !== 4 && nd !== cur.d) continue; // no turn on a bridge
      const nx = cur.x + DX[nd];
      const nz = cur.z + DZ[nd];
      if (nx < bounds.minX || nx > bounds.maxX || nz < bounds.minZ || nz > bounds.maxZ) continue;
      const nk = key(nx, nz);
      const isEnd = nx === end.x && nz === end.z;
      if (blocked.has(nk) && !isEnd) continue; // another edge's port: hard
      let stepCost = 1;
      const occAxis = occupied.get(nk);
      let crossing = false;
      if (blocks.has(nk) && !isEnd) {
        // Span the block at y+1 (any direction, but straight while on it).
        // y+1 must be free for our span here and for the up-ramp we'd need on cur.
        if (bridged.has(nk) || bridged.has(curK)) continue;
        stepCost += opts.blockCost;
        crossing = true;
      } else if (occAxis !== undefined && !isEnd) {
        // May only cross perpendicular to the existing cable, moving straight.
        if (occAxis === axisOfDir(nd)) continue; // parallel overlap forbidden
        if (bridged.has(nk) || bridged.has(curK)) continue;
        stepCost += opts.bridgeCost;
        crossing = true;
      }
      // Leaving a crossing run: nk is our down-ramp, so its y+1 must be free too.
      if (elevated && !crossing && bridged.has(nk)) continue;
      if (cur.d !== 4 && cur.d !== nd) stepCost += opts.turnCost;
      const tentative = cg + stepCost;
      const nkey = idx(nx, nz, nd);
      if (tentative < (g.get(nkey) ?? Infinity)) {
        g.set(nkey, tentative);
        from.set(nkey, ck);
        open.push({ x: nx, z: nz, d: nd, f: tentative + h(nx, nz) });
      }
    }
  }
  return null;
}

/**
 * Route every edge, bridging over blocks and previously-placed cables where
 * that beats detouring around them. Edges are routed in the given order.
 */
export function route3DCables(
  edges: RouteEdge[],
  blockCells: Iterable<Cell>,
  // ponytail: blockCost 8 hand-tuned — a 2-cell arch (16) loses to an easy
  // detour (~8-10) but wins against anything longer; retune if circuits look
  // too archy or too sprawling.
  opts: AStarOpts = { turnCost: 3, bridgeCost: 60, blockCost: 8 },
): RouteResult {
  const blocked = new Set<string>();
  for (const c of blockCells) blocked.add(key(c.x, c.z));

  // Occupied cable cells -> axis the cable runs there (for perpendicular-crossing test).
  const occupied = new Map<string, "X" | "Z">();
  // (x,z) whose y+1 level is taken by an earlier bridge (span or ramp top). A
  // second arch may not cross or ramp there — it must detour.
  const bridged = new Set<string>();
  const emitted = new Set<string>(); // 3D cell keys already emitted (dedupe shared ports)
  const out: RoutedCableCell[] = [];
  const flatPaths = new Map<string, Cell[]>();
  const chains = new Map<string, RoutedCableCell[]>();
  const failed: string[] = [];

  // Grid bounds from all endpoints + a margin so detours have room.
  const xs = edges.flatMap((e) => [e.start.x, e.end.x]);
  const zs = edges.flatMap((e) => [e.start.z, e.end.z]);
  for (const c of blockCells) {
    xs.push(c.x);
    zs.push(c.z);
  }
  const M = 4;
  const bounds = {
    minX: Math.min(...xs) - M,
    maxX: Math.max(...xs) + M,
    minZ: Math.min(...zs) - M,
    maxZ: Math.max(...zs) + M,
  };

  const push = (c: RoutedCableCell) => {
    const k = cellKey(c);
    if (emitted.has(k)) return;
    emitted.add(k);
    out.push(c);
  };

  // Every edge endpoint is a block port; no route may pass through another
  // connection's port (e.g. two inputs stacked on the same face).
  const allPorts = new Set<string>();
  for (const e of edges) {
    allPorts.add(key(e.start.x, e.start.z));
    allPorts.add(key(e.end.x, e.end.z));
  }

  for (const e of edges) {
    const reserved = new Set<string>();
    for (const p of allPorts) reserved.add(p);
    reserved.delete(key(e.start.x, e.start.z));
    reserved.delete(key(e.end.x, e.end.z));
    const path = astar(e.start, e.end, reserved, blocked, occupied, bridged, bounds, opts);
    if (!path) {
      failed.push(e.id);
      continue;
    }
    flatPaths.set(e.id, path);
    const y = e.start.y;
    const n = path.length;

    // A run of consecutive crossings becomes ONE bridge: rise on the cell before
    // the run, span the whole run at y+1, descend on the cell after it. A ramp
    // cell owns both its y0 foot and y+1 top; the span cells own only y+1 (the
    // crossed cables keep their y0). Ramp rots come from the real bridge table by
    // 3D neighbor set, so bridge length and direction are dynamic. When a crossing
    // sits right next to a port (index 1 or n-2) the port cell itself becomes the
    // riser — its foot connects into the block and up.
    const role: Array<"flat" | "up" | "span" | "down"> = new Array(n).fill("flat");
    for (let i = 1; i < n - 1; i++) {
      const k = key(path[i].x, path[i].z);
      if (occupied.has(k) || blocked.has(k)) role[i] = "span"; // over a cable or a block
    }
    // Descending between two crossings needs a down-ramp AND an up-ramp cell.
    // A gap of ≤2 flat cells leaves no level ground between them (gap 1 can't
    // even fit both — it would emit a down-ramp whose foot dangles under the
    // next span), so the bridge stays at y+1 and spans the free cells too —
    // their y0 stays empty. Holds through a turn in the gap as well: the arch
    // just corners at y+1. The A* ramp checks already verified y+1 is free on
    // every cell of such a short gap.
    for (let i = 1; i < n - 1; i++) {
      if (role[i] !== "flat" || role[i - 1] !== "span") continue;
      let j = i;
      while (j < n - 1 && role[j] === "flat") j++;
      if (role[j] === "span" && j - i <= 2)
        for (let k = i; k < j; k++) role[k] = "span";
      i = j - 1;
    }
    for (let i = 1; i < n; i++) {
      if (role[i] === "span" && role[i - 1] === "flat") role[i - 1] = "up";
      else if (role[i] === "flat" && role[i - 1] === "span") role[i] = "down";
    }

    // Emit this edge's 3D cells with their role, THEN assign each cell's rot from
    // its actual own-chain 3D neighbor set. A per-edge chain is a simple path, so
    // every cell has at most two chain-neighbors — the true straight/corner/ramp
    // topology, not a guess from the assumed travel direction. (The earlier
    // `fwd`-based ramp rots broke wherever a ramp sat at a turn or a terminal port,
    // where the real horizontal arm differs from the path's forward step.)
    type Kind = "flat" | "port" | "span" | "foot" | "top";
    const entries: Array<{ x: number; y: number; z: number; kind: Kind; isEnd: boolean }> = [];
    for (let i = 0; i < n; i++) {
      const c = path[i];
      const isEnd = i === 0 || i === n - 1;
      if (role[i] === "span") entries.push({ x: c.x, y: y + 1, z: c.z, kind: "span", isEnd });
      else if (role[i] === "up" || role[i] === "down") {
        entries.push({ x: c.x, y, z: c.z, kind: "foot", isEnd });
        entries.push({ x: c.x, y: y + 1, z: c.z, kind: "top", isEnd });
      } else entries.push({ x: c.x, y, z: c.z, kind: isEnd ? "port" : "flat", isEnd });
    }
    const chain: RoutedCableCell[] = [];
    const own = new Set(entries.map((en) => cellKey(en)));
    const CHAIN_DIRS: ReadonlyArray<readonly [Dir3, number, number, number]> = [
      ["+X", 1, 0, 0], ["-X", -1, 0, 0], ["+Z", 0, 0, 1], ["-Z", 0, 0, -1],
      ["+Y", 0, 1, 0], ["-Y", 0, -1, 0],
    ];
    for (const en of entries) {
      const nb: Dir3[] = [];
      for (const [d, dx, dy, dz] of CHAIN_DIRS)
        if (own.has(key3(en.x + dx, en.y + dy, en.z + dz))) nb.push(d);
      const horiz = nb.filter((d) => d !== "+Y" && d !== "-Y") as PlaneDir[];
      // Endpoints know their block side from the port offset (reliable even for
      // tall routers); interior/fallback uses the footprint adjacency scan.
      const edgeInto = en.isEnd ? (en === entries[0] ? e.startInto : e.endInto) : undefined;
      const into = edgeInto ?? intoBlockDir({ x: en.x, y: en.y, z: en.z }, blocked);

      let rot: number;
      let trailing: number;
      if (en.kind === "foot" || en.kind === "top") {
        // Ramp: one horizontal arm (own-chain, or into the block at a terminal
        // foot) plus the vertical arm to its foot/top partner. Rot from the real
        // bridge table by that 3D neighbor set.
        const vert: Dir3 = en.kind === "foot" ? "+Y" : "-Y";
        const arm = horiz[0] ?? into;
        rot = arm ? bridgeRampRot([arm, vert]) : bridgeRampRot(nb);
        trailing = 1;
      } else if (en.kind === "span") {
        // A gap cell kept at y+1 through a turn is an elevated corner, not a
        // straight span. Flat corner rots — the arch's own cosmetic frame at
        // y+1 is unverified for corners, and rot is best-effort anyway.
        if (horiz.length === 2 && horiz[0].includes("X") !== horiz[1].includes("X")) {
          rot = cornerRot(horiz);
          trailing = 1;
        } else {
          const axis: "X" | "Z" = horiz.some((d) => d.includes("X")) ? "X" : "Z";
          rot = SPAN_ROT[axis];
          trailing = 0;
        }
      } else if (en.kind === "port") {
        // Port stub: one cable arm + the block. Corner INTO the block when the
        // cable turns there, else the verified straight stub (5/0 ground truth).
        const cableDir = horiz[0] ?? null;
        const fallback = en === entries[0] ? e.startRot : e.endRot;
        if (into && cableDir && cableDir !== opposite(into)) {
          rot = cornerRot([into, cableDir]);
          trailing = 1;
        } else {
          rot = fallback;
          trailing = 0;
        }
      } else {
        const meta = cableMetaFromDirs(horiz);
        rot = meta.rot;
        trailing = meta.trailing;
      }
      const rc: RoutedCableCell = { x: en.x, y: en.y, z: en.z, rot, trailing };
      push(rc);
      chain.push(rc);
    }
    chains.set(e.id, chain);
    for (const en of entries) if (en.y > y) bridged.add(key(en.x, en.z));
    // Register this cable's flat cells as occupied (bridged spans stay at y+1;
    // crossed cells keep their owner's axis, and spanned-over gap cells have
    // no y0 presence at all — another cable may pass beneath).
    for (let i = 0; i < path.length; i++) {
      const c = path[i];
      if (role[i] === "span" || occupied.has(key(c.x, c.z))) continue;
      const a = i > 0 ? path[i - 1] : path[i + 1];
      const b = i < path.length - 1 ? path[i + 1] : path[i - 1];
      const axis: "X" | "Z" = (a && a.z === c.z) || (b && b.z === c.z) ? "X" : "Z";
      occupied.set(key(c.x, c.z), axis);
    }
  }

  return { cells: out, flatPaths, chains, failed };
}
