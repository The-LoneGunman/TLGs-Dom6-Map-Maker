import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultProject } from "../src/generator";
import {
  startProjectGeneration,
  type GenerationWorkerPort,
  type GenerationWorkerRequest,
  type GenerationWorkerResponse,
} from "../src/generationWorker";

class FakeGenerationWorker implements GenerationWorkerPort {
  onmessage: ((event: MessageEvent<GenerationWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  request?: GenerationWorkerRequest;
  terminated = 0;

  postMessage(message: GenerationWorkerRequest): void {
    this.request = message;
  }

  terminate(): void {
    this.terminated += 1;
  }

  emit(message: GenerationWorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<GenerationWorkerResponse>);
  }
}

test("background generation reports immediate progress and resolves only a complete project", async () => {
  const project = createDefaultProject("worker-complete");
  const worker = new FakeGenerationWorker();
  const progress: string[] = [];
  const task = startProjectGeneration(project, {
    workerFactory: () => worker,
    onProgress: (update) => progress.push(`${update.phase}:${update.message}`),
  });

  assert.equal(worker.request?.type, "generate");
  assert.equal(worker.request?.project, project);
  assert.match(progress[0]!, /^queued:Preparing 1 planned plane/);

  const requestId = worker.request!.requestId;
  worker.emit({
    type: "progress",
    requestId,
    progress: { phase: "generating", message: "Generating without blocking the editor…" },
  });
  const completed = structuredClone(project);
  completed.name = "Completed in worker";
  worker.emit({ type: "complete", requestId, project: completed });

  assert.equal((await task.promise).name, "Completed in worker");
  assert.equal(progress.at(-1), "generating:Generating without blocking the editor…");
  assert.equal(worker.terminated, 1);
});

test("cancelling terminates expensive work and cannot mutate the source project", async () => {
  const project = createDefaultProject("worker-cancel");
  const before = structuredClone(project);
  const worker = new FakeGenerationWorker();
  const task = startProjectGeneration(project, { workerFactory: () => worker });

  task.cancel();
  await assert.rejects(task.promise, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
  assert.equal(worker.terminated, 1);
  assert.deepEqual(project, before);

  worker.emit({ type: "complete", requestId: worker.request!.requestId, project: createDefaultProject("too-late") });
  assert.equal(worker.terminated, 1, "late worker messages are ignored after cancellation");
});

test("worker failures reject cleanly and dispose the worker", async () => {
  const worker = new FakeGenerationWorker();
  const task = startProjectGeneration(createDefaultProject("worker-failure"), { workerFactory: () => worker });
  worker.emit({ type: "error", requestId: worker.request!.requestId, message: "fixture failure" });
  await assert.rejects(task.promise, /fixture failure/);
  assert.equal(worker.terminated, 1);
});

test("worker construction failures never fall back to blocking synchronous generation", async () => {
  const task = startProjectGeneration(createDefaultProject("worker-unavailable"), {
    workerFactory: () => { throw new Error("Workers unavailable"); },
  });
  await assert.rejects(task.promise, /Workers unavailable/);
  task.cancel();
});

test("structured-clone submission failures dispose the worker", async () => {
  const worker = new FakeGenerationWorker();
  worker.postMessage = () => { throw new Error("clone failed"); };
  const task = startProjectGeneration(createDefaultProject("worker-clone-failure"), { workerFactory: () => worker });
  await assert.rejects(task.promise, /clone failed/);
  assert.equal(worker.terminated, 1);
});
