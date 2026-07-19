import type { OpKey } from "../formula/catalog";

/** A logic block instance in the compiled circuit. */
export interface BlockNode {
  id: string;
  op: OpKey;
  label: string;
  inputs: string[]; // input port labels
  outputs: string[]; // output port labels
  /** For `constant` blocks: the literal value. */
  value?: number;
  /** Literals stored in the block's own fields, aligned to `OpSpec.params`. */
  params?: number[];
  /** For `input`/`output` terminals: the named signal. */
  signalName?: string;
  /** Layout result (grid cells), filled by the layout engine. */
  cell?: { x: number; y: number; z: number };
  /** Explicit `_gt.rot` override. Set by the dense layout (rotated blocks) and
   * the calibration fixtures. Unset = the exporter's per-op default. */
  rot?: number;
  /** Grid quarter-turns about +Y that `rot` encodes, kept so the viewer and
   * port math can rotate offsets without inverting the quaternion. Unset = 0. */
  turns?: number;
}

export interface PortRef {
  blockId: string;
  /** Port index within the block's inputs/outputs array. */
  port: number;
}

/** A signal connection from one block's output port to another's input port. */
export interface Edge {
  id: string;
  from: PortRef; // source output port
  to: PortRef; // target input port
}

export interface BlockGraph {
  nodes: BlockNode[];
  edges: Edge[];
  inputs: string[]; // named input signals (free variables)
  outputs: string[]; // named output signals
}
