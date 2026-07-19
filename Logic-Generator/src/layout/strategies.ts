// Placement algorithm registry — mirrors the OPS / PREFAB_TABLE record pattern.
// Each algorithm is (graph) => LaidOutGraph and owns its options internally, so
// a future strategy with different constraints only adds an entry here.

import type { BlockGraph } from "../compiler/graph";
import { layoutDense } from "./dense";
import { layoutGraph, type LaidOutGraph } from "./layout";

export type LayoutAlgo = "dense" | "layered";

export const LAYOUT_ALGOS: Record<
  LayoutAlgo,
  { label: string; run: (g: BlockGraph) => LaidOutGraph }
> = {
  dense: { label: "Dense (rotated)", run: layoutDense },
  layered: { label: "Layered grid", run: (g) => layoutGraph(g) },
};

export const DEFAULT_ALGO: LayoutAlgo = "dense";
