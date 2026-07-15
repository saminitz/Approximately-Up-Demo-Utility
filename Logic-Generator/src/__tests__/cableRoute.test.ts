import { describe, expect, it } from "vitest";
import { compileFormula } from "../compiler/compiler";
import { layoutGraph } from "../layout/layout";
import { route3DCables, type RouteEdge } from "../layout/cableRoute";
import { CORNER_ROT } from "../layout/cableShapes";
import type { Cell } from "../layout/layout";

const yk = (c: { x: number; y: number; z: number }) => `${c.x},${c.y},${c.z}`;

describe("game-grid cable router", () => {
  it("never places a cable on a block cell or shares a cell with another cable", () => {
    // A formula with a feedback edge forces backward routing + potential crossings.
    const laid = layoutGraph(compileFormula("u = Kp*(t - p) + Kd*deriv(t - p)"));
    // Blocks are 2×2 — no cable may sit on any footprint cell.
    const blocks = new Set<string>();
    for (const n of laid.nodes) {
      for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        blocks.add(yk({ x: n.cell!.x + dx, y: n.cell!.y, z: n.cell!.z + dz }));
      }
    }

    const seen = new Set<string>();
    for (const c of laid.cableCells) {
      expect(blocks.has(yk(c))).toBe(false); // no cable through a block
      expect(seen.has(yk(c))).toBe(false); // no two cables in the same cell
      seen.add(yk(c));
    }
  });

  it("bridges (rises to y+1) when a crossing is unavoidable", () => {
    // A is a long wall along z=0; B crosses it near the middle, where detouring
    // around either end costs far more than a bridge (so A* must bridge).
    const y = 24;
    const edges: RouteEdge[] = [
      { id: "A", start: { x: 0, y, z: 0 }, end: { x: 100, y, z: 0 }, startRot: 0, endRot: 0 },
      { id: "B", start: { x: 50, y, z: -2 }, end: { x: 50, y, z: 2 }, startRot: 0, endRot: 0 },
    ];
    const blocks: Cell[] = [];
    const { cells, failed } = route3DCables(edges, blocks);
    expect(failed).toEqual([]);
    expect(cells.some((c) => c.y === y + 1)).toBe(true); // a bridge span exists
    // The crossed cell (50,y,0) is owned by exactly one cable at y0.
    const atCrossY0 = cells.filter((c) => c.x === 50 && c.z === 0 && c.y === y);
    expect(atCrossY0.length).toBe(1);
    // The bridge foot (y0 riser at z=-1) is a ramp corner (trailing 1), not flat.
    const foot = cells.find((c) => c.x === 50 && c.y === y && c.z === -1);
    expect(foot?.trailing).toBe(1);
  });

  it("spans multiple consecutive crossings with one bridge", () => {
    const y = 24;
    // Two parallel walls at z=0 and z=1; B must cross both. Long walls make the
    // detour far more expensive than a single bridge over both.
    const { cells, failed } = route3DCables([
      { id: "A1", start: { x: 0, y, z: 0 }, end: { x: 400, y, z: 0 }, startRot: 0, endRot: 0 },
      { id: "A2", start: { x: 0, y, z: 1 }, end: { x: 400, y, z: 1 }, startRot: 0, endRot: 0 },
      { id: "B", start: { x: 200, y, z: -2 }, end: { x: 200, y, z: 3 }, startRot: 0, endRot: 0 },
    ], []);
    expect(failed).toEqual([]);
    // Both crossed cells (z=0 and z=1) are spanned at y+1 by B, and their y0
    // stays owned by A1/A2 (B places no y0 cell there).
    for (const z of [0, 1]) {
      expect(cells.some((c) => c.x === 200 && c.y === y + 1 && c.z === z)).toBe(true);
      const bAtY0 = cells.filter((c) => c.x === 200 && c.y === y && c.z === z);
      expect(bAtY0.length).toBe(1); // only A's cell, not B's
    }
  });

  // Two parallel walls with a gap between them; B crosses both. Gap ≤2 has no
  // room for a down-ramp + up-ramp pair, so the bridge must stay at y+1.
  const gapCase = (gapWallZ: number) => {
    const y = 24;
    return route3DCables([
      { id: "A1", start: { x: 0, y, z: 0 }, end: { x: 400, y, z: 0 }, startRot: 0, endRot: 0 },
      { id: "A2", start: { x: 0, y, z: gapWallZ }, end: { x: 400, y, z: gapWallZ }, startRot: 0, endRot: 0 },
      { id: "B", start: { x: 200, y, z: -2 }, end: { x: 200, y, z: gapWallZ + 2 }, startRot: 0, endRot: 0 },
    ], []);
  };

  it("stays at y+1 across a 1-cell gap between crossings", () => {
    const { chains, failed } = gapCase(2);
    expect(failed).toEqual([]);
    const b = chains.get("B")!;
    expect(b.some((c) => c.z === 1 && c.y === 25)).toBe(true); // gap spanned at top
    expect(b.some((c) => c.z === 1 && c.y === 24)).toBe(false); // nothing at y0
  });

  it("stays at y+1 across a 2-cell gap (no pointless down+up)", () => {
    const { chains, failed } = gapCase(3);
    expect(failed).toEqual([]);
    const b = chains.get("B")!;
    for (const z of [1, 2]) {
      expect(b.some((c) => c.z === z && c.y === 25)).toBe(true);
      expect(b.some((c) => c.z === z && c.y === 24)).toBe(false);
    }
  });

  it("descends between crossings when the gap has real flat ground (≥3)", () => {
    const { chains, failed } = gapCase(4);
    expect(failed).toEqual([]);
    const b = chains.get("B")!;
    // Middle of the gap is back at y0: down-ramp z=1, flat z=2, up-ramp z=3.
    expect(b.some((c) => c.z === 2 && c.y === 24)).toBe(true);
    expect(b.some((c) => c.z === 2 && c.y === 25)).toBe(false);
  });

  it("stays at y+1 across a 1-cell gap that turns (no dangling down-ramp)", () => {
    const y = 24;
    // A is an L: south along x=10 (z=2..-1), then east along z=-1 (x=10..12).
    // B runs +X down a walled corridor at z=0, bridges A's Z-arm at (10,0), and
    // one cell later must bridge A's X-arm at (11,-1) — a single gap cell with a
    // turn in it. Blocks fence the pocket so no detour exists.
    const blocks: Cell[] = [];
    for (let x = 0; x <= 9; x++) blocks.push({ x, y, z: 1 }, { x, y, z: -1 });
    blocks.push({ x: 0, y, z: 0 });
    blocks.push({ x: 11, y, z: 2 }, { x: 12, y, z: 2 });
    for (let z = -6; z <= 2; z++) blocks.push({ x: 13, y, z });
    const { chains, failed } = route3DCables([
      { id: "A", start: { x: 10, y, z: 2 }, end: { x: 12, y, z: -1 }, startRot: 0, endRot: 0 },
      { id: "B", start: { x: 5, y, z: 0 }, end: { x: 11, y, z: -4 }, startRot: 0, endRot: 0 },
    ], blocks);
    expect(failed).toEqual([]);
    const b = chains.get("B")!;
    const gap = b.find((c) => c.x === 11 && c.z === 0);
    expect(gap?.y).toBe(y + 1); // arch turns at the top, no descent
    expect(b.some((c) => c.x === 11 && c.z === 0 && c.y === y)).toBe(false);
    expect(gap?.rot).toBe(CORNER_ROT["-X|-Z"]);
  });

  it("never lets one bridge cross another bridge's cells at y+1", () => {
    const y = 24;
    // A: wall cable at z=0. B: bridges it at x=200, so B's ramp feet sit at
    // (200,z=-1) and (200,z=1) with tops at y+1. C runs along z=-1 straight
    // through B's foot; a block wall at z=-2 leaves it no cheap detour, so the
    // naive router bridged there — landing on B's ramp top at (200,y+1,-1).
    const blocks: Cell[] = [];
    for (let x = 0; x <= 400; x++) if (x !== 200) blocks.push({ x, y, z: -2 });
    const { chains, failed } = route3DCables([
      { id: "A", start: { x: 0, y, z: 0 }, end: { x: 400, y, z: 0 }, startRot: 0, endRot: 0 },
      { id: "B", start: { x: 200, y, z: -4 }, end: { x: 200, y, z: 3 }, startRot: 0, endRot: 0 },
      { id: "C", start: { x: 150, y, z: -1 }, end: { x: 250, y, z: -1 }, startRot: 0, endRot: 0 },
    ], blocks);
    expect(failed).toEqual([]);
    const counts = new Map<string, number>();
    for (const c of [...chains.values()].flat()) counts.set(yk(c), (counts.get(yk(c)) ?? 0) + 1);
    const shared = [...counts].filter(([, n]) => n > 1).map(([k]) => k);
    expect(shared).toEqual([]);
  });

  // Ramp rots come from each cell's own-chain 3D topology, asserted against the
  // ground-truth Cable Bridge.bp table (isolated bridge, no sibling cables).
  const at = (cs: Array<Cell & { rot: number }>, x: number, yy: number, z: number) =>
    cs.find((c) => c.x === x && c.y === yy && c.z === z);

  it("+Z-travel bridge ramps use the verified rots", () => {
    const y = 24;
    const { cells } = route3DCables([
      { id: "A", start: { x: 0, y, z: 0 }, end: { x: 100, y, z: 0 }, startRot: 0, endRot: 0 },
      { id: "B", start: { x: 50, y, z: -2 }, end: { x: 50, y, z: 2 }, startRot: 0, endRot: 0 },
    ], []);
    expect(at(cells, 50, y, -1)?.rot).toBe(21); // up-foot   {+Y,-Z}
    expect(at(cells, 50, y + 1, -1)?.rot).toBe(12); // up-top  {+Z,-Y}
    expect(at(cells, 50, y + 1, 0)?.rot).toBe(21); // span Z
    expect(at(cells, 50, y + 1, 1)?.rot).toBe(20); // down-top {-Y,-Z}
    expect(at(cells, 50, y, 1)?.rot).toBe(9); // down-foot    {+Y,+Z}
  });

  it("+X-travel bridge ramps use the verified rots", () => {
    const y = 24;
    const { cells } = route3DCables([
      { id: "A", start: { x: 0, y, z: 0 }, end: { x: 0, y, z: 100 }, startRot: 0, endRot: 0 },
      { id: "B", start: { x: -2, y, z: 50 }, end: { x: 2, y, z: 50 }, startRot: 0, endRot: 0 },
    ], []);
    expect(at(cells, -1, y, 50)?.rot).toBe(11); // up-foot   {+Y,-X}
    expect(at(cells, -1, y + 1, 50)?.rot).toBe(2); // up-top  {+X,-Y}
    expect(at(cells, 0, y + 1, 50)?.rot).toBe(0); // span X
    expect(at(cells, 1, y + 1, 50)?.rot).toBe(14); // down-top {-X,-Y}
    expect(at(cells, 1, y, 50)?.rot).toBe(3); // down-foot    {+X,+Y}
  });
});
