import assert from "node:assert/strict";
import test from "node:test";
import {
  autosaveRevision,
  createLocalStorageDriver,
  loadProjectAutosave,
  saveProjectAutosave,
  type AutosaveDriver,
  type AutosaveDrivers,
  type AutosaveLockManager,
} from "../src/autosave";
import { createDefaultProject } from "../src/generator";
import { MAX_IMPORTED_STRING_LENGTH, parseProject, serializeProject } from "../src/export";

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

  async compareAndSet(
    expectedRevision: string | null,
    value: string,
  ): Promise<{ saved: boolean; current: string | null }> {
    this.events.push("set");
    if (this.failSet) throw this.failSet;
    if ((this.value === null ? null : autosaveRevision(this.value)) !== expectedRevision) {
      return { saved: false, current: this.value };
    }
    this.value = value;
    return { saved: true, current: value };
  }

  async removeIfRevision(
    expectedRevision: string | null,
  ): Promise<{ removed: boolean; current: string | null }> {
    this.events.push("remove");
    if (this.failRemove) throw this.failRemove;
    if ((this.value === null ? null : autosaveRevision(this.value)) !== expectedRevision) {
      return { removed: false, current: this.value };
    }
    this.value = null;
    return { removed: true, current: null };
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

  override async compareAndSet(
    expectedRevision: string | null,
    value: string,
  ): Promise<{ saved: boolean; current: string | null }> {
    this.reads += 1;
    if (this.reads === 2) this.value = this.replacement;
    return super.compareAndSet(expectedRevision, value);
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

test("restore preserves divergent durable copies and reports an explicit conflict", async () => {
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
  assert.equal(state.conflict?.reason, "divergent-copies");
  assert.equal(state.conflict?.alternateBackend, "localstorage");
  assert.deepEqual(localstorage.events, ["get"]);
  assert.equal(JSON.parse(localstorage.value!).seed, stale.seed);
});

test("restore selects but does not silently migrate a newer divergent fallback", async () => {
  const stale = createDefaultProject("stale-indexeddb-copy");
  stale.updatedAt = "2026-08-09T12:00:00.000Z";
  const expected = createDefaultProject("newer-local-fallback");
  expected.updatedAt = "2026-08-10T12:00:00.000Z";
  const indexeddb = new MemoryDriver(JSON.stringify(stale));
  const localstorage = new MemoryDriver(JSON.stringify(expected));

  const state = await loadProjectAutosave(drivers(indexeddb, localstorage));

  assert.equal(state.project?.seed, expected.seed);
  assert.equal(state.backend, "localstorage");
  assert.equal(state.migrated, false);
  assert.equal(state.conflict?.reason, "divergent-copies");
  assert.equal(JSON.parse(indexeddb.value!).seed, stale.seed);
  assert.equal(JSON.parse(localstorage.value!).seed, expected.seed);
});

test("a differing fallback wins timestamp ties without destroying either reviewed copy", async () => {
  const stale = createDefaultProject("same-millisecond-stale-idb");
  const expected = createDefaultProject("same-millisecond-local-fallback");
  stale.updatedAt = expected.updatedAt = "2026-08-10T12:00:00.000Z";
  const indexeddb = new MemoryDriver(JSON.stringify(stale));
  const localstorage = new MemoryDriver(JSON.stringify(expected));

  const state = await loadProjectAutosave(drivers(indexeddb, localstorage));

  assert.equal(state.project?.seed, expected.seed);
  assert.equal(state.backend, "localstorage");
  assert.equal(state.migrated, false);
  assert.equal(state.conflict?.reason, "divergent-copies");
  assert.equal(JSON.parse(indexeddb.value!).seed, stale.seed);
  assert.equal(JSON.parse(localstorage.value!).seed, expected.seed);
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
  assert.equal(state.backend, "localstorage");
  assert.equal(state.migrated, false);
  assert.equal(state.conflict?.reason, "unreadable-copy");
  assert.equal(indexeddb.value, "{broken");
  assert.equal(localstorage.value, JSON.stringify(expected));
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

test("an editor value beyond import limits cannot overwrite a recoverable autosave", async () => {
  const project = createDefaultProject("autosave-roundtrip-limits");
  const original = serializeProject(project);
  const indexeddb = new MemoryDriver(original);
  const localstorage = new MemoryDriver(original);
  project.description = "x".repeat(MAX_IMPORTED_STRING_LENGTH + 1);
  const saved = await saveProjectAutosave(project, drivers(indexeddb, localstorage), { expectedRevision: autosaveRevision(original) });
  assert.equal(saved.backend, "none");
  assert.match(saved.errors[0]!.message, /description.*4096/);
  assert.equal(indexeddb.value, original);
  assert.equal(localstorage.value, original);
  assert.equal((await loadProjectAutosave(drivers(indexeddb, localstorage))).project?.description, parseProject(original).description);
});

test("unreadable saved data requires explicit recovery before it can be replaced", async () => {
  const indexeddb = new MemoryDriver("{saved-but-incomplete");
  const localstorage = new MemoryDriver();
  const loaded = await loadProjectAutosave(drivers(indexeddb, localstorage));
  assert.equal(loaded.project, undefined);
  assert.equal(loaded.conflict?.reason, "unreadable-copy");
  assert.deepEqual(loaded.recoveryCopies, [{ backend: "indexeddb", text: "{saved-but-incomplete" }]);
  const fresh = createDefaultProject("autosave-recovery-explicit");
  const automatic = await saveProjectAutosave(fresh, drivers(indexeddb, localstorage), { expectedRevision: loaded.revision! });
  assert.ok(automatic.conflict);
  assert.equal(automatic.conflict.reason, "unreadable-copy");
  assert.deepEqual(automatic.recoveryCopies, loaded.recoveryCopies);
  assert.equal(indexeddb.value, "{saved-but-incomplete");
  const retried = await saveProjectAutosave(fresh, drivers(indexeddb, localstorage), { expectedRevision: automatic.revision! });
  assert.equal(retried.conflict?.reason, "unreadable-copy");
  assert.deepEqual(retried.recoveryCopies, loaded.recoveryCopies);
  assert.equal(indexeddb.value, "{saved-but-incomplete");
  const explicit = await saveProjectAutosave(fresh, drivers(indexeddb, localstorage), {
    expectedBackendRevisions: loaded.conflict!.backendRevisions,
  });
  assert.equal(explicit.backend, "indexeddb");
  assert.equal(parseProject(indexeddb.value!).seed, fresh.seed);
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

test("load-time migration refuses to overwrite an IndexedDB record changed after inspection", async () => {
  const local = createDefaultProject("autosave-load-local");
  local.updatedAt = "2026-08-10T12:00:00.000Z";
  const winner = createDefaultProject("autosave-load-race-winner");
  winner.updatedAt = "2026-08-10T12:01:00.000Z";
  const indexeddb = new MemoryDriver();
  const localstorage = new MemoryDriver(JSON.stringify(local));
  const originalCompare = indexeddb.compareAndSet.bind(indexeddb);
  indexeddb.compareAndSet = async (expectedRevision, value) => {
    indexeddb.value = JSON.stringify(winner);
    return originalCompare(expectedRevision, value);
  };

  const result = await loadProjectAutosave(drivers(indexeddb, localstorage));

  assert.equal(result.project?.seed, local.seed);
  assert.ok(result.conflict);
  assert.equal(JSON.parse(indexeddb.value!).seed, winner.seed);
  assert.equal(JSON.parse(localstorage.value!).seed, local.seed);
});

test("load-time stale-copy cleanup cannot delete a concurrent fallback write", async () => {
  const project = createDefaultProject("autosave-load-shared");
  const concurrent = createDefaultProject("autosave-load-concurrent");
  const raw = JSON.stringify(project);
  const indexeddb = new MemoryDriver(raw);
  const localstorage = new MemoryDriver(raw);
  const originalRemove = localstorage.removeIfRevision.bind(localstorage);
  localstorage.removeIfRevision = async (expectedRevision) => {
    localstorage.value = JSON.stringify(concurrent);
    return originalRemove(expectedRevision);
  };

  const result = await loadProjectAutosave(drivers(indexeddb, localstorage));

  assert.equal(result.project?.seed, project.seed);
  assert.ok(result.conflict);
  assert.equal(JSON.parse(localstorage.value!).seed, concurrent.seed);
});

test("divergent copies can be resolved only while both reviewed revisions remain current", async () => {
  const indexed = createDefaultProject("autosave-choice-indexed");
  indexed.updatedAt = "2026-08-10T12:00:00.000Z";
  const fallback = createDefaultProject("autosave-choice-fallback");
  fallback.updatedAt = "2026-08-10T12:01:00.000Z";
  const indexeddb = new MemoryDriver(JSON.stringify(indexed));
  const localstorage = new MemoryDriver(JSON.stringify(fallback));
  const loaded = await loadProjectAutosave(drivers(indexeddb, localstorage));
  assert.equal(loaded.project?.seed, fallback.seed);
  assert.equal(loaded.conflict?.reason, "divergent-copies");

  const edited = structuredClone(loaded.project!);
  edited.name = "Explicitly retained copy";
  const resolved = await saveProjectAutosave(edited, drivers(indexeddb, localstorage), {
    expectedBackendRevisions: loaded.conflict!.backendRevisions,
  });

  assert.equal(resolved.conflict, undefined);
  assert.equal(JSON.parse(indexeddb.value!).name, edited.name);
  assert.equal(localstorage.value, null);
});

test("localStorage conditional writes require a cross-tab lock and serialize contenders", async () => {
  let value: string | null = null;
  const storage = {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
    removeItem: () => { value = null; },
  };
  let tail = Promise.resolve();
  const locks: AutosaveLockManager = {
    request<T>(_name: string, callback: () => T): Promise<T> {
      const result = tail.then(callback, callback);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  const driver = createLocalStorageDriver(storage, locks);
  const first = createDefaultProject("autosave-lock-first");
  const second = createDefaultProject("autosave-lock-second");
  const [a, b] = await Promise.all([
    driver.compareAndSet!(null, JSON.stringify(first)),
    driver.compareAndSet!(null, JSON.stringify(second)),
  ]);

  assert.deepEqual([a.saved, b.saved].sort(), [false, true]);
  assert.equal(JSON.parse(value!).seed, first.seed);

  const unlocked = createLocalStorageDriver(storage, null);
  const refused = await unlocked.compareAndSet!(autosaveRevision(value!), JSON.stringify(second));
  assert.equal(refused.saved, false);
  assert.equal(JSON.parse(value!).seed, first.seed);
});

test("without a cross-tab lock, an empty legacy slot is not reported as a tab conflict", async () => {
  let value: string | null = null;
  const storage = {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
    removeItem: () => { value = null; },
  };
  const unlocked = createLocalStorageDriver(storage, null);
  assert.deepEqual(await unlocked.removeIfRevision!(null), { removed: true, current: null });

  value = JSON.stringify(createDefaultProject("autosave-unlocked-remove"));
  const refused = await unlocked.removeIfRevision!(autosaveRevision(value));
  assert.equal(refused.removed, false);
  assert.notEqual(value, null);
});
