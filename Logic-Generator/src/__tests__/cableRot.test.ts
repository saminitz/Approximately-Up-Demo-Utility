// Pins the cable L model to the blueprint pair it was measured against: our
// generated 12-rot cable fixture vs the same 12 cells rebuilt by hand in-game.
//
//   807f5ee1… Generated Calib All cable rotations.bp  (we wrote rot g per cell)
//   0d6fbbde… Actual All cable Rotations.bp           (game stored rot a per cell)
//
// The user built, at each cell, the L our viewer drew for g; so the game's real
// shape for rot a IS the shape our model claims for rot g. Comparing by SHAPE
// (not rot) is deliberate: an L's two rots differ only by which face is up.
//
// RESULT: all four FLAT corners agree — and flat is the only thing `cornerRot`
// is ever asked for (vertical corners route through BRIDGE_RAMP). The eight
// corners with a vertical arm do NOT agree and are not asserted here; see
// `cableShapes.ts` CORNER_ROT for the open question.

import { describe, expect, it } from "vitest";
import { byCell } from "./bpRecords";
import { CABLE_PREFAB } from "../serializer/prefabTable";
import { cableDirsForRot } from "../layout/cableShapes";

const GENERATED = "807f5ee1-c08a-43cf-a757-74e1776379c8 Generated Calib All cable rotations.bp";
const ACTUAL = "0d6fbbde-ac2c-4e8a-95bf-0ac12b48378d Actual All cable Rotations.bp";

const shape = (rot: number) => cableDirsForRot(rot).sort().join("|");
const isFlat = (rot: number) => !cableDirsForRot(rot).some((d) => d.includes("Y"));

describe("measured cable rotations", () => {
  const generated = byCell(GENERATED, CABLE_PREFAB.hash);
  const actual = byCell(ACTUAL, CABLE_PREFAB.hash);

  it("both blueprints hold the same 12 cable cells", () => {
    expect(generated.size).toBe(12);
    expect([...actual.keys()].sort()).toEqual([...generated.keys()].sort());
  });

  it("every flat corner we generate is the shape the game builds", () => {
    const flats = [...generated].filter(([, r]) => isFlat(r.gt.rot));
    expect(flats).toHaveLength(4);
    for (const [cell, gen] of flats) {
      expect(shape(actual.get(cell)!.gt.rot), `cell ${cell}`).toBe(shape(gen.gt.rot));
    }
  });

  it("a bent cable is trailing 1 — the game writes it that way too", () => {
    for (const r of [...generated.values(), ...actual.values()]) expect(r.trailing).toBe(1);
  });

  it("the hand-built row uses each of the 12 shapes exactly once", () => {
    // The build covers the full shape set; it's the per-cell ASSIGNMENT of the
    // vertical ones that disagrees, which is why they can't be read off yet.
    expect(new Set([...actual.values()].map((r) => shape(r.gt.rot))).size).toBe(12);
  });
});
