import { useEffect, useState } from "react";
import "./App.css";
import { Circuit3D } from "./components/Circuit3D";
import { FIXTURES } from "./fixtures";
import { ALL_BLOCKS, DEBUG } from "./flags";
import { DEMO_UNAVAILABLE, OPS, type OpKey } from "./formula/catalog";
import type { LaidOutGraph } from "./layout/layout";
import { LAYOUT_ALGOS, type LayoutAlgo } from "./layout/strategies";
import type { PipelineResult } from "./pipeline";
import { BLUEPRINT_GAME_VERSION } from "./serializer/bpmeta";
import { downloadBytes, exportBlueprintZip } from "./serializer/exportZip";
import {
  clampWidth,
  collision,
  deleteBlueprint,
  draftOf,
  exampleDraft,
  isDirty,
  loadAll,
  loadDraft,
  loadWidth,
  markWarned,
  newDraft,
  putBlueprint,
  saveDraft,
  saveWidth,
  STORAGE_WARNING,
  wasWarned,
  type Blueprint,
  type Draft,
} from "./store";
import { usePipeline } from "./usePipeline";

const ALL_EXAMPLES: { name: string; src: string }[] = [
  {
    name: "PD controller",
    src: `// PD controller: named vars become input/output blocks.
Kp = 0.002
Kd = 0.0003
error = target - position
control = Kp * error + Kd * deriv(error)`,
  },
  {
    name: "PID controller",
    src: `// PID controller: named vars become input/output blocks.
Kp = 0.002
Ki = 0.0001
Kd = 0.0003
error = target - position
control = Kp*error + Ki*integral(error) + Kd*deriv(error)`,
  },
  {
    name: "Altitude hold",
    src: `error = targetAlt - altitude
damp = Kd * deriv(altitude)
thrust = clamp0 + Kp * error - damp
clamp0 = 0.5`,
  },
  {
    name: "Vector magnitude",
    src: `speed = sqrt(vx*vx + vy*vy + vz*vz)`,
  },
  {
    name: "6-DOF stabilizer (complex)",
    src: `// Heavy mix: arithmetic, trig, stateful, logic, shaping. No sqrt block.
altError  = targetAlt - altitude
altRate   = deriv(altitude)
altInteg  = integral(altError)
altPID    = Kp*altError + Ki*altInteg - Kd*altRate

tiltMag   = abs(pitch) + abs(roll)
tilt      = atan2(pitch, roll)
gyroMix   = gx*gx + gy*gy + gz*gz
spin      = pow(gyroMix, 0.5)          // root without the sqrt block
damp      = tanh(spin) * max(tiltMag, 0.001)

heading   = atan2(yaw, tilt)
wrap      = mod(heading, 6.2831853)
osc       = sin(wrap) * cos(altRate) + tan(min(damp, 1.5))

gate      = xor(threshold(altError, 0.0), not(condition(spin, spinLimit)))
gated     = condition(gate, altPID)

shaped    = remap(gated, -10, 10, -1, 1)
memHold   = memory(shaped)
expTerm   = exp(-abs(shaped)) + log(1 + tiltMag)

thrust    = memHold + osc*0.25 - damp*0.1 + expTerm`,
  },
];

const LEGEND: { label: string; color: string }[] = [
  { label: "arithmetic", color: "#3b82f6" },
  { label: "trig", color: "#a855f7" },
  { label: "logic", color: "#ef4444" },
  { label: "stateful", color: "#f59e0b" },
  { label: "shaping", color: "#14b8a6" },
  { label: "input", color: "#22c55e" },
  { label: "output", color: "#ec4899" },
  { label: "constant", color: "#94a3b8" },
];

const enabled = (k: OpKey) => ALL_BLOCKS || !DEMO_UNAVAILABLE.has(k);

// Reference card: every operator/function the compiler accepts right now.
const OPERATORS = ["a + b", "a - b", "a * b", "a / b", "-a", ...(enabled("pow") ? ["a ^ b"] : [])];
const FUNCTIONS = Object.values(OPS)
  .filter((s) => s.fnNames && enabled(s.key))
  .map((s) => `${s.fnNames!.join("/")}(${[...s.inputs, ...(s.params ?? [])].join(", ")})`)
  .sort();

// Examples built on blocks the demo lacks would just fail to compile.
const DISABLED_FN = new RegExp(`\\b(${[...DEMO_UNAVAILABLE].flatMap((k) => OPS[k].fnNames ?? []).join("|")})\\s*\\(`);
const EXAMPLES = ALL_BLOCKS ? ALL_EXAMPLES : ALL_EXAMPLES.filter((e) => !DISABLED_FN.test(e.src));

export default function App() {
  // The whole editor is one draft object so it can be persisted and compared
  // against its saved record in one shot. Restored synchronously on first render.
  const [draft, setDraft] = useState<Draft>(() => loadDraft() ?? exampleDraft("", EXAMPLES[0]));
  const [saved, setSaved] = useState<Blueprint[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState<string | null>(null);
  // A calibration fixture takes over the viewer while selected; the formula
  // pipeline keeps running underneath, untouched.
  const [fixture, setFixture] = useState<{ name: string; laid: LaidOutGraph } | null>(null);

  const { src, name, folder, algo, emitCables } = draft;
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const [width, setWidth] = useState(() => loadWidth(window.innerWidth));

  useEffect(() => void loadAll().then(setSaved), []);
  useEffect(() => saveDraft(draft), [draft]);
  useEffect(() => saveWidth(width), [width]);

  // Drag the divider; the window listeners keep tracking even when the pointer
  // outruns the 6px handle or leaves the window entirely.
  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const move = (ev: PointerEvent) => setWidth(clampWidth(startW + ev.clientX - startX, window.innerWidth));
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const dirty = isDirty(draft, saved, EXAMPLES);
  /** Nothing may replace the editor contents without the user's blessing. */
  const mayReplace = () => !dirty || confirm(`Discard unsaved changes${name.trim() ? ` to “${name.trim()}”` : ""}?`);

  const onSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!wasWarned()) {
      if (!confirm(STORAGE_WARNING)) return;
      markWarned();
    }
    const ownId = draft.sourceKind === "saved" ? draft.sourceId : null;
    const hit = collision(trimmed, saved, ownId);
    if (hit && !confirm(`A blueprint named “${hit.name}” already exists. Replace it?`)) return;
    const bp: Blueprint = {
      id: ownId ?? hit?.id ?? crypto.randomUUID(),
      name: trimmed,
      folder,
      src,
      algo,
      emitCables,
      savedAt: Date.now(),
    };
    try {
      await putBlueprint(bp);
      // A rename onto another record's name replaces it; our own id survives.
      if (hit && hit.id !== bp.id) await deleteBlueprint(hit.id);
    } catch (e) {
      setStatus(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setSaved((prev) => [bp, ...prev.filter((b) => b.id !== bp.id && b.id !== hit?.id)]);
    patch({ name: trimmed, sourceId: bp.id, sourceKind: "saved" });
    setStatus(null);
  };

  const onDelete = async (bp: Blueprint) => {
    if (!confirm(`Delete “${bp.name}”?`)) return;
    try {
      await deleteBlueprint(bp.id);
    } catch (e) {
      setStatus(`Could not delete: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setSaved((prev) => prev.filter((b) => b.id !== bp.id));
    // The editor keeps what it shows; it just no longer points at a record.
    if (draft.sourceId === bp.id) patch({ sourceId: null, sourceKind: null });
  };

  const { result, running } = usePipeline(src, algo);
  const shown = fixture ? fixture.laid : result?.ok ? result.laid : null;

  const doExport = (laid: LaidOutGraph, bpName: string, cables: boolean) => {
    const res = exportBlueprintZip(laid, { name: bpName, folder, emitCables: cables });
    downloadBytes(res.zip, res.zipName);
    setLastExport(
      `Exported ${res.zipName} — ${res.build.blockRecords} blocks, ` +
        `${res.build.cableRecords} cable cells, files: ${res.files.join(", ")}.`,
    );
  };

  const onExport = () => {
    if (result?.ok) doExport(result.laid, name, emitCables);
  };

  return (
    <div className="app" style={{ gridTemplateColumns: `${width}px 1fr` }}>
      <aside className="sidebar">
        <div
          className="resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          tabIndex={0}
          onPointerDown={onResizeStart}
          onKeyDown={(e) => {
            const step = e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
            if (step) setWidth((w) => clampWidth(w + step, window.innerWidth));
          }}
        />
        <div className="brand">
          <h1>Logic Generator</h1>
          <p>Formula → Approximately Up blueprint compiler</p>
        </div>

        <div className="section">
          <label className="title">Blueprints</label>
          <div className="bp-list">
            {saved.map((bp) => (
              <div key={bp.id} className={`bp-row${draft.sourceId === bp.id ? " active" : ""}`}>
                <button
                  className="bp-open"
                  onClick={() => mayReplace() && setDraft(draftOf(bp))}
                  title={`Load “${bp.name}”${bp.folder ? ` (${bp.folder})` : ""}`}
                >
                  {bp.name}
                  {draft.sourceId === bp.id && dirty && <b title="Unsaved changes"> •</b>}
                </button>
                <button className="bp-del" onClick={() => onDelete(bp)} title={`Delete “${bp.name}”`}>
                  ×
                </button>
              </div>
            ))}
            {saved.length > 0 && <div className="bp-divider" />}
            {EXAMPLES.map((ex) => (
              <div key={ex.name} className={`bp-row${draft.sourceId === ex.name ? " active" : ""}`}>
                <button
                  className="bp-open"
                  onClick={() => mayReplace() && setDraft(exampleDraft(folder, ex))}
                  title={`Load the “${ex.name}” example`}
                >
                  {ex.name}
                  {draft.sourceId === ex.name && dirty && <b title="Unsaved changes"> •</b>}
                </button>
                <span className="bp-tag">example</span>
              </div>
            ))}
          </div>
          <div className="actions">
            <button onClick={() => mayReplace() && setDraft(newDraft(folder))} title="Start an empty formula">
              New
            </button>
            {/* Anything not already backed by a record stays savable, even when the
                only edit was one isDirty deliberately ignores (an example's folder). */}
            <button
              className="primary"
              onClick={onSave}
              disabled={!name.trim() || (draft.sourceKind === "saved" && !dirty)}
              title={name.trim() ? "Save to this browser" : "Give the blueprint a name first"}
            >
              Save
            </button>
          </div>
          <div className="field-row">
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(e) => patch({ name: e.target.value })} />
            </label>
            <label className="field">
              <span>Folder</span>
              <input value={folder} onChange={(e) => patch({ folder: e.target.value })} />
            </label>
          </div>
          {status && <p className="footnote error">{status}</p>}
        </div>

        <div className="section">
          <label className="title" htmlFor="formula">
            Formula
          </label>{" "}
          <details className="section syntax">
            <summary>Syntax reference</summary>
            <p className="footnote">
              One assignment per line: <code>name = expression</code>. A name that is never assigned becomes an input
              block, a name nothing else reads becomes an output. <code>//</code> starts a comment. Arguments after the
              wired inputs (remap bounds, threshold level) must be literal numbers — they are stored on the block
              itself.
            </p>
            <div className="chips">
              {[...OPERATORS, ...FUNCTIONS].map((s) => (
                <code key={s}>{s}</code>
              ))}
            </div>
          </details>
          <textarea
            id="formula"
            className="formula-area"
            spellCheck={false}
            value={src}
            onChange={(e) => patch({ src: e.target.value })}
          />
        </div>

        <div className="section">
          <label className="title">Layout</label>
          <div className="actions" style={{ flexWrap: "wrap" }}>
            {(Object.keys(LAYOUT_ALGOS) as LayoutAlgo[]).map((k) => (
              <button
                key={k}
                className={algo === k ? "primary" : undefined}
                onClick={() => patch({ algo: k })}
                title={`Place blocks with the "${LAYOUT_ALGOS[k].label}" algorithm`}
              >
                {LAYOUT_ALGOS[k].label}
              </button>
            ))}
          </div>
        </div>

        <Diagnostics result={result} running={running} />

        {result?.ok && (
          <div className="section">
            <label className="title">Circuit</label>
            <div className="stats">
              <Stat n={result.stats.blocks} label="blocks" />
              <Stat n={result.stats.edges} label="connections" />
              <Stat n={result.stats.inputs} label="inputs" />
              <Stat n={result.stats.outputs} label="outputs" />
            </div>
          </div>
        )}

        <div className="section">
          <label className="title">Export</label>
          <div className="toggles">
            <label>
              <input type="checkbox" checked={emitCables} onChange={(e) => patch({ emitCables: e.target.checked })} />
              Include visible cables (experimental)
            </label>
          </div>
          <div className="actions">
            <button className="primary" onClick={onExport} disabled={!result?.ok || running}>
              Download blueprint ZIP
            </button>
          </div>
          {lastExport && <p className="footnote">{lastExport}</p>}
        </div>

        {DEBUG && (
          <div className="section">
            <label className="title">Calibration blueprints</label>
            <div className="actions" style={{ flexWrap: "wrap" }}>
              {FIXTURES.map((f) => (
                <button
                  key={f.name}
                  className={fixture?.name === f.name ? "primary" : undefined}
                  onClick={() => setFixture({ name: f.name, laid: f.build() })}
                  title={`Show the "${f.name}" fixture in the viewer`}
                >
                  {f.name}
                </button>
              ))}
            </div>
            {fixture && (
              <div className="actions" style={{ flexWrap: "wrap" }}>
                <button className="primary" onClick={() => doExport(fixture.laid, `Calib ${fixture.name}`, true)}>
                  Download “{fixture.name}” ZIP
                </button>
                <button onClick={() => setFixture(null)}>Back to formula</button>
              </div>
            )}
            <p className="footnote">
              Synthetic fixtures for diffing the viewer against a hand-built in-game copy. Index is encoded by position:
              item i sits i steps along +X from the anchor, bracketed by constants reading 0 (start) and 100 (end).
              Blocks and bare cable cells are drawn at their real <code>_gt.rot</code>.
            </p>
            <p className="footnote">
              <b>Axis markers</b> anchors at grid (0,0,0) and spells the axes with block values: <code>0</code> =
              origin, <code>1</code> = +X, <code>2</code> = +Y (up),
              <code>3</code> = +Z — each 4 cells out from the origin block.
            </p>
          </div>
        )}

        <p className="footnote">
          Blueprint schema header taken verbatim from a real v{BLUEPRINT_GAME_VERSION} reference file. Operator prefab
          hashes and cable geometry are partly provisional — see the warnings above and the README.
        </p>
      </aside>

      <section className="canvas-wrap">
        <div className="canvas-toolbar">
          <div className="legend">
            {LEGEND.map((l) => (
              <span key={l.label}>
                <i style={{ background: l.color }} /> {l.label}
              </span>
            ))}
          </div>
          <div className="spacer" />
          <span className="footnote">
            cables bend as in-game (L within a block) · drag orbit · scroll zoom · right-drag pan
          </span>
        </div>
        <div className="canvas-view">
          {shown ? (
            <Circuit3D laid={shown} />
          ) : (
            !running && <div className="empty">Fix the formula to see the circuit.</div>
          )}
          {running && !fixture && <div className="spinner" title="Refreshing circuit" />}
        </div>
      </section>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="stat">
      <b>{n}</b>
      <span>{label}</span>
    </div>
  );
}

function Diagnostics({ result, running }: { result: PipelineResult | null; running: boolean }) {
  if (running) return <div className="diag">Compiling…</div>;
  if (!result) return null;
  if (!result.ok) {
    return (
      <div className="diag error">
        <b>Error:</b> {result.message}
        {result.pos !== undefined && <span> (at position {result.pos})</span>}
      </div>
    );
  }
  if (result.unknownOps.length > 0) {
    return (
      <div className="diag warn">
        <b>Provisional export.</b> These operators have unconfirmed prefab hashes and will import as a generic block
        until pinned:
        <ul>
          {result.unknownOps.map((op) => (
            <li key={op}>
              <code>{OPS[op].label}</code>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return <div className="diag ok">Circuit compiled. All used blocks are mapped.</div>;
}
