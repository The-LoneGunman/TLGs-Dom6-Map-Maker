import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const clientRoot = path.join(projectRoot, "dist", "client");
const workerEntry = path.join(projectRoot, "dist", "server", "index.js");

const contentTypes = new Map([
  [".avif", "image/avif"],
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function parseOptions(args) {
  const options = { host: "127.0.0.1", port: 3000 };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--host" || argument === "--hostname") {
      options.host = args[++index];
    } else if (argument === "--port" || argument === "-p") {
      options.port = Number(args[++index]);
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown local-server option: ${argument}`);
    }
  }
  if (!options.host) throw new Error("A hostname is required.");
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
    throw new Error("The port must be an integer from 1 through 65535.");
  }
  return options;
}

function assetPathForUrl(url) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (decodedPath.includes("\0") || decodedPath.includes("\\")) return null;
  const relativePath = decodedPath.replace(/^\/+/, "");
  if (!relativePath) return null;
  const absolutePath = path.resolve(clientRoot, relativePath);
  const relative = path.relative(clientRoot, absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return absolutePath;
}

async function assetResponse(request) {
  const url = new URL(request.url);
  const absolutePath = assetPathForUrl(url);
  if (!absolutePath) return new Response("Not found", { status: 404 });

  let details;
  try {
    details = await stat(absolutePath);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!details.isFile()) return new Response("Not found", { status: 404 });

  const headers = new Headers({
    "Content-Length": String(details.size),
    "Content-Type": contentTypes.get(path.extname(absolutePath).toLowerCase()) ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  });
  if (url.pathname.startsWith("/_next/static/")) {
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    headers.set("Cache-Control", "no-cache");
  }

  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(Readable.toWeb(createReadStream(absolutePath)), { status: 200, headers });
}

function requestUrl(request, host, port) {
  // Keep only the path and query. Targets such as "//other.host/x",
  // "/\other.host/x" or absolute-form URLs must not change the host the
  // application sees.
  const parsed = new URL(request.url || "/", `http://${host}:${port}`);
  const url = new URL(`http://${host}:${port}/`);
  url.pathname = parsed.pathname;
  url.search = parsed.search;
  return url.href;
}

function webRequestFromNode(request, host, port) {
  const headers = new Headers(request.headers);
  headers.set("host", `${host}:${port}`);
  headers.delete("forwarded");
  headers.delete("x-forwarded-host");
  headers.delete("x-forwarded-proto");
  const init = { headers, method: request.method };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = Readable.toWeb(request);
    init.duplex = "half";
  }
  return new Request(requestUrl(request, host, port), init);
}

async function sendWebResponse(response, outgoing) {
  outgoing.statusCode = response.status;
  outgoing.statusMessage = response.statusText;
  for (const [name, value] of response.headers) outgoing.setHeader(name, value);
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length > 0) outgoing.setHeader("set-cookie", cookies);
  if (!response.body) {
    outgoing.end();
    return;
  }
  await new Promise((resolve, reject) => {
    const body = Readable.fromWeb(response.body);
    body.once("error", reject);
    outgoing.once("error", reject);
    outgoing.once("finish", resolve);
    // A client that disconnects mid-download never emits "finish". Release the
    // source stream (and its file handle) instead of leaving it open.
    outgoing.once("close", () => {
      if (!outgoing.writableFinished) body.destroy();
      resolve();
    });
    body.pipe(outgoing);
  });
}

export async function startLocalServer({ host = "127.0.0.1", port = 3000 } = {}) {
  if (host !== "127.0.0.1") {
    throw new Error("Pantokrator Atlas local releases may bind only to 127.0.0.1.");
  }
  const workerModule = await import(pathToFileURL(workerEntry));
  const worker = workerModule.default;
  if (!worker || typeof worker.fetch !== "function") {
    throw new Error("The production worker does not export a fetch handler.");
  }

  const pendingTasks = new Set();
  const executionContext = {
    passThroughOnException() {},
    props: {},
    waitUntil(promise) {
      const task = Promise.resolve(promise).catch((error) => console.error("Background task failed:", error));
      pendingTasks.add(task);
      task.finally(() => pendingTasks.delete(task));
    },
  };
  const environment = { ASSETS: { fetch: assetResponse } };

  const server = http.createServer(async (incoming, outgoing) => {
    try {
      const request = webRequestFromNode(incoming, host, port);
      let response = await assetResponse(request);
      if (response.status === 404) response = await worker.fetch(request, environment, executionContext);
      await sendWebResponse(response, outgoing);
    } catch (error) {
      console.error("Local request failed:", error);
      if (!outgoing.headersSent) {
        outgoing.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      }
      outgoing.end("Pantokrator Atlas encountered a local server error.");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  return {
    server,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await Promise.allSettled(pendingTasks);
    },
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/local-server.mjs [--hostname 127.0.0.1] [--port 3000]");
    return;
  }
  const running = await startLocalServer(options);
  console.log(`Pantokrator Atlas local server listening on http://${options.host}:${options.port}/`);

  const stop = async () => {
    await running.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.once("message", (message) => {
    if (message === "shutdown") stop();
  });
  await new Promise(() => {});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
