import GenerationWorkerConstructor from "./generation.worker.ts?worker";
import type { GenerationWorkerPort } from "./generationWorker";

/**
 * Vite's worker constructor emits an origin-relative worker asset. Keeping it
 * in this lazy browser adapter prevents vinext from baking an RSC file:// base
 * into client code and lets Node unit tests inject a fake worker without
 * evaluating a bundler query import.
 */
export function createBrowserGenerationWorker(): GenerationWorkerPort {
  return new GenerationWorkerConstructor({ name: "pantokrator-atlas-generator" });
}
