import { runPipeline, type PipelineRequest } from "./pipeline";

self.onmessage = (e: MessageEvent<PipelineRequest>) => {
  self.postMessage(runPipeline(e.data.src, e.data.algo));
};
