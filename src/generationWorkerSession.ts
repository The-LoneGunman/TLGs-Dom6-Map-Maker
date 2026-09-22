import type { MapProject } from "./domain";
import {
  defaultWorkerFactory,
  type GenerationWorkerFactory,
  type GenerationWorkerPort,
  type GenerationWorkerProgress,
  type ProjectGenerationTask,
} from "./generationWorker";

export interface GenerationWorkerSession {
  /** Same contract as `startProjectGeneration`; tasks run one at a time on the session's worker. */
  start(project: MapProject, options?: { onProgress?: (progress: GenerationWorkerProgress) => void }): ProjectGenerationTask;
  /** Cancel any running task and terminate the session's worker. */
  dispose(): void;
}

let sessionRequestSequence = 0;

/**
 * Sequential background generation on one reused module worker, for callers
 * that generate several projects in a row (candidate comparison). A fresh
 * worker per task would evaluate the whole generator bundle again each time.
 *
 * A worker is kept only after a task completes successfully. Cancelling a
 * running task terminates its worker at once, so the work stops; a worker
 * that crashed, reported an error, or could not accept the request is
 * discarded. The next task then starts a fresh worker. Starting a task while
 * another is running cancels the older task. Callers must `dispose` the
 * session when they are done so the idle worker is released.
 */
export function createGenerationWorkerSession(options: { workerFactory?: GenerationWorkerFactory } = {}): GenerationWorkerSession {
  let idle: GenerationWorkerPort | undefined;
  let active: ProjectGenerationTask | undefined;
  let disposed = false;

  const acquire = async (): Promise<GenerationWorkerPort> => {
    const reused = idle;
    idle = undefined;
    if (reused) return reused;
    return options.workerFactory ? options.workerFactory() : await defaultWorkerFactory();
  };

  const start = (project: MapProject, taskOptions: { onProgress?: (progress: GenerationWorkerProgress) => void } = {}): ProjectGenerationTask => {
    active?.cancel();
    const requestId = `generation-session-${Date.now().toString(36)}-${(++sessionRequestSequence).toString(36)}`;
    let worker: GenerationWorkerPort | undefined;
    let settled = false;
    let rejectTask: (reason?: unknown) => void = () => undefined;

    taskOptions.onProgress?.({
      phase: "queued",
      message: `Preparing ${project.planes.length} planned plane${project.planes.length === 1 ? "" : "s"} for background generation…`,
    });

    /** Detach the task's worker; keep it for the next task only after a success. */
    const release = (reusable: boolean) => {
      const current = worker;
      worker = undefined;
      if (active === task) active = undefined;
      if (!current) return;
      current.onmessage = null;
      current.onerror = null;
      if (reusable && !disposed && !idle) idle = current;
      else current.terminate();
    };

    const promise = new Promise<MapProject>((resolve, reject) => {
      rejectTask = reject;
      const run = async () => {
        try {
          const candidate = await acquire();
          if (settled) {
            candidate.terminate();
            return;
          }
          worker = candidate;
          worker.onmessage = (event) => {
            const response = event.data;
            if (settled || response.requestId !== requestId) return;
            if (response.type === "progress") {
              taskOptions.onProgress?.(response.progress);
              return;
            }
            settled = true;
            if (response.type === "complete") {
              release(true);
              resolve(response.project);
            } else {
              release(false);
              reject(new Error(response.message));
            }
          };
          worker.onerror = (event) => {
            if (settled) return;
            settled = true;
            release(false);
            reject(new Error(event.message || "The background generator stopped unexpectedly."));
          };
          worker.postMessage({ type: "generate", requestId, project });
        } catch (error) {
          if (settled) return;
          settled = true;
          release(false);
          reject(error);
        }
      };
      void run();
    });

    const task: ProjectGenerationTask = {
      promise,
      cancel() {
        if (settled) return;
        settled = true;
        release(false);
        rejectTask(new DOMException("Map generation was cancelled.", "AbortError"));
      },
    };
    active = task;
    return task;
  };

  return {
    start,
    dispose() {
      disposed = true;
      active?.cancel();
      idle?.terminate();
      idle = undefined;
    },
  };
}
