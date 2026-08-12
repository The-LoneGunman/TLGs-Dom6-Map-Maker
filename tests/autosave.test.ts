import assert from "node:assert/strict";
import test from "node:test";
import {
  autosaveRevision,
  loadProjectAutosave,
  saveProjectAutosave,
  type AutosaveDriver,
  type AutosaveDrivers,
} from "../src/autosave";
import { createDefaultProject } from "../src/generator";

class MemoryDriver implements AutosaveDriver {
  value: string | null;
  readonly events: string[];
  failGet?: Error;
  failSet?: Error;
  failRemove?: Error;

  constructor(value: string | null = null, events: string[] = []) {
    this.value = value;
    this.events = events;
  }

  async get(): Promise<string | null> {
    this.events.push("get");
    if (this.failGet) throw this.failGet;
    return this.value;
  }

  async set(value: string): Promise<void> {
    this.events.push("set");
    if (this.failSet) throw this.failSet;
    this.value = value;
  }

  async remove(): Promise<void> {
    this.events.push("remove");
    if (this.failRemove) throw this.failRemove;
    this.value = null;
  }
}

class RaceOnSecondReadDriver extends MemoryDriver {
  private reads = 0;

  constructor(value: string, private readonly replacement: string) {
    super(value);
  }

  override async get(): Promise<string | null> {
    this.reads += 1;
    if (this.reads === 2) this.value = this.replacement;
    return super.get();
  }
}

function drivers(indexeddb: MemoryDriver, localstorage: MemoryDriver): AutosaveDrivers {
  return { indexeddb, localstorage };
}

test("autosave writes the durable IndexedDB record and removes the legacy copy", async () => {
  const project = createDefaultProject("autosave-indexeddb");
  const indexeddb = new MemoryDriver();
  const localstorage = new MemoryDriver("old");

  const state = await saveProjectAutosave(project, drivers(indexeddb, localstorage));

  assert.equal(state.backend, "indexeddb");
  assert.deepEqual(state.errors, []);
  assert.equal(JSON.parse(indexeddb.value!).seed, project.seed);
  assert.equal(state.revision, autosaveRevision(indexeddb.value!));
  assert.equal(localstorage.value, null);
});

test("autosave falls back to localStorage when IndexedDB rejects a large write", async () => {
  const project = createDefaultProject("autosave-fallback");
  const indexeddb = new MemoryDriver();
  indexeddb.failSet = new Error("quota denied");
  const localstorage = new MemoryDriver();

  const state = await saveProjectAutosave(project, drivers(indexeddb, localstorage));

  assert.equal(state.backend, "localstorage");
  assert.equal(state.errors.length, 1);
  assert.equal(state.errors[0]!.backend, "indexeddb");
  assert.match(state.errors[0]!.message, /quota denied/);
  assert.equal(JSON.parse(localstorage.value!).seed, project.seed);
});

test("autosave catches and reports failures from both persistence backends", async () => {
  const indexeddb = new MemoryDriver();
  indexeddb.failSet = new Error("idb blocked");
  const localstorage = new MemoryDriver();
  localstorage.failSet = new Error("storage full");

  const state = await saveProjectAutosave(createDefaultProject("autosave-both-fail"), drivers(indexeddb, localstorage));

  assert.equal(state.backend, "none");
  assert.deepEqual(state.errors.map((entry) => entry.backend), ["indexeddb", "localstorage"]);
  assert.match(state.errors[1]!.message, /storage full/);
});

test("restore prefers the newer IndexedDB project and removes a stale legacy slot", async () => {
  const expected = createDefaultProject("autosave-restore-idb");
  expected.updatedAt = "2026-08-10T12:00:00.000Z";
  const stale = createDefaultProject("stale-local-copy");
  stale.updatedAt = "2026-08-09T12:00:00.000Z";
  const indexeddb = new MemoryDriver(JSON.stringify(expected));
  const localstorage = new MemoryDriver(JSON.stringify(stale));

  const state = await loadProjectAutosave(drivers(indexeddb, localstorage));

  assert.equal(state.project?.seed, expected.seed);
  assert.equal(state.backend, "indexeddb");
  assert.equal(state.migrated, false);
  assert.deepEqual(localstorage.events, ["get", "remove"]);
  assert.equal(localstorage.value, null);
});

test("restore does not lose a newer local fallback when IndexedDB retained an older project", async () => {
  const stale = createDefaultProject("stale-indexeddb-copy");
  stale.updatedAt = "2026-08-09T12:00:00.000Z";
  const expected = createDefaultProject("newer-local-fallback");
  expected.updatedAt = "2026-08-10T12:00:00.000Z";
  const indexeddb = new MemoryDriver(JSON.stringify(stale));
  const localstorage = new MemoryDriver(JSON.stringify(expected));

  const state = await loadProjectAutosave(drivers(indexeddb, localstorage));

  assert.equal(state.project?.seed, expected.seed);
  assert.equal(state.backend, "indexeddb");
  assert.equal(state.migrated, true);
  assert.equal(JSON.parse(indexeddb.value!).seed, expected.seed);
  assert.equal(localstorage.value, null);
});

test("a differing local fallback wins timestamp ties instead of reviving stale IndexedDB data", async () => {
  const stale = createDefaultProject("same-millisecond-stale-idb");
  const expected = createDefaultProject("same-millisecond-local-fallback");
  stale.updatedAt = expected.updatedAt = "2026-08-10T12:00:00.000Z";
  const indexeddb = new MemoryDriver(JSON.stringify(stale));
  const localstorage = new MemoryDriver(JSON.stringify(expected));

  const state = await loadProjectAutosave(drivers(indexeddb, localstorage));

  assert.equal(state.project?.seed, expected.seed);
  assert.equal(state.backend, "indexeddb");
  assert.equal(state.migrated, true);
});

test("restore migrates a schema-v1 localStorage project only after IndexedDB accepts it", async () => {
  const expected = createDefaultProject("autosave-migrate");
  const events: string[] = [];
  const indexeddb = new MemoryDriver(null, events);
  const localstorage = new MemoryDriver(JSON.stringify(expected), events);

  const state = await loadProjectAutosave(drivers(indexeddb, localstorage));

  assert.equal(state.project?.seed, expected.seed);
  assert.equal(state.backend, "indexeddb");
  assert.equal(state.migrated, true);
  assert.deepEqual(events, ["get", "get", "set", "remove"]);
  assert.equal(localstorage.value, null);
  assert.equal(JSON.parse(indexeddb.value!).seed, expected.seed);
});

test("a failed migration keeps the valid localStorage copy and exposes the IndexedDB error", async () => {
  const expected = createDefaultProject("autosave-migration-fallback");
  const indexeddb = new MemoryDriver();
  indexeddb.failSet = new Error("database unavailable");
  const localstorage = new MemoryDriver(JSON.stringify(expected));

  const state = await loadProjectAutosave(drivers(indexeddb, localstorage));

  assert.equal(state.project?.seed, expected.seed);
  assert.equal(state.backend, "localstorage");
  assert.equal(state.migrated, false);
  assert.ok(localstorage.value);
  assert.deepEqual(localstorage.events, ["get"]);
  assert.ok(state.errors.some((entry) => entry.backend === "indexeddb" && entry.operation === "write"));
});

test("restore catches read and parse errors and still tries the other backend", async () => {
  const expected = createDefaultProject("autosave-corrupt-idb-fallback");
  const indexeddb = new MemoryDriver("{broken");
  const localstorage = new MemoryDriver(JSON.stringify(expected));

  const state = await loadProjectAutosave(drivers(indexeddb, localstorage));

  assert.equal(state.project?.seed, expected.seed);
  assert.equal(state.backend, "indexeddb");
  assert.equal(state.migrated, true);
  assert.ok(state.errors.some((entry) => entry.backend === "indexeddb" && entry.operation === "parse"));

  indexeddb.value = null;
  indexeddb.failGet = new Error("idb read failed");
  localstorage.value = null;
  localstorage.failGet = new Error("local read failed");
  const failed = await loadProjectAutosave(drivers(indexeddb, localstorage));
  assert.equal(failed.backend, "none");
  assert.equal(failed.project, undefined);
  assert.deepEqual(failed.errors.map((entry) => entry.operation), ["read", "read"]);
});

test("load and guarded save return revision tokens and advance them after a successful write", async () => {
  const original = createDefaultProject("autosave-revision-original");
  original.updatedAt = "2026-08-10T12:00:00.000Z";
  const indexeddb = new MemoryDriver(JSON.stringify(original));
  const localstorage = new MemoryDriver();

  const loaded = await loadProjectAutosave(drivers(indexeddb, localstorage));
  assert.equal(loaded.revision, autosaveRevision(JSON.stringify(original)));

  const edited = structuredClone(original);
  edited.name = "Revision-safe edit";
  edited.updatedAt = "2026-08-10T12:01:00.000Z";
  const saved = await saveProjectAutosave(edited, drivers(indexeddb, localstorage), {
    expectedRevision: loaded.revision!,
  });

  assert.equal(saved.backend, "indexeddb");
  assert.equal(saved.conflict, undefined);
  assert.equal(saved.revision, autosaveRevision(JSON.stringify(edited)));
  assert.notEqual(saved.revision, loaded.revision);
  assert.equal(JSON.parse(indexeddb.value!).name, edited.name);
});

test("a stale guarded save refuses to overwrite or remove either durable copy", async () => {
  const stale = createDefaultProject("autosave-stale-tab");
  stale.updatedAt = "2026-08-10T12:00:00.000Z";
  const current = createDefaultProject("autosave-current-tab");
  current.updatedAt = "2026-08-10T12:02:00.000Z";
  const fallback = createDefaultProject("autosave-current-fallback");
  fallback.updatedAt = "2026-08-10T12:03:00.000Z";
  const currentRaw = JSON.stringify(current);
  const fallbackRaw = JSON.stringify(fallback);
  const indexeddb = new MemoryDriver(currentRaw);
  const localstorage = new MemoryDriver(fallbackRaw);

  const result = await saveProjectAutosave(stale, drivers(indexeddb, localstorage), {
    expectedRevision: autosaveRevision(JSON.stringify(stale)),
  });

  assert.equal(result.conflict?.expectedRevision, autosaveRevision(JSON.stringify(stale)));
  assert.equal(result.conflict?.currentRevision, autosaveRevision(fallbackRaw));
  assert.equal(result.conflict?.backend, "localstorage");
  assert.equal(indexeddb.value, currentRaw);
  assert.equal(localstorage.value, fallbackRaw);
  assert.deepEqual(indexeddb.events, ["get"]);
  assert.deepEqual(localstorage.events, ["get"]);
});

test("expecting an empty slot detects a record created by another tab", async () => {
  const indexeddb = new MemoryDriver();
  const localstorage = new MemoryDriver();
  const empty = await loadProjectAutosave(drivers(indexeddb, localstorage));
  assert.equal(empty.revision, null);

  const concurrent = createDefaultProject("autosave-concurrent-first-write");
  const concurrentRaw = JSON.stringify(concurrent);
  indexeddb.value = concurrentRaw;
  const attempted = createDefaultProject("autosave-late-first-write");
  const result = await saveProjectAutosave(attempted, drivers(indexeddb, localstorage), {
    expectedRevision: empty.revision!,
  });

  assert.equal(result.conflict?.currentRevision, autosaveRevision(concurrentRaw));
  assert.equal(indexeddb.value, concurrentRaw);
  assert.equal(localstorage.value, null);
});

test("a record changed after preflight is detected by compare-before-set", async () => {
  const original = createDefaultProject("autosave-race-original");
  original.updatedAt = "2026-08-10T12:00:00.000Z";
  const concurrent = createDefaultProject("autosave-race-winner");
  concurrent.updatedAt = "2026-08-10T12:01:00.000Z";
  const originalRaw = JSON.stringify(original);
  const concurrentRaw = JSON.stringify(concurrent);
  const indexeddb = new RaceOnSecondReadDriver(originalRaw, concurrentRaw);
  const localstorage = new MemoryDriver();

  const attempted = structuredClone(original);
  attempted.name = "Losing edit";
  const result = await saveProjectAutosave(attempted, drivers(indexeddb, localstorage), {
    expectedRevision: autosaveRevision(originalRaw),
  });

  assert.equal(result.conflict?.currentRevision, autosaveRevision(concurrentRaw));
  assert.equal(indexeddb.value, concurrentRaw);
  assert.ok(!indexeddb.events.includes("set"));
});

test("a guarded write retains optimistic checks when falling back to localStorage", async () => {
  const original = createDefaultProject("autosave-guarded-fallback-original");
  original.updatedAt = "2026-08-10T12:00:00.000Z";
  const originalRaw = JSON.stringify(original);
  const indexeddb = new MemoryDriver();
  indexeddb.failSet = new Error("IndexedDB quota denied");
  const localstorage = new MemoryDriver(originalRaw);
  const edited = structuredClone(original);
  edited.name = "Fallback edit";
  edited.updatedAt = "2026-08-10T12:01:00.000Z";

  const result = await saveProjectAutosave(edited, drivers(indexeddb, localstorage), {
    expectedRevision: autosaveRevision(originalRaw),
  });

  assert.equal(result.backend, "localstorage");
  assert.equal(result.conflict, undefined);
  assert.equal(result.revision, autosaveRevision(JSON.stringify(edited)));
  assert.equal(JSON.parse(localstorage.value!).name, edited.name);
  assert.ok(result.errors.some((entry) => entry.backend === "indexeddb" && entry.operation === "write"));
});

test("a guarded save refuses to write when durable state cannot be read", async () => {
  const indexeddb = new MemoryDriver("unreadable-but-preserved");
  indexeddb.failGet = new Error("database temporarily blocked");
  const localstorage = new MemoryDriver();

  const result = await saveProjectAutosave(
    createDefaultProject("autosave-read-refusal"),
    drivers(indexeddb, localstorage),
    { expectedRevision: null },
  );

  assert.equal(result.conflict?.currentRevision, undefined);
  assert.ok(result.errors.some((entry) => entry.backend === "indexeddb" && entry.operation === "read"));
  assert.equal(indexeddb.value, "unreadable-but-preserved");
  assert.ok(!indexeddb.events.includes("set"));
  assert.ok(!localstorage.events.includes("set"));
});
