// Generate a fresh sample PD-controller blueprint ZIP with the app's OWN

// serializer, so the user can import it in-game to verify placement fixes.

// Run with:  npx vite-node scripts/makeSample.ts

import { mkdirSync, writeFileSync } from "node:fs";

import { dirname, resolve } from "node:path";

import { fileURLToPath } from "node:url";

import { runPipeline } from "../src/pipeline";

import { exportBlueprintZip } from "../src/serializer/exportZip";

import { GT_DATA_OFFSET } from "../src/serializer/bpWriter";

import { packGt, unpackGt } from "../src/serializer/gtCodec";

import { ROT_UPRIGHT } from "../src/serializer/rotations";



const VERSION = "0.1.3";

const FORMULA = "u = Kp*(t - p) + Kd*deriv(t - p)";



const here = dirname(fileURLToPath(import.meta.url));

const outDir = resolve(here, "..", "samples");

mkdirSync(outDir, { recursive: true });



const res = runPipeline(FORMULA);

if (!res.ok) throw new Error("pipeline failed: " + res.message);



const exp = exportBlueprintZip(res.laid, {

  name: `PD_Sample_Logic-Generator_${VERSION}`,

  folder: "80 Controllers",

  uuid: "0f1c1c11-0101-4101-8101-1090eec70101",

});



const zipPath = resolve(outDir, exp.zipName);

writeFileSync(zipPath, exp.zip);



const sample = res.laid.nodes.slice(0, 5).map((n) => {

  const c = n.cell!;

  const gt = packGt({ x: c.x, y: c.y, z: c.z, rot: ROT_UPRIGHT });

  return {

    op: n.op,

    cell: c,

    gt: "0x" + gt.toString(16).padStart(8, "0"),

    decoded: unpackGt(gt),

    gtOffset: "data+0x" + GT_DATA_OFFSET.toString(16),

  };

});



console.log("Wrote ZIP:", zipPath);

console.log("ZIP entries:", exp.files.join(", "));

console.log("blocks:", exp.build.blockRecords, "cables:", exp.build.cableRecords);

console.log("stats:", JSON.stringify(res.stats));

console.log("first cells:", JSON.stringify(sample, null, 2));

