import { runPipeline } from "./pipeline";

self.onmessage = (e: MessageEvent<string>) => {
  self.postMessage(runPipeline(e.data));
};
