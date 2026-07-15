import { useMemo, useState } from "react";
import "./App.css";
import { Circuit3D } from "./components/Circuit3D";
import { runPipeline } from "./pipeline";
import { OPS } from "./formula/catalog";
import {
  downloadBytes,
  exportBlueprintZip,
} from "./serializer/exportZip";
import { BLUEPRINT_GAME_VERSION } from "./serializer/bpmeta";

const EXAMPLES: { name: string; src: string }[] = [
  {
    name: "PD controller",
    src: `// PD controller: named vars become input/output blocks.
error = target - position
control = Kp * error + Kd * deriv(error)`,
  },
  {
    name: "PID controller",
    src: `error = target - position
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

export default function App() {
  const [src, setSrc] = useState(EXAMPLES[0].src);
  const [name, setName] = useState("My Logic");
  const [folder, setFolder] = useState("80 Controllers");
  const [emitCables, setEmitCables] = useState(true);
  const [lastExport, setLastExport] = useState<string | null>(null);

  const result = useMemo(() => runPipeline(src), [src]);

  const onExport = () => {
    if (!result.ok) return;
    const res = exportBlueprintZip(result.laid, {
      name,
      folder,
      emitCables,
    });
    downloadBytes(res.zip, res.zipName);
    setLastExport(
      `Exported ${res.zipName} — ${res.build.blockRecords} blocks, ` +
        `${res.build.cableRecords} cable cells, files: ${res.files.join(", ")}.`,
    );
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <h1>Logic Generator</h1>
          <p>Formula → Approximately Up blueprint compiler</p>
        </div>

        <div className="section">
          <label className="title" htmlFor="formula">
            Formula
          </label>
          <textarea
            id="formula"
            className="formula-area"
            spellCheck={false}
            value={src}
            onChange={(e) => setSrc(e.target.value)}
          />
          <div className="actions" style={{ flexWrap: "wrap" }}>
            {EXAMPLES.map((ex) => (
              <button key={ex.name} onClick={() => setSrc(ex.src)} title={`Load "${ex.name}"`}>
                {ex.name}
              </button>
            ))}
          </div>
        </div>

        <Diagnostics result={result} />

        {result.ok && (
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
          <label className="title">Blueprint</label>
          <div className="field-row">
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span>Folder</span>
              <input value={folder} onChange={(e) => setFolder(e.target.value)} />
            </label>
          </div>
          <div className="toggles">
            <label>
              <input type="checkbox" checked={emitCables} onChange={(e) => setEmitCables(e.target.checked)} />
              Emit cable cells (provisional)
            </label>
          </div>
          <div className="actions">
            <button className="primary" onClick={onExport} disabled={!result.ok}>
              Download blueprint ZIP
            </button>
          </div>
          {lastExport && <p className="footnote">{lastExport}</p>}
        </div>

        <p className="footnote">
          Blueprint schema header taken verbatim from a real v{BLUEPRINT_GAME_VERSION}{" "}
          reference file. Operator prefab hashes and cable geometry are partly
          provisional — see the warnings above and the README.
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
          {result.ok ? (
            <Circuit3D laid={result.laid} />
          ) : (
            <div className="empty">Fix the formula to see the circuit.</div>
          )}
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

function Diagnostics({ result }: { result: ReturnType<typeof runPipeline> }) {
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
        <b>Provisional export.</b> These operators have unconfirmed prefab hashes
        and will import as a generic block until pinned:
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
