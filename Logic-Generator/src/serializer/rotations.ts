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
