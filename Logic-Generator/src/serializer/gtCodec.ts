// `uint _gt` (GarageTransform) pack / unpack.
//
// PROVEN layout (scratch/gt-extract/GT_REPORT.md §3, reverse-engineered from both
// GarageTransform.Encode and .Decode machine code):
//
//   bits  0..8   -> X  (9-bit unsigned, 0..511)   grid cell X
//   bits  9..17  -> Y  (9-bit unsigned, 0..511)   grid cell Y
//   bits 18..26  -> Z  (9-bit unsigned, 0..511)   grid cell Z
//   bits 27..31  -> rot (5-bit, index 0..23 into ROTATIONS[24])
//
//   _gt = X | (Y << 9) | (Z << 18) | (rot << 27)
//
// Grid cell size = 0.125 local units, corner origin (no centering bias):
//   localPos = float3(X,Y,Z) * 0.125 + rotate(ROTATIONS[rot], prefabOffset)
//
// NOTE / OPEN ITEM: GT_REPORT_v2.md corrected an earlier mis-read — `_gt` lives at
// data+0x14 (after a 20-byte entity id), not at data+0x10. The pack/unpack below is
// plain and matches the native Encode/Decode machine code.

import { ROT_UPRIGHT } from "./rotations";

export const GRID_CELL_SIZE = 0.125;
const MASK9 = 0x1ff;

export interface GtFields {
  x: number;
  y: number;
  z: number;
  rot: number;
}

const clampCell = (v: number): number => {
  const i = Math.round(v);
  if (i < 0) return 0;
  if (i > MASK9) return MASK9;
  return i;
};

/** Pack grid cell + rotation index into the 32-bit `_gt` word (unsigned). */
export function packGt({ x, y, z, rot = ROT_UPRIGHT }: Partial<GtFields>): number {
  const X = clampCell(x ?? 0);
  const Y = clampCell(y ?? 0);
  const Z = clampCell(z ?? 0);
  const R = rot & 0x1f;
  // >>> 0 keeps the result an unsigned 32-bit integer.
  return (X | (Y << 9) | (Z << 18) | (R << 27)) >>> 0;
}

/** Unpack a `_gt` word back into grid cell + rotation index. */
export function unpackGt(gt: number): GtFields {
  const g = gt >>> 0;
  return {
    x: g & MASK9,
    y: (g >>> 9) & MASK9,
    z: (g >>> 18) & MASK9,
    rot: (g >>> 27) & 0x1f,
  };
}

/** Convert a packed cell to its decoded local position (ignoring prefab offset). */
export function cellToLocalPos(gt: number): [number, number, number] {
  const { x, y, z } = unpackGt(gt);
  return [x * GRID_CELL_SIZE, y * GRID_CELL_SIZE, z * GRID_CELL_SIZE];
}
