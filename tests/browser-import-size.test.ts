import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CUSTOM_CATALOG_IMPORT_BYTES,
  parseCatalogImportFile,
  parseProjectImportFile,
} from "../src/MapMakerApp";
import { MAX_PROJECT_IMPORT_BYTES } from "../src/export";

test("project picker rejects an oversized file before reading its text", async () => {
  let read = false;
  await assert.rejects(parseProjectImportFile({
    size: MAX_PROJECT_IMPORT_BYTES + 1,
    async text() {
      read = true;
      return "{}";
    },
  }), /file was not read/i);
  assert.equal(read, false);
});

test("custom catalog picker has an independent pre-read ceiling", async () => {
  let read = false;
  await assert.rejects(parseCatalogImportFile({
    size: MAX_CUSTOM_CATALOG_IMPORT_BYTES + 1,
    async text() {
      read = true;
      return "{}";
    },
  }), /custom catalog.*browser import limit/i);
  assert.equal(read, false);
});

test("files at the project ceiling reach the parser", async () => {
  let read = false;
  await assert.rejects(parseProjectImportFile({
    size: MAX_PROJECT_IMPORT_BYTES,
    async text() {
      read = true;
      return "not json";
    },
  }));
  assert.equal(read, true);
});
