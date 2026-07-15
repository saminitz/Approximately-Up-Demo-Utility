// Model frame → game frame, for the viewer only.
//
// Verified in-game with the "Axis markers" fixture: the field packed as `_gt.x` is
// the axis the GAME calls Z, and `_gt.z` is the game's X. Y agrees. The model is
// left alone — it round-trips through the same packGt the port map was parsed
// with, so it is self-consistent and exports correctly. Only the VIEW transposes.
//
// ponytail: rename `_gt` x/z to their game meaning only if the confusion outlives
// this file — that is a wide, purely cosmetic diff through layout + router.

import { ROTATIONS, type Quaternion } from "./serializer/rotations";

export type Vec3Tuple = [number, number, number];

/** scene = (model.z, model.y, model.x): scene X is game X, scene Z is game Z. */
export const toScene = (x: number, y: number, z: number): Vec3Tuple => [z, y, x];

/** Model cardinal direction → the scene direction that draws it. */
export const DIR_TO_SCENE = {
  "+X": "+Z", "-X": "-Z",
  "+Z": "+X", "-Z": "-X",
  "+Y": "+Y", "-Y": "-Y",
} as const;

/**
 * `_gt.rot` as a scene quaternion. Swapping X and Z is a REFLECTION (det −1), so
 * a model rotation R appears in the scene as M·R·M⁻¹ = the same rotation about the
 * swapped axis with the angle NEGATED. For q = (x, y, z, w) that is (−z, −y, −x, w)
 * — skip it and every block reads mirrored.
 */
export function sceneQuat(rot: number | undefined): Quaternion | undefined {
  const q = rot === undefined ? undefined : ROTATIONS[rot];
  return q && [-q[2], -q[1], -q[0], q[3]];
}
