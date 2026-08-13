import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { stageWindowsInstaller } from "../scripts/stage-windows-installer.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

async function writeFixture(root, relativePath, contents = relativePath) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents, "utf8");
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pantokrator-installer-test-"));
  const project = path.join(root, "project");
  const nodeRoot = path.join(root, "node-v22.23.2-win-x64");
  const output = path.join(root, "payload");
  for (const relativePath of [
    "LICENSE",
    "README.md",
    "Start Pantokrator Atlas.cmd",
    "THIRD_PARTY_LICENSES.txt",
    "docs/USER_GUIDE.md",
    "scripts/local-server.mjs",
    "scripts/start-atlas.mjs",
    "dist/server/index.js",
    "installer/INSTALLER_NOTICES.txt",
    "src/catalog/data/NOTICE.md",
    "src/catalog/data/LICENSE.dom6inspector.txt",
  ]) {
    await writeFixture(project, relativePath);
  }
  await writeFixture(project, "dist/.pantokrator-release-ready", "abc123\n");
  await writeFixture(nodeRoot, "node.exe", "portable node");
  await writeFixture(nodeRoot, "LICENSE", "node license");
  return { root, project, nodeRoot, output };
}

test("installed launcher prefers the bundled private Node runtime", async () => {
  const launcher = await readFile(path.join(repositoryRoot, "Start Pantokrator Atlas.cmd"), "utf8");
  assert.match(launcher, /runtime\\node\.exe/i);
  assert.match(launcher, /if not exist "%ATLAS_NODE%"/i);
  assert.match(launcher, /"%ATLAS_NODE%" "%~dp0scripts\\start-atlas\.mjs"/i);
});

test("Inno Setup contract is per-user, uninstallable, and creates useful shortcuts", async () => {
  const script = await readFile(path.join(repositoryRoot, "installer", "PantokratorAtlas.iss"), "utf8");
  assert.match(script, /PrivilegesRequired=lowest/);
  assert.match(script, /DefaultDirName=\{localappdata\}\\Programs\\Pantokrator Atlas/);
  assert.match(script, /ArchitecturesAllowed=x64compatible/);
  assert.match(script, /Source: "\{#PayloadDir\}\\\*";.*recursesubdirs/);
  assert.match(script, /\{group\}\\Pantokrator Atlas/);
  assert.match(script, /\{autodesktop\}\\Pantokrator Atlas/);
  assert.match(script, /Flags: postinstall nowait skipifsilent shellexec/);
});

test("release verifies the Inno Setup asset against its exact tagged attestation", async () => {
  const workflow = await readFile(path.join(repositoryRoot, ".github", "workflows", "release.yml"), "utf8");
  assert.match(
    workflow,
    /gh release verify-asset is-6_7_3 innosetup-6\.7\.3\.exe --repo jrsoftware\/issrc/,
  );
});

test("installer payload contains only runtime, documentation, and required licenses", async () => {
  const fixture = await createFixture();
  try {
    const result = await stageWindowsInstaller({
      projectRoot: fixture.project,
      nodeRoot: fixture.nodeRoot,
      outputDirectory: fixture.output,
      nodeVersion: "v22.23.2",
    });
    assert.equal(result.releaseSha, "abc123");
    assert.equal(await readFile(path.join(fixture.output, "runtime", "node.exe"), "utf8"), "portable node");
    assert.equal(await readFile(path.join(fixture.output, "runtime", "NODE_VERSION.txt"), "utf8"), "v22.23.2\n");
    assert.equal(await readFile(path.join(fixture.output, "runtime", "NODE_LICENSE.txt"), "utf8"), "node license");
    assert.equal(await readFile(path.join(fixture.output, "dist", "server", "index.js"), "utf8"), "dist/server/index.js");
    assert.equal(
      await readFile(path.join(fixture.output, "licenses", "dom6-catalog", "NOTICE.md"), "utf8"),
      "src/catalog/data/NOTICE.md",
    );
    await assert.rejects(readFile(path.join(fixture.output, "package-lock.json"), "utf8"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("payload staging refuses a build without a release marker", async () => {
  const fixture = await createFixture();
  try {
    await rm(path.join(fixture.project, "dist", ".pantokrator-release-ready"));
    await assert.rejects(
      stageWindowsInstaller({
        projectRoot: fixture.project,
        nodeRoot: fixture.nodeRoot,
        outputDirectory: fixture.output,
        nodeVersion: "v22.23.2",
      }),
      /release-ready build marker/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
