import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MapCanvas,
  dispatchMapKeyboardCommand,
  resolveMapKeyboardCommand,
} from "../src/MapCanvas";
import {
  ExportDialog,
  MapMakerApp,
  dialogShouldClose,
  resolveDialogTabIndex,
} from "../src/MapMakerApp";
import { createDefaultProject } from "../src/generator";

test("map arrows only navigate while Enter activates the current tool once", () => {
  const provinces = [{ id: "province-a" }, { id: "province-b" }, { id: "province-c" }];
  for (const tool of ["start", "throne", "link"] as const) {
    let selectedId = provinces[0]!.id;
    const model = { starts: 0, thrones: 0, linkEndpoints: [] as string[] };
    const activations: Array<{ tool: typeof tool; provinceId: string }> = [];
    const navigate = (provinceId: string) => { selectedId = provinceId; };
    const activate = (provinceId: string) => {
      activations.push({ tool, provinceId });
      if (tool === "start") model.starts += 1;
      else if (tool === "throne") model.thrones += 1;
      else model.linkEndpoints.push(provinceId);
    };

    const beforeArrow = structuredClone(model);
    const arrow = resolveMapKeyboardCommand(provinces, selectedId, "ArrowRight");
    assert.deepEqual(arrow, { type: "navigate", provinceId: "province-b" });
    dispatchMapKeyboardCommand(arrow!, navigate, activate);
    assert.deepEqual(model, beforeArrow, `${tool} must not mutate while moving the keyboard cursor`);
    assert.equal(selectedId, "province-b");
    assert.equal(activations.length, 0);

    const enter = resolveMapKeyboardCommand(provinces, selectedId, "Enter");
    assert.deepEqual(enter, { type: "activate", provinceId: "province-b" });
    dispatchMapKeyboardCommand(enter!, navigate, activate);
    assert.deepEqual(activations, [{ tool, provinceId: "province-b" }]);
    assert.equal(model.starts + model.thrones + model.linkEndpoints.length, 1);
  }
});

test("map keyboard commands cover first selection and bounded jumps", () => {
  const provinces = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(resolveMapKeyboardCommand(provinces, undefined, "Enter"), { type: "activate", provinceId: "a" });
  assert.deepEqual(resolveMapKeyboardCommand(provinces, "b", "Home"), { type: "navigate", provinceId: "a" });
  assert.deepEqual(resolveMapKeyboardCommand(provinces, "b", "End"), { type: "navigate", provinceId: "c" });
  assert.equal(resolveMapKeyboardCommand(provinces, "b", "Tab"), undefined);
});

test("canvas and main workbench expose current keyboard state", () => {
  const project = createDefaultProject("accessible-map");
  const plane = project.planes[0]!;
  const selected = plane.provinces[0]!;
  const canvasHtml = renderToStaticMarkup(createElement(MapCanvas, {
    plane,
    selectedId: selected.id,
    previewCondition: "normal",
    tool: "start",
    onNavigate() {},
    onActivate() {},
  }));
  assert.match(canvasHtml, /role="listbox"/);
  assert.match(canvasHtml, /aria-activedescendant=/);
  assert.match(canvasHtml, /role="option" aria-selected="true"/);
  assert.match(canvasHtml, /Current province 1 of/);
  assert.match(canvasHtml, /Start tool active/);
  assert.match(canvasHtml, /Arrow keys move the current province without applying the active tool/);
  assert.match(canvasHtml, /role="status" aria-live="polite"/);

  const appHtml = renderToStaticMarkup(createElement(MapMakerApp));
  assert.match(appHtml, /role="toolbar" aria-label="Map tools"/);
  assert.match(appHtml, /aria-label="Select" aria-pressed="true"/);
  assert.match(appHtml, /role="group" aria-label="Plane selector"/);
  assert.match(appHtml, /aria-pressed="true"/);
  assert.match(appHtml, /type="file" tabindex="-1" aria-hidden="true"/);
  assert.match(appHtml, /id="start-allocation-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(appHtml, /aria-describedby="start-allocation-status"/);
  assert.match(appHtml, /class="autosave [^"]*" role="status" aria-live="polite"/);
});

test("busy export has perceivable progress and dialog Tab/Escape containment", () => {
  const project = createDefaultProject("accessible-export");
  const html = renderToStaticMarkup(createElement(ExportDialog, {
    project,
    activePlane: project.planes[0]!,
    issues: [],
    progress: { stage: "rasterizing", plane: 1, planeCount: 2, percent: 45, message: "Rendering plane" },
    busy: true,
    onClose() {},
    onInstall() {},
    onZip() {},
    onProject() {},
    onPreview() {},
    onValidate() {},
  }));
  assert.match(html, /role="dialog"[^>]*aria-busy="true"/);
  assert.match(html, /role="progressbar"[^>]*aria-live="polite"/);
  assert.match(html, /aria-valuenow="45"/);
  assert.match(html, /aria-valuetext="Rendering plane\. 45%\. Plane 1 of 2\."/);
  assert.equal(resolveDialogTabIndex(0, -1, false), -1, "a busy dialog with no controls keeps focus on its container");
  assert.equal(resolveDialogTabIndex(3, -1, false), 0);
  assert.equal(resolveDialogTabIndex(3, -1, true), 2);
  assert.equal(resolveDialogTabIndex(3, 2, false), 0);
  assert.equal(resolveDialogTabIndex(3, 0, true), 2);
  assert.equal(resolveDialogTabIndex(3, 1, false), undefined);
  assert.equal(dialogShouldClose("Escape", false), true);
  assert.equal(dialogShouldClose("Escape", true), false);
  assert.equal(dialogShouldClose("Enter", false), false);
});

test("generation exposes an interruptible background progress status", () => {
  const source = readFileSync(new URL("../src/MapMakerApp.tsx", import.meta.url), "utf8");
  assert.match(source, /id="generation-progress"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"[^>]*aria-busy="true"/);
  assert.match(source, /<progress aria-label="Atlas generation in progress"/);
  assert.match(source, />Cancel generation<\/button>/);
  assert.match(source, /The current atlas was not changed/);
  assert.match(source, /id="start-plan-errors"[^>]*role="alert"[^>]*aria-live="polite"/);
  assert.match(source, /disabled=\{allocatedStarts !== project\.settings\.players \|\| startPlanErrors\.length > 0 \|\| generationBusy\}/);
  assert.match(source, /if \(startPlanErrors\.length\)[\s\S]*Generation cannot start/);
});

test("CSS preserves focus visibility and reflows the complete workbench", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.toggle-row input:focus-visible \+ i,[\s\S]*\.check-card input:focus-visible \+ i/);
  assert.doesNotMatch(css, /\.autosave\s*\{\s*display:\s*none/);
  assert.doesNotMatch(css, /\.top-actions \.button\.quiet\s*\{\s*display:\s*none/);
  assert.match(css, /@media \(max-width: 979px\)[\s\S]*body \{ overflow: auto; \}/);
  assert.match(css, /@media \(max-width: 979px\)[\s\S]*\.atlas-shell \{[\s\S]*min-width: 0;/);
  assert.match(css, /@media \(max-width: 979px\)[\s\S]*\.workbench \{[\s\S]*grid-template-columns: minmax\(0, 1fr\);[\s\S]*overflow: visible;/);
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*\.start-allocation-grid,[\s\S]*grid-template-columns: minmax\(0, 1fr\);/);
});

test("repeated province editor controls have contextual accessible names", () => {
  const source = readFileSync(new URL("../src/MapMakerApp.tsx", import.meta.url), "utf8");
  assert.match(source, /aria-label=\{`Remove site \$\{index \+ 1\}`\}/);
  assert.match(source, /aria-label=\{`Remove guardian group \$\{defenseIndex \+ 1\}`\}/);
  assert.match(source, /aria-label=\{`Guardian group \$\{defenseIndex \+ 1\}, squad \$\{squadIndex \+ 1\} count`\}/);
  assert.match(source, /aria-label=\{`Border type to province/);
});
