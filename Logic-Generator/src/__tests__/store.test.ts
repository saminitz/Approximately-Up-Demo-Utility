import { describe, expect, it } from "vitest";
import {
  collision,
  draftOf,
  exampleDraft,
  isDirty,
  loadDraft,
  markWarned,
  newDraft,
  saveDraft,
  wasWarned,
  type Blueprint,
} from "../store";

// Tests run in the node environment; the draft only needs a key/value bag.
const bag = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => bag.get(k) ?? null,
  setItem: (k: string, v: string) => void bag.set(k, v),
  removeItem: (k: string) => void bag.delete(k),
  clear: () => bag.clear(),
} as unknown as Storage;

const bp = (over: Partial<Blueprint> = {}): Blueprint => ({
  id: "id-1",
  name: "PD",
  folder: "80 Controllers",
  src: "a = b + c",
  algo: "dense",
  emitCables: true,
  savedAt: 1,
  ...over,
});

const EXAMPLES = [{ name: "Vector magnitude", src: "speed = sqrt(x*x)" }];

describe("isDirty", () => {
  it("is false for an untouched saved blueprint and true after any field changes", () => {
    const rec = bp();
    expect(isDirty(draftOf(rec), [rec], EXAMPLES)).toBe(false);
    expect(isDirty({ ...draftOf(rec), src: "a = 1" }, [rec], EXAMPLES)).toBe(true);
    expect(isDirty({ ...draftOf(rec), folder: "other" }, [rec], EXAMPLES)).toBe(true);
    expect(isDirty({ ...draftOf(rec), emitCables: false }, [rec], EXAMPLES)).toBe(true);
  });

  it("is true when the source record is gone", () => {
    expect(isDirty(draftOf(bp()), [], EXAMPLES)).toBe(true);
  });

  it("ignores folder/algo on examples but tracks the formula", () => {
    const d = exampleDraft("anything", EXAMPLES[0]);
    expect(isDirty(d, [], EXAMPLES)).toBe(false);
    expect(isDirty({ ...d, folder: "elsewhere", algo: "layered" }, [], EXAMPLES)).toBe(false);
    expect(isDirty({ ...d, src: "speed = 0" }, [], EXAMPLES)).toBe(true);
  });

  it("treats sourceless work as dirty only when it has content", () => {
    expect(isDirty(newDraft("80 Controllers"), [], EXAMPLES)).toBe(false);
    expect(isDirty(newDraft("", "x = 1"), [], EXAMPLES)).toBe(true);
  });
});

describe("collision", () => {
  const saved = [bp(), bp({ id: "id-2", name: "Hover" })];

  it("finds another record with the same trimmed name, never itself", () => {
    expect(collision("Hover", saved, null)?.id).toBe("id-2");
    expect(collision("  Hover ", saved, null)?.id).toBe("id-2");
    expect(collision("Hover", saved, "id-2")).toBeUndefined();
    expect(collision("Fresh", saved, null)).toBeUndefined();
  });
});

describe("draft persistence", () => {
  it("round-trips and falls back to null on junk", () => {
    const d = exampleDraft("80 Controllers", EXAMPLES[0]);
    saveDraft(d);
    expect(loadDraft()).toEqual(d);
    localStorage.setItem("logicgen.draft", "{not json");
    expect(loadDraft()).toBeNull();
    localStorage.setItem("logicgen.draft", JSON.stringify({ nope: 1 }));
    expect(loadDraft()).toBeNull();
    localStorage.clear();
    expect(loadDraft()).toBeNull();
  });

  it("remembers that the storage warning was shown", () => {
    localStorage.clear();
    expect(wasWarned()).toBe(false);
    markWarned();
    expect(wasWarned()).toBe(true);
  });
});
