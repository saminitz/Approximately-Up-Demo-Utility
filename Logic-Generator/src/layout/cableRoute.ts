// Game-grid cable router for the .bp export.
//
// Each edge is an INDEPENDENT point-to-point chain (source output port -> target
// input port). Cables may not share a cell with a block or with another cable.
// Where two cables must cross, the later one BRIDGES over the earlier: it rises
// one grid-Y level, spans the crossed cell at y+1, and descends (verified shape
// from `1b66fd4d… Cable Bridge.bp`).
//
// `_gt.rot` is cosmetic (connectivity comes from cell adjacency, not orientation)
// and the game derives it from the 3D mesh in a way not recoverable from cell
// positions — so flat cells use the dominant-value table in `cableShapes.ts` and
// bridge cells use the verified arch rots below. Positions are exact; rot is
// best-effort.

import type { Cell } from "./layout";
import {
  cableMetaFromDirs,
  cornerRot,
  dirBetween,
  SPAN_ROT,
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
}

export interface RoutedCableCell extends Cell {
  rot: number;
  trailing: number;
}

export interface RouteResult {
  cells: RoutedCableCell[];
  /** Flat (y0) A* path per edge id, for callers that need the 2D route. */
  flatPaths: Map<string, Cell[]>;
  /** Edges the router could not path (should be empty for laid-out graphs). */
  failed: string[];
}

const key = (x: number, z: number) => `${x},${z}`;
const cellKey = (c: Cell) => `${c.x},${c.y},${c.z}`;

const opposite = (d: PlaneDir): PlaneDir =>
  d === "+X" ? "-X" : d === "-X" ? "+X" : d === "+Z" ? "-Z" : "+Z";

type Dir = 0 | 1 | 2 | 3; // +X -X +Z -Z
const DX = [1, -1, 0, 0];
const DZ = [0, 0, 1, -1];
const axisOfDir = (d: Dir): "X" | "Z" => (d < 2 ? "X" : "Z");

interface AStarOpts {
  turnCost: number;
  bridgeCost: number;
}

/**
 * A* over integer (x,z) cells. Block cells are hard obstacles. Cable-occupied
 * cells are passable only as a straight perpendicular crossing (a bridge), at
 * `bridgeCost`. Returns the cell path (start..end inclusive) or null.
 */
function astar(
  start: Cell,
  end: Cell,
  blocked: Set<string>,
  occupied: Map<string, "X" | "Z">,
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
    // If standing on an occupied (crossing) cell, only continue straight.
    const onOccupied = occupied.has(key(cur.x, cur.z)) && !(cur.x === start.x && cur.z === start.z);
    for (let nd = 0 as Dir; nd < 4; nd++) {
      if (onOccupied && cur.d !== 4 && nd !== cur.d) continue; // no turn on a bridge
      const nx = cur.x + DX[nd];
      const nz = cur.z + DZ[nd];
      if (nx < bounds.minX || nx > bounds.maxX || nz < bounds.minZ || nz > bounds.maxZ) continue;
      const nk = key(nx, nz);
      const isEnd = nx === end.x && nz === end.z;
      if (blocked.has(nk) && !isEnd) continue;
      let stepCost = 1;
      const occAxis = occupied.get(nk);
      if (occAxis !== undefined && !isEnd) {
        // May only cross perpendicular to the existing cable, moving straight.
        if (occAxis === axisOfDir(nd)) continue; // parallel overlap forbidden
        stepCost += opts.bridgeCost;
      }
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

function neighborDirs(path: Cell[], i: number): PlaneDir[] {
  const dirs: PlaneDir[] = [];
  if (i > 0) {
    const d = dirBetween(path[i], path[i - 1]);
    if (d) dirs.push(d);
  }
  if (i < path.length - 1) {
    const d = dirBetween(path[i], path[i + 1]);
    if (d) dirs.push(d);
  }
  return dirs;
}

/**
 * Route every edge, avoiding blocks and previously-placed cables, bridging where
 * a crossing is unavoidable. Edges are routed in the given order.
 */
export function route3DCables(
  edges: RouteEdge[],
  blockCells: Iterable<Cell>,
  opts: AStarOpts = { turnCost: 3, bridgeCost: 60 },
): RouteResult {
  const blocked = new Set<string>();
  for (const c of blockCells) blocked.add(key(c.x, c.z));

  // Occupied cable cells -> axis the cable runs there (for perpendicular-crossing test).
  const occupied = new Map<string, "X" | "Z">();
  const emitted = new Set<string>(); // 3D cell keys already emitted (dedupe shared ports)
  const out: RoutedCableCell[] = [];
  const flatPaths = new Map<string, Cell[]>();
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
    const reserved = new Set(blocked);
    for (const p of allPorts) reserved.add(p);
    reserved.delete(key(e.start.x, e.start.z));
    reserved.delete(key(e.end.x, e.end.z));
    const path = astar(e.start, e.end, reserved, occupied, bounds, opts);
    if (!path) {
      failed.push(e.id);
      continue;
    }
    flatPaths.set(e.id, path);
    const y = e.start.y;
    for (let i = 0; i < path.length; i++) {
      const c = path[i];
      const crossing = occupied.has(key(c.x, c.z));
      if (crossing && i > 0 && i < path.length - 1) {
        // Bridge over this cell: arch across prev..c..next. Each ramp cell's rot
        // comes from its 3D neighbor set (the verified corner table), so all four
        // travel directions are handled correctly.
        const prev = path[i - 1];
        const next = path[i + 1];
        const d = dirBetween(prev, c)!; // travel direction across the bridge
        const back = opposite(d);
        const axis: "X" | "Z" = d.includes("X") ? "X" : "Z";
        // prev riser: foot {back, +Y}, top {forward, -Y}
        push({ ...prev, y, rot: cornerRot([back, "+Y"]), trailing: 1 });
        push({ ...prev, y: y + 1, rot: cornerRot([d, "-Y"]), trailing: 1 });
        // span at y+1 (elevated straight)
        push({ ...c, y: y + 1, rot: SPAN_ROT[axis], trailing: 0 });
        // next riser: top {back, -Y}, foot {forward, +Y}
        push({ ...next, y: y + 1, rot: cornerRot([back, "-Y"]), trailing: 1 });
        push({ ...next, y, rot: cornerRot([d, "+Y"]), trailing: 1 });
        continue; // do NOT place a y0 cell on the crossed cable's cell
      }
      // Flat cell: rot from port override (endpoints) or dominant shape table.
      let rot: number;
      let trailing: number;
      if (i === 0) {
        rot = e.startRot;
        trailing = 0;
      } else if (i === path.length - 1) {
        rot = e.endRot;
        trailing = 0;
      } else {
        const meta = cableMetaFromDirs(neighborDirs(path, i));
        rot = meta.rot;
        trailing = meta.trailing;
      }
      push({ ...c, y, rot, trailing });
    }
    // Register this cable's flat cells as occupied (bridged spans stay at y+1,
    // so the crossed cell remains owned by the earlier cable only).
    for (let i = 0; i < path.length; i++) {
      const c = path[i];
      if (occupied.has(key(c.x, c.z))) continue; // crossed cell keeps its owner's axis
      const a = i > 0 ? path[i - 1] : path[i + 1];
      const b = i < path.length - 1 ? path[i + 1] : path[i - 1];
      const axis: "X" | "Z" = (a && a.z === c.z) || (b && b.z === c.z) ? "X" : "Z";
      occupied.set(key(c.x, c.z), axis);
    }
  }

  return { cells: out, flatPaths, failed };
}
