import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";

async function render(extraHeaders = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://atlas.test/", { headers: { accept: "text/html", host: "atlas.test", ...extraHeaders } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the complete map workbench and social metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Pantokrator Atlas [^<]* Dominions 6 Map Forge<\/title>/i);
  assert.match(html, /Pantokrator Atlas/);
  assert.match(html, /DOMINIONS 6 MAP FORGE/);
  assert.match(html, /Generate balanced atlas/);
  assert.match(html, /Start allocation/);
  assert.match(html, /Land starts/);
  assert.match(html, /Deterministic cave-start nations/);
  assert.match(html, /Dominions native cave preference/);
  assert.match(html, /Target useful connections at starts/);
  assert.match(html, /Four useful connections is the recommended multiplayer baseline/);
  assert.match(html, /Lower cohesion creates more local variation and patchwork/);
  assert.match(html, /<button[^>]*type="button"[^>]*>Reroll generated names \(preserve manual\)<\/button>/i);
  assert.match(html, /<button[^>]*type="button"[^>]*>Replace every province name…<\/button>/i);
  assert.match(html, /Names edited in the province inspector are marked manual/);
  assert.match(html, /Configure plane archetypes &amp; selected links/);
  assert.match(html, /Install \/ export/);
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/i);
  assert.match(html, /rel="canonical" href="https:\/\/atlas\.test\/?"/i);
  assert.match(html, /name="theme-color" content="#0f1516"/i);
  assert.match(html, /apple-touch-icon/i);
  assert.match(html, /og\.png/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton|codex-preview/i);
});

test("canonical metadata rejects malformed forwarded authorities and protocols", async () => {
  const response = await render({
    "x-forwarded-host": "attacker.example/path",
    "x-forwarded-proto": "javascript",
  });
  const html = await response.text();
  assert.match(html, /rel="canonical" href="https:\/\/atlas\.test\/?"/i);
  assert.doesNotMatch(html, /attacker\.example|javascript:/i);
});

test("ships a standalone web-app manifest with complete install icons", () => {
  const clientDirectory = new URL("../dist/client/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("manifest.webmanifest", clientDirectory), "utf8"));
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#0f1516");
  assert.deepEqual(manifest.icons.map(({ sizes }) => sizes), ["192x192", "512x512"]);
  for (const { src } of manifest.icons) {
    assert.ok(existsSync(new URL(src.slice(1), clientDirectory)), `${src} should be copied into the production client`);
  }
  assert.ok(existsSync(new URL("apple-touch-icon.png", clientDirectory)));
});

test("ships a local-first editor without database-backed page dependencies", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /Loading autosave/);
  assert.match(html, /Condition preview/);
  assert.match(html, /Province inspector/i);
  assert.match(html, /Fairness/);
});

test("production generation worker stays on the browser origin", () => {
  const staticDirectory = new URL("../dist/client/_next/static/", import.meta.url);
  const javascriptFiles = readdirSync(staticDirectory, { recursive: true })
    .filter((name) => typeof name === "string" && name.endsWith(".js"));
  const source = javascriptFiles
    .map((name) => readFileSync(new URL(name.replaceAll("\\", "/"), staticDirectory), "utf8"))
    .join("\n");

  assert.doesNotMatch(source, /file:\/\/\/[^"'`]*generationWorker/i, "the client worker constructor must not retain a build-machine file URL");
  const workerReference = source.match(/\/_next\/static\/(generation\.worker-[A-Za-z0-9_-]+\.js)/);
  assert.ok(workerReference, "the app chunk should reference a same-origin generated worker asset");
  assert.ok(existsSync(new URL(workerReference[1], staticDirectory)), "the referenced worker asset should be emitted");
});
