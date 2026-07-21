import { compileFormula } from "./compiler/compiler";
import type { OpKey } from "./formula/catalog";
import { FormulaError } from "./formula/tokens";
import type { LaidOutGraph } from "./layout/layout";
import { DEFAULT_ALGO, LAYOUT_ALGOS, type LayoutAlgo } from "./layout/strategies";
import { PREFAB_TABLE } from "./serializer/prefabTable";

/** UI → worker message. */
export interface PipelineRequest {
  src: string;
  algo: LayoutAlgo;
  /** Allow blocks the game's demo build lacks (`?allblocks`). */
  allBlocks: boolean;
}

export interface PipelineSuccess {
  ok: true;
  laid: LaidOutGraph;
  stats: {
    blocks: number;
    edges: number;
    inputs: number;
    outputs: number;
    cableCells: number;
  };
  /** Op keys used that still have a placeholder (unconfirmed) prefab hash. */
  unknownOps: OpKey[];
}

export interface PipelineFailure {
  ok: false;
  message: string;
  /** Character offset of the error in the source, if known. */
  pos?: number;
}

export type PipelineResult = PipelineSuccess | PipelineFailure;

export function runPipeline(
  src: string,
  algo: LayoutAlgo = DEFAULT_ALGO,
  allBlocks = false,
): PipelineResult {
  try {
    const graph = compileFormula(src, allBlocks);
    const laid = LAYOUT_ALGOS[algo].run(graph);

    const used = new Set<OpKey>(laid.nodes.map((n) => n.op));
    const unknownOps = [...used].filter((k) => !PREFAB_TABLE[k].known).sort();
    const cableCells = laid.cableCells.length;

    return {
      ok: true,
      laid,
      unknownOps,
      stats: {
        blocks: laid.nodes.length,
        edges: laid.edges.length,
        inputs: laid.inputs.length,
        outputs: laid.outputs.length,
        cableCells,
      },
    };
  } catch (err) {
    if (err instanceof FormulaError) {
      return { ok: false, message: err.message, pos: err.pos };
    }
    return { ok: false, message: (err as Error).message ?? String(err) };
  }
}
