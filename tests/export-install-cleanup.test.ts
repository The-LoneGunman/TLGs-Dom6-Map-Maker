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

  constructor(initial: Record<string, string> = {}) {
    for (const [name, value] of Object.entries(initial)) this.files.set(name, encode(value));
  }

  async removeEntry(name: string) {
    this.events.push(`remove:${name}`);
    if (!this.files.delete(name)) throw notFound();
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!options?.create) throw notFound();
      this.files.set(name, new Uint8Array());
    }
    return {
      getFile: async () => {
        this.events.push(`read:${name}`);
        const data = this.files.get(name)!.slice();
        return { arrayBuffer: async () => data.buffer };
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

async function withDirectoryPicker<T>(directory: MemoryDirectory, action: () => Promise<T>): Promise<T> {
  const mapsDirectory = {
    async getDirectoryHandle() {
      return directory;
    },
  };
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { showDirectoryPicker: async () => mapsDirectory },
  });
  try {
    return await action();
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
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

test("direct install stages and backs up before publishing binaries, then removes only Atlas artifacts last", async () => {
  const project = smallInstallProject();
  const root = "Safety_Atlas";
  const directory = new MemoryDirectory({
    [`${root}.map`]: "old map",
    [`${root}.d6m`]: "old d6m",
    [`${root}_plane2.map`]: "obsolete map",
    [`${root}_plane2.d6m`]: "obsolete d6m",
    [`${root}_plane2.tga`]: "related but unowned image",
    [`${root}_battle.map`]: "related but unowned battle map",
    "custom-battlefield.tga": "unrelated image",
  });

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
  const initial = {
    [`${root}.map`]: "old main map",
    [`${root}.d6m`]: "old main d6m",
    [`${root}_plane2.map`]: "old plane map",
    [`${root}_plane2.d6m`]: "old plane d6m",
    "custom-battlefield.tga": "leave me",
  };
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
  const initial = {
    [`${root}.map`]: "old main map",
    [`${root}.d6m`]: "old main d6m",
    [`${root}_plane2.map`]: "old plane map",
    [`${root}_plane2.d6m`]: "old plane d6m",
    "custom-battlefield.tga": "leave me",
  };
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
  const initial = {
    [`${root}.map`]: "old map",
    [`${root}.d6m`]: "old d6m",
    "custom-battlefield.tga": "leave me",
  };
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
  for (const support of ["INSTALL.txt", "atlas_project.json", "balance_report.txt", "host_settings.txt", "host_topology.txt"]) {
    assert.equal(directory.files.has(support), false);
  }
  assert.equal([...directory.files].some(([name]) => name.startsWith(".__pantokrator_atlas_install__")), false);
});

test("an unrecoverable rollback retains Atlas backups and reports the residual explicitly", async () => {
  const project = smallInstallProject(2);
  const root = "Safety_Atlas";
  const directory = new MemoryDirectory({
    [`${root}.map`]: "old map",
    [`${root}.d6m`]: "old main d6m",
    [`${root}_plane2.map`]: "old plane map",
    [`${root}_plane2.d6m`]: "old plane d6m",
    "custom-battlefield.tga": "leave me",
  });
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
