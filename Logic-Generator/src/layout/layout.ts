import type { BlockGraph, BlockNode } from "../compiler/graph";
import { inputPortCell, inputPortRot, outputPortCell, outputPortRot } from "../catalog/ports";
import type { CableCell } from "./cableShapes";
import { route3DCables, type RouteEdge } from "./cableRoute";

export interface Cell {
  x: number;
  y: number;
  z: number;
}

export interface CableRoute {
  edgeId: string;
  fromBlock: string;
  toBlock: string;
  cells: Cell[]; // grid path from source port to target port
}

export interface LaidOutGraph {
  nodes: BlockNode[]; // same nodes, with `.cell` assigned
  edges: BlockGraph["edges"];
  routes: CableRoute[];
  /** Cable cells with per-cell shape/type/trailing metadata. */
  cableCells: CableCell[];
  inputs: string[];
  outputs: string[];
  bounds: { cols: number; rows: number; maxX: number; maxZ: number };
}

export interface LayoutOptions {
  /** Grid cells between successive layers (leaves room for cable channels). */
  colStep: number;
  /** Grid cells between rows within a layer. */
  rowStep: number;
  /** Grid origin (in cells). */
  originX: number;
  /** Constant vertical coordinate of the circuit plane (game Y / up). */
  originY: number;
  originZ: number;
}

/**
 * Base cell offset that places the generated circuit in the same grid region real
 * authored controllers occupy (GT_REPORT_v2.md §4).
 *
 * Signal blocks in PD Target Distance spread on X and Z with Y held near 24
 * (the horizontal circuit plane). We anchor at the low corner of that cluster.
 */
export const INTERIOR_BASE_CELL = { x: 200, y: 24, z: 192 } as const;

/** 2×2 block footprint offsets (dx, dz) from the anchor (min corner). */
const FOOTPRINT_2X2: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];

export const DEFAULT_LAYOUT: LayoutOptions = {
  colStep: 6,
  rowStep: 4,
  originX: INTERIOR_BASE_CELL.x,
  originY: INTERIOR_BASE_CELL.y,
  originZ: INTERIOR_BASE_CELL.z,
};

/**
 * Layered, topological left-to-right layout on the game's X-Z circuit plane
 * (Y constant). Cables are routed as orthogonal Manhattan paths between layers.
 */
export function layoutGraph(
  graph: BlockGraph,
  opts: LayoutOptions = DEFAULT_LAYOUT,
): LaidOutGraph {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const n of graph.nodes) {
    preds.set(n.id, []);
    succs.set(n.id, []);
  }
  for (const e of graph.edges) {
    succs.get(e.from.blockId)!.push(e.to.blockId);
    preds.get(e.to.blockId)!.push(e.from.blockId);
  }

  // --- Layer assignment (longest path from sources) --------------------------
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const computeLayer = (id: string): number => {
    const cached = layer.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // guard against unexpected cycles
    visiting.add(id);
    const ps = preds.get(id)!;
    let L = 0;
    for (const p of ps) L = Math.max(L, computeLayer(p) + 1);
    visiting.delete(id);
    layer.set(id, L);
    return L;
  };
  for (const n of graph.nodes) computeLayer(n.id);

  // Force output terminals to the last layer for a tidy right edge.
  const maxLayer = Math.max(0, ...graph.nodes.map((n) => layer.get(n.id)!));
  for (const n of graph.nodes) {
    if (n.op === "output") layer.set(n.id, maxLayer);
  }

  // --- Group by layer --------------------------------------------------------
  const layers: string[][] = [];
  for (const n of graph.nodes) {
    const L = layer.get(n.id)!;
    (layers[L] ??= []).push(n.id);
  }
  for (let L = 0; L < layers.length; L++) layers[L] ??= [];

  // --- Ordering within layers: one barycenter pass to reduce crossings -------
  const order = new Map<string, number>();
  layers.forEach((ids) => ids.forEach((id, i) => order.set(id, i)));
  for (let L = 1; L < layers.length; L++) {
    const ids = layers[L];
    const bary = (id: string): number => {
      const ps = preds.get(id)!;
      if (ps.length === 0) return order.get(id)!;
      let s = 0;
      for (const p of ps) s += order.get(p)!;
      return s / ps.length;
    };
    ids.sort((a, b) => bary(a) - bary(b));
    ids.forEach((id, i) => order.set(id, i));
  }

  // --- Assign grid cells (X = layers, Z = rows, Y = plane height) ------------
  let maxRows = 0;
  layers.forEach((ids, L) => {
    maxRows = Math.max(maxRows, ids.length);
    ids.forEach((id, row) => {
      const node = byId.get(id)!;
      node.cell = {
        x: opts.originX + L * opts.colStep,
        y: opts.originY,
        z: opts.originZ + row * opts.rowStep,
      };
    });
  });

  // --- Route cables on the X-Z plane -----------------------------------------
  // Each edge is an independent chain routed around blocks and other cables;
  // crossings bridge over (see cableRoute.ts). Port cells carry the verified
  // first-cable rot (Block List): 5 on the west face, 0 on the east face.
  const routeEdges: RouteEdge[] = graph.edges.map((e) => {
    const from = byId.get(e.from.blockId)!;
    const to = byId.get(e.to.blockId)!;
    const start = outputPortCell(from.op, from.cell!, e.from.port);
    const end = inputPortCell(to.op, to.cell!, e.to.port);
    return {
      id: e.id,
      start: { ...start, y: opts.originY },
      end: { ...end, y: opts.originY },
      startRot: outputPortRot(from.op, e.from.port),
      endRot: inputPortRot(to.op, e.to.port),
    };
  });

  // Blocks occupy a 2×2 footprint (anchor is the min corner); the router must
  // treat every footprint cell as an obstacle, not just the anchor.
  // ponytail: 2×2 covers all arithmetic/io/sensor blocks. The "2 size" router/
  // remap blocks are 2×4 — widen their footprint once a 2×4 size demo confirms it.
  const blockCells = graph.nodes.flatMap((n) =>
    n.cell
      ? FOOTPRINT_2X2.map(([dx, dz]) => ({ x: n.cell!.x + dx, y: n.cell!.y, z: n.cell!.z + dz }))
      : [],
  );
  const { cells: cableCells, flatPaths } = route3DCables(routeEdges, blockCells);

  const routes: CableRoute[] = graph.edges.map((e) => ({
    edgeId: e.id,
    fromBlock: e.from.blockId,
    toBlock: e.to.blockId,
    cells: flatPaths.get(e.id) ?? [],
  }));

  const cols = layers.length;
  const maxX = opts.originX + (cols - 1) * opts.colStep + 1;
  const maxZ = opts.originZ + (maxRows - 1) * opts.rowStep + 1;

  return {
    nodes: graph.nodes,
    edges: graph.edges,
    routes,
    cableCells,
    inputs: graph.inputs,
    outputs: graph.outputs,
    bounds: { cols, rows: maxRows, maxX, maxZ },
  };
}
