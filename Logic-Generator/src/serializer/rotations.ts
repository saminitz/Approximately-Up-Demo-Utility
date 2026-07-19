// The 24 orientations of the chiral octahedral rotation group, read verbatim from
// GarageTransform::ROTATIONS in lib_burst_generated.dll (.data @ RVA 0x00db7940).
// Source: scratch/gt-extract/GT_REPORT.md §4. Index 16 = identity.
//
// Each entry is a quaternion (x, y, z, w).

export type Quaternion = readonly [number, number, number, number];

const S = 0.70710677; // sqrt(1/2), stored bit pattern 0x3f3504f3

export const ROTATIONS: readonly Quaternion[] = [
  [0.5, 0.5, 0.5, 0.5], //  0  120° about (1,1,1)
  [-0.5, 0.5, -0.5, 0.5], //  1
  [-S, 0, -S, 0], //  2  180° about (1,0,1)
  [0, S, 0, S], //  3  90° about +Y
  [-0.5, -0.5, 0.5, 0.5], //  4
  [0.5, -0.5, -0.5, 0.5], //  5
  [0, -S, 0, S], //  6  -90° about +Y
  [S, 0, -S, 0], //  7  180° about (1,0,-1)
  [-S, 0, 0, S], //  8  -90° about +X
  [0, S, S, 0], //  9  180° about (0,1,1)
  [-0.5, -0.5, -0.5, 0.5], // 10
  [-0.5, 0.5, 0.5, 0.5], // 11
  [S, 0, 0, S], // 12  90° about +X
  [0, S, -S, 0], // 13  180° about (0,1,-1)
  [-0.5, 0.5, -0.5, -0.5], // 14
  [0.5, 0.5, -0.5, 0.5], // 15
  [0, 0, 0, 1], // 16  IDENTITY
  [0, 0, -1, 0], // 17  180° about +Z
  [0, 0, S, S], // 18  90° about +Z
  [0, 0, -S, S], // 19  -90° about +Z
  [1, 0, 0, 0], // 20  180° about +X
  [0, -1, 0, 0], // 21  180° about +Y
  [-S, -S, 0, 0], // 22  180° about (1,1,0)
  [S, -S, 0, 0], // 23  180° about (1,-1,0)
];

/** Index of the identity quaternion inside ROTATIONS. */
export const ROT_IDENTITY = 16;

/** Hamilton product, (x, y, z, w) order. */
function mulQuat(a: Quaternion, b: Quaternion): Quaternion {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** Rotate a vector by a quaternion, (x, y, z, w) order. */
export function rotateVec(q: Quaternion, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const t: Vec3 = [
    2 * (y * v[2] - z * v[1]),
    2 * (z * v[0] - x * v[2]),
    2 * (x * v[1] - y * v[0]),
  ];
  return [
    v[0] + w * t[0] + (y * t[2] - z * t[1]),
    v[1] + w * t[1] + (z * t[0] - x * t[2]),
    v[2] + w * t[2] + (x * t[1] - y * t[0]),
  ];
}

export type Vec3 = readonly [number, number, number];

/**
 * MEASURED correction between `ROTATIONS[i]` and the orientation the game really
 * renders for `_gt.rot = i`.
 *
 * Ground truth: the pair `75a8487b… Generated Calib All block rotations.bp` (24
 * adders written at rot 0..23) and `d4fcd73f… Actual All block rotations.bp` (the
 * same 24 orientations rebuilt by hand in-game). Diffing them by cell gives a
 * bijection generated→actual — and every one of the 24 entries is the SAME fixed
 * local yaw, so this is one constant rather than a lookup table:
 *
 *   ROTATIONS[actual] = ROTATIONS[generated] ⊗ ROT_LOCAL_FIX
 *
 * i.e. the game's mesh frame sits a local +90° about Y from this table's. The
 * table itself is still the verbatim DLL array — the offset is in what the mesh
 * does with it, so the fix is applied on read via {@link gameQuat}, not by
 * permuting ground truth.
 */
export const ROT_LOCAL_FIX: Quaternion = [0, S, 0, S]; // +90° about +Y, local

/** Inverse of {@link ROT_LOCAL_FIX}. */
const ROT_LOCAL_FIX_INV: Quaternion = [0, -S, 0, S];

/**
 * The orientation the game actually renders for `_gt.rot = rot` — i.e. what a
 * viewer must draw. This is the corrected read of {@link ROTATIONS}; see
 * {@link ROT_LOCAL_FIX}.
 */
export function gameQuat(rot: number): Quaternion {
  return mulQuat(ROTATIONS[rot] ?? ROTATIONS[ROT_IDENTITY], ROT_LOCAL_FIX_INV);
}

/**
 * Reference upright rotation from GT_REPORT_v2.md §5 (PD Target Distance record 0):
 * `_gt=0x332030D8` → rot=6 (`(0, -√½, 0, √½)`, −90° about +Y).
 */
export const ROT_UPRIGHT = 6;

/**
 * Default rotation for generated logic blocks: 180° yaw (+Y) from {@link ROT_UPRIGHT},
 * so input ports face the compiler's left-to-right cable routing (rot 6 had ports swapped).
 * rot 6 = −90° Y, rot 3 = +90° Y → 180° apart.
 */
export const ROT_LOGIC = 3;

/** One grid quarter-turn: +90° about +Y (maps +X→−Z on the circuit plane). */
const YAW_QUARTER = ROTATIONS[3];

/**
 * Compose `quarterTurns` world +90°-Y steps onto a base orientation and return
 * the matching {@link ROTATIONS} index (q ≅ −q). The local mesh fix cancels in
 * the composition, so this is exact for any base. Sanity: yawRot(ROT_UPRIGHT, 2)
 * === ROT_LOGIC, the documented 180°-apart pair.
 */
export function yawRot(base: number, quarterTurns: number): number {
  let q = ROTATIONS[base] ?? ROTATIONS[ROT_IDENTITY];
  const n = ((quarterTurns % 4) + 4) % 4;
  for (let i = 0; i < n; i++) q = mulQuat(YAW_QUARTER, q);
  const near = (r: Quaternion, s: 1 | -1) =>
    r.every((v, i) => Math.abs(v - s * q[i]) < 1e-4);
  return ROTATIONS.findIndex((r) => near(r, 1) || near(r, -1));
}
