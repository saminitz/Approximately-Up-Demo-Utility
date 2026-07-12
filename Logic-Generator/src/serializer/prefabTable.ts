// ============================================================================
// PLUGGABLE CONFIG — empirical bridge between OpKeys and in-game binary identities.
// Ground truth: Block List blueprint (1845836d…, v0.1.139) + PD/PID references.
// AsciiHash64 was NOT reverse-engineered — see README §Prefab hashes.
// ============================================================================

import type { OpKey } from "../formula/catalog";

export const FIELD_HASH = {
  guid: 0x5a9afb0dddc03646n,
  gt: 0x674a096805f65dc6n,
  col: 0xa02a12ac78f009a6n,
  value: 0xa5251abf2c8bd1b8n,
  /** Wireless transmitter channel (idx 10, schema offset 20 → disk +24). */
  channel: 0xd4fd95402fe51781n,
} as const;

export const STRUCT_IDX = {
  base: 0, // EPC_SpaceshipComponent  {guid, gt, col}
  cable: 2, // EPC_SCCable            {guid, gt} — rot carries mesh orientation
  constant: 5, // EPC_SCConstant      {guid, gt, value, col}
  wireless: 10, // EPC_SCWirelessTransmitter {guid, gt, channel, col}
  threshold: 15, // EPC_SCSimpleThreshold {guid, gt, value, col}
  remap: 20, // EPC_SCRemapper {guid, gt, inMin, inMax, outMin, outMax, col}
  velocityMeter: 30, // EPC_SCVelocityMeter {guid, gt, …, col}
  differentiator: 31, // EPC_SCDifferentiator {guid, gt, rotKnobValue, col}
  memory: 32, // EPC_SCMemory {guid, gt, mode, col}
  accumulator: 33, // EPC_SCAccumulator {guid, gt, mode, col}
} as const;

export interface PrefabEntry {
  hash: bigint;
  structIndex: number;
  known: boolean;
  note?: string;
}

function base(known = false, hash: bigint, note?: string): PrefabEntry {
  return { hash, structIndex: STRUCT_IDX.base, known, note };
}

// idx-0 signal processors — Block List blueprint (left-to-right, 2026-07).
const ADDER = 0x3b7bbce726d0cc7fn;
const SUBTRACTOR = 0x1c97aba9f33d90c8n;
const MULTIPLIER = 0x0407f3d568e89e48n;
const DIVIDER = 0x00766e1e0f9c8699n;
const MINIMUM = 0x5bd117aa5c9fdf0an;
const MAXIMUM = 0x6d2fdb1b68703078n;
const LOGIC_NOT = 0x72696a5f8c4b74den;
const LOGIC_XOR = 0xeb8fe77ce46f3590n;
const ROUTER2 = 0x592905a5e74d8aaan;
const ROUTER4 = 0x0124dacc6531029an;
const SIGNAL_ROUTER3 = 0x4224391ea20c8575n;

/** Placeholder for ops not present in the Block List reference row. */
const UNKNOWN = ADDER;

export const PREFAB_TABLE: Record<OpKey, PrefabEntry> = {
  constant: {
    hash: 0x9fe80f5af364c2ecn,
    structIndex: STRUCT_IDX.constant,
    known: true,
    note: "Block List #1; _value≈187.4",
  },
  deriv: {
    hash: 0xa198e2ba8fe8844fn,
    structIndex: STRUCT_IDX.differentiator,
    known: true,
    note: "Differentiator; Block List #18, idx 31.",
  },
  integ: {
    hash: 0x5e3e015590584dccn,
    structIndex: STRUCT_IDX.accumulator,
    known: true,
    note: "Accumulator; Block List #20, idx 33.",
  },

  add: {
    hash: ADDER,
    structIndex: STRUCT_IDX.base,
    known: true,
    note: "Block List #5 (SC_Adder).",
  },
  sub: {
    hash: SUBTRACTOR,
    structIndex: STRUCT_IDX.base,
    known: true,
    note: "Block List #6 (SC_Subtractor).",
  },
  mul: {
    hash: MULTIPLIER,
    structIndex: STRUCT_IDX.base,
    known: true,
    note: "Block List #7 (SC_Multiplier).",
  },
  div: {
    hash: DIVIDER,
    structIndex: STRUCT_IDX.base,
    known: true,
    note: "Block List #8 (SC_Divider). Was mislabeled as Addition Array hash.",
  },
  min: {
    hash: MINIMUM,
    structIndex: STRUCT_IDX.base,
    known: true,
    note: "Block List #9 (SC_Minimum).",
  },
  max: {
    hash: MAXIMUM,
    structIndex: STRUCT_IDX.base,
    known: true,
    note: "Block List #10 (SC_Maximum).",
  },
  mod: base(false, UNKNOWN, "TODO: hash of SC_Mod"),
  pow: base(false, UNKNOWN, "TODO: hash of SC_Pow"),
  atan2: base(false, UNKNOWN, "TODO: hash of SC_Atan2"),
  abs: base(false, UNKNOWN, "TODO: hash of SC_Abs"),
  sqrt: base(false, UNKNOWN, "TODO: hash of SC_Sqrt"),
  exp: base(false, UNKNOWN, "TODO: hash of SC_Exp"),
  log: base(false, UNKNOWN, "TODO: hash of SC_Log"),
  sin: base(false, UNKNOWN, "TODO: hash of SC_Sin"),
  cos: base(false, UNKNOWN, "TODO: hash of SC_Cos"),
  tan: base(false, UNKNOWN, "TODO: hash of SC_Tan"),
  asin: base(false, UNKNOWN, "TODO: hash of SC_Asin"),
  acos: base(false, UNKNOWN, "TODO: hash of SC_Acos"),
  atan: base(false, UNKNOWN, "TODO: hash of SC_Atan"),
  sinh: base(false, UNKNOWN, "TODO: hash of SC_Sinh"),
  cosh: base(false, UNKNOWN, "TODO: hash of SC_Cosh"),
  tanh: base(false, UNKNOWN, "TODO: hash of SC_Tanh"),
  asinh: base(false, UNKNOWN, "TODO: hash of SC_Asinh"),
  acosh: base(false, UNKNOWN, "TODO: hash of SC_Acosh"),
  atanh: base(false, UNKNOWN, "TODO: hash of SC_Atanh"),
  not: {
    hash: LOGIC_NOT,
    structIndex: STRUCT_IDX.base,
    known: true,
    note: "Block List #3 (SC_LogicGateNot).",
  },
  xor: {
    hash: LOGIC_XOR,
    structIndex: STRUCT_IDX.base,
    known: true,
    note: "Block List #11 (SC_LogicGateXor).",
  },
  condition: base(false, UNKNOWN, "TODO: hash of SC_Condition"),
  memory: {
    hash: 0x876ad2fe23bf2867n,
    structIndex: STRUCT_IDX.memory,
    known: true,
    note: "Block List #19, idx 32.",
  },
  remap: {
    hash: 0xf45687f85cf62f59n,
    structIndex: STRUCT_IDX.remap,
    known: true,
    note: "Block List #14; inMin=12 inMax=13 outMin=21 outMax=22.",
  },
  threshold: {
    hash: 0x72a389e0f97da2d6n,
    structIndex: STRUCT_IDX.threshold,
    known: true,
    note: "Block List #12; _value≈4.321.",
  },
  router2: {
    hash: ROUTER2,
    structIndex: STRUCT_IDX.base,
    known: true,
    note: "Data Router 2; Block List #15.",
  },
  router4: {
    hash: ROUTER4,
    structIndex: STRUCT_IDX.base,
    known: true,
    note: "Data Router 4; Block List #16. Was 0x1fa8fb58… (wrong).",
  },
  signalRouter3: {
    hash: SIGNAL_ROUTER3,
    structIndex: STRUCT_IDX.base,
    known: true,
    note: "Data Redirector / Signal Router 3; Block List #17.",
  },

  input: {
    hash: 0xfb42bddabfe173edn,
    structIndex: STRUCT_IDX.wireless,
    known: true,
    note: "Wireless Transmitter; Block List #21, channel field idx 10.",
  },
  output: {
    hash: 0xfb42bddabfe173edn,
    structIndex: STRUCT_IDX.wireless,
    known: true,
    note: "Wireless Transmitter — same block for named outputs.",
  },
};

export const CABLE_PREFAB = {
  hash: 0xe60658e2e04f33cen,
  structIndex: STRUCT_IDX.cable,
  known: true,
} as const;

/** Extra blocks from Block List not exposed as formula OpKeys. */
export const BLOCK_LIST_EXTRA: Record<string, PrefabEntry> = {
  logicValue: base(true, 0xe1efc8ed6895b620n, "Block List #2"),
  additionArray: base(true, 0x3b80bdebfdb10fa9n, "Block List #4 (2-cell)"),
  joystickSplitter: base(true, 0x518fdaab8c071134n, "Block List #13"),
  inclinometer: base(true, 0xae0669dbe99d036fn, "Block List #22"),
  rotometer: base(true, 0x955ad7bed99d6821n, "Block List #23"),
  altimeter: base(true, 0x815199777b4f9cdbn, "Block List #24"),
  trajectoryCurvatureMeter: base(true, 0xd32d617963da17c3n, "Block List #25"),
  velocityMeter: {
    hash: 0x550e55971db328fen,
    structIndex: STRUCT_IDX.velocityMeter,
    known: true,
    note: "Block List #26, idx 30.",
  },
  accelerometer: base(true, 0x9a4e18286af91651n, "Block List #27"),
  distanceMeter: base(true, 0xdf2cba30ff100988n, "Block List #28"),
};

/** Default wireless channel for generated I/O blocks (reference compact uses 2). */
export const WIRELESS_DEFAULT_CHANNEL = 1;

/** List of op keys whose prefab hash is still a placeholder. */
export function unknownOpKeys(usedOps: Iterable<OpKey>): OpKey[] {
  const out: OpKey[] = [];
  for (const k of usedOps) if (!PREFAB_TABLE[k].known) out.push(k);
  return out;
}
