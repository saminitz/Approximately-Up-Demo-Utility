// Pins ROT_LOCAL_FIX to the blueprints it was measured from: our generated
// rot 0..23 fixture vs the same 24 orientations rebuilt by hand in-game. If the
// table, the fix, or the files drift apart, this fails.

import { describe, expect, it } from "vitest";
import { ROTATIONS, gameQuat } from "../serializer/rotations";
import { byCell } from "./bpRecords";

const GENERATED = "75a8487b-f87f-49d6-9320-cfb839bac201 Generated Calib All block rotations.bp";
const ACTUAL = "d4fcd73f-69e2-4605-8021-a9438a8642b7 Actual All block rotations.bp";
const ADDER = 0x3b7bbce726d0cc7fn;

/** Every adder record's cell + rot, keyed by cell. */
function adderRots(file: string): Map<string, number> {
  return new Map([...byCell(file, ADDER)].map(([cell, r]) => [cell, r.gt.rot]));
}

describe("measured rotation fix", () => {
  it("gameQuat(actual rot) equals the raw table entry we generated, for all 24", () => {
    const generated = adderRots(GENERATED);
    const actual = adderRots(ACTUAL);
    expect(generated.size).toBe(24);
    expect(actual.size).toBe(24);

    const seen = new Set<number>();
    for (const [cell, genRot] of generated) {
      const actRot = actual.get(cell);
      expect(actRot, `no in-game block at ${cell}`).toBeDefined();
      seen.add(actRot!);
      // The block the user built to match our render of `genRot` was stored by the
      // game as `actRot`; so the game's orientation for actRot IS ROTATIONS[genRot].
      gameQuat(actRot!).forEach((n, i) =>
        expect(Math.abs(n - ROTATIONS[genRot][i]) < 1e-4 || Math.abs(n + ROTATIONS[genRot][i]) < 1e-4,
          `rot ${genRot}→${actRot} component ${i}`).toBe(true),
      );
    }
    expect(seen.size, "in-game rots should be a bijection of 0..23").toBe(24);
  });
});
