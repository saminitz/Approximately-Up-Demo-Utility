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
      .map((p) => ({ face: p.face, dx: p.dx, dz: p.dz, chainLen: p.chainLen }));
  return { inputs: pick("input"), outputs: pick("output") };
}

function enrichTopology(op: OpKey, topo: PortTopology): PortTopology {
  const inputs = [...topo.inputs];
  const outputs = [...topo.outputs];

  if (op === "threshold" && inputs.length === 1 && outputs.length === 1) {
    inputs.push({ face: "+X", dx: 2, dz: 1, chainLen: 1 });
  }

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
    { face: "+X", dx: 2, dz: 1, chainLen: 1 },
    { face: "+X", dx: 3, dz: 1, chainLen: 1 },
  ],
  outputs: [{ face: "-X", dx: -1, dz: 0, chainLen: 2 }],
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

export function portCell(
  anchor: { x: number; y: number; z: number },
  offset: PortOffset,
): { x: number; y: number; z: number } {
  return { x: anchor.x + offset.dx, y: anchor.y, z: anchor.z + offset.dz };
}

export function inputPortCell(
  op: OpKey,
  anchor: { x: number; y: number; z: number },
  portIndex: number,
): { x: number; y: number; z: number } {
  const topo = topologyForOp(op);
  const off = topo.inputs[portIndex] ?? topo.inputs[topo.inputs.length - 1] ?? { face: "-X", dx: -1, dz: 0 };
  return portCell(anchor, off);
}

export function outputPortCell(
  op: OpKey,
  anchor: { x: number; y: number; z: number },
  portIndex: number,
): { x: number; y: number; z: number } {
  const topo = topologyForOp(op);
  const off = topo.outputs[portIndex] ?? topo.outputs[0] ?? { face: "+X", dx: 2, dz: 1 };
  return portCell(anchor, off);
}
