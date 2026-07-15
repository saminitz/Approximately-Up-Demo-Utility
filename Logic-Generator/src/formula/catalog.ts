// The logic-operator catalog. This is the SINGLE SOURCE OF TRUTH for which
// operators the formula language exposes — and it is deliberately limited to the
// blocks the game actually provides (SCTypeSignalProcessor + dedicated EPC_SC*).
//
// Every function/operator the parser accepts must resolve to an OpKey here.
// Anything not in this table is rejected by the parser/compiler.

export type OpKey =
  // arithmetic (binary)
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "min"
  | "max"
  | "mod"
  | "pow"
  | "atan2"
  // arithmetic (unary)
  | "abs"
  | "sqrt"
  | "exp"
  | "log"
  // trig (unary)
  | "sin"
  | "cos"
  | "tan"
  | "asin"
  | "acos"
  | "atan"
  | "sinh"
  | "cosh"
  | "tanh"
  | "asinh"
  | "acosh"
  | "atanh"
  // logic
  | "not"
  | "xor"
  | "condition"
  // stateful
  | "deriv"
  | "integ"
  | "memory"
  // signal shaping
  | "remap"
  | "threshold"
  // leaves / terminals (created by the compiler, not written by the user)
  | "constant"
  | "input"
  | "output"
  // routing (available blocks; not produced from formula syntax)
  | "router2"
  | "router4"
  | "signalRouter3";

export type OpCategory =
  | "arithmetic"
  | "trig"
  | "logic"
  | "stateful"
  | "shaping"
  | "routing"
  | "io"
  | "constant";

export interface OpSpec {
  key: OpKey;
  /** Display label shown on the block in the visualization. */
  label: string;
  category: OpCategory;
  /** Input port labels (order matters — matches the block's electric-port array). */
  inputs: string[];
  /** Output port labels. */
  outputs: string[];
  /** Function name(s) usable in a formula, if any. */
  fnNames?: string[];
  /**
   * Trailing call argument stored inside the block (`_value`) instead of being
   * wired to a port — must be a numeric literal. Same deal as a Constant block.
   */
  param?: string;
  /** How the parser may spell it: as an infix operator, a call, or neither. */
  syntax: "infix" | "call" | "internal";
}

export const OPS: Record<OpKey, OpSpec> = {
  add: { key: "add", label: "Adder", category: "arithmetic", inputs: ["a", "b"], outputs: ["out"], syntax: "infix" },
  sub: { key: "sub", label: "Subtractor", category: "arithmetic", inputs: ["a", "b"], outputs: ["out"], syntax: "infix" },
  mul: { key: "mul", label: "Multiplier", category: "arithmetic", inputs: ["a", "b"], outputs: ["out"], syntax: "infix" },
  div: { key: "div", label: "Divider", category: "arithmetic", inputs: ["a", "b"], outputs: ["out"], syntax: "infix" },
  min: { key: "min", label: "Minimum", category: "arithmetic", inputs: ["a", "b"], outputs: ["out"], fnNames: ["min"], syntax: "call" },
  max: { key: "max", label: "Maximum", category: "arithmetic", inputs: ["a", "b"], outputs: ["out"], fnNames: ["max"], syntax: "call" },
  mod: { key: "mod", label: "Mod", category: "arithmetic", inputs: ["a", "b"], outputs: ["out"], fnNames: ["mod"], syntax: "call" },
  pow: { key: "pow", label: "Pow", category: "arithmetic", inputs: ["base", "exp"], outputs: ["out"], fnNames: ["pow"], syntax: "call" },
  atan2: { key: "atan2", label: "Atan2", category: "trig", inputs: ["y", "x"], outputs: ["out"], fnNames: ["atan2"], syntax: "call" },

  abs: { key: "abs", label: "Abs", category: "arithmetic", inputs: ["x"], outputs: ["out"], fnNames: ["abs"], syntax: "call" },
  sqrt: { key: "sqrt", label: "Sqrt", category: "arithmetic", inputs: ["x"], outputs: ["out"], fnNames: ["sqrt"], syntax: "call" },
  exp: { key: "exp", label: "Exp", category: "arithmetic", inputs: ["x"], outputs: ["out"], fnNames: ["exp"], syntax: "call" },
  log: { key: "log", label: "Log", category: "arithmetic", inputs: ["x"], outputs: ["out"], fnNames: ["log"], syntax: "call" },

  sin: { key: "sin", label: "Sin", category: "trig", inputs: ["x"], outputs: ["out"], fnNames: ["sin"], syntax: "call" },
  cos: { key: "cos", label: "Cos", category: "trig", inputs: ["x"], outputs: ["out"], fnNames: ["cos"], syntax: "call" },
  tan: { key: "tan", label: "Tan", category: "trig", inputs: ["x"], outputs: ["out"], fnNames: ["tan"], syntax: "call" },
  asin: { key: "asin", label: "Asin", category: "trig", inputs: ["x"], outputs: ["out"], fnNames: ["asin"], syntax: "call" },
  acos: { key: "acos", label: "Acos", category: "trig", inputs: ["x"], outputs: ["out"], fnNames: ["acos"], syntax: "call" },
  atan: { key: "atan", label: "Atan", category: "trig", inputs: ["x"], outputs: ["out"], fnNames: ["atan"], syntax: "call" },
  sinh: { key: "sinh", label: "Sinh", category: "trig", inputs: ["x"], outputs: ["out"], fnNames: ["sinh"], syntax: "call" },
  cosh: { key: "cosh", label: "Cosh", category: "trig", inputs: ["x"], outputs: ["out"], fnNames: ["cosh"], syntax: "call" },
  tanh: { key: "tanh", label: "Tanh", category: "trig", inputs: ["x"], outputs: ["out"], fnNames: ["tanh"], syntax: "call" },
  asinh: { key: "asinh", label: "Asinh", category: "trig", inputs: ["x"], outputs: ["out"], fnNames: ["asinh"], syntax: "call" },
  acosh: { key: "acosh", label: "Acosh", category: "trig", inputs: ["x"], outputs: ["out"], fnNames: ["acosh"], syntax: "call" },
  atanh: { key: "atanh", label: "Atanh", category: "trig", inputs: ["x"], outputs: ["out"], fnNames: ["atanh"], syntax: "call" },

  not: { key: "not", label: "Logic NOT", category: "logic", inputs: ["x"], outputs: ["out"], fnNames: ["not"], syntax: "call" },
  xor: { key: "xor", label: "Logic XOR", category: "logic", inputs: ["a", "b"], outputs: ["out"], fnNames: ["xor"], syntax: "call" },
  condition: { key: "condition", label: "Condition", category: "logic", inputs: ["a", "b"], outputs: ["out"], fnNames: ["condition"], syntax: "call" },

  deriv: { key: "deriv", label: "Differentiator", category: "stateful", inputs: ["x"], outputs: ["d/dt"], fnNames: ["deriv", "d"], syntax: "call" },
  integ: { key: "integ", label: "Accumulator", category: "stateful", inputs: ["x"], outputs: ["∫"], fnNames: ["integ", "integral"], syntax: "call" },
  memory: { key: "memory", label: "Memory", category: "stateful", inputs: ["x"], outputs: ["out"], fnNames: ["memory"], syntax: "call" },

  remap: { key: "remap", label: "Remapper", category: "shaping", inputs: ["x", "inMin", "inMax", "outMin", "outMax"], outputs: ["out"], fnNames: ["remap"], syntax: "call" },
  threshold: { key: "threshold", label: "Simple Threshold", category: "shaping", inputs: ["x"], outputs: ["out"], fnNames: ["threshold"], param: "t", syntax: "call" },

  constant: { key: "constant", label: "Constant", category: "constant", inputs: [], outputs: ["out"], syntax: "internal" },
  input: { key: "input", label: "Input", category: "io", inputs: [], outputs: ["out"], syntax: "internal" },
  output: { key: "output", label: "Output", category: "io", inputs: ["in"], outputs: [], syntax: "internal" },

  router2: { key: "router2", label: "Router 2", category: "routing", inputs: ["in"], outputs: ["out1", "out2"], syntax: "internal" },
  router4: { key: "router4", label: "Router 4", category: "routing", inputs: ["in"], outputs: ["out1", "out2", "out3", "out4"], syntax: "internal" },
  signalRouter3: { key: "signalRouter3", label: "Signal Router 3", category: "routing", inputs: ["in"], outputs: ["out1", "out2", "out3"], syntax: "internal" },
};

/** Map a formula function name to its OpKey (or undefined if unknown). */
export const FN_TO_OP: Record<string, OpKey> = (() => {
  const m: Record<string, OpKey> = {};
  for (const spec of Object.values(OPS)) {
    for (const n of spec.fnNames ?? []) m[n] = spec.key;
  }
  return m;
})();

/**
 * Ground-truth SCPrefab hashes from the in-game Block List blueprint
 * (1845836d…, bpmeta v0.1.139). See `data/prefab-map.json` for the full table.
 * Keys match OPS labels where an OpKey exists.
 */
export const BLOCK_LIST_HASHES: Partial<Record<OpKey, string>> = {
  constant: "0x9fe80f5af364c2ec",
  not: "0x72696a5f8c4b74de",
  add: "0x3b7bbce726d0cc7f",
  sub: "0x1c97aba9f33d90c8",
  mul: "0x0407f3d568e89e48",
  div: "0x00766e1e0f9c8699",
  min: "0x5bd117aa5c9fdf0a",
  max: "0x6d2fdb1b68703078",
  xor: "0xeb8fe77ce46f3590",
  threshold: "0x72a389e0f97da2d6",
  remap: "0xf45687f85cf62f59",
  router2: "0x592905a5e74d8aaa",
  router4: "0x0124dacc6531029a",
  signalRouter3: "0x4224391ea20c8575",
  deriv: "0xa198e2ba8fe8844f",
  memory: "0x876ad2fe23bf2867",
  integ: "0x5e3e015590584dcc",
  input: "0xfb42bddabfe173ed",
  output: "0xfb42bddabfe173ed",
};
