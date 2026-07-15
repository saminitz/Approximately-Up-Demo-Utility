// Per-block port topology extracted from the Block List blueprint cable markers.
// Source of truth: `data/port-map.json` (regenerate via `node scratch/parseBlockListPorts.js --write`).

import type { OpKey } from "../formula/catalog";
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

function enrichTopology(op: OpKey, topo: PortTopology): PortTopology {
  const inputs = [...topo.inputs];
  const outputs = [...topo.outputs];

  if (op === "remap") {
    const base = inputs[0] ?? { face: "+Z" as PortFace, dx: 2, dz: 3, chainLen: 1 };
    for (let i = inputs.length; i < 5; i++) {
      inputs.push({ ...base, dz: base.dz + (i - inputs.length) });
    }
  }

  return { inputs, outputs };
}

/** Lookup by OpKey from Block List rows that map to formula ops. */
export const PORT_BY_OP: Partial<Record<OpKey, PortTopology>> = (() => {
  const m: Partial<Record<OpKey, PortTopology>> = {};
  for (const b of portMap.blocks) {
    if (!b.opKey) continue;
    m[b.opKey] = enrichTopology(b.opKey, topologyFromPorts(b.ports));
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

export function inputPortCell(
  op: OpKey,
  anchor: { x: number; y: number; z: number },
  portIndex: number,
): { x: number; y: number; z: number } {
  return portCell(anchor, inputOffset(op, portIndex));
}

export function outputPortCell(
  op: OpKey,
  anchor: { x: number; y: number; z: number },
  portIndex: number,
): { x: number; y: number; z: number } {
  return portCell(anchor, outputOffset(op, portIndex));
}

export function inputPortRot(op: OpKey, portIndex: number): number {
  return portRot(inputOffset(op, portIndex));
}

export function outputPortRot(op: OpKey, portIndex: number): number {
  return portRot(outputOffset(op, portIndex));
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

export function inputPortInto(op: OpKey, portIndex: number): PortFace {
  return portInto(inputOffset(op, portIndex));
}

export function outputPortInto(op: OpKey, portIndex: number): PortFace {
  return portInto(outputOffset(op, portIndex));
}
