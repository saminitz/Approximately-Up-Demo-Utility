// Per-block port topology extracted from the Block List blueprint cable markers.
// Source of truth: `data/port-map.json` (regenerate via `node scratch/parseBlockListPorts.js --write`).

import type { OpKey } from "../formula/catalog";
import { yawRot } from "../serializer/rotations";
import portMapJson from "../../data/port-map.json";

export type PortFace = "+X" | "-X" | "+Z" | "-Z";

export interface PortOffset {
  face: PortFace;
  /** Grid cells relative to the block anchor cell (`_gt` X/Z). */
  dx: number;
  dz: number;
  /** Cable chain length in the reference blueprint (1 = input stub, 2 = output chain). */
  chainLen?: number;
  /** Ground-truth `_gt.rot` of the first cable cell at this port (Block List). */
  cableRot?: number;
}

export interface PortTopology {
  inputs: PortOffset[];
  outputs: PortOffset[];
}

interface PortMapEntry {
  kind: "input" | "output";
  dx: number;
  dy: number;
  dz: number;
  face: PortFace;
  chainLen?: number;
  cableRot?: number;
  portIndex?: number;
}

interface PortMapBlock {
  name: string;
  opKey: OpKey | null;
  scPrefab: string;
  inputs: number;
  outputs: number;
  ports: PortMapEntry[];
}

const portMap = portMapJson as {
  _stats?: { cables: number; cableChains: number };
  blocks: PortMapBlock[];
};

function topologyFromPorts(ports: PortMapEntry[]): PortTopology {
  const pick = (kind: "input" | "output") =>
    ports
      .filter((p) => p.kind === kind)
      .sort((a, b) => (a.portIndex ?? 0) - (b.portIndex ?? 0))
      .map((p) => ({ face: p.face, dx: p.dx, dz: p.dz, chainLen: p.chainLen, cableRot: p.cableRot }));
  return { inputs: pick("input"), outputs: pick("output") };
}

/** Lookup by OpKey from Block List rows that map to formula ops. */
export const PORT_BY_OP: Partial<Record<OpKey, PortTopology>> = (() => {
  const m: Partial<Record<OpKey, PortTopology>> = {};
  for (const b of portMap.blocks) {
    if (!b.opKey) continue;
    m[b.opKey] = topologyFromPorts(b.ports);
  }
  m.output = m.input;
  return m;
})();

/** Lookup by SCPrefab hash (lowercase 0x… string). */
export const PORT_BY_PREFAB: Record<string, PortTopology> = (() => {
  const m: Record<string, PortTopology> = {};
  for (const b of portMap.blocks) {
    m[b.scPrefab.toLowerCase()] = topologyFromPorts(b.ports);
  }
  return m;
})();

/** Stats from the Block List port parse. */
export const PORT_MAP_STATS = portMap._stats;

const DEFAULT_BINARY: PortTopology = {
  inputs: [
    { face: "-X", dx: -1, dz: 0, chainLen: 1 },
    { face: "-X", dx: -1, dz: 1, chainLen: 1 },
  ],
  outputs: [{ face: "+X", dx: 2, dz: 1, chainLen: 2 }],
};

const DEFAULT_UNARY: PortTopology = {
  inputs: [{ face: "-X", dx: -1, dz: 1, chainLen: 1 }],
  outputs: [{ face: "+X", dx: 2, dz: 1, chainLen: 2 }],
};

const DEFAULT_STATEFUL: PortTopology = {
  inputs: [{ face: "-X", dx: -1, dz: 0, chainLen: 2 }],
  outputs: [{ face: "+X", dx: 2, dz: 1, chainLen: 2 }],
};

const DEFAULT_SOURCE: PortTopology = {
  inputs: [],
  outputs: [{ face: "+X", dx: 2, dz: 1, chainLen: 2 }],
};

const DEFAULT_SINK: PortTopology = {
  inputs: [{ face: "-X", dx: -1, dz: 0, chainLen: 1 }],
  outputs: [],
};

export function topologyForOp(op: OpKey): PortTopology {
  const pinned = PORT_BY_OP[op];
  if (pinned) return pinned;

  switch (op) {
    case "constant":
    case "input":
      return DEFAULT_SOURCE;
    case "output":
      return DEFAULT_SINK;
    case "memory":
    case "integ":
      return DEFAULT_STATEFUL;
    case "not":
    case "deriv":
    case "threshold":
      return PORT_BY_OP[op] ?? DEFAULT_UNARY;
    case "router2":
    case "router4":
    case "signalRouter3":
    case "remap":
      return PORT_BY_OP[op] ?? DEFAULT_BINARY;
    default:
      return DEFAULT_BINARY;
  }
}

/**
 * Block footprint on the X-Z plane, derived from the ground-truth port geometry
 * (port-map.json). Every block is 2 wide in X; its Z-height is 2 or 4 depending
 * on whether any real port reaches beyond the near half (binary/unary span 2,
 * routers/remap span 4). Fed to collision (layout.ts) and the 3D render.
 */
export function footprintForOp(op: OpKey): { w: number; h: number } {
  const t = topologyForOp(op);
  const dz = [...t.inputs, ...t.outputs].map((p) => p.dz);
  const span = dz.length ? Math.max(...dz) - Math.min(...dz) + 1 : 1;
  return { w: 2, h: span > 2 ? 4 : 2 };
}

export function portCell(
  anchor: { x: number; y: number; z: number },
  offset: PortOffset,
): { x: number; y: number; z: number } {
  return { x: anchor.x + offset.dx, y: anchor.y, z: anchor.z + offset.dz };
}

// --- Y-axis rotation (grid quarter-turns) -----------------------------------
// Rotation is about the UNROTATED w×h footprint centre — the same pivot the
// viewer rotates the mesh around, so grid, viewer, and export stay consistent.
// All footprints are even×even, so rotated offsets stay on integer cells.

/** Rotate a plane face by quarter-turns about +Y (+X→−Z→−X→+Z). */
export function rotFace(face: PortFace, turns: number): PortFace {
  const cycle: PortFace[] = ["+X", "-Z", "-X", "+Z"];
  return cycle[(cycle.indexOf(face) + ((turns % 4) + 4) % 4) % 4];
}

/** (dx,dz) anchor-relative offset rotated about the w×h footprint centre. */
function rotOffset(
  dx: number,
  dz: number,
  w: number,
  h: number,
  turns: number,
): { dx: number; dz: number } {
  const cx = (w - 1) / 2;
  const cz = (h - 1) / 2;
  let u = dx - cx;
  let v = dz - cz;
  for (let i = 0; i < ((turns % 4) + 4) % 4; i++) [u, v] = [v, -u];
  return { dx: cx + u, dz: cz + v };
}

/**
 * The grid cells a block occupies at `anchor`, rotated `turns` quarter-turns.
 * turns 0/2 (and any turn of a square block) keep the unrotated rectangle.
 */
export function footprintCellsForOp(
  op: OpKey,
  anchor: { x: number; y: number; z: number },
  turns = 0,
): { x: number; y: number; z: number }[] {
  const { w, h } = footprintForOp(op);
  const cells: { x: number; y: number; z: number }[] = [];
  for (let dx = 0; dx < w; dx++)
    for (let dz = 0; dz < h; dz++) {
      const r = rotOffset(dx, dz, w, h, turns);
      cells.push({ x: anchor.x + r.dx, y: anchor.y, z: anchor.z + r.dz });
    }
  return cells;
}

/**
 * `_gt.rot` of the first cable cell touching a port. Block List convention: cells
 * on the block's west (-X) face use rot 5, east (+X) face use rot 0 (independent
 * of input/output). Uses the parsed ground truth when present, else the dx rule.
 */
export function portRot(off: PortOffset): number {
  return off.cableRot ?? (off.dx < 0 ? 5 : 0);
}

function inputOffset(op: OpKey, portIndex: number): PortOffset {
  const topo = topologyForOp(op);
  return topo.inputs[portIndex] ?? topo.inputs[topo.inputs.length - 1] ?? { face: "-X", dx: -1, dz: 0 };
}

function outputOffset(op: OpKey, portIndex: number): PortOffset {
  const topo = topologyForOp(op);
  return topo.outputs[portIndex] ?? topo.outputs[0] ?? { face: "+X", dx: 2, dz: 1 };
}

/** Port cell with the block rotated `turns` quarter-turns (0 = today's output). */
function rotatedPortCell(
  op: OpKey,
  anchor: { x: number; y: number; z: number },
  off: PortOffset,
  turns: number,
): { x: number; y: number; z: number } {
  if (!turns) return portCell(anchor, off);
  const { w, h } = footprintForOp(op);
  const r = rotOffset(off.dx, off.dz, w, h, turns);
  return { x: anchor.x + r.dx, y: anchor.y, z: anchor.z + r.dz };
}

export function inputPortCell(
  op: OpKey,
  anchor: { x: number; y: number; z: number },
  portIndex: number,
  turns = 0,
): { x: number; y: number; z: number } {
  return rotatedPortCell(op, anchor, inputOffset(op, portIndex), turns);
}

export function outputPortCell(
  op: OpKey,
  anchor: { x: number; y: number; z: number },
  portIndex: number,
  turns = 0,
): { x: number; y: number; z: number } {
  return rotatedPortCell(op, anchor, outputOffset(op, portIndex), turns);
}

export function inputPortRot(op: OpKey, portIndex: number, turns = 0): number {
  const r = portRot(inputOffset(op, portIndex));
  return turns ? yawRot(r, turns) : r;
}

export function outputPortRot(op: OpKey, portIndex: number, turns = 0): number {
  const r = portRot(outputOffset(op, portIndex));
  return turns ? yawRot(r, turns) : r;
}

/**
 * Direction from a port cell toward the block it attaches to, derived from the
 * offset alone (blocks are 2 wide in X; ports sit just outside). Works for tall
 * router/remap blocks where a fixed-size footprint scan would miss the block.
 */
export function portInto(off: PortOffset): PortFace {
  if (off.dx <= -1) return "+X";
  if (off.dx >= 2) return "-X";
  return off.dz <= -1 ? "+Z" : "-Z";
}

export function inputPortInto(op: OpKey, portIndex: number, turns = 0): PortFace {
  return rotFace(portInto(inputOffset(op, portIndex)), turns);
}

export function outputPortInto(op: OpKey, portIndex: number, turns = 0): PortFace {
  return rotFace(portInto(outputOffset(op, portIndex)), turns);
}
