import assert from "node:assert/strict";
import { startLocalServer } from "./local-server.mjs";

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

  const traversalResponse = await fetch(`${origin}/..%2fpackage.json`);
  assert.equal(traversalResponse.status, 404);

  console.log(`Pantokrator Atlas local-server smoke passed at ${origin}.`);
} finally {
  await running.close();
}
