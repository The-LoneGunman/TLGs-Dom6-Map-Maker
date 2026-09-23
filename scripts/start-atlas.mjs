import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, lstat, readFile, readdir, readlink, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ATLAS_IDENTITY_PATH,
  atlasIdentity,
  identityResponse,
  isAtlasIdentity,
  isNotModified,
} from "./local-server.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const minimumNodeVersion = [22, 13, 0];
const dependencyMarker = path.join(projectRoot, "node_modules", ".pantokrator-lock-hash");
const buildMarker = path.join(projectRoot, "dist", ".pantokrator-build-hash");
const releaseMarker = path.join(projectRoot, "dist", ".pantokrator-release-ready");
const productionEntry = path.join(projectRoot, "dist", "server", "index.js");
const vinextEntry = path.join(projectRoot, "node_modules", "vinext", "dist", "cli.js");
const localServerEntry = path.join(projectRoot, "scripts", "local-server.mjs");
const firstLocalPort = 3000;
const lastLocalPort = 3099;
const maxIdentityBytes = 4_096;
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

async function launcherVersion() {
  return JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8")).version;
}

/**
 * Asks one local port for the Atlas identity served by scripts/local-server.mjs.
 * Resolves the identity, or null for a closed port, another application, an
 * oversized or malformed answer, a timeout, or an abort. A port that accepts
 * the connection gets the longer response timeout, so a busy Atlas is still
 * recognized; one that does not connect is given up on quickly.
 */
function probeAtlasPort(port, {
  // Loopback connections complete in the kernel even while a server is busy.
  // Windows can take about two seconds to refuse a closed port, so a port that
  // has not connected by now is treated as closed.
  connectTimeoutMs = 750,
  responseTimeoutMs = 5_000,
  signal,
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let request;
    let timer;
    const finish = (identity) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      request?.destroy();
      resolve(identity);
    };
    const abort = () => finish(null);
    if (signal?.aborted) {
      resolve(null);
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(abort, connectTimeoutMs);
    request = http.get({
      agent: false,
      headers: { Accept: "application/json" },
      host: "127.0.0.1",
      path: ATLAS_IDENTITY_PATH,
      port,
    }, (response) => {
      if (response.statusCode !== 200 || !/^application\/json\b/i.test(String(response.headers["content-type"] ?? ""))) {
        finish(null);
        return;
      }
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
        if (body.length > maxIdentityBytes) finish(null);
      });
      response.once("end", () => {
        let identity = null;
        try {
          const parsed = JSON.parse(body);
          if (isAtlasIdentity(parsed)) identity = parsed;
        } catch {
          // Not an Atlas identity.
        }
        finish(identity);
      });
      response.once("error", abort);
    });
    request.once("error", abort);
    request.once("socket", (socket) => {
      socket.once("connect", () => {
        if (settled) return;
        clearTimeout(timer);
        timer = setTimeout(abort, responseTimeoutMs);
      });
    });
  });
}

/**
 * Probes every launcher port at once and returns the lowest one serving Atlas,
 * or null. Remaining probes are cancelled as soon as the answer is known.
 */
async function findRunningAtlas({
  ports = Array.from({ length: lastLocalPort - firstLocalPort + 1 }, (_, index) => firstLocalPort + index),
  ...probeOptions
} = {}) {
  const controller = new AbortController();
  const probes = ports.map((port) => probeAtlasPort(port, { ...probeOptions, signal: controller.signal }));
  try {
    for (let index = 0; index < ports.length; index += 1) {
      const identity = await probes[index];
      if (identity) return { port: ports[index], url: `http://127.0.0.1:${ports[index]}/`, identity };
    }
    return null;
  } finally {
    controller.abort();
  }
}

function reportRunningAtlas(running, version, openInBrowser) {
  console.log(`Pantokrator Atlas is already running at ${running.url}`);
  if (running.identity.version !== version) {
    console.log(`That copy is version ${running.identity.version}; this launcher is version ${version}.`);
    console.log("To use this version instead, close the running Atlas window (or press Ctrl+C there) and launch again.");
  }
  console.log(openInBrowser
    ? "Opening it instead of starting a second server, so your browser autosave stays at the same address."
    : `Not starting a second server; open ${running.url} to keep using the same browser autosave.`);
}

async function findAvailablePort(firstPort = firstLocalPort, lastPort = lastLocalPort) {
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
      // The first "/" render can take several seconds on slow or busy CPUs.
      // Aborting early would not stop that render and would only stack more
      // renders behind it, so allow each check to run up to the deadline.
      const remaining = Math.max(1_000, Math.min(20_000, deadline - Date.now()));
      const response = await fetch(url, { signal: AbortSignal.timeout(remaining) });
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
  assert.ok(dependencyNotices.includes(`vinext@${packageData.devDependencies.vinext} | MIT`));
  const catalogNotice = await readFile(path.join(projectRoot, "src", "catalog", "data", "NOTICE.md"), "utf8");
  assert.match(catalogNotice, /GNU General Public License v3\.0/);
  assert.match(catalogNotice, /LICENSE\.dom6inspector\.txt/);
  assert.equal(await exists(path.join(projectRoot, "src", "catalog", "data", "LICENSE.dom6inspector.txt")), true);
  await selfTestRunningInstanceProbe();
  selfTestConditionalRequests();
  console.log("Pantokrator Atlas launcher self-test passed.");
}

async function withTestServer(handler, run) {
  const sockets = new Set();
  const server = http.createServer(handler);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    return await run(server.address().port);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function closedPort() {
  return withTestServer(() => {}, async (port) => port);
}

async function selfTestRunningInstanceProbe() {
  const quick = { connectTimeoutMs: 500, responseTimeoutMs: 500 };
  const atlas = async (request, response) => {
    // The real identity serializer that scripts/local-server.mjs serves.
    const identity = request.url === ATLAS_IDENTITY_PATH ? identityResponse(request.method, "9.9.9") : new Response("Not found", { status: 404 });
    response.writeHead(identity.status, Object.fromEntries(identity.headers));
    response.end(Buffer.from(await identity.arrayBuffer()));
  };
  const json = (value) => (request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(value));
  };
  const page = (request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<title>Pantokrator Atlas</title>");
  };
  const silent = () => {};

  assert.deepEqual(atlasIdentity("1.2.3"), { application: "pantokrator-atlas", name: "Pantokrator Atlas", version: "1.2.3" });
  assert.equal(identityResponse("POST", "1.2.3").status, 405);
  assert.equal(isAtlasIdentity({ application: "pantokrator-atlas", version: "1" }), true);
  for (const value of [null, [], "pantokrator-atlas", { application: "other", version: "1" }, { application: "pantokrator-atlas" }]) {
    assert.equal(isAtlasIdentity(value), false);
  }

  await withTestServer(atlas, async (atlasPort) => {
    assert.deepEqual(await probeAtlasPort(atlasPort, quick), atlasIdentity("9.9.9"));
    await withTestServer(atlas, async (secondAtlasPort) => {
      await withTestServer(page, async (pagePort) => {
        await withTestServer(json({ application: "another-app", version: "1" }), async (otherJsonPort) => {
          await withTestServer(json({ application: "pantokrator-atlas", version: "1", padding: "x".repeat(20_000) }), async (oversizedPort) => {
            await withTestServer(silent, async (silentPort) => {
              const unused = await closedPort();
              for (const port of [pagePort, otherJsonPort, oversizedPort, unused]) {
                assert.equal(await probeAtlasPort(port, quick), null, `port ${port} is not Atlas`);
              }
              let started = Date.now();
              assert.equal(await probeAtlasPort(silentPort, quick), null);
              assert.ok(Date.now() - started < 3_000, "A listener that never answers must time out.");

              // Ports are searched in order (ascending by default); the first Atlas wins.
              const found = await findRunningAtlas({ ports: [unused, pagePort, otherJsonPort, silentPort, atlasPort, secondAtlasPort], ...quick });
              assert.deepEqual(found, { port: atlasPort, url: `http://127.0.0.1:${atlasPort}/`, identity: atlasIdentity("9.9.9") });
              assert.equal(await findRunningAtlas({ ports: [unused, pagePort, otherJsonPort, oversizedPort, silentPort], ...quick }), null);

              // The first Atlas in port order wins at once; a slower, silent
              // port later in the order is cancelled rather than awaited.
              started = Date.now();
              const first = await findRunningAtlas({ ports: [atlasPort, silentPort], connectTimeoutMs: 30_000, responseTimeoutMs: 30_000 });
              assert.equal(first?.port, atlasPort);
              assert.ok(Date.now() - started < 3_000, "Remaining probes must be cancelled once Atlas is found.");
            });
          });
        });
      });
    });
  });
}

function selfTestConditionalRequests() {
  const tag = "\"4d2-17f0a\"";
  const modifiedMs = Date.parse("2026-09-22T12:00:00.750Z");
  const headers = (entries) => new Headers(entries);
  assert.equal(isNotModified("GET", headers({}), tag, modifiedMs), false);
  assert.equal(isNotModified("GET", headers({ "If-None-Match": tag }), tag, modifiedMs), true);
  assert.equal(isNotModified("HEAD", headers({ "If-None-Match": tag }), tag, modifiedMs), true);
  assert.equal(isNotModified("POST", headers({ "If-None-Match": tag }), tag, modifiedMs), false);
  assert.equal(isNotModified("GET", headers({ "If-None-Match": `"other", W/${tag}` }), tag, modifiedMs), true);
  assert.equal(isNotModified("GET", headers({ "If-None-Match": "*" }), tag, modifiedMs), true);
  assert.equal(isNotModified("GET", headers({ "If-None-Match": "\"other\"" }), tag, modifiedMs), false);
  const lastModified = new Date(modifiedMs).toUTCString();
  assert.equal(isNotModified("GET", headers({ "If-Modified-Since": lastModified }), tag, modifiedMs), true);
  assert.equal(isNotModified("GET", headers({ "If-Modified-Since": "Mon, 21 Sep 2026 12:00:00 GMT" }), tag, modifiedMs), false);
  assert.equal(isNotModified("GET", headers({ "If-Modified-Since": "not a date" }), tag, modifiedMs), false);
  // If-None-Match takes precedence over a matching If-Modified-Since.
  assert.equal(isNotModified("GET", headers({ "If-None-Match": "\"other\"", "If-Modified-Since": lastModified }), tag, modifiedMs), false);
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

  // Browser autosave belongs to the exact address, so a second launch must
  // reuse a running Atlas rather than serve a new, empty-looking origin on
  // the next free port. Preparation and the smoke test keep their own work.
  if (!options.has("--prepare-only") && !options.has("--smoke-test")) {
    const running = await findRunningAtlas();
    if (running) {
      const openInBrowser = !options.has("--no-browser");
      reportRunningAtlas(running, await launcherVersion(), openInBrowser);
      if (openInBrowser) openBrowser(running.url);
      return;
    }
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
      // A later launch must recognize this server instead of starting another.
      const running = await findRunningAtlas({ ports: [port] });
      assert.equal(running?.url, url, "The running-instance probe did not recognize the launched server.");
      assert.equal(running.identity.version, await launcherVersion());
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
