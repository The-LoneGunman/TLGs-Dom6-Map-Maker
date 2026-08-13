import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, lstat, readFile, readdir, readlink, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const minimumNodeVersion = [22, 13, 0];
const dependencyMarker = path.join(projectRoot, "node_modules", ".pantokrator-lock-hash");
const buildMarker = path.join(projectRoot, "dist", ".pantokrator-build-hash");
const releaseMarker = path.join(projectRoot, "dist", ".pantokrator-release-ready");
const productionEntry = path.join(projectRoot, "dist", "server", "index.js");
const vinextEntry = path.join(projectRoot, "node_modules", "vinext", "dist", "cli.js");
const localServerEntry = path.join(projectRoot, "scripts", "local-server.mjs");
const buildInputs = [
  ".openai/hosting.json",
  "app",
  "build",
  "next.config.ts",
  "package-lock.json",
  "package.json",
  "postcss.config.mjs",
  "public",
  "src",
  "tsconfig.json",
  "vite.config.ts",
  "worker",
];

function parseVersion(version) {
  const match = String(version).replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function addPathToHash(hash, absolutePath, label) {
  const details = await lstat(absolutePath);
  hash.update(`${label}\0${details.mode}\0`);

  if (details.isDirectory()) {
    const entries = await readdir(absolutePath);
    entries.sort((left, right) => left.localeCompare(right));
    for (const entry of entries) {
      await addPathToHash(hash, path.join(absolutePath, entry), `${label}/${entry}`);
    }
    return;
  }

  if (details.isSymbolicLink()) {
    hash.update(`link\0${await readlink(absolutePath)}\0`);
    return;
  }

  if (details.isFile()) {
    hash.update(await readFile(absolutePath));
  }
}

async function hashInputs(relativePaths) {
  const hash = createHash("sha256");
  for (const relativePath of relativePaths) {
    const absolutePath = path.join(projectRoot, relativePath);
    if (!(await exists(absolutePath))) {
      throw new Error(`Required release file is missing: ${relativePath}`);
    }
    await addPathToHash(hash, absolutePath, relativePath.replaceAll("\\", "/"));
  }
  return hash.digest("hex");
}

async function markerMatches(markerPath, expected) {
  try {
    return (await readFile(markerPath, "utf8")).trim() === expected;
  } catch {
    return false;
  }
}

function npmProcess(args, options = {}) {
  if (process.platform === "win32") {
    const command = ["npm.cmd", ...args].join(" ");
    return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", command], {
      cwd: projectRoot,
      stdio: "inherit",
      windowsHide: false,
      ...options,
    });
  }

  return spawn("npm", args, {
    cwd: projectRoot,
    stdio: "inherit",
    ...options,
  });
}

async function waitForProcess(child, failureMessage) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${failureMessage} (exit ${code ?? signal ?? "unknown"}).`));
      }
    });
  });
}

async function prepareDependencies() {
  const lockHash = await hashInputs(["package.json", "package-lock.json"]);
  const dependenciesReady = (await exists(vinextEntry)) && (await markerMatches(dependencyMarker, lockHash));
  if (dependenciesReady) {
    console.log("Dependencies are current.");
    return;
  }

  console.log("Installing verified dependencies from package-lock.json...");
  await waitForProcess(npmProcess(["ci"]), "Dependency installation failed");
  await writeFile(dependencyMarker, `${lockHash}\n`, "utf8");
}

async function prepareBuild() {
  const sourceHash = await hashInputs(buildInputs);
  const buildReady = (await exists(productionEntry)) && (await markerMatches(buildMarker, sourceHash));
  if (buildReady) {
    console.log("Production build is current.");
    return;
  }

  console.log("Building Pantokrator Atlas for local use...");
  await waitForProcess(npmProcess(["run", "build"]), "Production build failed");
  await writeFile(buildMarker, `${sourceHash}\n`, "utf8");
}

async function findAvailablePort(firstPort = 3000, lastPort = 3099) {
  for (let port = firstPort; port <= lastPort; port += 1) {
    const available = await new Promise((resolve) => {
      const server = net.createServer();
      server.unref();
      server.once("error", () => resolve(false));
      server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
        server.close(() => resolve(true));
      });
    });
    if (available) return port;
  }
  throw new Error(`No free local port was found between ${firstPort} and ${lastPort}.`);
}

async function waitForServer(url, child, timeoutMs = 45_000) {
  let exited = null;
  child.once("exit", (code, signal) => {
    exited = code ?? signal ?? "unknown";
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`The local server stopped before it was ready (exit ${exited}).`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) return;
    } catch {
      // The production server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The local server did not become ready within 45 seconds.");
}

function openBrowser(url) {
  let command;
  let args;
  if (process.platform === "win32") {
    command = "rundll32.exe";
    args = ["url.dll,FileProtocolHandler", url];
  } else if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  const opener = spawn(command, args, { detached: true, stdio: "ignore" });
  opener.once("error", () => {
    console.warn(`Could not open the default browser automatically. Open ${url}`);
  });
  opener.unref();
}

async function runSelfTest() {
  assert.deepEqual(parseVersion("v22.13.0"), [22, 13, 0]);
  assert.equal(compareVersions([22, 13, 0], minimumNodeVersion), 0);
  assert.equal(compareVersions([22, 12, 9], minimumNodeVersion), -1);
  assert.equal(compareVersions([23, 0, 0], minimumNodeVersion), 1);
  assert.equal((await hashInputs(["package.json", "package-lock.json"])).length, 64);
  const packageData = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  assert.equal(packageData.name, "pantokrator-atlas");
  const applicationLicense = await readFile(path.join(projectRoot, "LICENSE"), "utf8");
  assert.match(applicationLicense, /BSD Zero Clause License/);
  assert.match(applicationLicense, /Permission to use, copy, modify, and\/or distribute/);
  const dependencyNotices = await readFile(path.join(projectRoot, "THIRD_PARTY_LICENSES.txt"), "utf8");
  assert.match(dependencyNotices, /PANTOKRATOR ATLAS THIRD-PARTY SOFTWARE NOTICES/);
  assert.match(dependencyNotices, /react@19\.2\.8 \| MIT/);
  assert.match(dependencyNotices, /vinext@1\.0\.0-beta\.2 \| MIT/);
  const catalogNotice = await readFile(path.join(projectRoot, "src", "catalog", "data", "NOTICE.md"), "utf8");
  assert.match(catalogNotice, /GNU General Public License v3\.0/);
  assert.match(catalogNotice, /LICENSE\.dom6inspector\.txt/);
  assert.equal(await exists(path.join(projectRoot, "src", "catalog", "data", "LICENSE.dom6inspector.txt")), true);
  console.log("Pantokrator Atlas launcher self-test passed.");
}

async function main() {
  const currentVersion = parseVersion(process.version);
  if (!currentVersion || compareVersions(currentVersion, minimumNodeVersion) < 0) {
    throw new Error(`Node.js 22.13.0 or newer is required; this computer has ${process.version}.`);
  }

  const options = new Set(process.argv.slice(2));
  if (options.has("--self-test")) {
    await runSelfTest();
    return;
  }

  const packagedBuildReady = (await exists(productionEntry)) && (await exists(releaseMarker));
  if (packagedBuildReady) {
    console.log("Packaged production build is ready.");
  } else {
    await prepareDependencies();
    await prepareBuild();
  }
  if (options.has("--prepare-only")) {
    console.log("Pantokrator Atlas is installed and ready to launch.");
    return;
  }

  const port = await findAvailablePort();
  const url = `http://127.0.0.1:${port}/`;
  console.log(`Starting Pantokrator Atlas at ${url}`);
  const server = spawn(process.execPath, [localServerEntry, "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  const serverExit = new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("exit", (code, signal) => resolve({ code, signal }));
  });

  try {
    await waitForServer(url, server);
  } catch (error) {
    server.kill();
    throw error;
  }

  console.log(`Pantokrator Atlas is ready: ${url}`);
  console.log("Keep this window open. Press Ctrl+C here when you are finished.");
  if (options.has("--smoke-test")) {
    let result;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      assert.equal(response.status, 200);
      assert.match(await response.text(), /Pantokrator Atlas/);
    } finally {
      if (server.exitCode === null && server.signalCode === null) server.kill();
      result = await serverExit;
    }
    if (result.code !== 0 && result.code !== null) {
      throw new Error(`The local server smoke stopped unexpectedly (exit ${result.code ?? result.signal}).`);
    }
    console.log(`Pantokrator Atlas launcher smoke passed at ${url}`);
    return;
  }
  if (!options.has("--no-browser")) openBrowser(url);

  const result = await serverExit;
  if (result.code !== 0 && result.code !== null) {
    throw new Error(`The local server stopped unexpectedly (exit ${result.code ?? result.signal}).`);
  }
}

main().catch((error) => {
  console.error(`\nERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
