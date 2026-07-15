import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { CircuitCanvas } from "./components/CircuitCanvas";
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
  // One state for the whole view transform so zoom+pan update atomically.
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [lastExport, setLastExport] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const result = useMemo(() => runPipeline(src), [src]);

  // Center the circuit in the pane at the given zoom. Uses the SVG's natural
  // viewBox size (zoom-independent) so it doesn't depend on the current render.
  const recenter = (zoom = view.zoom) => {
    const wrap = wrapRef.current;
    const svg = viewRef.current?.querySelector("svg");
    if (!wrap || !svg) return;
    const nw = svg.viewBox.baseVal.width;
    const nh = svg.viewBox.baseVal.height;
    setView({
      zoom,
      x: (wrap.clientWidth - nw * zoom) / 2,
      y: (wrap.clientHeight - nh * zoom) / 2,
    });
  };

  // Zoom toward a screen point (px relative to the pane), keeping it pinned.
  const zoomAround = (nz: number, px: number, py: number) =>
    setView((v) => ({
      zoom: nz,
      x: px - ((px - v.x) * nz) / v.zoom,
      y: py - ((py - v.y) * nz) / v.zoom,
    }));

  const zoomToCenter = (nz: number) => {
    const wrap = wrapRef.current;
    if (wrap) zoomAround(nz, wrap.clientWidth / 2, wrap.clientHeight / 2);
  };

  // Recenter whenever the circuit changes (new formula → new size).
  useEffect(() => {
    recenter(view.zoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // Ctrl/Cmd + scroll zooms around the cursor; plain scroll is left alone.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      setView((v) => {
        const nz = Math.min(2.5, Math.max(0.3, +(v.zoom * Math.exp(-e.deltaY * 0.001)).toFixed(3)));
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        return { zoom: nz, x: px - ((px - v.x) * nz) / v.zoom, y: py - ((py - v.y) * nz) / v.zoom };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Left-click drag pans the view; the circuit data is untouched.
  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".canvas-toolbar")) return;
    dragRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.style.cursor = "grabbing";
  };
  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    dragRef.current = null;
    e.currentTarget.style.cursor = "grab";
  };

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

      <section
        className="canvas-wrap"
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <div className="canvas-toolbar">
          <div className="legend">
            {LEGEND.map((l) => (
              <span key={l.label}>
                <i style={{ background: l.color }} /> {l.label}
              </span>
            ))}
          </div>
          <div className="spacer" />
          <button onClick={() => zoomToCenter(Math.max(0.3, +(view.zoom - 0.1).toFixed(2)))}>−</button>
          <span style={{ width: 44, textAlign: "center" }}>{Math.round(view.zoom * 100)}%</span>
          <button onClick={() => zoomToCenter(Math.min(2.5, +(view.zoom + 0.1).toFixed(2)))}>+</button>
          <button onClick={() => recenter(1)}>Reset</button>
        </div>
        <div
          className="canvas-view"
          ref={viewRef}
          style={{ transform: `translate(${view.x}px, ${view.y}px)` }}
        >
          {result.ok ? (
            <CircuitCanvas laid={result.laid} zoom={view.zoom} />
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
