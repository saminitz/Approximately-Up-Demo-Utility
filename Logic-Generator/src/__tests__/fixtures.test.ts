import { describe, expect, it } from "vitest";
import {
  FIXTURES,
  MARKER_PREFIX,
  fixtureAllBlocks,
  fixtureAllCableRots,
  fixtureAllRotations,
  fixtureAxisMarkers,
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
