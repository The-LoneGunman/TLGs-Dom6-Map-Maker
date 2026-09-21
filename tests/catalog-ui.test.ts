import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BUILTIN_DOM6_CATALOG, createCatalogTemplate, findCatalogEntry, mergeCatalogBundles, parseCatalogBundle, type Dom6CatalogBundle } from "../src/catalog";
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

function sitePickerFixture() {
  const project = createDefaultProject("catalog-ui-provenance-boundary");
  const plane = project.planes[0]!;
  const province = plane.provinces.find(entry => !entry.start)!;
  province.sites = [{ id: "custom-selected-site", value: "9001", known: false }];
  const catalog: Dom6CatalogBundle = { ...structuredClone(BUILTIN_DOM6_CATALOG),
    sites: [401, 1261, 204, 1361].map(id => structuredClone(findCatalogEntry(BUILTIN_DOM6_CATALOG.sites, id)!)),
  };
  const render = (activeCatalog: Dom6CatalogBundle) => renderToStaticMarkup(createElement(SitesDefenseInspector, {
    catalog: activeCatalog, plane, province, update() {},
  }));
  return { catalog, render };
}

test("ordinary site browsing follows current bundled provenance while preserving older custom site metadata", () => {
  const { catalog, render } = sitePickerFixture();
  assert.equal(catalog.sites[0]!.provenanceId, "dom6inspector-6.37-c30c6c14");
  const savedCustom = createCatalogTemplate("6.35");
  savedCustom.provenance[0]!.id = "saved-6.35-custom-catalog";
  const provenanceId = savedCustom.provenance[0]!.id;
  savedCustom.sites = [
    { id: 9001, name: "Preserved custom spring", provenanceId },
    { id: 9002, name: "Custom non-random sanctuary", provenanceId, tags: ["non-random-site"] },
    { id: 401, name: "Customized ordinary site", provenanceId },
    { id: 204, name: "Customized capital site", provenanceId, tags: ["ordinary-site"] },
    { id: 1361, name: "Customized throne site", provenanceId, tags: ["ordinary-site"] },
  ];
  const parsed = parseCatalogBundle(JSON.stringify(savedCustom));
  const merged = mergeCatalogBundles(catalog, parsed);
  const html = render(merged);
  assert.equal(findCatalogEntry(merged.sites, 401)?.name, "Customized ordinary site");
  assert.equal(findCatalogEntry(merged.sites, 9001)?.provenanceId, provenanceId);
  assert.ok(findCatalogEntry(merged.sites, 204)?.tags?.includes("nation-home-site"));
  assert.ok(findCatalogEntry(merged.sites, 1361)?.tags?.includes("throne"));
  assert.match(html, /of 2 ordinary province sites/);
  assert.match(html, /2 ordinary \+ 2 non-random non-home sites available/);
  assert.match(html, /Include all 4 non-capital sites/);
  assert.match(html, /Preserved custom spring \(#9001\)/);
  assert.doesNotMatch(html, /of 3 ordinary province sites/);
});

test("saved 6.35 Inspector provenance cannot leak special sites into the current ordinary picker", () => {
  const { catalog, render } = sitePickerFixture();
  const savedInspector = createCatalogTemplate("6.35");
  savedInspector.provenance = [{
    id: "dom6inspector-6.35-cfac4311", title: "Dom6 Inspector data export", authority: "community",
    version: "6.35 / cfac4311bc0b58053b8dead7bffbc036ba9bd5dc",
    source: "https://github.com/larzm42/dom6inspector/tree/cfac4311bc0b58053b8dead7bffbc036ba9bd5dc/gamedata",
  }];
  savedInspector.sites = catalog.sites.map(site => ({ ...site, provenanceId: savedInspector.provenance[0]!.id }));
  const custom = createCatalogTemplate("6.35");
  custom.sites = [{ id: 9001, name: "Preserved custom spring", provenanceId: custom.provenance[0]!.id }];
  const merged = mergeCatalogBundles(catalog, parseCatalogBundle(JSON.stringify(savedInspector)), parseCatalogBundle(JSON.stringify(custom)));
  assert.equal(findCatalogEntry(merged.sites, 1261)?.provenanceId, "dom6inspector-6.35-cfac4311", "old observations must not be silently relabelled");
  const html = render(merged);
  assert.match(html, /of 2 ordinary province sites/);
  assert.match(html, /2 ordinary \+ 1 non-random non-home sites available/);
  assert.match(html, /Include all 3 non-capital sites/);
  assert.match(html, /Preserved custom spring \(#9001\)/);
  assert.doesNotMatch(html, /of 3 ordinary province sites/);
});
