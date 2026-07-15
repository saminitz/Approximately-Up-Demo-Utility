import { useEffect, useRef, useState } from "react";
import type { PipelineResult } from "./pipeline";

/** Quiet time after the last edit before a run starts. */
const DEBOUNCE_MS = 400;

/**
 * Runs the pipeline off the main thread. Each edit restarts the debounce; when it
 * fires, any in-flight run is killed (terminate — the pipeline is synchronous and
 * has no other cancel point) and a fresh worker runs the current source. The last
 * good result stays visible until the new one lands.
 */
export function usePipeline(src: string) {
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [running, setRunning] = useState(true);
  const worker = useRef<Worker | null>(null);

  useEffect(() => {
    setRunning(true);
    const timer = setTimeout(() => {
      worker.current?.terminate();
      const w = new Worker(new URL("./pipeline.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.current = w;
      w.onmessage = (e: MessageEvent<PipelineResult>) => {
        setResult(e.data);
        setRunning(false);
      };
      w.postMessage(src);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [src]);

  useEffect(() => () => worker.current?.terminate(), []);

  return { result, running };
}
