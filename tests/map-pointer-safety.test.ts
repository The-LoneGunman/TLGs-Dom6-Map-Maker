import assert from "node:assert/strict";
import test from "node:test";
import { createElement, isValidElement, type ReactNode, type ReactElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MapCanvas } from "../src/MapCanvas";
import { createDefaultProject } from "../src/generator";

function canvasElement(tree: ReactNode): ReactElement<ComponentProps<"canvas">> {
  if (Array.isArray(tree)) {
    for (const child of tree) { try { return canvasElement(child); } catch { /* next sibling */ } }
  } else if (isValidElement<{ children?: ReactNode }>(tree)) {
    if (tree.type === "canvas") return tree as ReactElement<ComponentProps<"canvas">>;
    return canvasElement(tree.props.children);
  }
  throw new Error("Missing canvas");
}

test("map tools require a completed matching primary click, never orphan/cancel/non-left gestures", () => {
  const plane = createDefaultProject("pointer-regression").planes[0]!;
  const province = plane.provinces[0]!;
  const activated: string[] = [];
  let tree: ReactNode;
  function Capture() {
    tree = MapCanvas({ plane, previewCondition: "normal", tool: "start", onNavigate() {}, onActivate(id) { activated.push(id); } });
    return null;
  }
  renderToStaticMarkup(createElement(Capture));
  const props = canvasElement(tree).props;
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }), setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} };
  (props.ref as { current: unknown }).current = canvas;
  const event = (overrides: object = {}) => ({ pointerId: 1, button: 0, isPrimary: true, clientX: province.x * 800, clientY: province.y * 600, currentTarget: canvas, ...overrides }) as unknown as Parameters<NonNullable<typeof props.onPointerDown>>[0];
  const down = (overrides = {}) => props.onPointerDown!(event(overrides));
  const up = (overrides = {}) => props.onPointerUp!(event(overrides));
  up();
  for (const button of [1, 2]) { down({ button }); up({ button }); }
  down({ isPrimary: false }); up({ isPrimary: false });
  down(); props.onPointerCancel!(event()); up();
  down(); props.onLostPointerCapture!(event()); up();
  down(); props.onPointerMove!(event({ clientX: province.x * 800 + 8 })); up();
  down(); up({ clientY: province.y * 600 + 8 });
  assert.deepEqual(activated, []);
  down(); up({ pointerId: 2 });
  assert.deepEqual(activated, []);
  up(); up();
  assert.deepEqual(activated, [province.id], "matching primary gesture activates exactly once");
});
