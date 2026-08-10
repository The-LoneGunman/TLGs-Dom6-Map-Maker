import assert from "node:assert/strict";
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
  assert.match(html, /Install \/ export/);
  assert.match(html, /og\.png/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton|codex-preview/i);
});

test("ships a local-first editor without database-backed page dependencies", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /Local autosave/);
  assert.match(html, /Condition preview/);
  assert.match(html, /Province inspector/i);
  assert.match(html, /Fairness/);
});
