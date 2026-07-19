import { describe, expect, it } from "vitest";
import { DIR_TO_SCENE, sceneQuat, toScene } from "../gameFrame";
import { ROTATIONS, gameQuat, type Quaternion } from "../serializer/rotations";

type V = [number, number, number];

/** Rotate a vector by a quaternion (x, y, z, w). */
function rotate(q: Quaternion, [vx, vy, vz]: V): V {
  const [x, y, z, w] = q;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

describe("game frame (viewer transpose)", () => {
  it("swaps X and Z, leaves Y", () => {
    expect(toScene(1, 2, 3)).toEqual([3, 2, 1]);
    expect(DIR_TO_SCENE["+X"]).toBe("+Z");
    expect(DIR_TO_SCENE["+Y"]).toBe("+Y");
  });

  // The load-bearing identity: drawing with sceneQuat must equal transposing the
  // game-rotated geometry. Get the reflection wrong and every block mirrors.
  // `gameQuat`, not raw ROTATIONS — the measured local-yaw fix rides along (see
  // rotationFix.test.ts, which pins that half against the in-game blueprints).
  it("sceneQuat(rot) matches the transpose of the game rotation, for all 24 rots", () => {
    for (let rot = 0; rot < ROTATIONS.length; rot++) {
      for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 2, 3]] as V[]) {
        const viaModel = toScene(...rotate(gameQuat(rot), v));
        const viaScene = rotate(sceneQuat(rot)!, toScene(...v));
        viaScene.forEach((n, i) => expect(n).toBeCloseTo(viaModel[i], 5));
      }
    }
  });
});
