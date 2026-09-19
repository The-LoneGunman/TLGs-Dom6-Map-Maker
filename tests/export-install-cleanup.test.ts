import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPackageFiles,
  downloadPackage,
  installPackage,
  removeObsoletePlaneArtifacts,
  zipPackageSafety,
} from "../src/export";
import { createDefaultProject } from "../src/generator";

const obsoleteNames = (root: string, firstPlane: number) => {
  const names: string[] = [];
  for (let planeNumber = firstPlane; planeNumber <= 8; planeNumber += 1) {
    names.push(`${root}_plane${planeNumber}.map`, `${root}_plane${planeNumber}.d6m`);
  }
  return names;
};

function notFound(): DOMException {
  return new DOMException("The entry does not exist.", "NotFoundError");
}

const encode = (value: string) => new TextEncoder().encode(value);

class MemoryDirectory {
  readonly files = new Map<string, Uint8Array>();
  readonly events: string[] = [];
  failWrite?: (name: string) => unknown;
  readOverride?: (name: string, data: Uint8Array) => Uint8Array;

  constructor(initial: Record<string, string> = {}) {
    for (const [name, value] of Object.entries(initial)) this.files.set(name, encode(value));
  }

  async removeEntry(name: string) {
    this.events.push(`remove:${name}`);
    if (!this.files.delete(name)) throw notFound();
  }

  async *values() {
    for (const name of this.files.keys()) yield { kind: "file" as const, name };
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!options?.create) throw notFound();
      this.files.set(name, new Uint8Array());
    }
    return {
      getFile: async () => {
        this.events.push(`read:${name}`);
        const stored = this.files.get(name)!.slice();
        const data = this.readOverride?.(name, stored) ?? stored;
        return { size: data.byteLength, arrayBuffer: async () => data.buffer };
      },
      createWritable: async () => {
        let pending = new Uint8Array();
        return {
          write: async (value: ArrayBuffer | ArrayBufferView) => {
            this.events.push(`write:${name}`);
            const failure = this.failWrite?.(name);
            if (failure) throw failure;
            pending = value instanceof ArrayBuffer
              ? new Uint8Array(value).slice()
              : new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
          },
          close: async () => {
            this.events.push(`close:${name}`);
            this.files.set(name, pending);
          },
        };
      },
    };
  }
}

function smallInstallProject(planeCount = 1) {
  const project = createDefaultProject("install-safety");
  project.name = "Safety Atlas!";
  project.planes[0]!.width = 256;
  project.planes[0]!.height = 256;
  while (project.planes.length < planeCount) {
    const plane = structuredClone(project.planes[0]!);
    plane.id = `install-plane-${project.planes.length + 1}`;
    plane.name = `Install Plane ${project.planes.length + 1}`;
    project.planes.push(plane);
  }
  return project;
}

function atlasOwnedFiles(project: ReturnType<typeof smallInstallProject>, files: Record<string, string>): Record<string, string> {
  return { ...files, "atlas_project.json": JSON.stringify(project) };
}

async function withDirectoryPicker<T>(directory: MemoryDirectory, action: () => Promise<T>): Promise<T> {
  const mapsDirectory = {
    async getDirectoryHandle() {
      return directory;
    },
  };
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let locked = false;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    locks: { async request(name: string, options: { ifAvailable: boolean }, action: (lock: object | null) => Promise<unknown>) {
      assert.equal(name, "pantokrator-atlas:direct-install");
      assert.equal(options.ifAvailable, true);
      if (locked) return action(null);
      locked = true;
      try { return await action({ name }); } finally { locked = false; }
    } },
  } });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { showDirectoryPicker: async () => mapsDirectory },
  });
  try {
    return await action();
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
}

test("8-to-2 reinstall cleanup targets only plane 3 through plane 8 artifacts", async () => {
  const removed: string[] = [];
  const directory = {
    async removeEntry(name: string) {
      removed.push(name);
    },
  };

  await removeObsoletePlaneArtifacts(directory, "Atlas_Root", 2);

  assert.deepEqual(removed, obsoleteNames("Atlas_Root", 3));
  assert.equal(removed.includes("Atlas_Root.map"), false);
  assert.equal(removed.includes("Atlas_Root.d6m"), false);
  assert.equal(removed.some((name) => name.includes("plane2")), false);
});

test("competing direct installs are rejected before changing files and the lock releases", async () => {
  const a = smallInstallProject();
  const b = structuredClone(a);
  b.description = "Competing package";
  const directory = new MemoryDirectory();
  let second: Promise<unknown> | undefined;
  directory.failWrite = (name) => {
    if (name === "Safety_Atlas.map" && !second) {
      second = assert.rejects(installPackage(b), /Another Atlas tab is installing/);
    }
  };
  await withDirectoryPicker(directory, async () => {
    assert.equal(await installPackage(a), "installed");
    await second;
    assert.equal(JSON.parse(new TextDecoder().decode(directory.files.get("atlas_project.json"))).description, a.description);
    directory.failWrite = undefined;
    assert.equal(await installPackage(b), "installed");
    assert.equal(JSON.parse(new TextDecoder().decode(directory.files.get("atlas_project.json"))).description, b.description);
  });
});

test("install requires cross-tab locking and makes no changes when it is unavailable", async () => {
  const directory = new MemoryDirectory();
  await withDirectoryPicker(directory, async () => {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    assert.equal(await installPackage(smallInstallProject()), "unsupported");
    assert.equal(directory.events.length, 0);
    assert.equal(directory.files.size, 0);
  });
});

test("an interrupted first-install stage can be retried without deleting old staging bytes", async () => {
  const orphan = ".__pantokrator_atlas_install__Safety_Atlas__old_1__stage__Safety_Atlas.d6m.tmp";
  const directory = new MemoryDirectory({ [orphan]: "partial old stage" });
  assert.equal(await withDirectoryPicker(directory, () => installPackage(smallInstallProject())), "installed");
  assert.deepEqual(directory.files.get(orphan), encode("partial old stage"));
  assert.ok(directory.events.indexOf("write:atlas_project.json") < directory.events.indexOf("write:Safety_Atlas.d6m"));
});

test("stage-only recovery never authorizes unrelated or backup filenames", async () => {
  for (const name of [
    ".__pantokrator_atlas_install__Safety_Atlas__old_1__stage__unrelated.txt.tmp",
    ".__pantokrator_atlas_install__Safety_Atlas__old_1__backup__Safety_Atlas.d6m.tmp",
    ".__pantokrator_atlas_install__Other_Atlas__old_1__stage__Safety_Atlas.d6m.tmp",
    "Safety_Atlas.d6m",
  ]) {
    const directory = new MemoryDirectory({ [name]: "preserve" });
    await assert.rejects(withDirectoryPicker(directory, () => installPackage(smallInstallProject())), /No files were changed/);
    assert.deepEqual(directory.files.get(name), encode("preserve"));
  }
});

test("outside writes are preserved during failed-install rollback", async () => {
  const project = smallInstallProject();
  const directory = new MemoryDirectory(atlasOwnedFiles(project, {
    "Safety_Atlas.map": "old map", "Safety_Atlas.d6m": "old binary",
  }));
  directory.failWrite = (name) => {
    if (name === "Safety_Atlas.map") {
      directory.files.set("Safety_Atlas.d6m", encode("outside update"));
      return new Error("interrupted");
    }
  };
  await assert.rejects(withDirectoryPicker(directory, () => installPackage(project)), /backup temporary files were retained/i);
  assert.deepEqual(directory.files.get("Safety_Atlas.d6m"), encode("outside update"));
  assert.ok([...directory.files].some(([name, value]) => name.includes("__backup__") && new TextDecoder().decode(value) === "old binary"));
});

test("a changing backup read cannot substitute another writer's bytes for the original", async () => {
  const project = smallInstallProject();
  const directory = new MemoryDirectory(atlasOwnedFiles(project, {
    "Safety_Atlas.map": "original map", "Safety_Atlas.d6m": "original binary",
  }));
  let reads = 0;
  directory.readOverride = (name, data) => {
    // Simulate A -> B -> A between the fingerprint and backup reads.
    if (name === "Safety_Atlas.d6m" && ++reads === 3) return encode("transient competing binary");
    return data;
  };
  await assert.rejects(withDirectoryPicker(directory, () => installPackage(project)), /changed while its backup was being read/);
  assert.deepEqual(directory.files.get("Safety_Atlas.d6m"), encode("original binary"));
  assert.deepEqual(directory.files.get("Safety_Atlas.map"), encode("original map"));
  assert.equal(directory.events.includes("write:Safety_Atlas.d6m"), false);
});

test("one-plane cleanup targets plane 2 through plane 8 and leaves unrelated assets untouched", async () => {
  const removed: string[] = [];
  const existing = new Set([
    "Atlas_Root.map",
    "Atlas_Root.d6m",
    "Atlas_Root_plane2.map",
    "Atlas_Root_plane2.d6m",
    "Atlas_Root_plane2.tga",
    "Atlas_Root_battle.map",
    "Other_Atlas_plane3.map",
    "battlefield.tga",
    "atlas_project.json",
    "host_topology.txt",
  ]);
  const directory = {
    async removeEntry(name: string) {
      removed.push(name);
      if (!existing.delete(name)) throw notFound();
    },
  };

  await removeObsoletePlaneArtifacts(directory, "Atlas_Root", 1);

  assert.deepEqual(removed, obsoleteNames("Atlas_Root", 2));
  assert.deepEqual(
    [...existing].sort(),
    [
      "Atlas_Root.d6m",
      "Atlas_Root.map",
      "Atlas_Root_battle.map",
      "Atlas_Root_plane2.tga",
      "Other_Atlas_plane3.map",
      "atlas_project.json",
      "host_topology.txt",
      "battlefield.tga",
    ].sort(),
  );
});

test("cleanup ignores missing entries but propagates other filesystem failures", async () => {
  await assert.doesNotReject(removeObsoletePlaneArtifacts({
    async removeEntry() {
      throw notFound();
    },
  }, "Atlas_Root", 7));

  const denied = new DOMException("Permission denied.", "NotAllowedError");
  await assert.rejects(removeObsoletePlaneArtifacts({
    async removeEntry() {
      throw denied;
    },
  }, "Atlas_Root", 7), (error) => error === denied);
});

test("direct install accepts a new empty map folder", async () => {
  const project = smallInstallProject();
  const directory = new MemoryDirectory();

  assert.equal(await withDirectoryPicker(directory, () => installPackage(project)), "installed");
  assert.equal(directory.files.has("Safety_Atlas.map"), true);
  assert.equal(directory.files.has("Safety_Atlas.d6m"), true);
  assert.equal(directory.files.has("atlas_project.json"), true);
});

test("direct install refuses a non-Atlas normalized-name collision before changing any file", async () => {
  const project = smallInstallProject();
  project.name = "Collision / Atlas?";
  const root = "Collision_Atlas";
  const initial = {
    [`${root}.map`]: "unrelated authored map",
    [`${root}.d6m`]: "unrelated geography",
    "custom-battlefield.tga": "unrelated image",
  };
  const directory = new MemoryDirectory(initial);

  await assert.rejects(
    withDirectoryPicker(directory, () => installPackage(project)),
    /refused to change the existing Collision_Atlas folder.*no atlas_project\.json ownership marker.*No files were changed/i,
  );
  assert.equal(directory.events.some((event) => event.startsWith("write:") || event.startsWith("remove:")), false);
  for (const [name, value] of Object.entries(initial)) assert.deepEqual(directory.files.get(name), encode(value));
});

test("direct install refuses a nonempty folder whose Atlas marker belongs to another normalized root", async () => {
  const project = smallInstallProject();
  const other = smallInstallProject();
  other.name = "Different Atlas";
  const root = "Safety_Atlas";
  const initial = atlasOwnedFiles(other, {
    [`${root}.map`]: "unrelated map",
    [`${root}.d6m`]: "unrelated geography",
  });
  const directory = new MemoryDirectory(initial);

  await assert.rejects(
    withDirectoryPicker(directory, () => installPackage(project)),
    /refused to change the existing Safety_Atlas folder.*does not identify this normalized map folder.*No files were changed/i,
  );
  assert.equal(directory.events.some((event) => event.startsWith("write:") || event.startsWith("remove:")), false);
  for (const [name, value] of Object.entries(initial)) assert.deepEqual(directory.files.get(name), encode(value));
});

test("direct install refuses an unreadable Atlas ownership marker before staging", async () => {
  const project = smallInstallProject();
  const initial = {
    "Safety_Atlas.map": "existing map",
    "Safety_Atlas.d6m": "existing geography",
    "atlas_project.json": "{not valid project JSON",
  };
  const directory = new MemoryDirectory(initial);

  await assert.rejects(
    withDirectoryPicker(directory, () => installPackage(project)),
    /refused to change the existing Safety_Atlas folder.*does not identify this normalized map folder.*No files were changed/i,
  );
  assert.equal(directory.events.some((event) => event.startsWith("write:") || event.startsWith("remove:")), false);
  for (const [name, value] of Object.entries(initial)) assert.deepEqual(directory.files.get(name), encode(value));
});

test("direct install stages and backs up before publishing binaries, then removes only Atlas artifacts last", async () => {
  const project = smallInstallProject();
  const root = "Safety_Atlas";
  const directory = new MemoryDirectory(atlasOwnedFiles(project, {
    [`${root}.map`]: "old map",
    [`${root}.d6m`]: "old d6m",
    [`${root}_plane2.map`]: "obsolete map",
    [`${root}_plane2.d6m`]: "obsolete d6m",
    [`${root}_plane2.tga`]: "related but unowned image",
    [`${root}_battle.map`]: "related but unowned battle map",
    "custom-battlefield.tga": "unrelated image",
  }));

  assert.equal(await withDirectoryPicker(directory, () => installPackage(project)), "installed");

  const writes = directory.events.filter((event) => event.startsWith("write:"));
  const stageD6m = writes.findIndex((event) => event.includes("__stage__") && event.endsWith(`${root}.d6m.tmp`));
  const finalD6m = writes.findIndex((event) => event === `write:${root}.d6m`);
  const finalMap = writes.findIndex((event) => event === `write:${root}.map`);
  const finalSupport = writes.findIndex((event) => event === "write:INSTALL.txt");
  assert.ok(stageD6m >= 0 && stageD6m < finalD6m, "new binary must be staged before the playable target changes");
  assert.ok(finalD6m < finalMap && finalD6m < finalSupport, "all playable binaries publish before map/support references");

  const lastFinalWrite = Math.max(...directory.events.map((event, index) =>
    event.startsWith("write:") && !event.includes(".__pantokrator_atlas_install__") ? index : -1));
  const firstRemoval = directory.events.findIndex((event) => event.startsWith("remove:"));
  assert.ok(firstRemoval > lastFinalWrite, "temporary and obsolete deletion must be the final phase");
  assert.equal([...directory.files].some(([name]) => name.startsWith(".__pantokrator_atlas_install__")), false);
  assert.equal(directory.files.has(`${root}_plane2.map`), false);
  assert.equal(directory.files.has(`${root}_plane2.d6m`), false);
  assert.equal(directory.files.has(`${root}_plane2.tga`), true);
  assert.equal(directory.files.has(`${root}_battle.map`), true);
  assert.equal(directory.files.has("custom-battlefield.tga"), true);
  for (const support of ["INSTALL.txt", "atlas_project.json", "balance_report.txt", "host_settings.txt", "host_topology.txt"]) {
    assert.equal(directory.files.has(support), true, `${support} should publish after the D6M`);
  }
});

test("a staging failure preserves every current playable and unrelated file", async () => {
  const project = smallInstallProject(2);
  const root = "Safety_Atlas";
  const initial = atlasOwnedFiles(project, {
    [`${root}.map`]: "old main map",
    [`${root}.d6m`]: "old main d6m",
    [`${root}_plane2.map`]: "old plane map",
    [`${root}_plane2.d6m`]: "old plane d6m",
    "custom-battlefield.tga": "leave me",
  });
  const directory = new MemoryDirectory(initial);
  const failure = new DOMException("Disk full", "QuotaExceededError");
  directory.failWrite = (name) => name.includes("__stage__") && name.endsWith(`${root}_plane2.d6m.tmp`) ? failure : undefined;

  await assert.rejects(withDirectoryPicker(directory, () => installPackage(project)), (error) => error === failure);
  for (const [name, value] of Object.entries(initial)) {
    assert.deepEqual(directory.files.get(name), encode(value), `${name} must survive staging failure byte-for-byte`);
  }
  assert.equal([...directory.files].some(([name]) => name.startsWith(".__pantokrator_atlas_install__")), false);
});

test("a mid-publish binary failure rolls every touched target back from disk backups", async () => {
  const project = smallInstallProject(2);
  const root = "Safety_Atlas";
  const initial = atlasOwnedFiles(project, {
    [`${root}.map`]: "old main map",
    [`${root}.d6m`]: "old main d6m",
    [`${root}_plane2.map`]: "old plane map",
    [`${root}_plane2.d6m`]: "old plane d6m",
    "custom-battlefield.tga": "leave me",
  });
  const directory = new MemoryDirectory(initial);
  const failure = new DOMException("Write interrupted", "InvalidStateError");
  let failed = false;
  directory.failWrite = (name) => {
    if (!failed && name === `${root}_plane2.d6m`) {
      failed = true;
      return failure;
    }
    return undefined;
  };

  await assert.rejects(withDirectoryPicker(directory, () => installPackage(project)), (error) => error === failure);
  for (const [name, value] of Object.entries(initial)) {
    assert.deepEqual(directory.files.get(name), encode(value), `${name} must be restored byte-for-byte`);
  }
  assert.equal([...directory.files].some(([name]) => name.startsWith(".__pantokrator_atlas_install__")), false);
});

test("a map-reference publish failure restores binaries and removes newly created support files", async () => {
  const project = smallInstallProject();
  const root = "Safety_Atlas";
  const initial = atlasOwnedFiles(project, {
    [`${root}.map`]: "old map",
    [`${root}.d6m`]: "old d6m",
    "custom-battlefield.tga": "leave me",
  });
  const directory = new MemoryDirectory(initial);
  const failure = new DOMException("Map write failed", "NotAllowedError");
  let failed = false;
  directory.failWrite = (name) => {
    if (!failed && name === `${root}.map`) {
      failed = true;
      return failure;
    }
    return undefined;
  };

  await assert.rejects(withDirectoryPicker(directory, () => installPackage(project)), (error) => error === failure);
  for (const [name, value] of Object.entries(initial)) assert.deepEqual(directory.files.get(name), encode(value));
  assert.deepEqual(directory.files.get("atlas_project.json"), encode(initial["atlas_project.json"]));
  for (const support of ["INSTALL.txt", "balance_report.txt", "host_settings.txt", "host_topology.txt"]) {
    assert.equal(directory.files.has(support), false);
  }
  assert.equal([...directory.files].some(([name]) => name.startsWith(".__pantokrator_atlas_install__")), false);
});

test("an unrecoverable rollback retains Atlas backups and reports the residual explicitly", async () => {
  const project = smallInstallProject(2);
  const root = "Safety_Atlas";
  const directory = new MemoryDirectory(atlasOwnedFiles(project, {
    [`${root}.map`]: "old map",
    [`${root}.d6m`]: "old main d6m",
    [`${root}_plane2.map`]: "old plane map",
    [`${root}_plane2.d6m`]: "old plane d6m",
    "custom-battlefield.tga": "leave me",
  }));
  const publishFailure = new DOMException("Publish failed", "InvalidStateError");
  const restoreFailure = new DOMException("Restore failed", "NotAllowedError");
  let planeTwoFailed = false;
  let mainWrites = 0;
  directory.failWrite = (name) => {
    if (name === `${root}.d6m`) {
      mainWrites += 1;
      if (mainWrites === 2) return restoreFailure;
    }
    if (!planeTwoFailed && name === `${root}_plane2.d6m`) {
      planeTwoFailed = true;
      return publishFailure;
    }
    return undefined;
  };

  await assert.rejects(withDirectoryPicker(directory, () => installPackage(project)), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.message, /backup temporary files were retained/i);
    return true;
  });
  const backup = [...directory.files].find(([name]) => name.includes("__backup__") && name.endsWith(`${root}.d6m.tmp`));
  assert.ok(backup, "the old binary backup remains available after restoration itself fails");
  assert.deepEqual(backup[1], encode("old main d6m"));
  assert.deepEqual(directory.files.get("custom-battlefield.tga"), encode("leave me"));
  assert.equal([...directory.files].some(([name]) => name.includes("__stage__")), false);
});

test("ZIP memory safety distinguishes ordinary, cautionary, and blocked package sizes", () => {
  const sized = (planeCount: number) => {
    const project = smallInstallProject(planeCount);
    for (const plane of project.planes) {
      plane.width = 3840;
      plane.height = 2160;
    }
    return project;
  };

  assert.equal(zipPackageSafety(smallInstallProject()).level, "safe");
  const warning = zipPackageSafety(sized(4));
  assert.equal(warning.level, "warning");
  assert.match(warning.message!, /substantial browser memory/i);
  const blocked = zipPackageSafety(sized(8));
  assert.equal(blocked.level, "blocked");
  assert.match(blocked.message!, /direct install/i);
  assert.ok(blocked.estimatedPeakBytes > blocked.estimatedPackageBytes);
  return assert.rejects(downloadPackage(sized(8)), /safe memory limit/i);
});

test("package includes replace-folder instructions and reports vertical-only wrap cleanly", async () => {
  const project = createDefaultProject("zip-update-instructions");
  project.name = "Vertical Atlas";
  project.planes[0]!.width = 256;
  project.planes[0]!.height = 256;
  project.planes[0]!.wrapX = false;
  project.planes[0]!.wrapY = true;
  const files = await buildPackageFiles(project);
  const decoder = new TextDecoder();
  const install = decoder.decode(files.find((file) => file.name === "INSTALL.txt")!.data);
  const host = decoder.decode(files.find((file) => file.name === "host_settings.txt")!.data);
  assert.match(install, /remove any existing map folder/i);
  assert.match(install, /Do not merge/i);
  assert.match(host, /Wrap: north\/south/);
  assert.doesNotMatch(host, /Wrap: none \+/);
});
