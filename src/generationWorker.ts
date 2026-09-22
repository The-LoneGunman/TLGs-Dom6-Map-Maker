import {
  hasConnectedRegionStabilization,
  primeConnectedRegionStabilization,
  type ConnectedRegionStabilization,
} from "./connectedRegions";
import type { MapProject, Plane } from "./domain";
import { usesConnectedRegions } from "./geometry";

export type GenerationWorkerPhase = "queued" | "generating";

export interface GenerationWorkerProgress {
  phase: GenerationWorkerPhase;
  message: string;
}

/** A connected-region plane's native stabilization, computed off the main thread. */
export interface PlaneStabilization {
  planeId: string;
  stabilization: ConnectedRegionStabilization;
}

export type GenerationWorkerRequest =
  | {
    type: "generate";
    requestId: string;
    project: MapProject;
    /** Also scan each generated connected-region plane before completing. */
    stabilizeConnectedRegions?: boolean;
  }
  | {
    type: "stabilize";
    requestId: string;
    planes: Plane[];
  };

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
    stabilizations?: PlaneStabilization[];
  }
  | {
    type: "stabilized";
    requestId: string;
    stabilizations: PlaneStabilization[];
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
  /**
   * Have the worker also compute each connected-region plane's native-pixel
   * stabilization and prime this thread with it, so the first validation and
   * render of the result skip that multi-second scan. Only worth it for a
   * result that will be opened in the editor.
   */
  stabilizeConnectedRegions?: boolean;
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
          if (settled || response.requestId !== requestId || response.type === "stabilized") return;
          if (response.type === "progress") {
            options.onProgress?.(response.progress);
            return;
          }
          settled = true;
          finish();
          if (response.type === "complete") {
            primePlaneStabilizations(response.project.planes, response.stabilizations);
            resolve(response.project);
          } else reject(new Error(response.message));
        };

        worker.onerror = (event) => {
          if (settled) return;
          settled = true;
          finish();
          reject(new Error(event.message || "The background generator stopped unexpectedly."));
        };
        worker.postMessage({
          type: "generate",
          requestId,
          project,
          ...(options.stabilizeConnectedRegions ? { stabilizeConnectedRegions: true } : {}),
        });
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

/** Prime this thread with worker results; each one is checked against its plane's current signature. */
export function primePlaneStabilizations(planes: readonly Plane[], stabilizations: readonly PlaneStabilization[] | undefined): number {
  let primed = 0;
  for (const item of stabilizations ?? []) {
    const plane = planes.find((candidate) => candidate.id === item.planeId);
    if (plane && primeConnectedRegionStabilization(plane, item.stabilization)) primed += 1;
  }
  return primed;
}

export interface ConnectedRegionPreparationTask {
  /** Planes sent to background workers; 0 when nothing needs scanning. */
  pending: number;
  /** Resolves with the number of planes primed; never rejects. */
  promise: Promise<number>;
  cancel(): void;
}

export interface PrepareConnectedRegionsOptions {
  workerFactory?: GenerationWorkerFactory;
  /** Parallel workers; defaults to the spare hardware threads, at most 4. */
  concurrency?: number;
  /** Give up (the scan then runs on demand as before) after this long. */
  timeoutMs?: number;
}

/**
 * Before an opened atlas (autosave restore or import) is shown, scan its
 * connected-region planes in background workers and prime this thread, so the
 * first validation and render do not block the editor for seconds. This is a
 * pure cache warm-up: on any worker failure, timeout or cancellation it simply
 * resolves, and the affected planes compute the same result on first use.
 */
export function prepareConnectedRegionsInBackground(
  project: MapProject,
  options: PrepareConnectedRegionsOptions = {},
): ConnectedRegionPreparationTask {
  let queue: Plane[];
  try {
    queue = project.planes.filter((plane) =>
      usesConnectedRegions(plane) && plane.provinces.length > 0 && !hasConnectedRegionStabilization(plane));
  } catch {
    queue = [];
  }
  const pending = queue.length;
  if (!pending) return { pending, promise: Promise.resolve(0), cancel: () => undefined };
  const workers = new Set<GenerationWorkerPort>();
  let finish: () => void = () => undefined;
  let primed = 0;
  let done = false;
  const promise = new Promise<number>((resolve) => {
    finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      for (const worker of workers) worker.terminate();
      workers.clear();
      resolve(primed);
    };
    const timeout = setTimeout(finish, options.timeoutMs ?? 30_000);
    const hardware = typeof navigator === "undefined" ? 2 : navigator.hardwareConcurrency || 2;
    const concurrency = Math.max(1, Math.min(queue.length, options.concurrency ?? Math.min(4, hardware - 1)));
    let active = concurrency;
    const run = async () => {
      let retired = false;
      let port: GenerationWorkerPort | undefined;
      const retire = () => {
        if (retired) return;
        retired = true;
        if (port) {
          port.terminate();
          workers.delete(port);
        }
        active -= 1;
        if (active <= 0) finish();
      };
      try {
        port = options.workerFactory ? options.workerFactory() : await defaultWorkerFactory();
      } catch {
        retire();
        return;
      }
      if (done) {
        port.terminate();
        return;
      }
      workers.add(port);
      let requestId = "";
      const next = () => {
        const plane = queue.shift();
        if (!plane || done) {
          retire();
          return;
        }
        requestId = `stabilize-${Date.now().toString(36)}-${(++requestSequence).toString(36)}`;
        try {
          port!.postMessage({ type: "stabilize", requestId, planes: [plane] });
        } catch {
          retire();
        }
      };
      port.onmessage = (event) => {
        const response = event.data;
        if (done || response.requestId !== requestId) return;
        if (response.type === "stabilized") primed += primePlaneStabilizations(project.planes, response.stabilizations);
        if (response.type === "stabilized" || response.type === "error") next();
      };
      port.onerror = () => {
        if (!done) retire();
      };
      next();
    };
    for (let index = 0; index < concurrency; index += 1) void run();
  });
  return { pending, promise, cancel: () => finish() };
}
