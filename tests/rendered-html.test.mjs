import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://atlas.test/", { headers: { accept: "text/html", host: "atlas.test" } }),
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
  assert.match(html, /og\.png/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton|codex-preview/i);
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
