import assert from "node:assert/strict";
import test from "node:test";
import {
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
