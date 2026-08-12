import type { MapProject } from "./domain";

export type GenerationWorkerPhase = "queued" | "generating";

export interface GenerationWorkerProgress {
  phase: GenerationWorkerPhase;
  message: string;
}

export interface GenerationWorkerRequest {
  type: "generate";
  requestId: string;
  project: MapProject;
}

export type GenerationWorkerResponse =
  | {
    type: "progress";
    requestId: string;
    progress: GenerationWorkerProgress;
  }
  | {
    type: "complete";
    requestId: string;
    project: MapProject;
  }
  | {
    type: "error";
    requestId: string;
    message: string;
  };

export interface ProjectGenerationTask {
  promise: Promise<MapProject>;
  cancel(): void;
}

export interface GenerationWorkerPort {
  onmessage: ((event: MessageEvent<GenerationWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: GenerationWorkerRequest): void;
  terminate(): void;
}

export type GenerationWorkerFactory = () => GenerationWorkerPort;

export interface StartProjectGenerationOptions {
  onProgress?: (progress: GenerationWorkerProgress) => void;
  workerFactory?: GenerationWorkerFactory;
}

let requestSequence = 0;

async function defaultWorkerFactory(): Promise<GenerationWorkerPort> {
  if (typeof Worker === "undefined") {
    throw new Error("This browser does not support background map generation.");
  }
  // Keep the bundler-only ?worker import out of Node's TypeScript test graph.
  // The adapter still resolves to a static Vite chunk in the browser build.
  const { createBrowserGenerationWorker } = await import("./generationWorkerBrowser");
  return createBrowserGenerationWorker();
}

function abortError(): DOMException {
  return new DOMException("Map generation was cancelled.", "AbortError");
}

/**
 * Run deterministic atlas generation in a disposable module worker.
 *
 * The input crosses the structured-clone boundary and the caller receives a
 * result only after the worker completes. Cancelling terminates the worker, so
 * a partially generated project can never leak back into application state.
 */
export function startProjectGeneration(
  project: MapProject,
  options: StartProjectGenerationOptions = {},
): ProjectGenerationTask {
  const requestId = `generation-${Date.now().toString(36)}-${(++requestSequence).toString(36)}`;
  let worker: GenerationWorkerPort | undefined;
  let rejectTask: (reason?: unknown) => void = () => undefined;
  let settled = false;

  options.onProgress?.({
    phase: "queued",
    message: `Preparing ${project.planes.length} planned plane${project.planes.length === 1 ? "" : "s"} for background generation…`,
  });

  const promise = new Promise<MapProject>((resolve, reject) => {
    rejectTask = reject;
    const finish = () => {
      worker?.terminate();
      worker = undefined;
    };

    const startWorker = async () => {
      try {
        const candidate = options.workerFactory ? options.workerFactory() : await defaultWorkerFactory();
        if (settled) {
          candidate.terminate();
          return;
        }
        worker = candidate;
        worker.onmessage = (event) => {
          const response = event.data;
          if (settled || response.requestId !== requestId) return;
          if (response.type === "progress") {
            options.onProgress?.(response.progress);
            return;
          }
          settled = true;
          finish();
          if (response.type === "complete") resolve(response.project);
          else reject(new Error(response.message));
        };

        worker.onerror = (event) => {
          if (settled) return;
          settled = true;
          finish();
          reject(new Error(event.message || "The background generator stopped unexpectedly."));
        };
        worker.postMessage({ type: "generate", requestId, project });
      } catch (error) {
        if (settled) return;
        settled = true;
        finish();
        reject(error);
      }
    };
    void startWorker();
  });

  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      worker?.terminate();
      worker = undefined;
      rejectTask(abortError());
    },
  };
}

export function isGenerationAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
