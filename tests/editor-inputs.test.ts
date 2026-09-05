import assert from "node:assert/strict";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { BoundedNumberInput, ItemListInput } from "../src/EditorInputs";
import { CatalogCombobox } from "../src/catalog/CatalogCombobox";
import { BUILTIN_DOM6_CATALOG } from "../src/catalog";
import { setNationSpecificStart } from "../src/domain";
import { createDefaultProject } from "../src/generator";
import { updateCaveStartNations } from "../src/MapMakerApp";

interface ControlProps {
  children?: ReactNode;
  value?: string;
  onChange?: (event: { target: { value: string } }) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

function capture<P>(component: (props: P) => ReactNode, props: P): ReactNode {
  let captured: ReactNode;
  function Capture() { captured = component(props); return null; }
  renderToStaticMarkup(createElement(Capture));
  return captured;
}

function control(tree: ReactNode, tag: "input" | "textarea"): ReactElement<ControlProps> {
  if (Array.isArray(tree)) {
    for (const child of tree) { try { return control(child, tag); } catch { /* Continue through siblings. */ } }
  } else if (isValidElement<ControlProps>(tree)) {
    if (tree.type === tag) return tree;
    return control(tree.props.children, tag);
  }
  throw new Error(`Missing ${tag} control`);
}

test("catalog focus and untouched blur preserve generated-cave provenance and create no edit", () => {
  const project = createDefaultProject("catalog-focus-provenance");
  const plane = project.planes[0]!;
  setNationSpecificStart(project, plane.id, plane.provinces[0]!.id, 15, "generated-cave");
  let edits = 0;
  const input = control(capture(CatalogCombobox, {
    label: "Specific-start nation", value: 15, entries: BUILTIN_DOM6_CATALOG.nations,
    onCommit(value: string) { edits += 1; setNationSpecificStart(project, plane.id, plane.provinces[0]!.id, Number(value)); },
  }), "input");
  input.props.onFocus!();
  input.props.onBlur!();
  assert.equal(edits, 0);
  assert.equal(project.specificStarts[0]!.source, "generated-cave");
  updateCaveStartNations(project, []);
  assert.equal(project.specificStarts.length, 0);
});

test("typing a valid multi-digit count does not commit its out-of-range prefix", () => {
  const changes: number[] = [];
  const input = control(capture(BoundedNumberInput, { value: 6, min: 2, max: 32, onChange: (next: number) => changes.push(next) }), "input");
  input.props.onFocus!();
  input.props.onChange!({ target: { value: "" } });
  input.props.onChange!({ target: { value: "1" } });
  assert.deepEqual(changes, [], "blank and the prefix of 16 remain local drafts");
  input.props.onChange!({ target: { value: "16" } });
  assert.deepEqual(changes, [16]);
});

test("item whitespace does not create edits, and multiword items compile as separate entries", () => {
  const changes: string[][] = [];
  const input = control(capture(ItemListInput, { value: ["Fire Brand"], onChange: (next: string[]) => changes.push(next) }), "textarea");
  input.props.onFocus!();
  input.props.onChange!({ target: { value: "Fire Brand " } });
  input.props.onChange!({ target: { value: "Fire Brand\n" } });
  assert.deepEqual(changes, []);
  input.props.onChange!({ target: { value: "Fire Brand\nFrost Brand" } });
  assert.deepEqual(changes, [["Fire Brand", "Frost Brand"]]);
  input.props.onChange!({ target: { value: Array.from({ length: 65 }, (_, i) => `Item ${i}`).join("\n") } });
  assert.equal(changes.length, 1, "an unrestorable item count does not reach the project");
});
