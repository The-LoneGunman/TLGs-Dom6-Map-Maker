import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ATLAS_IDENTITY_PATH, startLocalServer } from "./local-server.mjs";

const running = await startLocalServer({ host: "127.0.0.1", port: 0 });
try {
  const address = running.server.address();
  assert.ok(address && typeof address === "object");
  assert.equal(address.address, "127.0.0.1");
  const origin = `http://127.0.0.1:${address.port}`;

  const rootResponse = await fetch(`${origin}/`);
  assert.equal(rootResponse.status, 200);
  assert.match(await rootResponse.text(), /Pantokrator Atlas/);

  const manifestResponse = await fetch(`${origin}/manifest.webmanifest`);
  assert.equal(manifestResponse.status, 200);
  assert.match(manifestResponse.headers.get("content-type") ?? "", /^application\/manifest\+json/);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.short_name, "Pantokrator Atlas");
  assert.match(manifest.name, /^Pantokrator Atlas/);

  const assetResponse = await fetch(`${origin}/app-icon-192.png`);
  assert.equal(assetResponse.status, 200);
  assert.equal(assetResponse.headers.get("content-type"), "image/png");
  await assetResponse.arrayBuffer();

  // The launcher recognizes a running Atlas through this fixed, render-free identity.
  const packageData = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const identityResponse = await fetch(`${origin}${ATLAS_IDENTITY_PATH}`);
  assert.equal(identityResponse.status, 200);
  assert.match(identityResponse.headers.get("content-type") ?? "", /^application\/json/);
  assert.equal(identityResponse.headers.get("cache-control"), "no-store");
  assert.equal(identityResponse.headers.get("access-control-allow-origin"), null);
  assert.deepEqual(await identityResponse.json(), { application: "pantokrator-atlas", name: "Pantokrator Atlas", version: packageData.version });
  assert.equal((await fetch(`${origin}${ATLAS_IDENTITY_PATH}`, { method: "POST" })).status, 405);

  // Public files revalidate on every load (no-cache) and are answered with a
  // bodiless 304 while unchanged.
  const mapArt = JSON.parse(await readFile(new URL("../public/map-art/manifest.json", import.meta.url), "utf8"));
  const texturePath = JSON.stringify(mapArt).match(/\/map-art\/[^"]+\.(?:webp|png|jpg)/)?.[0];
  assert.ok(texturePath, "The map-art manifest should reference a texture.");
  for (const pathname of ["/app-icon-192.png", "/manifest.webmanifest", "/map-art/manifest.json", texturePath]) {
    const full = await fetch(`${origin}${pathname}`);
    assert.equal(full.status, 200, pathname);
    const body = Buffer.from(await full.arrayBuffer());
    assert.equal(full.headers.get("cache-control"), "no-cache", pathname);
    assert.equal(full.headers.get("content-length"), String(body.length), pathname);
    const etag = full.headers.get("etag");
    const lastModified = full.headers.get("last-modified");
    assert.match(etag ?? "", /^"[0-9a-f]+-[0-9a-f]+"$/, `${pathname} needs a strong ETag`);
    assert.ok(lastModified && Number.isFinite(Date.parse(lastModified)), `${pathname} needs Last-Modified`);

    for (const [method, headers] of [
      ["GET", { "If-None-Match": etag }],
      ["HEAD", { "If-None-Match": etag }],
      ["GET", { "If-None-Match": `"stale", W/${etag}` }],
      ["GET", { "If-Modified-Since": lastModified }],
    ]) {
      const revalidated = await fetch(`${origin}${pathname}`, { method, headers });
      assert.equal(revalidated.status, 304, `${method} ${pathname} ${JSON.stringify(headers)}`);
      assert.equal((await revalidated.arrayBuffer()).byteLength, 0);
      assert.equal(revalidated.headers.get("etag"), etag);
      assert.equal(revalidated.headers.get("cache-control"), "no-cache");
    }
    const changed = await fetch(`${origin}${pathname}`, { headers: { "If-None-Match": "\"stale\"", "If-Modified-Since": lastModified } });
    assert.equal(changed.status, 200, "If-None-Match takes precedence over If-Modified-Since");
    assert.deepEqual(Buffer.from(await changed.arrayBuffer()), body);
    const older = await fetch(`${origin}${pathname}`, { headers: { "If-Modified-Since": new Date(Date.parse(lastModified) - 1_000).toUTCString() } });
    assert.equal(older.status, 200);
    await older.arrayBuffer();
  }

  const head = await fetch(`${origin}/app-icon-192.png`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-type"), "image/png");
  assert.ok(Number(head.headers.get("content-length")) > 0);
  assert.equal((await head.arrayBuffer()).byteLength, 0);

  // Content-hashed build assets stay immutable and carry the same validators.
  const html = await (await fetch(`${origin}/`)).text();
  const hashedPath = html.match(/\/_next\/static\/[^"'\s)]+\.(?:js|css)/)?.[0];
  assert.ok(hashedPath, "The rendered page should reference a hashed build asset.");
  const hashed = await fetch(`${origin}${hashedPath}`);
  assert.equal(hashed.status, 200);
  assert.equal(hashed.headers.get("cache-control"), "public, max-age=31536000, immutable");
  await hashed.arrayBuffer();
  const hashedRevalidation = await fetch(`${origin}${hashedPath}`, { headers: { "If-None-Match": hashed.headers.get("etag") } });
  assert.equal(hashedRevalidation.status, 304);
  assert.equal(hashedRevalidation.headers.get("cache-control"), "public, max-age=31536000, immutable");

  const traversalResponse = await fetch(`${origin}/..%2fpackage.json`);
  assert.equal(traversalResponse.status, 404);
  const conditionalTraversal = await fetch(`${origin}/..%2fpackage.json`, { headers: { "If-None-Match": "*" } });
  assert.notEqual(conditionalTraversal.status, 304);

  console.log(`Pantokrator Atlas local-server smoke passed at ${origin}.`);
} finally {
  await running.close();
}
