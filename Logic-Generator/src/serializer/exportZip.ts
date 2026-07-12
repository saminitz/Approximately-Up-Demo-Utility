import { zipSync } from "fflate";
import type { LaidOutGraph } from "../layout/layout";
import { buildBp, DEFAULT_BP_OPTIONS, type BpBuildResult } from "./bpWriter";
import { buildBpMeta, type BpMeta } from "./bpmeta";
import { buildBpex } from "./bpex";
import { ROT_UPRIGHT } from "./rotations";

export interface ExportOptions extends BpMeta {
  /** Include the 192 KiB .bpex sidecar (default true). */
  includeBpex?: boolean;
  /** Emit provisional cable-cell records (default true). */
  emitCables?: boolean;
  /** Explicit blueprint UUID (otherwise generated). */
  uuid?: string;
}

export interface ExportResult {
  zip: Uint8Array;
  zipName: string;
  uuid: string;
  build: BpBuildResult;
  files: string[];
}

function uuidv4(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Compile a laid-out graph to a downloadable ZIP of blueprint files. */
export function exportBlueprintZip(
  laid: LaidOutGraph,
  opts: ExportOptions,
): ExportResult {
  const uuid = opts.uuid ?? uuidv4();
  const build = buildBp(laid, {
    ...DEFAULT_BP_OPTIONS,
    emitCables: opts.emitCables ?? true,
    rot: ROT_UPRIGHT,
  });
  const meta = buildBpMeta(opts);

  const files: Record<string, Uint8Array> = {
    [`${uuid}.bp`]: build.bytes,
    [`${uuid}.bpmeta`]: meta,
  };
  if (opts.includeBpex ?? true) {
    files[`${uuid}.bpex`] = buildBpex();
  }

  const zip = zipSync(files, { level: 6 });
  return {
    zip,
    zipName: `${sanitize(opts.name)}.zip`,
    uuid,
    build,
    files: Object.keys(files),
  };
}

function sanitize(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "blueprint";
}

/** Trigger a browser download of a byte array. */
export function downloadBytes(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], {
    type: "application/zip",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
