import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ActionErrorAlert,
  createActionErrorNotice,
} from "../src/MapMakerApp";

test("action failures render as persistent dismissible alerts", () => {
  const notice = createActionErrorNotice(
    "package-export",
    7,
    new Error("The selected folder is no longer writable."),
    "Export failed.",
  );
  const html = renderToStaticMarkup(createElement(ActionErrorAlert, {
    error: notice,
    onDismiss() {},
  }));

  assert.match(html, /class="action-error-alert" role="alert" aria-live="assertive" aria-atomic="true"/);
  assert.match(html, /aria-labelledby="action-error-7-title"/);
  assert.match(html, /aria-describedby="action-error-7-message"/);
  assert.match(html, />Map package could not be exported</);
  assert.match(html, />The selected folder is no longer writable\.</);
  assert.match(html, /<button[^>]*aria-label="Dismiss: Map package could not be exported"[^>]*>Dismiss<\/button>/);
});

test("repeated and non-Error failures receive stable fallback copy and fresh announcement IDs", () => {
  const first = createActionErrorNotice("device-save", 11, { message: "Storage quota reached." }, "Save failed.");
  const repeated = createActionErrorNotice("device-save", 12, { message: "Storage quota reached." }, "Save failed.");
  const fallback = createActionErrorNotice("project-import", 13, undefined, "Project import failed.");

  assert.equal(first.message, "Storage quota reached.");
  assert.equal(repeated.message, first.message);
  assert.notEqual(repeated.sequence, first.sequence);
  assert.equal(fallback.message, "Project import failed.");
  assert.equal(fallback.title, "Project could not be opened");
});

test("failed action paths do not reuse the transient success toast", () => {
  const source = readFileSync(new URL("../src/MapMakerApp.tsx", import.meta.url), "utf8");

  for (const kind of ["catalog-import", "project-import", "package-export", "preview-export", "device-save"]) {
    assert.match(source, new RegExp(`showActionError\\(\\"${kind}\\"`), `${kind} failures should use the persistent alert`);
  }
  assert.match(source, /state\.backend === "none"[\s\S]*showActionError\("device-save"/);
  assert.match(source, /<ActionErrorAlert key=\{actionError\.sequence\}/);
  assert.doesNotMatch(source, /setTimeout\([\s\S]{0,80}setActionError/);

  for (const kind of ["catalog-import", "project-import", "package-export", "preview-export", "device-save"]) {
    assert.match(source, new RegExp(`clearActionError\\(\\"${kind}\\"`), `${kind} success should resolve its previous alert`);
  }
});

test("persistent alerts remain readable and dismissible on narrow screens", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.action-error-alert \{[\s\S]*position: fixed;[\s\S]*width: min\(460px, calc\(100vw - 20px\)\);/);
  assert.match(css, /\.action-error-alert p \{[^}]*font-size: 11px;/);
  assert.match(css, /\.action-error-alert button \{[\s\S]*min-width: 72px;[\s\S]*min-height: 44px;/);
});
