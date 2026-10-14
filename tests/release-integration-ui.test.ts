import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExportDialog, removeStoredCustomCatalog } from "../src/MapMakerApp";
import { cloneProject, type MapProject } from "../src/domain";
import { addPlane, createDefaultProject, generateProject } from "../src/generator";

function sizedProject(planeCount: number): MapProject {
  const project = createDefaultProject(`release-integration-${planeCount}`);
  const source = project.planes[0]!;
  project.planes = Array.from({ length: planeCount }, (_, index) => {
    const plane = cloneProject({ ...project, planes: [source] }).planes[0]!;
    plane.id = `release-plane-${index + 1}`;
    plane.name = `Release plane ${index + 1}`;
    plane.width = 3840;
    plane.height = 2160;
    return plane;
  });
  return project;
}

function exportDialogMarkup(project: MapProject, options: Partial<ComponentProps<typeof ExportDialog>> = {}): string {
  const noop = () => undefined;
  return renderToStaticMarkup(createElement(ExportDialog, {
    project,
    activePlane: project.planes[0]!,
    issues: [],
    busy: false,
    directInstallSupported: true,
    onClose: noop,
    onInstall: noop,
    onZip: noop,
    onProject: noop,
    onPreview: noop,
    onValidate: noop,
    ...options,
  }));
}

function zipButton(markup: string): string {
  const match = markup.match(/<button class="export-option"[\s\S]*?Download ready ZIP[\s\S]*?<\/button>/);
  assert.ok(match, "ZIP export button should be rendered");
  return match[0];
}

test("Export dialog discloses cautionary ZIP memory before the user clicks", () => {
  const markup = exportDialogMarkup(sizedProject(4));
  assert.match(markup, /Large ZIP memory warning/);
  assert.match(markup, /Estimated peak working memory/);
  assert.doesNotMatch(zipButton(markup), /disabled=""/);
});

test("Export dialog blocks only unsafe ZIP assembly and retains recovery paths", () => {
  const markup = exportDialogMarkup(sizedProject(8));
  assert.match(markup, /ZIP download blocked for browser memory safety/);
  assert.match(zipButton(markup), /disabled=""/);
  assert.match(markup, /Install directly/);
  assert.match(markup, /Editable project JSON/);
  assert.match(markup, /Direct install and Editable project JSON remain available/);
});

test("custom catalog cleanup absorbs denied browser storage removals", () => {
  let removed = "";
  assert.equal(removeStoredCustomCatalog({ removeItem(key) { removed = key; } }), true);
  assert.equal(removed, "pantokrator-atlas-user-catalog-v1");
  assert.equal(removeStoredCustomCatalog({ removeItem() { throw new DOMException("denied", "SecurityError"); } }), false);
});

test("unsupported browsers never advertise direct install as available or recommended", () => {
  for (const planeCount of [1, 8]) {
    const markup = exportDialogMarkup(sizedProject(planeCount), { directInstallSupported: false });
    const button = markup.match(/<button class="export-option primary-option"[\s\S]*?<\/button>/)![0];
    assert.match(button, /disabled=""/);
    assert.match(button, /Unavailable in this browser/);
    assert.doesNotMatch(markup, /Recommended|Direct install and Editable project JSON remain available/);
    assert.match(markup, /Editable project JSON/);
    if (planeCount === 8) {
      assert.match(zipButton(markup), /disabled=""/);
      assert.doesNotMatch(markup, /Download the ready ZIP,/);
      assert.match(markup, /Reduce output resolution/);
    }
  }
});

test("unsafe ZIPs expose a one-step resolution repair and explain layout locks", () => {
  const project = generateProject(addPlane(createDefaultProject("export-dialog-resize"), "underworld", { generate: false, autoSize: true }));
  const unlocked = exportDialogMarkup(project, { artwork: "illustrated", directInstallSupported: false, onResizeForZip() {} });
  assert.match(unlocked, /Reduce output resolution to fit ZIP/);
  project.authoring = { lockLayout: true };
  const locked = exportDialogMarkup(project, { artwork: "illustrated", directInstallSupported: false, onResizeForZip() {} });
  assert.match(locked, /Layout is locked/);
  assert.doesNotMatch(locked, /Reduce output resolution to fit ZIP/);
});
