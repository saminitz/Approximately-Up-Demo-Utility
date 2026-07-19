import { describe, expect, it } from "vitest";
import {
  FIXTURES,
  MARKER_PREFIX,
  fixtureAllBlocks,
  fixtureAllCableRots,
  fixtureAllRotations,
  fixtureAxisMarkers,
  fixtureCableSnake,
} from "../fixtures";
import { buildBp, DEFAULT_BP_OPTIONS } from "../serializer/bpWriter";
import { PREFAB_TABLE } from "../serializer/prefabTable";
import { packGt } from "../serializer/gtCodec";
import type { BlockNode } from "../compiler/graph";
import { ROTATIONS } from "../serializer/rotations";
import { CORNER_ROT, cableDirsForRot } from "../layout/cableShapes";

const key = (c: { x: number; y: number; z: number }) => `${c.x},${c.y},${c.z}`;
const items = (laid: { nodes: BlockNode[] }) =>
  laid.nodes.filter((n) => !n.id.startsWith(MARKER_PREFIX));
const marks = (laid: { nodes: BlockNode[] }) =>
  laid.nodes.filter((n) => n.id.startsWith(MARKER_PREFIX));

describe("calibration fixtures", () => {
  it("all-blocks fixture only places pinned prefabs, one per op", () => {
    const laid = fixtureAllBlocks();
    expect(laid.nodes.every((n) => PREFAB_TABLE[n.op].known)).toBe(true);
    expect(new Set(items(laid).map((n) => n.op)).size).toBe(items(laid).length);
  });

  it("rotation fixture covers every rot exactly once, no shared cells", () => {
    const laid = fixtureAllRotations();
    expect(items(laid).map((n) => n.rot)).toEqual(ROTATIONS.map((_, i) => i));
    expect(new Set(laid.nodes.map((n) => key(n.cell!))).size).toBe(laid.nodes.length);
  });

  it("every row fixture is bracketed by 0/100 constant markers outside its items", () => {
    for (const build of [fixtureAllBlocks, fixtureAllRotations, fixtureAllCableRots]) {
      const laid = build();
      const m = marks(laid);
      expect(m.map((n) => n.value)).toEqual([0, 100]);
      expect(m.every((n) => n.op === "constant")).toBe(true);
      const xs = [...items(laid).map((n) => n.cell!.x), ...laid.cableCells.map((c) => c.x)];
      expect(m[0].cell!.x).toBeLessThan(Math.min(...xs));
      expect(m[1].cell!.x).toBeGreaterThan(Math.max(...xs) + 1); // clears the 2-wide body
    }
  });

  it("axis probe sits at the origin, one arm per axis, value naming the axis", () => {
    const byValue = new Map(fixtureAxisMarkers().nodes.map((n) => [n.value, n.cell!]));
    expect(byValue.get(0)).toEqual({ x: 0, y: 0, z: 0 });
    expect(byValue.get(1)).toEqual({ x: 4, y: 0, z: 0 });
    expect(byValue.get(2)).toEqual({ x: 0, y: 4, z: 0 });
    expect(byValue.get(3)).toEqual({ x: 0, y: 0, z: 4 });
  });

  it("cable fixture covers every distinct L exactly once, twin rots dropped", () => {
    const cells = fixtureAllCableRots().cableCells;
    const dirKeys = cells.map((c) => cableDirsForRot(c.rot).sort().join("|"));
    expect(new Set(dirKeys).size).toBe(cells.length); // no two cells the same L
    expect(new Set(dirKeys)).toEqual(new Set(Object.keys(CORNER_ROT))); // all 12
    expect(new Set(cells.map(key)).size).toBe(cells.length);
  });

  it("cable snake ships its connectivity, so the viewer never guesses from rot", () => {
    // Circuit3D only reads arms out of `_gt.rot` for cells with no chain, and
    // that L model draws straights (rot 0) as the "+X|+Z" corner (also rot 0).
    const laid = fixtureCableSnake();
    expect(laid.cableChains).toHaveLength(1);
    expect(laid.cableChains[0].cells.map(key)).toEqual(laid.cableCells.map(key));
  });

  it("cable snake's dangling ends are Ls that bend off-plane, not flat stubs", () => {
    // What Circuit3D unions into an un-ported chain end. Every measured ENDPOINT
    // rot carries a vertical arm — 15/17/14 bend down, 21 bends up — which is
    // what the game draws and what the viewer used to miss.
    const cells = fixtureCableSnake().cableCells;
    for (const [end, neighbour] of [
      [cells[0], cells[1]],
      [cells[cells.length - 1], cells[cells.length - 2]],
    ]) {
      const arms = cableDirsForRot(end.rot);
      expect(arms).toHaveLength(2);
      expect(arms.some((d) => d.includes("Y")), `rot ${end.rot} has no bend`).toBe(true);
      // the other arm runs along the strand, so the end stays visually attached
      const toNeighbour =
        neighbour.x > end.x ? "+X" : neighbour.x < end.x ? "-X"
        : neighbour.y > end.y ? "+Y" : neighbour.y < end.y ? "-Y"
        : neighbour.z > end.z ? "+Z" : "-Z";
      expect(arms).toContain(toNeighbour);
      expect(end.trailing).toBe(1); // bent, like a corner
    }
  });

  it("cable snake is one unbroken strand hitting all 12 Ls, nothing fused", () => {
    const cells = fixtureCableSnake().cableCells;
    expect(new Set(cells.map(key)).size).toBe(cells.length);

    // consecutive cells are one step apart
    for (let i = 1; i < cells.length; i++) {
      const d = ["x", "y", "z"].map((a) => Math.abs((cells[i] as any)[a] - (cells[i - 1] as any)[a]));
      expect(d.reduce((s, v) => s + v, 0)).toBe(1);
    }

    // no cell touches a non-neighbour in the chain — that would read as a tee
    const index = new Map(cells.map((c, i) => [key(c), i]));
    for (let i = 0; i < cells.length; i++) {
      for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
        const j = index.get(key({ x: cells[i].x + dx, y: cells[i].y + dy, z: cells[i].z + dz }));
        if (j !== undefined) expect(Math.abs(j - i)).toBe(1);
      }
    }

    // Every distinct L is turned somewhere along the strand. Read the arms off
    // the GEOMETRY, not off rot — a straight's rot aliases an L's rot, so
    // asking cableDirsForRot would let a missing corner hide behind a straight.
    const dirOf = (a: typeof cells[0], b: typeof cells[0]) =>
      b.x > a.x ? "+X" : b.x < a.x ? "-X" : b.y > a.y ? "+Y" : b.y < a.y ? "-Y" : b.z > a.z ? "+Z" : "-Z";
    const turns = new Set<string>();
    for (let i = 1; i < cells.length - 1; i++) {
      const arms = [dirOf(cells[i], cells[i - 1]), dirOf(cells[i], cells[i + 1])];
      if (arms[0][1] !== arms[1][1]) turns.add(arms.sort().join("|")); // same axis = straight
    }
    expect(turns).toEqual(new Set(Object.keys(CORNER_ROT)));

    // and each turn carries the rot CORNER_ROT claims for its arms
    for (let i = 1; i < cells.length - 1; i++) {
      const arms = [dirOf(cells[i], cells[i - 1]), dirOf(cells[i], cells[i + 1])].sort();
      const rot = CORNER_ROT[arms.join("|")];
      if (rot !== undefined) expect(cells[i].rot, `cell ${i} ${arms}`).toBe(rot);
    }
  });

  it("cableDirsForRot reproduces the verified CORNER_ROT table, 2 rots per L", () => {
    const byDirs = new Map<string, number[]>();
    for (let rot = 0; rot < ROTATIONS.length; rot++) {
      const k = cableDirsForRot(rot).sort().join("|");
      byDirs.set(k, [...(byDirs.get(k) ?? []), rot]);
    }
    expect(byDirs.size).toBe(12); // 24 rots collapse 2:1 — the L's arm-swap flip
    for (const [dirs, rot] of Object.entries(CORNER_ROT)) {
      expect(byDirs.get(dirs)).toContain(rot);
      expect(byDirs.get(dirs)).toHaveLength(2); // rot + its face-swapped twin
    }
  });

  it("every fixture exports, and per-node rot reaches the written _gt", () => {
    for (const f of FIXTURES) {
      const laid = f.build();
      const build = buildBp(laid, DEFAULT_BP_OPTIONS);
      expect(build.blockRecords).toBe(laid.nodes.length);
      expect(build.cableRecords).toBe(laid.cableCells.length);
    }

    const laid = fixtureAllRotations();
    const dv = new DataView(buildBp(laid, DEFAULT_BP_OPTIONS).bytes.buffer);
    const written = new Set<number>();
    for (let off = 0; off + 4 <= dv.byteLength; off++) written.add(dv.getUint32(off, true));
    for (const n of items(laid)) {
      expect(written.has(packGt({ ...n.cell!, rot: n.rot! }) >>> 0)).toBe(true);
    }
  });
});
