import { describe, expect, it } from "vitest";
import { packGt, unpackGt } from "../serializer/gtCodec";
import { ROTATIONS, ROT_IDENTITY, ROT_UPRIGHT } from "../serializer/rotations";

describe("gt codec", () => {
  it("decodes the corrected PD Target Distance record 0 (0x332030D8)", () => {
    // GT_REPORT_v2.md §5: X=216, Y=24, Z=200, rot=6.
    const f = unpackGt(0x332030d8);
    expect(f).toEqual({ x: 216, y: 24, z: 200, rot: 6 });
  });

  it("packs the corrected reference fields back to the same word", () => {
    expect(packGt({ x: 216, y: 24, z: 200, rot: 6 })).toBe(0x332030d8);
  });

  it("round-trips arbitrary in-range values", () => {
    for (const t of [
      { x: 0, y: 0, z: 0, rot: 0 },
      { x: 511, y: 511, z: 511, rot: 23 },
      { x: 1, y: 2, z: 3, rot: ROT_IDENTITY },
      { x: 300, y: 17, z: 400, rot: 12 },
    ]) {
      expect(unpackGt(packGt(t))).toEqual(t);
    }
  });

  it("clamps out-of-range cells to [0,511]", () => {
    expect(unpackGt(packGt({ x: -5, y: 999, z: 512, rot: 6 }))).toEqual({
      x: 0,
      y: 511,
      z: 511,
      rot: 6,
    });
  });

  it("defaults to the upright rotation (index 6)", () => {
    expect(ROT_UPRIGHT).toBe(6);
    expect(unpackGt(packGt({ x: 1, y: 1, z: 1 })).rot).toBe(ROT_UPRIGHT);
    expect(unpackGt(packGt({ x: 1, y: 1, z: 1 })).rot).not.toBe(ROT_IDENTITY);
  });

  it("has 24 rotations with identity at index 16", () => {
    expect(ROTATIONS).toHaveLength(24);
    expect(ROTATIONS[ROT_IDENTITY]).toEqual([0, 0, 0, 1]);
  });
});
