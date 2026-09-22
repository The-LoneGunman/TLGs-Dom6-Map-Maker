import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createDefaultProject } from "../src/generator";
import {
  startProjectGeneration,
  type GenerationWorkerPort,
  type GenerationWorkerRequest,
  type GenerationWorkerResponse,
} from "../src/generationWorker";
import { createGenerationWorkerSession } from "../src/generationWorkerSession";

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

/** Hands out workers in order and records how many the session created. */
function workerPool() {
  const created: FakeGenerationWorker[] = [];
  return { created, factory: () => { const worker = new FakeGenerationWorker(); created.push(worker); return worker; } };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("a generation session reuses one worker for sequential candidates and releases it on dispose", async () => {
  const pool = workerPool();
  const session = createGenerationWorkerSession({ workerFactory: pool.factory });
  const project = createDefaultProject("session-reuse");
  for (const name of ["first", "second", "third"]) {
    const progress: string[] = [];
    const task = session.start(project, { onProgress: (update) => progress.push(update.phase) });
    await flush();
    const worker = pool.created[0]!;
    const request = worker.request;
    assert.equal(request?.type, "generate");
    assert.equal(request?.type === "generate" ? request.project : undefined, project);
    worker.emit({ type: "progress", requestId: worker.request!.requestId, progress: { phase: "generating", message: "…" } });
    const completed = structuredClone(project);
    completed.name = name;
    worker.emit({ type: "complete", requestId: worker.request!.requestId, project: completed });
    assert.equal((await task.promise).name, name);
    assert.deepEqual(progress, ["queued", "generating"]);
  }
  assert.equal(pool.created.length, 1, "one worker serves every sequential candidate");
  assert.equal(pool.created[0]!.terminated, 0, "a successful worker stays alive for the next candidate");
  session.dispose();
  assert.equal(pool.created[0]!.terminated, 1, "dispose releases the idle worker");
});

test("cancelling a session task stops its worker and the next task starts a fresh one", async () => {
  const pool = workerPool();
  const session = createGenerationWorkerSession({ workerFactory: pool.factory });
  const first = session.start(createDefaultProject("session-cancel"));
  await flush();
  const running = pool.created[0]!;
  first.cancel();
  await assert.rejects(first.promise, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
  assert.equal(running.terminated, 1, "cancelling terminates the busy worker");
  running.emit({ type: "complete", requestId: running.request!.requestId, project: createDefaultProject("too-late") });

  const second = session.start(createDefaultProject("session-after-cancel"));
  await flush();
  assert.equal(pool.created.length, 2, "a cancelled worker is never reused");
  const fresh = pool.created[1]!;
  fresh.emit({ type: "complete", requestId: fresh.request!.requestId, project: createDefaultProject("fresh") });
  assert.equal((await second.promise).seed, createDefaultProject("fresh").seed);
  session.dispose();
  assert.equal(fresh.terminated, 1);
});

test("a crashed or failing session worker is replaced, and cancelling before the worker exists never posts work", async () => {
  const pool = workerPool();
  const session = createGenerationWorkerSession({ workerFactory: pool.factory });
  const crashed = session.start(createDefaultProject("session-crash"));
  await flush();
  pool.created[0]!.onerror?.({ message: "worker crashed" } as ErrorEvent);
  await assert.rejects(crashed.promise, /worker crashed/);
  assert.equal(pool.created[0]!.terminated, 1);

  const failed = session.start(createDefaultProject("session-error"));
  await flush();
  assert.equal(pool.created.length, 2, "the crashed worker was replaced");
  pool.created[1]!.emit({ type: "error", requestId: pool.created[1]!.request!.requestId, message: "generation failed" });
  await assert.rejects(failed.promise, /generation failed/);
  assert.equal(pool.created[1]!.terminated, 1, "a worker that reported an error is discarded");

  const early = session.start(createDefaultProject("session-early-cancel"));
  early.cancel();
  await assert.rejects(early.promise, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
  await flush();
  assert.equal(pool.created.length, 3);
  assert.equal(pool.created[2]!.request, undefined, "no work is posted after an early cancel");
  assert.equal(pool.created[2]!.terminated, 1);

  const superseded = session.start(createDefaultProject("session-superseded"));
  await flush();
  const replacement = session.start(createDefaultProject("session-replacement"));
  await assert.rejects(superseded.promise, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
  assert.equal(pool.created[3]!.terminated, 1, "starting a new task cancels the running one");
  await flush();
  pool.created[4]!.emit({ type: "complete", requestId: pool.created[4]!.request!.requestId, project: createDefaultProject("done") });
  await replacement.promise;
  session.dispose();
  assert.equal(pool.created[4]!.terminated, 1);
});

test("candidate comparison generates on one session worker and disposes it however the run ends", () => {
  const source = readFileSync(new URL("../src/IterationPanel.tsx", import.meta.url), "utf8");
  const run = source.slice(source.indexOf("const runCandidates"), source.indexOf("/** Errors and the Apply/Discard card"));
  assert.match(run, /const session = createGenerationWorkerSession\(\);/);
  assert.match(run, /task\.current = session\.start\(input,/);
  assert.match(run, /finally \{ session\.dispose\(\);/);
  assert.doesNotMatch(run, /startProjectGeneration/);
});
