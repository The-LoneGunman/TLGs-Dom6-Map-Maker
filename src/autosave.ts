import type { MapProject } from "./domain";
import { parseProject, serializeProject } from "./export";

export const LEGACY_PROJECT_AUTOSAVE_KEY = "pantokrator-atlas-project-v1";

const DATABASE_NAME = "pantokrator-atlas";
const DATABASE_VERSION = 1;
const OBJECT_STORE_NAME = "autosaves";
const PROJECT_RECORD_KEY = "project-v1";

export type AutosaveBackend = "indexeddb" | "localstorage" | "none";
export type AutosaveOperation = "read" | "write" | "remove" | "parse" | "serialize" | "unavailable";
export type AutosaveRevision = string;

export interface AutosaveIssue {
  backend: Exclude<AutosaveBackend, "none">;
  operation: AutosaveOperation;
  message: string;
}

export interface AutosaveState {
  backend: AutosaveBackend;
  errors: AutosaveIssue[];
  migrated: boolean;
  /** Fingerprint of the durable record selected or written by this operation. */
  revision?: AutosaveRevision | null;
  /** Present when an optimistic save was refused because durable state changed. */
  conflict?: AutosaveConflict;
  /** Original unreadable records retained for explicit user recovery. */
  recoveryCopies?: { backend: Exclude<AutosaveBackend, "none">; text: string }[];
}

export interface AutosaveConflict {
  expectedRevision: AutosaveRevision | null;
  /** Undefined means a backend could not be read safely. Null means no record exists. */
  currentRevision: AutosaveRevision | null | undefined;
  backend: AutosaveBackend;
  /** Distinguishes an ordinary stale-tab save from two durable copies that need an explicit choice. */
  reason?: "revision-changed" | "divergent-copies" | "conditional-write-unavailable" | "unreadable-copy";
  /** Present when both persistence backends contain different valid projects. */
  alternateBackend?: Exclude<AutosaveBackend, "none">;
  /** Backend-specific tokens used to resolve a conflict without an unconditional overwrite. */
  backendRevisions?: Partial<Record<Exclude<AutosaveBackend, "none">, AutosaveRevision | null>>;
}

export interface LoadedProjectAutosave extends AutosaveState {
  project?: MapProject;
}

export interface AutosaveDriver {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  remove(): Promise<void>;
  compareAndSet?(
    expectedRevision: AutosaveRevision | null,
    value: string,
  ): Promise<{ saved: boolean; current: string | null }>;
  removeIfRevision?(
    expectedRevision: AutosaveRevision | null,
  ): Promise<{ removed: boolean; current: string | null }>;
}

export interface AutosaveDrivers {
  indexeddb?: AutosaveDriver;
  localstorage?: AutosaveDriver;
}

export interface AutosaveLockManager {
  request<T>(name: string, callback: () => T): Promise<T>;
}

export interface SaveProjectAutosaveOptions {
  /**
   * Refuse the write unless durable state still has this revision. Pass null
   * after loading an empty slot; omit the option only for an unconditional
   * legacy write.
   */
  expectedRevision?: AutosaveRevision | null;
  /** Explicit conflict resolution: replace only if both copies are still exactly the ones reviewed. */
  expectedBackendRevisions?: Partial<Record<Exclude<AutosaveBackend, "none">, AutosaveRevision | null>>;
  /**
   * `serializeProject(project)` when the caller already computed it for this
   * unchanged project object; saves serializing the atlas a second time.
   */
  serialized?: string;
}

export interface LoadProjectAutosaveOptions {
  /** Lets conflict UI inspect the other preserved copy without deleting either one. */
  preferredBackend?: Exclude<AutosaveBackend, "none">;
}

/**
 * Restores the durable IndexedDB record first, then the schema-v1 localStorage
 * record used by earlier builds. A valid legacy record is copied to IndexedDB
 * before it is removed, so a failed migration never destroys the only copy.
 */
export async function loadProjectAutosave(
  drivers: AutosaveDrivers = createBrowserAutosaveDrivers(),
  options: LoadProjectAutosaveOptions = {},
): Promise<LoadedProjectAutosave> {
  const errors: AutosaveIssue[] = [];
  let indexedDbAvailable = false;
  let localStorageAvailable = false;
  let indexedDbProject: MapProject | undefined;
  let indexedDbSerialized: string | undefined;
  let indexedDbRaw: string | null = null;
  let localStorageProject: MapProject | undefined;
  let localStorageSerialized: string | undefined;
  let localStorageRaw: string | null = null;

  if (drivers.indexeddb) {
    try {
      const serialized = await drivers.indexeddb.get();
      indexedDbAvailable = true;
      indexedDbRaw = serialized;
      if (serialized !== null) {
        try {
          indexedDbProject = parseProject(serialized);
          indexedDbSerialized = serialized;
          rememberReadableText(serialized, projectTimestamp(indexedDbProject));
        } catch (error) {
          errors.push(issue("indexeddb", "parse", error));
        }
      }
    } catch (error) {
      errors.push(issue("indexeddb", "read", error));
    }
  } else {
    errors.push(unavailableIssue("indexeddb", "IndexedDB is unavailable in this browser context."));
  }

  if (drivers.localstorage) {
    try {
      const serialized = await drivers.localstorage.get();
      localStorageAvailable = true;
      localStorageRaw = serialized;
      if (serialized !== null) {
        try {
          localStorageProject = parseProject(serialized);
          localStorageSerialized = serialized;
          rememberReadableText(serialized, projectTimestamp(localStorageProject));
        } catch (error) {
          errors.push(issue("localstorage", "parse", error));
        }
      }
    } catch (error) {
      errors.push(issue("localstorage", "read", error));
    }
  } else {
    errors.push(unavailableIssue("localstorage", "localStorage is unavailable in this browser context."));
  }

  const recoveryCopies: NonNullable<AutosaveState["recoveryCopies"]> = [];
  if (indexedDbRaw !== null && !indexedDbProject) recoveryCopies.push({ backend: "indexeddb", text: indexedDbRaw });
  if (localStorageRaw !== null && !localStorageProject) recoveryCopies.push({ backend: "localstorage", text: localStorageRaw });
  if (recoveryCopies.length) {
    const backend = indexedDbProject ? "indexeddb" : localStorageProject ? "localstorage" : recoveryCopies[0]!.backend;
    const project = indexedDbProject ?? localStorageProject;
    const revision = project ? revisionForStoredValue(backend === "indexeddb" ? indexedDbRaw : localStorageRaw) : null;
    return {
      project, backend, errors, migrated: false, revision, recoveryCopies,
      conflict: {
        expectedRevision: revision,
        currentRevision: revisionForStoredValue(backend === "indexeddb" ? indexedDbRaw : localStorageRaw),
        backend,
        reason: "unreadable-copy",
        backendRevisions: {
          ...(indexedDbAvailable ? { indexeddb: revisionForStoredValue(indexedDbRaw) } : {}),
          ...(localStorageAvailable ? { localstorage: revisionForStoredValue(localStorageRaw) } : {}),
        },
      },
    };
  }

  if (
    indexedDbProject
    && indexedDbSerialized
    && localStorageProject
    && localStorageSerialized
    && indexedDbSerialized !== localStorageSerialized
  ) {
    const useIndexedDb = options.preferredBackend
      ? options.preferredBackend === "indexeddb"
      : projectTimestamp(indexedDbProject) > projectTimestamp(localStorageProject);
    const selectedProject = useIndexedDb ? indexedDbProject : localStorageProject;
    const selectedSerialized = useIndexedDb ? indexedDbSerialized : localStorageSerialized;
    const selectedBackend = useIndexedDb ? "indexeddb" : "localstorage";
    const alternateBackend = useIndexedDb ? "localstorage" : "indexeddb";
    return {
      project: selectedProject,
      backend: selectedBackend,
      errors,
      migrated: false,
      revision: autosaveRevision(selectedSerialized),
      conflict: {
        expectedRevision: autosaveRevision(selectedSerialized),
        currentRevision: autosaveRevision(useIndexedDb ? localStorageSerialized : indexedDbSerialized),
        backend: selectedBackend,
        alternateBackend,
        reason: "divergent-copies",
        backendRevisions: {
          indexeddb: autosaveRevision(indexedDbSerialized),
          localstorage: autosaveRevision(localStorageSerialized),
        },
      },
    };
  }

  if (indexedDbProject && (
    !localStorageProject
    || indexedDbSerialized === localStorageSerialized
    || projectTimestamp(indexedDbProject) > projectTimestamp(localStorageProject)
  )) {
    if (localStorageSerialized && drivers.localstorage) {
      try {
        const removed = await removeIfUnchanged(
          drivers.localstorage,
          autosaveRevision(localStorageSerialized),
        );
        if (!removed.removed) {
          const latest = await inspectAutosave(drivers);
          return loadedConflict(
            indexedDbProject,
            "indexeddb",
            autosaveRevision(indexedDbSerialized!),
            latest,
            errors,
          );
        }
      } catch (error) {
        errors.push(issue("localstorage", "remove", error));
      }
    }
    return {
      project: indexedDbProject,
      backend: "indexeddb",
      errors,
      migrated: false,
      revision: autosaveRevision(indexedDbSerialized!),
    };
  }

  if (localStorageProject && localStorageSerialized) {
    if (drivers.indexeddb) {
      try {
        const saved = await compareAndSetValue(
          drivers.indexeddb,
          revisionForStoredValue(indexedDbRaw),
          localStorageSerialized,
        );
        if (!saved.saved) {
          const latest = await inspectAutosave(drivers);
          return loadedConflict(
            localStorageProject,
            "localstorage",
            autosaveRevision(localStorageSerialized),
            latest,
            errors,
          );
        }
        indexedDbAvailable = true;
        if (drivers.localstorage) {
          try {
            const removed = await removeIfUnchanged(
              drivers.localstorage,
              autosaveRevision(localStorageSerialized),
            );
            if (!removed.removed) {
              const latest = await inspectAutosave(drivers);
              return loadedConflict(
                localStorageProject,
                "indexeddb",
                autosaveRevision(localStorageSerialized),
                latest,
                errors,
              );
            }
          } catch (error) {
            errors.push(issue("localstorage", "remove", error));
          }
        }
        return {
          project: localStorageProject,
          backend: "indexeddb",
          errors,
          migrated: true,
          revision: autosaveRevision(localStorageSerialized),
        };
      } catch (error) {
        errors.push(issue("indexeddb", "write", error));
      }
    }
    return {
      project: localStorageProject,
      backend: "localstorage",
      errors,
      migrated: false,
      revision: autosaveRevision(localStorageSerialized),
    };
  }

  return {
    backend: preferredAvailableBackend(indexedDbAvailable, localStorageAvailable),
    errors,
    migrated: false,
    revision: revisionForStoredValue(indexedDbRaw ?? localStorageRaw),
  };
}

/** Saves large projects to IndexedDB and falls back to the legacy storage slot. */
export async function saveProjectAutosave(
  project: MapProject,
  drivers: AutosaveDrivers = createBrowserAutosaveDrivers(),
  options: SaveProjectAutosaveOptions = {},
): Promise<AutosaveState> {
  const errors: AutosaveIssue[] = [];
  let serialized: string;
  try {
    serialized = options.serialized ?? serializeProject(project);
  } catch (error) {
    errors.push(issue("indexeddb", "serialize", error));
    return { backend: "none", errors, migrated: false };
  }
  const nextRevision = autosaveRevision(serialized);
  // serializeProject shape-checks the project before JSON encoding, so the
  // written text parses back to this project; a later inspection of exactly
  // this durable text need not parse the whole atlas again.
  const rememberWritten = () => rememberReadableText(serialized, projectTimestamp(project));
  const expectedRevision = options.expectedRevision;
  const expectedBackendRevisions = options.expectedBackendRevisions;
  const resolvingConflict = expectedBackendRevisions !== undefined;
  const guarded = expectedRevision !== undefined || resolvingConflict;
  let snapshot: AutosaveSnapshot | undefined;

  if (guarded) {
    snapshot = await inspectAutosave(drivers);
    errors.push(...snapshot.errors);
    const backendMismatch = resolvingConflict && (["indexeddb", "localstorage"] as const).some((backend) =>
      snapshot!.backendRevisions[backend] !== expectedBackendRevisions[backend]);
    if (
      !snapshot.readSafe
      || backendMismatch
      || (!resolvingConflict && (snapshot.divergentCopies || snapshot.errors.some((error) => error.operation === "parse") || snapshot.revision !== expectedRevision))
    ) {
      return conflictState(expectedRevision ?? snapshot.revision, snapshot, errors);
    }
  }

  if (drivers.indexeddb) {
    try {
      if (guarded) {
        const result = await compareAndSetValue(
          drivers.indexeddb,
          (resolvingConflict ? expectedBackendRevisions.indexeddb : snapshot!.backendRevisions.indexeddb) ?? null,
          serialized,
        );
        if (!result.saved) return conflictAfterRace(expectedRevision ?? snapshot!.revision, drivers, errors);
      } else {
        await drivers.indexeddb.set(serialized);
      }
      if (drivers.localstorage) {
        try {
          if (guarded) {
            const result = await removeIfUnchanged(
              drivers.localstorage,
              (resolvingConflict ? expectedBackendRevisions.localstorage : snapshot!.backendRevisions.localstorage) ?? null,
            );
            if (!result.removed) return conflictAfterRace(expectedRevision ?? snapshot!.revision, drivers, errors);
          } else {
            await drivers.localstorage.remove();
          }
        } catch (error) {
          errors.push(issue("localstorage", "remove", error));
        }
      }
      rememberWritten();
      return { backend: "indexeddb", errors, migrated: false, revision: nextRevision };
    } catch (error) {
      errors.push(issue("indexeddb", "write", error));
    }
  } else {
    errors.push(unavailableIssue("indexeddb", "IndexedDB is unavailable in this browser context."));
  }

  if (drivers.localstorage) {
    try {
      if (guarded) {
        const result = await compareAndSetValue(
          drivers.localstorage,
          (resolvingConflict ? expectedBackendRevisions.localstorage : snapshot!.backendRevisions.localstorage) ?? null,
          serialized,
        );
        if (!result.saved) return conflictAfterRace(expectedRevision ?? snapshot!.revision, drivers, errors);
      } else {
        await drivers.localstorage.set(serialized);
      }
      rememberWritten();
      return { backend: "localstorage", errors, migrated: false, revision: nextRevision };
    } catch (error) {
      errors.push(issue("localstorage", "write", error));
    }
  } else {
    errors.push(unavailableIssue("localstorage", "localStorage is unavailable in this browser context."));
  }

  return { backend: "none", errors, migrated: false };
}

export function createBrowserAutosaveDrivers(): AutosaveDrivers {
  const drivers: AutosaveDrivers = {};
  try {
    if (typeof indexedDB !== "undefined") drivers.indexeddb = createIndexedDbDriver(indexedDB);
  } catch {
    // Access may be denied by browser privacy policy; the caller reports it as unavailable.
  }
  try {
    if (typeof localStorage !== "undefined") {
      drivers.localstorage = createLocalStorageDriver(localStorage, browserAutosaveLockManager());
    }
  } catch {
    // Access may throw before the first operation in sandboxed/opaque origins.
  }
  return drivers;
}

export function createIndexedDbDriver(factory: IDBFactory): AutosaveDriver {
  return {
    async get() {
      const database = await openAutosaveDatabase(factory);
      try {
        return await readIndexedDbValue(database);
      } finally {
        database.close();
      }
    },
    async set(value) {
      const database = await openAutosaveDatabase(factory);
      try {
        await writeIndexedDbValue(database, value);
      } finally {
        database.close();
      }
    },
    async remove() {
      const database = await openAutosaveDatabase(factory);
      try {
        await removeIndexedDbValue(database);
      } finally {
        database.close();
      }
    },
    async compareAndSet(expectedRevision, value) {
      const database = await openAutosaveDatabase(factory);
      try {
        return await compareAndSetIndexedDbValue(database, expectedRevision, value);
      } finally {
        database.close();
      }
    },
    async removeIfRevision(expectedRevision) {
      const database = await openAutosaveDatabase(factory);
      try {
        return await removeIndexedDbValueIfRevision(database, expectedRevision);
      } finally {
        database.close();
      }
    },
  };
}

export function createLocalStorageDriver(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  lockManager: AutosaveLockManager | null | undefined = browserAutosaveLockManager(),
): AutosaveDriver {
  return {
    async get() {
      return storage.getItem(LEGACY_PROJECT_AUTOSAVE_KEY);
    },
    async set(value) {
      storage.setItem(LEGACY_PROJECT_AUTOSAVE_KEY, value);
    },
    async remove() {
      storage.removeItem(LEGACY_PROJECT_AUTOSAVE_KEY);
    },
    async compareAndSet(expectedRevision, value) {
      if (!lockManager) {
        return { saved: false, current: storage.getItem(LEGACY_PROJECT_AUTOSAVE_KEY) };
      }
      return lockManager.request(LEGACY_PROJECT_AUTOSAVE_KEY, () => {
        const current = storage.getItem(LEGACY_PROJECT_AUTOSAVE_KEY);
        if (revisionForStoredValue(current) !== expectedRevision) return { saved: false, current };
        storage.setItem(LEGACY_PROJECT_AUTOSAVE_KEY, value);
        return { saved: true, current: value };
      });
    },
    async removeIfRevision(expectedRevision) {
      if (!lockManager) {
        const current = storage.getItem(LEGACY_PROJECT_AUTOSAVE_KEY);
        // Nothing stored and nothing expected: there is nothing to delete or
        // race against, so report success rather than a false tab conflict.
        if (current === null && expectedRevision === null) return { removed: true, current: null };
        return { removed: false, current };
      }
      return lockManager.request(LEGACY_PROJECT_AUTOSAVE_KEY, () => {
        const current = storage.getItem(LEGACY_PROJECT_AUTOSAVE_KEY);
        if (revisionForStoredValue(current) !== expectedRevision) return { removed: false, current };
        storage.removeItem(LEGACY_PROJECT_AUTOSAVE_KEY);
        return { removed: true, current: null };
      });
    },
  };
}

function openAutosaveDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OBJECT_STORE_NAME)) database.createObjectStore(OBJECT_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB could not be opened."));
    request.onblocked = () => reject(new Error("IndexedDB upgrade was blocked by another tab."));
  });
}

function readIndexedDbValue(database: IDBDatabase): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const transaction = database.transaction(OBJECT_STORE_NAME, "readonly");
    const request = transaction.objectStore(OBJECT_STORE_NAME).get(PROJECT_RECORD_KEY);
    request.onsuccess = () => {
      if (settled) return;
      settled = true;
      resolve(typeof request.result === "string" ? request.result : null);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error("IndexedDB autosave could not be read."));
    };
    transaction.onabort = () => {
      if (settled) return;
      settled = true;
      reject(transaction.error ?? new Error("IndexedDB read transaction was aborted."));
    };
  });
}

function writeIndexedDbValue(database: IDBDatabase, value: string): Promise<void> {
  return mutateIndexedDb(database, (store) => store.put(value, PROJECT_RECORD_KEY), "write");
}

function removeIndexedDbValue(database: IDBDatabase): Promise<void> {
  return mutateIndexedDb(database, (store) => store.delete(PROJECT_RECORD_KEY), "remove");
}

function compareAndSetIndexedDbValue(
  database: IDBDatabase,
  expectedRevision: AutosaveRevision | null,
  value: string,
): Promise<{ saved: boolean; current: string | null }> {
  return conditionallyMutateIndexedDb(database, expectedRevision, (store) => {
    store.put(value, PROJECT_RECORD_KEY);
  }, "write").then((result) => ({ saved: result.mutated, current: result.mutated ? value : result.current }));
}

function removeIndexedDbValueIfRevision(
  database: IDBDatabase,
  expectedRevision: AutosaveRevision | null,
): Promise<{ removed: boolean; current: string | null }> {
  return conditionallyMutateIndexedDb(database, expectedRevision, (store) => {
    store.delete(PROJECT_RECORD_KEY);
  }, "remove").then((result) => ({ removed: result.mutated, current: result.mutated ? null : result.current }));
}

function conditionallyMutateIndexedDb(
  database: IDBDatabase,
  expectedRevision: AutosaveRevision | null,
  action: (store: IDBObjectStore) => void,
  operation: "write" | "remove",
): Promise<{ mutated: boolean; current: string | null }> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    let current: string | null = null;
    let mutated = false;
    try {
      transaction = database.transaction(OBJECT_STORE_NAME, "readwrite");
      const store = transaction.objectStore(OBJECT_STORE_NAME);
      const request = store.get(PROJECT_RECORD_KEY);
      request.onsuccess = () => {
        current = typeof request.result === "string" ? request.result : null;
        if (revisionForStoredValue(current) !== expectedRevision) return;
        mutated = true;
        action(store);
      };
      request.onerror = () => transaction.abort();
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve({ mutated, current });
    transaction.onerror = () => reject(transaction.error ?? new Error(`IndexedDB conditional ${operation} transaction failed.`));
    transaction.onabort = () => reject(transaction.error ?? new Error(`IndexedDB conditional ${operation} transaction was aborted.`));
  });
}

function mutateIndexedDb(
  database: IDBDatabase,
  action: (store: IDBObjectStore) => IDBRequest,
  operation: "write" | "remove",
): Promise<void> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(OBJECT_STORE_NAME, "readwrite");
      action(transaction.objectStore(OBJECT_STORE_NAME));
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(`IndexedDB ${operation} transaction failed.`));
    transaction.onabort = () => reject(transaction.error ?? new Error(`IndexedDB ${operation} transaction was aborted.`));
  });
}

interface AutosaveSnapshot {
  backend: AutosaveBackend;
  revision: AutosaveRevision | null;
  backendRevisions: Partial<Record<Exclude<AutosaveBackend, "none">, AutosaveRevision | null>>;
  errors: AutosaveIssue[];
  readSafe: boolean;
  divergentCopies: boolean;
  recoveryCopies: NonNullable<AutosaveState["recoveryCopies"]>;
}

interface AutosaveCandidate {
  backend: Exclude<AutosaveBackend, "none">;
  available: boolean;
  raw: string | null;
  revision: AutosaveRevision | null;
  /** `projectTimestamp` of the parsed record; undefined when absent or unreadable. */
  timestamp?: number;
}

async function inspectAutosave(drivers: AutosaveDrivers): Promise<AutosaveSnapshot> {
  const errors: AutosaveIssue[] = [];
  let readSafe = true;
  const read = async (
    backend: Exclude<AutosaveBackend, "none">,
    driver: AutosaveDriver | undefined,
  ): Promise<AutosaveCandidate> => {
    if (!driver) return { backend, available: false, raw: null, revision: null };
    try {
      const raw = await driver.get();
      const candidate: AutosaveCandidate = {
        backend,
        available: true,
        raw,
        revision: revisionForStoredValue(raw),
      };
      if (raw !== null) {
        const known = readableTextTimestamp(raw);
        if (known !== undefined) candidate.timestamp = known;
        else {
          try {
            candidate.timestamp = projectTimestamp(parseProject(raw));
            rememberReadableText(raw, candidate.timestamp);
          } catch (error) { errors.push(issue(backend, "parse", error)); }
        }
      }
      return candidate;
    } catch (error) {
      readSafe = false;
      errors.push(issue(backend, "read", error));
      return { backend, available: false, raw: null, revision: null };
    }
  };

  const [indexeddb, localstorage] = await Promise.all([
    read("indexeddb", drivers.indexeddb),
    read("localstorage", drivers.localstorage),
  ]);
  let selected: AutosaveCandidate | undefined;
  if (indexeddb.raw !== null && (localstorage.raw === null || indexeddb.raw === localstorage.raw)) {
    selected = indexeddb;
  } else if (localstorage.raw !== null && indexeddb.raw === null) {
    selected = localstorage;
  } else if (indexeddb.timestamp !== undefined && (
    localstorage.timestamp === undefined || indexeddb.timestamp > localstorage.timestamp
  )) {
    selected = indexeddb;
  } else if (localstorage.timestamp !== undefined) {
    selected = localstorage;
  } else if (indexeddb.raw !== null) {
    selected = indexeddb;
  } else if (localstorage.raw !== null) {
    selected = localstorage;
  }

  return {
    backend: selected?.backend ?? preferredAvailableBackend(indexeddb.available, localstorage.available),
    revision: selected?.revision ?? null,
    backendRevisions: {
      ...(indexeddb.available ? { indexeddb: indexeddb.revision } : {}),
      ...(localstorage.available ? { localstorage: localstorage.revision } : {}),
    },
    errors,
    readSafe,
    divergentCopies: indexeddb.timestamp !== undefined && localstorage.timestamp !== undefined && indexeddb.raw !== localstorage.raw,
    recoveryCopies: [indexeddb, localstorage].flatMap((candidate) =>
      candidate.raw !== null && candidate.timestamp === undefined ? [{ backend: candidate.backend, text: candidate.raw }] : []),
  };
}

async function compareAndSetValue(
  driver: AutosaveDriver,
  expectedRevision: AutosaveRevision | null,
  value: string,
): Promise<{ saved: boolean; current: string | null }> {
  if (driver.compareAndSet) return driver.compareAndSet(expectedRevision, value);
  const current = await driver.get();
  // A read followed by a separate write is not a compare-and-set operation:
  // another tab can win in between. Refuse guarded writes from legacy drivers.
  return { saved: false, current };
}

async function removeIfUnchanged(
  driver: AutosaveDriver,
  expectedRevision: AutosaveRevision | null,
): Promise<{ removed: boolean; current: string | null }> {
  if (driver.removeIfRevision) return driver.removeIfRevision(expectedRevision);
  const current = await driver.get();
  // As above, never emulate conditional deletion with a racy get/remove pair.
  return { removed: false, current };
}

function loadedConflict(
  project: MapProject,
  backend: Exclude<AutosaveBackend, "none">,
  revision: AutosaveRevision,
  snapshot: AutosaveSnapshot,
  errors: AutosaveIssue[],
): LoadedProjectAutosave {
  return {
    project,
    backend,
    errors: [...errors, ...snapshot.errors],
    migrated: false,
    revision,
    recoveryCopies: snapshot.recoveryCopies,
    conflict: {
      expectedRevision: revision,
      currentRevision: snapshot.readSafe ? snapshot.revision : undefined,
      backend: snapshot.backend,
      alternateBackend: snapshot.backend === "none" ? undefined : snapshot.backend,
      reason: snapshot.recoveryCopies.length ? "unreadable-copy" : snapshot.divergentCopies ? "divergent-copies" : "revision-changed",
      backendRevisions: snapshot.backendRevisions,
    },
  };
}

function conflictState(
  expectedRevision: AutosaveRevision | null,
  snapshot: AutosaveSnapshot,
  errors: AutosaveIssue[],
): AutosaveState {
  return {
    backend: snapshot.backend,
    errors,
    migrated: false,
    revision: snapshot.readSafe ? snapshot.revision : undefined,
    recoveryCopies: snapshot.recoveryCopies,
    conflict: {
      expectedRevision,
      currentRevision: snapshot.readSafe ? snapshot.revision : undefined,
      backend: snapshot.backend,
      reason: snapshot.recoveryCopies.length ? "unreadable-copy" : snapshot.divergentCopies ? "divergent-copies" : "revision-changed",
      backendRevisions: snapshot.backendRevisions,
    },
  };
}

function browserAutosaveLockManager(): AutosaveLockManager | undefined {
  try {
    if (typeof navigator === "undefined" || !navigator.locks) return undefined;
    return {
      request<T>(name: string, callback: () => T): Promise<T> {
        return navigator.locks.request(name, callback);
      },
    };
  } catch {
    return undefined;
  }
}

async function conflictAfterRace(
  expectedRevision: AutosaveRevision | null,
  drivers: AutosaveDrivers,
  errors: AutosaveIssue[],
): Promise<AutosaveState> {
  const latest = await inspectAutosave(drivers);
  return conflictState(expectedRevision, latest, [...errors, ...latest.errors]);
}

/**
 * One save fingerprints the same atlas text several times (the new text, then
 * the stored copy read back from each backend and inside compare-and-set), so
 * the most recent results are reused for byte-identical text.
 */
const recentRevisions: { text: string; revision: AutosaveRevision }[] = [];
const RECENT_REVISION_LIMIT = 2;

/** Stable compact fingerprint used as an optimistic autosave revision token. */
export function autosaveRevision(serialized: string): AutosaveRevision {
  for (const entry of recentRevisions) if (entry.text === serialized) return entry.revision;
  const revision = fnv1a64Revision(serialized);
  recentRevisions.unshift({ text: serialized, revision });
  if (recentRevisions.length > RECENT_REVISION_LIMIT) recentRevisions.length = RECENT_REVISION_LIMIT;
  return revision;
}

/**
 * 64-bit FNV-1a over UTF-16 code units, computed in four 16-bit limbs instead
 * of BigInt arithmetic. Tokens are identical to the former BigInt version:
 * `hash ^= code; hash = (hash * 0x100000001b3) mod 2^64` per code unit.
 */
function fnv1a64Revision(serialized: string): AutosaveRevision {
  // Offset basis 0xcbf29ce484222325, least significant limb first.
  let h0 = 0x2325;
  let h1 = 0x8422;
  let h2 = 0x9ce4;
  let h3 = 0xcbf2;
  for (let index = 0; index < serialized.length; index += 1) {
    h0 ^= serialized.charCodeAt(index);
    // The prime is 2^40 + 0x1b3: multiply each limb by 0x1b3, add the limbs
    // shifted by 40 bits (two limbs plus 8 bits), and propagate carries.
    const t0 = h0 * 0x1b3;
    const t1 = h1 * 0x1b3 + (t0 >>> 16);
    const t2 = h2 * 0x1b3 + (t1 >>> 16) + (h0 << 8);
    const t3 = h3 * 0x1b3 + (t2 >>> 16) + (h1 << 8);
    h0 = t0 & 0xffff;
    h1 = t1 & 0xffff;
    h2 = t2 & 0xffff;
    h3 = t3 & 0xffff;
  }
  const high = ((h3 << 16) | h2) >>> 0;
  const low = ((h1 << 16) | h0) >>> 0;
  return `fnv1a64:${serialized.length}:${high.toString(16).padStart(8, "0")}${low.toString(16).padStart(8, "0")}`;
}

/**
 * The most recent durable text known to parse, with the `projectTimestamp` its
 * parse yields. Inspection before every guarded save reads back the record the
 * previous save wrote; recognising it avoids re-parsing the whole atlas.
 */
let knownReadableText: { text: string; timestamp: number } | undefined;

function rememberReadableText(text: string, timestamp: number): void {
  knownReadableText = { text, timestamp };
}

function readableTextTimestamp(text: string): number | undefined {
  return knownReadableText?.text === text ? knownReadableText.timestamp : undefined;
}

function revisionForStoredValue(value: string | null): AutosaveRevision | null {
  return value === null ? null : autosaveRevision(value);
}

function preferredAvailableBackend(indexedDbAvailable: boolean, localStorageAvailable: boolean): AutosaveBackend {
  if (indexedDbAvailable) return "indexeddb";
  if (localStorageAvailable) return "localstorage";
  return "none";
}

function projectTimestamp(project: MapProject): number {
  const timestamp = Date.parse(project.updatedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function issue(
  backend: AutosaveIssue["backend"],
  operation: AutosaveOperation,
  error: unknown,
): AutosaveIssue {
  return {
    backend,
    operation,
    message: error instanceof Error ? error.message : String(error),
  };
}

function unavailableIssue(backend: AutosaveIssue["backend"], message: string): AutosaveIssue {
  return { backend, operation: "unavailable", message };
}
