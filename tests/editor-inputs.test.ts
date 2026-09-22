import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  onBlur?: (event: { currentTarget: { value: string } }) => void;
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
  input.props.onBlur!({ currentTarget: { value: "15" } });
  assert.equal(edits, 0);
  assert.equal(project.specificStarts[0]!.source, "generated-cave");
  updateCaveStartNations(project, []);
  assert.equal(project.specificStarts.length, 0);
});

test("numeric catalog blur resolves IDs and unique names but preserves ambiguous or invalid drafts", () => {
  const commits: string[] = [];
  const input = control(capture(CatalogCombobox, {
    label: "Specific-start nation", value: 15, entries: BUILTIN_DOM6_CATALOG.nations,
    numericOnly: true, isValueAllowed: (value: string) => Number(value) >= 5,
    onCommit: (value: string) => commits.push(value),
  }), "input");
  for (const query of ["Agartha", "unknown nation", "#015", "15", "#2", "-8", "9007199254740993"]) {
    input.props.onChange!({ target: { value: query } });
    input.props.onBlur!({ currentTarget: { value: query } });
    assert.deepEqual(commits, [], `${query} must not clear or reassign the current start`);
  }
  input.props.onBlur!({ currentTarget: { value: "#59" } });
  assert.deepEqual(commits, ["59"]);
  input.props.onBlur!({ currentTarget: { value: "" } });
  assert.deepEqual(commits, ["59", ""], "only explicit empty input clears");
  const unique = control(capture(CatalogCombobox, {
    label: "Population type", value: 2, numericOnly: true,
    entries: [{ id: 31, name: "Unique Folk", aliases: ["Local Folk"], provenanceId: "test" }],
    onCommit: (value: string) => commits.push(value),
  }), "input");
  unique.props.onBlur!({ currentTarget: { value: "local folk" } });
  assert.equal(commits.at(-1), "31");
});

test("unit and site catalog fields retain free-text mod references", () => {
  const commits: string[] = [];
  const input = control(capture(CatalogCombobox, {
    label: "Commander", value: "34", entries: BUILTIN_DOM6_CATALOG.units,
    onCommit: (value: string) => commits.push(value),
  }), "input");
  input.props.onBlur!({ currentTarget: { value: "My Mod Commander" } });
  assert.deepEqual(commits, ["My Mod Commander"]);
});

test("catalog results stay out of the Tab order so Tab leaves the combobox for the next control", () => {
  const source = readFileSync(new URL("../src/catalog/CatalogCombobox.tsx", import.meta.url), "utf8");
  const option = source.slice(source.indexOf('role="option"'), source.indexOf("onClick={() => commit(String(entry.id))}"));
  assert.match(option, /tabIndex=\{-1\}/, "a tabbable option would vanish on blur and drop focus to the page body");
  assert.match(source, /role="listbox" tabIndex=\{-1\}/, "the overflowing result list must not become a keyboard-focusable scroller either");
  assert.match(option, /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/, "pointer selection still commits before the input blurs");
  assert.match(source, /aria-activedescendant=/, "arrow keys still move through the results");
});

test("typing a valid multi-digit count does not commit its out-of-range prefix", () => {
  const changes: number[] = [];
  const input = control(capture(BoundedNumberInput, { value: 6, min: 2, max: 32, onChange: (next: number) => { changes.push(next); } }), "input");
  input.props.onFocus!();
  input.props.onChange!({ target: { value: "" } });
  input.props.onChange!({ target: { value: "1" } });
  assert.deepEqual(changes, [], "blank and the prefix of 16 remain local drafts");
  input.props.onChange!({ target: { value: "16" } });
  assert.deepEqual(changes, [16]);
});

test("number blur uses the visible draft, bounds it, and skips untouched values", () => {
  const changes: number[] = [];
  const input = control(capture(BoundedNumberInput, { value: 6, min: 2, max: 32,
    onChange: (next: number) => { changes.push(next); return false; } }), "input");
  input.props.onFocus!();
  input.props.onBlur!({ currentTarget: { value: "6" } });
  input.props.onBlur!({ currentTarget: { value: "" } });
  assert.deepEqual(changes, []);
  for (const value of ["1", "100", "3.4", "16"]) input.props.onBlur!({ currentTarget: { value } });
  assert.deepEqual(changes, [2, 32, 3, 16]);
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
