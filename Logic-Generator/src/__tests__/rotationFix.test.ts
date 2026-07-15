// Pins ROT_LOCAL_FIX to the blueprints it was measured from: our generated
// rot 0..23 fixture vs the same 24 orientations rebuilt by hand in-game. If the
// table, the fix, or the files drift apart, this fails.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { unpackGt } from "../serializer/gtCodec";
import { ROTATIONS, gameQuat } from "../serializer/rotations";

const DATA = new URL("../../../data/", import.meta.url);
const GENERATED = "75a8487b-f87f-49d6-9320-cfb839bac201 Generated Calib All block rotations.bp";
const ACTUAL = "d4fcd73f-69e2-4605-8021-a9438a8642b7 Actual All block rotations.bp";
const ADDER = 0x3b7bbce726d0cc7fn;
const GT_DATA_OFFSET = 0x14;

/** Struct sizes + payload start from a .bp file's own schema header. */
function parseSizes(dv: DataView): { sizes: number[]; payload: number } {
  let o = 4;
  const sizes: number[] = [];
  for (let i = 0, n = dv.getInt32(0, true); i < n; i++) {
    o += 8;
    sizes.push(dv.getInt32(o, true));
    const fieldCount = dv.getInt32(o + 4, true);
    o += 8 + 16 * fieldCount;
  }
  return { sizes, payload: o };
}

/** Every adder record's cell + rot, keyed by cell. */
function adderRots(file: string): Map<string, number> {
  const bytes = readFileSync(new URL(encodeURIComponent(file), DATA));
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { sizes, payload } = parseSizes(dv);
  const out = new Map<string, number>();
  let off = payload;
  while (off + 12 <= dv.byteLength) {
    const prefab = dv.getBigUint64(off, true);
    const size = sizes[dv.getInt32(off + 8, true)];
    const data = off + 12;
    if (size === undefined || data + size + 4 > dv.byteLength) break;
    const gt = unpackGt(dv.getUint32(data + GT_DATA_OFFSET, true));
    if (prefab === ADDER) out.set(`${gt.x},${gt.y},${gt.z}`, gt.rot);
    off = data + size + 4;
  }
  return out;
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
