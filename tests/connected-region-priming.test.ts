import assert from "node:assert/strict";
import test from "node:test";
import type { MapProject, Plane, PlaneKind } from "../src/domain";
import { createDefaultProject, generatePlane } from "../src/generator";
import {
  connectedRegionLayoutNotice,
  hasConnectedRegionStabilization,
  primeConnectedRegionStabilization,
  type ConnectedRegionStabilization,
} from "../src/connectedRegions";
import { createProvinceOwnershipModel } from "../src/geometry";
import {
  prepareConnectedRegionsInBackground,
  startProjectGeneration,
  type GenerationWorkerPort,
  type GenerationWorkerRequest,
  type GenerationWorkerResponse,
} from "../src/generationWorker";

// A second module instance has its own caches, like the generation worker.
const workerSpecifier: string = "../src/connectedRegions.ts?priming-worker";
const worker = await import(workerSpecifier) as typeof import("../src/connectedRegions");

function fixture(seed: string, kind: PlaneKind = "cave", width = 256, height = 256, count = 36): Plane {
  const project = createDefaultProject(seed, { generate: false });
  const source: Plane = { ...project.planes[0]!, id: `${seed}-${kind}`, kind, ownershipMode: "sparse", sparseLayout: "regions",
    provinceTarget: count, width, height, wrapX: true, wrapY: false, noGeneratedStarts: true };
  return generatePlane(source, project.settings, `${seed}-${kind}`, 1, { deferStrategicFeatures: true });
}

function computedElsewhere(plane: Plane): ConnectedRegionStabilization {
  const result = worker.connectedRegionStabilization(structuredClone(plane));
  assert.ok(result, "regional planes produce a transferable stabilization");
  return structuredClone(result);
}

function raster(model: ReturnType<typeof createProvinceOwnershipModel>, plane: Plane): Int16Array {
  const owners = new Int16Array(plane.width * plane.height);
  for (let y = 0; y < plane.height; y++) for (let x = 0; x < plane.width; x++) {
    owners[y * plane.width + x] = model.ownerAt((x + .5) / plane.width, (y + .5) / plane.height);
  }
  return owners;
}

test("a worker stabilization primes the main thread and reproduces its ownership exactly", () => {
  const plane = fixture("priming-exact");
  const record = computedElsewhere(plane);
  assert.equal(hasConnectedRegionStabilization(plane), false);
  assert.equal(primeConnectedRegionStabilization(plane, record), true);
  assert.equal(hasConnectedRegionStabilization(plane), true);
  const primed = createProvinceOwnershipModel(plane);
  const reference = worker.createConnectedRegionOwnership(structuredClone(plane))!;
  assert.deepEqual(raster(primed, plane), raster(reference, plane));
  assert.deepEqual([...primed.regionBorders!], [...reference.regionBorders!]);
  assert.equal(JSON.stringify(primed.primitives), JSON.stringify(reference.primitives));
});

test("a primed result replaces the native scan for its exact signature", () => {
  const plane = fixture("priming-used");
  // Only a result that skipped the scan could report this notice.
  assert.equal(primeConnectedRegionStabilization(plane, { ...computedElsewhere(plane), notice: "Primed notice." }), true);
  assert.equal(connectedRegionLayoutNotice(plane), "Primed notice.");
});

test("stale, foreign or malformed stabilizations are ignored", () => {
  const plane = fixture("priming-stale");
  const record = computedElsewhere(plane);
  const moved = structuredClone(plane);
  moved.provinces[0]!.x = Math.min(1, moved.provinces[0]!.x + 1e-6);
  assert.equal(primeConnectedRegionStabilization(moved, record), false, "any geometry change invalidates the signature");
  const relinked = structuredClone(plane);
  relinked.edges = relinked.edges.slice(1);
  assert.equal(primeConnectedRegionStabilization(relinked, record), false);
  assert.equal(primeConnectedRegionStabilization(plane, { ...record, signature: `${record.signature} ` }), false);
  assert.equal(primeConnectedRegionStabilization(plane, { ...record, removedPixels: Uint32Array.of(plane.width * plane.height) }), false);
  assert.equal(primeConnectedRegionStabilization(plane, { ...record, removedPixels: [] as unknown as Uint32Array }), false);
  assert.equal(hasConnectedRegionStabilization(plane), false);
  assert.equal(connectedRegionLayoutNotice(plane), undefined, "the main thread still computes the result itself");
});

class FakeWorker implements GenerationWorkerPort {
  onmessage: ((event: MessageEvent<GenerationWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  requests: GenerationWorkerRequest[] = [];
  terminated = 0;
  constructor(private readonly reply?: (request: GenerationWorkerRequest) => GenerationWorkerResponse | undefined) {}
  postMessage(message: GenerationWorkerRequest): void {
    this.requests.push(message);
    const response = this.reply?.(message);
    if (response) queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent<GenerationWorkerResponse>));
  }
  terminate(): void {
    this.terminated += 1;
  }
}

function projectWith(plane: Plane): MapProject {
  const project = createDefaultProject("priming-project", { generate: false });
  project.planes = [plane];
  return project;
}

test("a generation result carrying stabilizations primes its regional planes", async () => {
  const plane = fixture("priming-generation");
  const project = projectWith(plane);
  const fake = new FakeWorker();
  const task = startProjectGeneration(project, { workerFactory: () => fake, stabilizeConnectedRegions: true });
  const request = fake.requests[0]!;
  assert.equal(request.type === "generate" && request.stabilizeConnectedRegions, true);
  const completed = structuredClone(project);
  fake.onmessage?.({ data: { type: "complete", requestId: request.requestId, project: completed,
    stabilizations: [{ planeId: plane.id, stabilization: computedElsewhere(plane) }] } } as MessageEvent<GenerationWorkerResponse>);
  const result = await task.promise;
  assert.equal(hasConnectedRegionStabilization(result.planes[0]!), true);
});

test("opening an atlas scans regional planes in workers and never rejects", async () => {
  const plane = fixture("priming-open");
  const project = projectWith(plane);
  const fake = new FakeWorker((request) => request.type === "stabilize"
    ? { type: "stabilized", requestId: request.requestId,
      stabilizations: request.planes.map((item) => ({ planeId: item.id, stabilization: computedElsewhere(item) })) }
    : undefined);
  const task = prepareConnectedRegionsInBackground(project, { workerFactory: () => fake, concurrency: 1 });
  assert.equal(task.pending, 1);
  assert.equal(await task.promise, 1);
  assert.equal(fake.terminated, 1, "workers are disposed once the queue drains");
  assert.equal(hasConnectedRegionStabilization(plane), true);
  assert.equal(prepareConnectedRegionsInBackground(project).pending, 0, "nothing left to scan");

  const failing = projectWith(fixture("priming-open-failure"));
  assert.equal(await prepareConnectedRegionsInBackground(failing, { workerFactory: () => { throw new Error("no workers"); } }).promise, 0);
  const erroring = new FakeWorker((request) => ({ type: "error", requestId: request.requestId, message: "fixture failure" }));
  assert.equal(await prepareConnectedRegionsInBackground(failing, { workerFactory: () => erroring }).promise, 0);
  assert.equal(erroring.terminated, 1);
  assert.equal(hasConnectedRegionStabilization(failing.planes[0]!), false, "failures leave the on-demand scan in place");
});
