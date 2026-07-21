// Blueprint persistence. Saved blueprints live in IndexedDB (one entry per id);
// the live editor state ("draft") lives in localStorage so it can be read
// synchronously during the first render — an async restore would flash the
// wrong formula and burn a worker compile on it.

import { del, entries, set } from "idb-keyval";
import { DEFAULT_ALGO, type LayoutAlgo } from "./layout/strategies";

/** Everything the editor holds. Saved records and the draft share these fields. */
export type Blueprint = {
  id: string;
  name: string;
  folder: string;
  src: string;
  algo: LayoutAlgo;
  emitCables: boolean;
  savedAt: number;
};

/** Live editor state: a blueprint plus where it came from, if anywhere. */
export type Draft = Omit<Blueprint, "id" | "savedAt"> & {
  sourceId: string | null;
  sourceKind: "saved" | "example" | null;
};

const DRAFT_KEY = "logicgen.draft";
const WARNED_KEY = "logicgen.storageWarned";

/** Shown once, before the very first save. Browser storage is not a safe home. */
export const STORAGE_WARNING =
  "Heads up: blueprints are saved inside this browser only.\n\n" +
  "They are not uploaded anywhere and there is no backup. Clearing site data, " +
  "browsing privately, or the browser reclaiming space can erase them at any " +
  "time, and they will not follow you to another browser or machine.\n\n" +
  "Download the blueprint ZIP for anything you want to keep for good.\n\n" +
  "Save it here anyway?";

export const wasWarned = () => {
  try {
    return localStorage.getItem(WARNED_KEY) === "1";
  } catch {
    return false;
  }
};

export const markWarned = () => {
  try {
    localStorage.setItem(WARNED_KEY, "1");
  } catch {
    /* ignore */
  }
};

export const exampleDraft = (folder: string, ex: { name: string; src: string }): Draft => ({
  ...newDraft(folder, ex.src, ex.name),
  sourceId: ex.name,
  sourceKind: "example",
});

export const newDraft = (folder: string, src = "", name = ""): Draft => ({
  name,
  folder,
  src,
  algo: DEFAULT_ALGO,
  emitCables: true,
  sourceId: null,
  sourceKind: null,
});

export const draftOf = (bp: Blueprint): Draft => ({
  name: bp.name,
  folder: bp.folder,
  src: bp.src,
  algo: bp.algo,
  emitCables: bp.emitCables,
  sourceId: bp.id,
  sourceKind: "saved",
});

/**
 * True when the draft differs from the record it came from (or is unsaved work).
 * Examples are compared on formula and name only — they carry no folder/algo/cables,
 * so tweaking those is not something a switch-away prompt should nag about.
 */
export function isDirty(draft: Draft, saved: Blueprint[], examples: { name: string; src: string }[]): boolean {
  if (draft.sourceKind === "saved") {
    const bp = saved.find((b) => b.id === draft.sourceId);
    if (!bp) return true;
    return (
      bp.name !== draft.name ||
      bp.folder !== draft.folder ||
      bp.src !== draft.src ||
      bp.algo !== draft.algo ||
      bp.emitCables !== draft.emitCables
    );
  }
  if (draft.sourceKind === "example") {
    const ex = examples.find((e) => e.name === draft.sourceId);
    return !ex || ex.src !== draft.src || ex.name !== draft.name;
  }
  return draft.src.trim() !== "" || draft.name.trim() !== "";
}

/** The saved record this name would collide with, ignoring the draft's own record. */
export const collision = (name: string, saved: Blueprint[], selfId: string | null) =>
  saved.find((b) => b.id !== selfId && b.name.trim() === name.trim());

export function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    // Guard against a hand-edited or older payload rather than rendering junk.
    return typeof d?.src === "string" && typeof d?.name === "string" ? d : null;
  } catch {
    return null;
  }
}

export function saveDraft(draft: Draft): void {
  // A full disk / private-mode throw here is not worth interrupting typing over;
  // the explicit Save path reports its failures instead.
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* ignore */
  }
}

/** Saved blueprints, newest first. A corrupt store reads as empty, never throws. */
export async function loadAll(): Promise<Blueprint[]> {
  try {
    const rows = await entries<string, Blueprint>();
    return rows
      .map(([, b]) => b)
      .filter((b) => b && typeof b.src === "string")
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export const putBlueprint = (bp: Blueprint) => set(bp.id, bp);
export const deleteBlueprint = (id: string) => del(id);
