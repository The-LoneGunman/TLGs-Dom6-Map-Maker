import { connectedRegionStabilization } from "./connectedRegions";
import type { Plane } from "./domain";
import { generateProject } from "./generator";
import { usesConnectedRegions } from "./geometry";
import type { GenerationWorkerRequest, GenerationWorkerResponse, PlaneStabilization } from "./generationWorker";

interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<GenerationWorkerRequest>) => void): void;
  postMessage(message: GenerationWorkerResponse, transfer?: Transferable[]): void;
}

const workerScope = globalThis as unknown as WorkerScope;

/**
 * Native-pixel stabilization for each connected-region plane: the scan the
 * main thread would otherwise run on its first validation or render.
 */
function stabilizePlanes(planes: readonly Plane[]): PlaneStabilization[] {
  const results: PlaneStabilization[] = [];
  for (const plane of planes) {
    const stabilization = connectedRegionStabilization(plane);
    if (stabilization) results.push({ planeId: plane.id, stabilization });
  }
  return results;
}

const transferables = (results: readonly PlaneStabilization[]): Transferable[] =>
  results.map((result) => result.stabilization.removedPixels.buffer as ArrayBuffer);

workerScope.addEventListener("message", (event) => {
  const request = event.data;
  if (request.type === "stabilize") {
    const { requestId, planes } = request;
    try {
      const stabilizations = stabilizePlanes(planes);
      workerScope.postMessage({ type: "stabilized", requestId, stabilizations }, transferables(stabilizations));
    } catch (error) {
      workerScope.postMessage({
        type: "error",
        requestId,
        message: error instanceof Error ? error.message : "Background regional border preparation failed.",
      });
    }
    return;
  }
  if (request.type !== "generate") return;
  const { requestId, project } = request;
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
      const generated = generateProject(project);
      const stabilizations = request.stabilizeConnectedRegions ? stabilizeGenerated(requestId, generated.planes) : [];
      workerScope.postMessage(
        { type: "complete", requestId, project: generated, ...(stabilizations.length ? { stabilizations } : {}) },
        transferables(stabilizations),
      );
    } catch (error) {
      workerScope.postMessage({
        type: "error",
        requestId,
        message: error instanceof Error ? error.message : "Background map generation failed.",
      });
    }
  }, 0);
});

function stabilizeGenerated(requestId: string, planes: readonly Plane[]): PlaneStabilization[] {
  if (!planes.some(usesConnectedRegions)) return [];
  workerScope.postMessage({
    type: "progress",
    requestId,
    progress: { phase: "generating", message: "Checking regional borders at native resolution…" },
  });
  // A pure cache warm-up: on failure the editor computes the same result on demand.
  try {
    return stabilizePlanes(planes);
  } catch {
    return [];
  }
}
