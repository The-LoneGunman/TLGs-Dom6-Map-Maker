import assert from "node:assert/strict";
import test from "node:test";
import { buildPackageFiles, installPackage, removeObsoletePlaneArtifacts } from "../src/export";
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

test("direct install completes after cleanup and performs every removal before its first write", async () => {
  const project = createDefaultProject("install-cleanup");
  project.name = "Cleanup Atlas!";
  project.planes[0]!.width = 256;
  project.planes[0]!.height = 256;
  const root = "Cleanup_Atlas";
  const events: string[] = [];
  const written = new Set<string>();
  const existing = new Set([
    `${root}.map`,
    `${root}.d6m`,
    `${root}_plane2.map`,
    `${root}_plane2.d6m`,
    `${root}_plane2.tga`,
    `${root}_battle.map`,
    "custom-battlefield.tga",
  ]);

  const mapDirectory = {
    async removeEntry(name: string) {
      events.push(`remove:${name}`);
      if (!existing.delete(name)) throw notFound();
    },
    async getFileHandle(name: string) {
      events.push(`write:${name}`);
      existing.add(name);
      written.add(name);
      return {
        async createWritable() {
          return {
            async write() {},
            async close() {},
          };
        },
      };
    },
  };
  const mapsDirectory = {
    async getDirectoryHandle(name: string, options: { create?: boolean }) {
      assert.equal(name, root);
      assert.equal(options.create, true);
      return mapDirectory;
    },
  };
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { showDirectoryPicker: async () => mapsDirectory },
  });

  try {
    assert.equal(await installPackage(project), "installed");
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }

  assert.deepEqual(events.filter((event) => event.startsWith("remove:")).map((event) => event.slice(7)), obsoleteNames(root, 2));
  const firstWrite = events.findIndex((event) => event.startsWith("write:"));
  assert.equal(firstWrite, obsoleteNames(root, 2).length);
  assert.ok(events.slice(0, firstWrite).every((event) => event.startsWith("remove:")));
  assert.deepEqual(
    [...written].sort(),
    [
      `${root}.map`,
      `${root}.d6m`,
      "INSTALL.txt",
      "atlas_project.json",
      "balance_report.txt",
      "host_settings.txt",
    ].sort(),
  );
  assert.equal(existing.has(`${root}_plane2.map`), false);
  assert.equal(existing.has(`${root}_plane2.d6m`), false);
  assert.equal(existing.has(`${root}_plane2.tga`), true);
  assert.equal(existing.has(`${root}_battle.map`), true);
  assert.equal(existing.has("custom-battlefield.tga"), true);
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
