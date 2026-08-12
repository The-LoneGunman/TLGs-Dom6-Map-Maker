import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BUILTIN_DOM6_CATALOG } from "../src/catalog";
import { createDefaultProject } from "../src/generator";
import { SitesDefenseInspector, includeSelectedEntry } from "../src/MapMakerApp";

test("site and guardian editor renders complete role-aware catalog affordances", () => {
  const project = createDefaultProject("catalog-ui");
  const plane = project.planes[0]!;
  const province = plane.provinces.find((entry) => !entry.start)!;
  province.sites = [{ id: "site-ui", value: "", known: false }];
  province.defenders = [{
    commander: "2844",
    squads: [{ id: "squad-ui", unit: "3624", count: 10 }],
    bodyguard: "34",
    bodyguardCount: 4,
  }];

  const html = renderToStaticMarkup(createElement(SitesDefenseInspector, {
    catalog: BUILTIN_DOM6_CATALOG,
    plane,
    province,
    update() {},
  }));

  assert.match(html, /of 900 ordinary province sites/);
  assert.match(html, /900 ordinary \+ 71 non-random non-home sites available/);
  assert.match(html, /complete 900-site ordinary pool/);
  assert.match(html, /expanded 971-site pool/);
  assert.match(html, /Nation home\/capital sites and Thrones of Ascension stay excluded/);
  assert.match(html, /Include all 971 non-capital sites/);
  assert.match(html, /Search 900 ordinary sites by name or ID/);
  assert.match(html, /All 4,078 gameplay records available; role filters cover 850 commanders \/ 842 troops/);
  assert.match(html, /Use role-focused lists/);
  assert.match(html, /Search 4,078 gameplay units by name or ID/);
  assert.match(html, /13 Test, Debug, XXX, or Unused data records are hidden from normal browsing/);
  assert.match(html, /raw numeric ID/);
  assert.match(html, /Spectral Commander \(#2844\)/);
  assert.match(html, /Phantasmal Warrior \(#3624\)/);
  assert.match(html, /not unit-name guesses/);
});

test("role-focused lists preserve an already selected unusual vanilla monster", () => {
  const filtered: typeof BUILTIN_DOM6_CATALOG.units = [];
  const entries = includeSelectedEntry(filtered, BUILTIN_DOM6_CATALOG.units, 2844);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.name, "Spectral Commander");
});

test("normal browsing can preserve an already selected internal raw ID", () => {
  const entries = includeSelectedEntry([], BUILTIN_DOM6_CATALOG.units, 4135);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.name, "Debug Senpai");
  assert.ok(entries[0]?.tags?.includes("internal-unit-record"));
});

test("guardian creation is disabled on every authored start type", () => {
  const project = createDefaultProject("catalog-ui-protected-start");
  const plane = project.planes[0]!;
  const province = plane.provinces.find((entry) => !entry.start)!;
  const html = renderToStaticMarkup(createElement(SitesDefenseInspector, {
    catalog: BUILTIN_DOM6_CATALOG,
    plane,
    province,
    protectedStart: true,
    update() {},
  }));

  assert.match(html, /<button[^>]+disabled=""[^>]*>\+ Add guardian group<\/button>/);
  assert.match(html, /disabled on generic, team, and nation-specific starts/);
});
