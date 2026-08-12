import { generateProject } from "./generator";
import type { GenerationWorkerRequest, GenerationWorkerResponse } from "./generationWorker";

interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<GenerationWorkerRequest>) => void): void;
  postMessage(message: GenerationWorkerResponse): void;
}

const workerScope = globalThis as unknown as WorkerScope;

workerScope.addEventListener("message", (event) => {
  if (event.data.type !== "generate") return;
  const { requestId, project } = event.data;
  workerScope.postMessage({
    type: "progress",
    requestId,
    progress: {
      phase: "generating",
      message: `Generating ${project.planes.length} plane${project.planes.length === 1 ? "" : "s"} without blocking the editor…`,
    },
  });

  // Yield once so the progress message reaches the UI before expensive work.
  setTimeout(() => {
    try {
      workerScope.postMessage({ type: "complete", requestId, project: generateProject(project) });
    } catch (error) {
      workerScope.postMessage({
        type: "error",
        requestId,
        message: error instanceof Error ? error.message : "Background map generation failed.",
      });
    }
  }, 0);
});
