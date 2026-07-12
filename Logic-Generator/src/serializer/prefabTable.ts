// ============================================================================
// PLUGGABLE CONFIG — the empirical bridge between our OpKeys and the game's
// binary identities. Finalize this once AsciiHash64 is cracked (scratch/REPORT.md
// §5) and the full per-op prefab hashes are pinned from in-game samples.
// ============================================================================
//
// Two things identify a serialized block in a .bp payload record:
//   1. SCPrefab (uint64)  — AsciiHash64("SC_<Name>") [algorithm still unknown]
//   2. headerStructIndex (int32) — which BlueprintData layout it uses
//
// Confirmed hashes come from parsing the real reference blueprints
// (data/*.bp, scratch/game-mined/blueprints/*). Everything marked known:false is
// a PLACEHOLDER: we reuse a valid generic signal-processor identity so the emitted
// file stays structurally valid and loads, but the block type will be wrong until
// the real hash is supplied.

import type { OpKey } from "../formula/catalog";

// --- Field name hashes (scratch/REPORT.md §4, harvested Rosetta pairs) ---------
// NOTE: the schema header documents `_guid` as 16 bytes at offset 0, but the game
// stores a 20-byte entity id; `_gt` therefore lives at data+0x14 (GT_REPORT_v2.md).
export const FIELD_HASH = {
  guid: 0x5a9afb0dddc03646n,
  gt: 0x674a096805f65dc6n,
  col: 0xa02a12ac78f009a6n,
  value: 0xa5251abf2c8bd1b8n,
  shape: 0x4df7cfb5963d7138n,
  type: 0x522adc952e25206bn,
} as const;

// --- Header struct indices (this game version = v0.1.139) ---------------------
// From scratch/REPORT.md §4 + entity analysis of the reference blueprints.
export const STRUCT_IDX = {
  base: 0, // EPC_SpaceshipComponent  {guid, gt, col}          — all signal processors
  cable: 2, // EPC_SCCable            {guid, gt, shape, type, col}
  constant: 5, // EPC_SCConstant      {guid, gt, value, col}
  differentiator: 31, // EPC_SCDifferentiator {guid, gt, rotKnobValue, col}
  accumulator: 33, // EPC_SCAccumulator {guid, gt, mode, col}
} as const;

export interface PrefabEntry {
  /** SCPrefab uint64. */
  hash: bigint;
  /** Header struct index whose BlueprintData layout this block uses. */
  structIndex: number;
  /** True if `hash` is empirically confirmed; false if it is a placeholder. */
  known: boolean;
  /** Optional note describing provenance / what still needs confirming. */
  note?: string;
}

// A confirmed, real signal-processor prefab hash (idx 0). Used as the fallback
// identity for not-yet-mapped base-struct ops so the file still parses in-game.
// (Most common idx-0 prefab across the reference set — likely Adder/Subtractor.)
const GENERIC_SIGNAL_PROC = 0x0407f3d568e89e48n;

function base(known = false, hash = GENERIC_SIGNAL_PROC, note?: string): PrefabEntry {
  return { hash, structIndex: STRUCT_IDX.base, known, note };
}

// ----------------------------------------------------------------------------
// Op -> blueprint identity table.
// ----------------------------------------------------------------------------
export const PREFAB_TABLE: Record<OpKey, PrefabEntry> = {
  // Confirmed identities ------------------------------------------------------
  constant: {
    hash: 0x9fe80f5af364c2ecn,
    structIndex: STRUCT_IDX.constant,
    known: true,
    note: "Confirmed vs GT_REPORT sample + reference record 0.",
  },
  deriv: {
    hash: 0xa198e2ba8fe8844fn,
    structIndex: STRUCT_IDX.differentiator,
    known: true,
    note: "Differentiator (D term); struct idx 31, hash from reference PD blueprint.",
  },
  integ: {
    hash: 0x5e3e015590584dccn,
    structIndex: STRUCT_IDX.accumulator,
    known: true,
    note: "Accumulator (I term); struct idx 33, hash from reference PID blueprint.",
  },

  // Base-struct signal processors — hashes still to pin (TODO) ----------------
  add: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Adder"),
  sub: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Subtractor"),
  mul: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Multiplier"),
  div: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Divider"),
  min: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Minimum"),
  max: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Maximum"),
  mod: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Mod"),
  pow: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Pow"),
  atan2: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Atan2"),
  abs: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Abs"),
  sqrt: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Sqrt"),
  exp: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Exp"),
  log: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Log"),
  sin: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Sin"),
  cos: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Cos"),
  tan: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Tan"),
  asin: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Asin"),
  acos: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Acos"),
  atan: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Atan"),
  sinh: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Sinh"),
  cosh: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Cosh"),
  tanh: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Tanh"),
  asinh: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Asinh"),
  acosh: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Acosh"),
  atanh: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Atanh"),
  not: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_LogicGateNot"),
  xor: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_LogicGateXor"),
  condition: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Condition"),
  memory: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Memory (struct idx TBD)"),
  remap: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Remapper (struct idx ~20)"),
  threshold: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_SimpleThreshold"),
  router2: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Router2"),
  router4: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_Router4"),
  signalRouter3: base(false, GENERIC_SIGNAL_PROC, "TODO: hash of SC_SignalRouter3"),

  // I/O terminals — TODO: identify the real input/output terminal prefabs.
  input: base(false, GENERIC_SIGNAL_PROC, "TODO: named-input terminal prefab"),
  output: base(false, GENERIC_SIGNAL_PROC, "TODO: named-output terminal prefab"),
};

// Cable prefab (primary variant), confirmed empirically.
export const CABLE_PREFAB = {
  hash: 0xe60658e2e04f33cen,
  structIndex: STRUCT_IDX.cable,
  known: true,
} as const;

/** List of op keys whose prefab hash is still a placeholder. */
export function unknownOpKeys(usedOps: Iterable<OpKey>): OpKey[] {
  const out: OpKey[] = [];
  for (const k of usedOps) if (!PREFAB_TABLE[k].known) out.push(k);
  return out;
}
