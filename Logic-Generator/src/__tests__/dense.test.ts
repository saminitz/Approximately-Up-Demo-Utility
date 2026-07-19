import { describe, expect, it } from "vitest";
import { compileFormula } from "../compiler/compiler";
import { layoutDense } from "../layout/dense";
import { layoutGraph, type LaidOutGraph } from "../layout/layout";
import {
  footprintCellsForOp,
  footprintForOp,
  inputPortCell,
  outputPortCell,
} from "../catalog/ports";
import { ROT_LOGIC, ROT_UPRIGHT, yawRot } from "../serializer/rotations";
import { runPipeline } from "../pipeline";

const ZERO = { x: 0, y: 0, z: 0 };

const PD = `error = target - position
control = Kp * error + Kd * deriv(error)`;

const HOVER = `vUp   = integral(aUp)
vErr  = vTarget - vUp
cmd   = Kp*vErr + Ki*integral(vErr)
throt = min(1, max(0, cmd))`;

const SIXDOF = `altError  = targetAlt - altitude
altRate   = deriv(altitude)
altInteg  = integral(altError)
altPID    = Kp*altError + Ki*altInteg - Kd*altRate
tiltMag   = abs(pitch) + abs(roll)
tilt      = atan2(pitch, roll)
gate      = xor(threshold(altError, 0.0), not(condition(tilt, spinLimit)))
gated     = condition(gate, altPID)
shaped    = remap(gated, -10, 10, -1, 1)
memHold   = memory(shaped)
thrust    = memHold + tiltMag*0.25`;

const cellKey = (c: { x: number; y: number; z: number }) => `${c.x},${c.y},${c.z}`;

/** Bounding-box area over all (rotated) footprint cells. */
function area(laid: LaidOutGraph): number {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const n of laid.nodes)
    for (const c of footprintCellsForOp(n.op, n.cell!, n.turns ?? 0)) {
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
      minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
    }
  return (maxX - minX + 1) * (maxZ - minZ + 1);
}

/** Blocks must not overlap each other; cables must not overlap blocks; every
 * edge is either routed or realized by abutment (ports inside the partner). */
function validate(laid: LaidOutGraph) {
  const blockCells = new Set<string>();
  for (const n of laid.nodes)
    for (const c of footprintCellsForOp(n.op, n.cell!, n.turns ?? 0)) {
      const k = cellKey(c);
      expect(blockCells.has(k), `block overlap at ${k}`).toBe(false);
      blockCells.add(k);
    }
  for (const c of laid.cableCells)
    expect(blockCells.has(cellKey(c)), `cable inside block at ${cellKey(c)}`).toBe(false);

  const byId = new Map(laid.nodes.map((n) => [n.id, n]));
  for (const r of laid.routes) {
    if (r.cells.length > 0) continue; // routed normally
    // fused: the two port cells must sit inside the partner's footprint (abutted)
    const e = laid.edges.find((x) => x.id === r.edgeId)!;
    const p = byId.get(e.from.blockId)!;
    const c = byId.get(e.to.blockId)!;
    const out = outputPortCell(p.op, p.cell!, e.from.port, p.turns ?? 0);
    const inp = inputPortCell(c.op, c.cell!, e.to.port, c.turns ?? 0);
    const cCells = new Set(footprintCellsForOp(c.op, c.cell!, c.turns ?? 0).map(cellKey));
    const pCells = new Set(footprintCellsForOp(p.op, p.cell!, p.turns ?? 0).map(cellKey));
    expect(cCells.has(cellKey(out)), `edge ${e.id}: output port not abutted`).toBe(true);
    expect(pCells.has(cellKey(inp)), `edge ${e.id}: input port not abutted`).toBe(true);
  }
}

describe("layoutDense", () => {
  it("fuses a pure chain end to end (zero cables)", () => {
    const laid = layoutDense(compileFormula("y = deriv(x)"));
    expect(laid.cableCells.length).toBe(0);
    expect(laid.routes.every((r) => r.cells.length === 0)).toBe(true);
    validate(laid);
  });

  it("packs the PD controller denser than the layered grid", () => {
    const dense = layoutDense(compileFormula(PD));
    const layered = layoutGraph(compileFormula(PD));
    expect(area(dense)).toBeLessThan(area(layered));
    validate(dense);
  });

  it.each([
    ["PD", PD],
    ["hover", HOVER],
    ["6dof", SIXDOF],
    ["vecmag", "speed = sqrt(vx*vx + vy*vy + vz*vz)"],
  ])("produces a valid circuit for %s", (_name, src) => {
    const laid = layoutDense(compileFormula(src));
    validate(laid);
    // rot, when set, is a valid ROTATIONS index consistent with turns
    for (const n of laid.nodes) {
      if (n.turns) {
        expect(n.rot).toBe(yawRot(ROT_LOGIC, n.turns));
        expect(n.rot).toBeGreaterThanOrEqual(0);
        expect(n.rot).toBeLessThan(24);
      } else {
        expect(n.rot).toBeUndefined();
      }
    }
  });

  it("threads through runPipeline for both algorithms", () => {
    const dense = runPipeline(PD);
    const layered = runPipeline(PD, "layered");
    expect(dense.ok).toBe(true);
    expect(layered.ok).toBe(true);
    if (dense.ok && layered.ok)
      expect(dense.stats.cableCells).toBeLessThan(layered.stats.cableCells);
  });
});

describe("rotation geometry", () => {
  it("yawRot composes quarter-turns onto any base", () => {
    expect(yawRot(ROT_UPRIGHT, 2)).toBe(ROT_LOGIC); // documented 180° pair
    const cycle = [0, 1, 2, 3].map((q) => yawRot(ROT_LOGIC, q));
    expect(new Set(cycle).size).toBe(4);
    for (const r of cycle) expect(r).toBeGreaterThanOrEqual(0);
    expect(yawRot(ROT_LOGIC, 4)).toBe(ROT_LOGIC); // full circle
  });

  it.each(["add", "remap"] as const)("rotates %s ports about the footprint centre", (op) => {
    const { w, h } = footprintForOp(op);
    const cx = (w - 1) / 2;
    const cz = (h - 1) / 2;
    const p0 = outputPortCell(op, ZERO, 0);
    // 180°: point reflection through the centre
    expect(outputPortCell(op, ZERO, 0, 2)).toEqual({
      x: 2 * cx - p0.x, y: 0, z: 2 * cz - p0.z,
    });
    // 90°: (u,v) -> (v,-u) about the centre
    expect(outputPortCell(op, ZERO, 0, 1)).toEqual({
      x: cx + (p0.z - cz), y: 0, z: cz - (p0.x - cx),
    });
    // square footprints keep their cells under 90°
    if (w === h) {
      const a = new Set(footprintCellsForOp(op, ZERO, 0).map(cellKey));
      const b = new Set(footprintCellsForOp(op, ZERO, 1).map(cellKey));
      expect(b).toEqual(a);
    }
  });
});
