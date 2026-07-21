// Dense placement on the X-Z circuit plane.
//
// The objective is FEWEST CABLE CELLS, not smallest bounding box. Four ideas
// over the layered grid:
//  1. ABUTMENT FUSION — a producer whose +X output face aligns with a consumer's
//     -X input face is placed touching it. The game connects abutted ports
//     directly, so the edge needs no cable at all.
//  2. CONNECTIVITY ORDER — chains are packed in DFS order over the chain graph,
//     so a producer and its consumers land in adjacent shelf slots instead of
//     wherever topo depth happened to scatter them.
//  3. SHELF PACKING with Y-axis rotation — fused chains are packed onto shelves
//     inside a box of the current aspect; odd shelves are flipped 180° and fill
//     east→west (serpentine), and lone source blocks turn 90° toward far
//     consumers so cables leave on the short side.
//  4. SHAPE SEARCH — the whole pack+route runs once per (gap, aspect, order)
//     candidate and the cheapest CABLING wins, under a wall-clock budget. A
//     tighter box is not a shorter circuit: squeezed channels force the router
//     to detour, and the detours cost more cells than the spread saves.
//
// Game constraint: logic blocks snap to a 2x grid — every block anchor keeps
// even X and Z (fusion offsets, chain normalization, and shelf origins are all
// parity-guarded). Cables live on the fine 1x grid.

import type { BlockGraph, BlockNode, Edge } from "../compiler/graph";
import {
  footprintCellsForOp,
  footprintForOp,
  inputPortCell,
  inputPortInto,
  inputPortRot,
  outputPortCell,
  outputPortInto,
  outputPortRot,
} from "../catalog/ports";
import { ROT_LOGIC, yawRot } from "../serializer/rotations";
import { route3DCables, type RouteEdge, type RouteResult } from "./cableRoute";
import {
  INTERIOR_BASE_CELL,
  layoutGraph,
  type CableRoute,
  type Cell,
  type LaidOutGraph,
} from "./layout";

/** Width biases of the packed box to try (>1 = wider than tall), best guess
 * first so a budget cutoff still lands on a sane shape. */
const ASPECTS = [1.3, 1.0, 1.8, 0.8, 2.5];
/** Channel widths to try, in cells between packed chains. */
const GAPS = [1, 2, 3, 4];
/** Shape-search wall clock. One A* sweep is ~2s on a 100-block circuit and the
 * grid is 40 shapes, so an unbounded search freezes the UI for over a minute.
 * The budget is checked between shapes, so the first shape always completes and
 * there is always a result. Shapes are ordered best-guess-first for that reason.
 * ponytail: fixed budget, not adaptive — make it an option only if someone
 * actually wants to trade a slow generate for a tighter circuit. */
const SEARCH_BUDGET_MS = 2000;

const key = (x: number, z: number) => `${x},${z}`;
const ZERO = { x: 0, y: 0, z: 0 };

interface ChainBlock {
  node: BlockNode;
  /** Chain-local anchor. */
  x: number;
  z: number;
  turns: number;
}

interface Chain {
  blocks: ChainBlock[];
  /** Bbox over footprint cells ∪ unfused used port cells, normalized to (0,0). */
  w: number;
  h: number;
  depth: number;
  hasOutput: boolean;
}

export function layoutDense(graph: BlockGraph): LaidOutGraph {
  if (graph.nodes.length === 0) return layoutGraph(graph);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const originY = INTERIOR_BASE_CELL.y;

  // --- Topo depth (longest path from sources), as in layoutGraph -------------
  const preds = new Map<string, string[]>();
  for (const n of graph.nodes) preds.set(n.id, []);
  for (const e of graph.edges) preds.get(e.to.blockId)!.push(e.from.blockId);
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id);
    let d = 0;
    for (const p of preds.get(id)!) d = Math.max(d, depthOf(p) + 1);
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const n of graph.nodes) depthOf(n.id);

  // --- Edge indexes ----------------------------------------------------------
  const inEdges = new Map<string, Edge[]>();
  const outEdges = new Map<string, Edge[]>();
  const outByPort = new Map<string, Edge[]>();
  for (const n of graph.nodes) {
    inEdges.set(n.id, []);
    outEdges.set(n.id, []);
  }
  for (const e of graph.edges) {
    inEdges.get(e.to.blockId)!.push(e);
    outEdges.get(e.from.blockId)!.push(e);
    const k = `${e.from.blockId}:${e.from.port}`;
    (outByPort.get(k) ?? outByPort.set(k, []).get(k)!).push(e);
  }

  // --- Phase A: abutment fusion ---------------------------------------------
  // Greedy over edges in topo order: fuse producer→consumer when the +X output
  // face meets the -X input face and the involved outputs feed nothing else
  // (their port cells get buried under the consumer). ALL parallel edges
  // between the pair fuse (or fail) together — one abutment connects every
  // port pair at once, so they must all align under the same even z-shift.
  // A fusion is only accepted if every OTHER
  // used port along the whole resulting chain stays outside the chain's
  // footprints AND keeps at least one free orthogonal neighbor — a port walled
  // in by its own chain (footprints + reserved sibling ports) can never be
  // cabled, no matter how far apart the chains are packed. Each block joins at
  // most one link per side, so fusions form linear runs.
  const fused = new Set<string>();
  const fusedNext = new Map<string, Edge>();
  const fusedPrev = new Map<string, Edge>();

  /** Blocks of p's chain (walking fused predecessors), p at (0,0). */
  const chainBehind = (p: BlockNode): { node: BlockNode; x: number; z: number }[] => {
    const blocks = [{ node: p, x: 0, z: 0 }];
    let cur = p;
    while (fusedPrev.has(cur.id)) {
      const e2 = fusedPrev.get(cur.id)!;
      const prev = byId.get(e2.from.blockId)!;
      const oOut = outputPortCell(prev.op, ZERO, e2.from.port);
      const oIn = inputPortCell(cur.op, ZERO, e2.to.port);
      const last = blocks[blocks.length - 1];
      blocks.push({
        node: prev,
        x: last.x - footprintForOp(prev.op).w,
        z: last.z - (oOut.z - oIn.z),
      });
      cur = prev;
    }
    return blocks;
  };

  const ordered = [...graph.edges].sort(
    (a, b) => depthOf(a.from.blockId) - depthOf(b.from.blockId) || a.id.localeCompare(b.id),
  );
  for (const e of ordered) {
    const p = byId.get(e.from.blockId)!;
    const c = byId.get(e.to.blockId)!;
    if (p.id === c.id || fusedNext.has(p.id) || fusedPrev.has(c.id)) continue;
    const group = outEdges.get(p.id)!.filter((e2) => e2.to.blockId === c.id);
    const groupIds = new Set(group.map((g) => g.id));
    // Every involved output port gets buried, so it may feed only this consumer.
    if (
      !group.every((g) =>
        outByPort.get(`${p.id}:${g.from.port}`)!.every((x) => groupIds.has(x.id)),
      )
    )
      continue;
    const pw = footprintForOp(p.op).w;
    const shifts = group.map((g) => {
      const oOut = outputPortCell(p.op, ZERO, g.from.port);
      const oIn = inputPortCell(c.op, ZERO, g.to.port);
      // NaN when the faces don't oppose across +X — poisons the same-shift test.
      return oOut.x === pw && oIn.x === -1 ? oOut.z - oIn.z : NaN;
    });
    const shift = shifts[0];
    if (!shifts.every((s) => s === shift)) continue;
    if (shift & 1) continue; // odd z-shift would knock c off the 2x grid

    // Candidate chain: p's existing run plus c abutted east of p.
    const blocks = [
      ...chainBehind(p),
      { node: c, x: pw, z: shift },
    ];
    const foot = new Set(
      blocks.flatMap((b) =>
        footprintCellsForOp(b.node.op, { x: b.x, y: 0, z: b.z }).map((f) => key(f.x, f.z)),
      ),
    );
    const usedPorts: { x: number; z: number }[] = [];
    for (const b of blocks) {
      const a = { x: b.x, y: 0, z: b.z };
      for (const e2 of inEdges.get(b.node.id)!)
        if (!groupIds.has(e2.id) && !fused.has(e2.id))
          usedPorts.push(inputPortCell(b.node.op, a, e2.to.port));
      for (const e2 of outEdges.get(b.node.id)!)
        if (!groupIds.has(e2.id) && !fused.has(e2.id))
          usedPorts.push(outputPortCell(b.node.op, a, e2.from.port));
    }
    const portSet = new Set(usedPorts.map((f) => key(f.x, f.z)));
    const ok = usedPorts.every((f) => {
      if (foot.has(key(f.x, f.z))) return false; // buried under a footprint
      return [
        [1, 0], [-1, 0], [0, 1], [0, -1],
      ].some(([dx, dz]) => {
        const k = key(f.x + dx, f.z + dz);
        return !foot.has(k) && !portSet.has(k); // ≥1 approachable neighbor
      });
    });
    if (!ok) continue;
    for (const g of group) fused.add(g.id);
    // One representative edge per link — all group shifts are equal, so the
    // chain walkers reconstruct the same offset from any of them.
    fusedNext.set(p.id, e);
    fusedPrev.set(c.id, e);
  }

  // --- Chain geometry --------------------------------------------------------
  const unfusedPortCells = (b: ChainBlock): { x: number; z: number }[] => {
    const a = { x: b.x, y: 0, z: b.z };
    const cells: { x: number; z: number }[] = [];
    for (const e2 of inEdges.get(b.node.id)!)
      if (!fused.has(e2.id)) cells.push(inputPortCell(b.node.op, a, e2.to.port, b.turns));
    for (const e2 of outEdges.get(b.node.id)!)
      if (!fused.has(e2.id)) cells.push(outputPortCell(b.node.op, a, e2.from.port, b.turns));
    return cells;
  };

  const finishChain = (blocks: ChainBlock[]): Chain => {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const b of blocks) {
      const pts = [
        ...footprintCellsForOp(b.node.op, { x: b.x, y: 0, z: b.z }, b.turns),
        ...unfusedPortCells(b),
      ];
      for (const f of pts) {
        minX = Math.min(minX, f.x); maxX = Math.max(maxX, f.x);
        minZ = Math.min(minZ, f.z); maxZ = Math.max(maxZ, f.z);
      }
    }
    // Blocks may only sit on the 2x grid; ports can push the bbox to an odd
    // corner, so shift by the blocks' own parity, not the raw minimum. (All
    // blocks in a chain share parity: fusion offsets are even, and a 180° flip
    // shifts every anchor by the odd -(w-1)/-(h-1) uniformly.)
    if ((minX ^ blocks[0].x) & 1) minX--;
    if ((minZ ^ blocks[0].z) & 1) minZ--;
    for (const b of blocks) {
      b.x -= minX;
      b.z -= minZ;
    }
    return {
      blocks,
      w: maxX - minX + 1,
      h: maxZ - minZ + 1,
      depth: Math.min(...blocks.map((b) => depth.get(b.node.id)!)),
      hasOutput: blocks.some((b) => b.node.op === "output"),
    };
  };

  const buildChains = (): Chain[] => {
    const chains: Chain[] = [];
    for (const n of graph.nodes) {
      if (fusedPrev.has(n.id)) continue; // not a chain head
      const blocks: ChainBlock[] = [{ node: n, x: 0, z: 0, turns: 0 }];
      let cur = n;
      while (fusedNext.has(cur.id)) {
        const e = fusedNext.get(cur.id)!;
        const nxt = byId.get(e.to.blockId)!;
        const prev = blocks[blocks.length - 1];
        const oOut = outputPortCell(cur.op, ZERO, e.from.port);
        const oIn = inputPortCell(nxt.op, ZERO, e.to.port);
        blocks.push({
          node: nxt,
          x: prev.x + footprintForOp(cur.op).w,
          z: prev.z + oOut.z - oIn.z,
          turns: 0,
        });
        cur = nxt;
      }
      chains.push(finishChain(blocks));
    }
    return chains;
  };

  /** Shelf order. Depth alone scatters linked chains across the box (ties broken
   * by id), and every cable then pays that distance. Instead: walk the chain-level
   * graph depth-first from the shallowest unvisited chain, emitting each chain's
   * consumers right after it, so a producer and its consumers land in adjacent
   * shelf slots. Depth still breaks ties, keeping the overall west→east flow.
   * ponytail: greedy DFS, no crossing minimization — swap in barycenter passes
   * only if measured cable cost stops improving. */
  const orderChains = (chains: Chain[], dfs: boolean): Chain[] => {
    const chainOf = new Map<string, number>();
    chains.forEach((c, i) => c.blocks.forEach((b) => chainOf.set(b.node.id, i)));
    const succ = chains.map(() => new Set<number>());
    for (const e of graph.edges) {
      if (fused.has(e.id)) continue;
      const a = chainOf.get(e.from.blockId)!;
      const b = chainOf.get(e.to.blockId)!;
      if (a !== b) succ[a].add(b);
    }
    const byDepth = chains
      .map((_, i) => i)
      .sort(
        (a, b) =>
          chains[a].depth - chains[b].depth ||
          chains[a].blocks[0].node.id.localeCompare(chains[b].blocks[0].node.id),
      );
    if (!dfs) return byDepth.map((i) => chains[i]);
    const rank = new Map(byDepth.map((c, i) => [c, i]));
    const seen = new Set<number>();
    const out: Chain[] = [];
    const visit = (i: number) => {
      if (seen.has(i)) return;
      seen.add(i);
      out.push(chains[i]);
      for (const s of [...succ[i]].sort((a, b) => rank.get(a)! - rank.get(b)!)) visit(s);
    };
    for (const i of byDepth) visit(i);
    return out;
  };

  /** Rigid whole-chain rotation about the chain origin (block centres move, each
   * block spins in place). Chains holding an `output` block never rotate — their
   * exporter base rot (ROT_UPRIGHT) doesn't cancel in the viewer like ROT_LOGIC. */
  const rotateChain = (chain: Chain, q: number): Chain => {
    if (!q || chain.hasOutput) return chain;
    for (const b of chain.blocks) {
      const { w, h } = footprintForOp(b.node.op);
      let u = b.x + (w - 1) / 2;
      let v = b.z + (h - 1) / 2;
      for (let i = 0; i < q; i++) [u, v] = [v, -u];
      b.x = u - (w - 1) / 2;
      b.z = v - (h - 1) / 2;
      b.turns = (b.turns + q) % 4;
    }
    return finishChain(chain.blocks);
  };

  // --- Phases B–D: pack, rotate, route — one candidate shape ----------------
  const attempt = (
    gap: number,
    aspect: number,
    dfs: boolean,
    priority: ReadonlySet<string>,
  ): { routed: RouteResult; blockCells: Cell[] } => {
    const chains = orderChains(buildChains(), dfs);
    const area = chains.reduce((s, c) => s + (c.w + gap) * (c.h + gap), 0);
    const W = Math.max(
      Math.max(...chains.map((c) => c.w)),
      Math.round(Math.sqrt(area * aspect)),
    );
    let x = 0, shelfZ = 0, shelfH = 0, shelf = 0;
    for (let c of chains) {
      if (x > 0 && x + c.w > W) {
        shelfZ += shelfH + gap;
        shelfZ += shelfZ & 1; // next shelf starts on an even row (2x grid)
        shelfH = 0;
        x = 0;
        shelf++;
      }
      c = rotateChain(c, shelf % 2 ? 2 : 0); // serpentine: flip odd shelves
      // …fill odd shelves east→west. Snap each chain origin to an even column,
      // toward the free side, so block anchors stay on the 2x grid.
      let ox: number;
      if (shelf % 2) {
        ox = W - x - c.w;
        ox -= ox & 1;
      } else {
        x += x & 1;
        ox = x;
      }
      for (const b of c.blocks) {
        b.node.cell = {
          x: INTERIOR_BASE_CELL.x + ox + b.x,
          y: originY,
          z: INTERIOR_BASE_CELL.z + shelfZ + b.z,
        };
        b.node.turns = b.turns || undefined;
      }
      x = (shelf % 2 ? W - ox : ox + c.w) + gap;
      shelfH = Math.max(shelfH, c.h);
    }

    // 90° pass: a lone source block (no inputs) whose consumers sit mostly
    // north/south turns so its output faces them. Square footprints only —
    // the block's cells stay put, just its port cells move, and they only
    // need free cells to land on.
    const footprintSet = new Set<string>();
    const portOwner = new Map<string, string>();
    for (const n of graph.nodes) {
      for (const f of footprintCellsForOp(n.op, n.cell!, n.turns ?? 0))
        footprintSet.add(key(f.x, f.z));
      const t = n.turns ?? 0;
      for (const e2 of inEdges.get(n.id)!)
        if (!fused.has(e2.id)) {
          const f = inputPortCell(n.op, n.cell!, e2.to.port, t);
          portOwner.set(key(f.x, f.z), n.id);
        }
      for (const e2 of outEdges.get(n.id)!)
        if (!fused.has(e2.id)) {
          const f = outputPortCell(n.op, n.cell!, e2.from.port, t);
          portOwner.set(key(f.x, f.z), n.id);
        }
    }
    for (const n of graph.nodes) {
      const { w, h } = footprintForOp(n.op);
      if (w !== h || n.op === "output" || (n.turns ?? 0) !== 0) continue;
      const ins = inEdges.get(n.id)!;
      const outs = outEdges.get(n.id)!.filter((e2) => !fused.has(e2.id));
      if (ins.length > 0 || outs.length === 0 || fusedNext.has(n.id)) continue;
      const myPort = outputPortCell(n.op, n.cell!, outs[0].from.port);
      let mx = 0, mz = 0;
      for (const e2 of outs) {
        const t = byId.get(e2.to.blockId)!;
        const f = inputPortCell(t.op, t.cell!, e2.to.port, t.turns ?? 0);
        mx += f.x - myPort.x;
        mz += f.z - myPort.z;
      }
      if (Math.abs(mz) <= Math.abs(mx)) continue; // east/west-ish: leave it
      const turns = mz > 0 ? 3 : 1; // +X output face → +Z or −Z
      const moved = outs.map((e2) => outputPortCell(n.op, n.cell!, e2.from.port, turns));
      const free = moved.every((f) => {
        const k = key(f.x, f.z);
        return !footprintSet.has(k) && (portOwner.get(k) ?? n.id) === n.id;
      });
      if (!free) continue;
      portOwner.set(key(myPort.x, myPort.z), n.id); // stays reserved for us anyway
      for (const f of moved) portOwner.set(key(f.x, f.z), n.id);
      n.turns = turns;
    }

    for (const n of graph.nodes) n.rot = n.turns ? yawRot(ROT_LOGIC, n.turns) : undefined;

    // --- Route what fusion didn't absorb ---------------------------------
    const routeEdges: RouteEdge[] = graph.edges
      .filter((e) => !fused.has(e.id))
      .map((e) => {
        const from = byId.get(e.from.blockId)!;
        const to = byId.get(e.to.blockId)!;
        const ft = from.turns ?? 0;
        const tt = to.turns ?? 0;
        return {
          id: e.id,
          start: outputPortCell(from.op, from.cell!, e.from.port, ft),
          end: inputPortCell(to.op, to.cell!, e.to.port, tt),
          startRot: outputPortRot(from.op, e.from.port, ft),
          endRot: inputPortRot(to.op, e.to.port, tt),
          startInto: outputPortInto(from.op, e.from.port, ft),
          endInto: inputPortInto(to.op, e.to.port, tt),
        };
      });
    // Routing order: edges that failed the previous sweep go FIRST (a port
    // pocketed by its siblings' cables is only reachable before they route),
    // then longest hauls before short local hops — long nets die first under
    // congestion, short ones almost always still squeeze through locally.
    const manhattan = (e: RouteEdge) =>
      Math.abs(e.end.x - e.start.x) + Math.abs(e.end.z - e.start.z);
    routeEdges.sort(
      (a, b) =>
        (priority.has(b.id) ? 1 : 0) - (priority.has(a.id) ? 1 : 0) ||
        manhattan(b) - manhattan(a),
    );
    const blockCells = graph.nodes.flatMap((n) =>
      footprintCellsForOp(n.op, n.cell!, n.turns ?? 0),
    );
    return { routed: route3DCables(routeEdges, blockCells), blockCells };
  };

  // Sweep every candidate shape and keep the cheapest cabling, not the first
  // that routes (see SHAPE SEARCH above). Each shape gets one failed-first retry
  // — a port pocketed by its siblings' cables is only reachable before they
  // route — before being dropped as unroutable.
  let result: { routed: RouteResult; blockCells: Cell[] } | null = null;
  let best = Infinity;
  let snapshot: { cell: Cell; turns: number | undefined }[] = [];
  const deadline = performance.now() + SEARCH_BUDGET_MS;
  search: for (const dfs of [true, false]) {
    for (const aspect of ASPECTS) {
      for (const gap of GAPS) {
        if (result && performance.now() > deadline) break search;
        let r = attempt(gap, aspect, dfs, new Set());
        if (r.routed.failed.length > 0)
          r = attempt(gap, aspect, dfs, new Set(r.routed.failed));
        if (r.routed.failed.length > 0 || r.routed.cells.length >= best) continue;
        best = r.routed.cells.length;
        result = r;
        // attempt() mutates node cells in place, so capture this shape's
        // placement before the next one overwrites it.
        snapshot = graph.nodes.map((n) => ({ cell: n.cell!, turns: n.turns }));
      }
    }
  }
  if (result) {
    graph.nodes.forEach((n, i) => {
      n.cell = snapshot[i].cell;
      n.turns = snapshot[i].turns;
      n.rot = n.turns ? yawRot(ROT_LOGIC, n.turns) : undefined;
    });
  }
  if (!result) {
    // Always-valid fallback; shed any turns the failed attempts left behind.
    for (const n of graph.nodes) {
      n.turns = undefined;
      n.rot = undefined;
    }
    return layoutGraph(graph);
  }

  // --- Phase E: emit ---------------------------------------------------------
  const { cells: cableCells, flatPaths, chains: chainMap } = result.routed;
  const routes: CableRoute[] = graph.edges.map((e) => ({
    edgeId: e.id,
    fromBlock: e.from.blockId,
    toBlock: e.to.blockId,
    cells: flatPaths.get(e.id) ?? [], // fused edges: empty, no cable
  }));
  const cableChains = graph.edges.map((e) => ({
    edgeId: e.id,
    cells: chainMap.get(e.id) ?? [],
  }));

  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const f of result.blockCells) {
    minX = Math.min(minX, f.x); maxX = Math.max(maxX, f.x);
    minZ = Math.min(minZ, f.z); maxZ = Math.max(maxZ, f.z);
  }

  return {
    nodes: graph.nodes,
    edges: graph.edges,
    routes,
    cableCells,
    cableChains,
    inputs: graph.inputs,
    outputs: graph.outputs,
    bounds: { cols: maxX - minX + 1, rows: maxZ - minZ + 1, maxX, maxZ },
  };
}
