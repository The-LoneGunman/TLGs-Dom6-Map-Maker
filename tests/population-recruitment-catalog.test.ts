import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertSupportedRecruitmentSource, decodePopulationRecruitmentRecord, extractPopulationRecruitment,
  joinPopulationRecruitmentIdentities, parseRecruitmentUnitCatalog, POPULATION_RECRUITMENT_SOURCE, sha256,
} from "../scripts/catalog/population-recruitment-decoder.mjs";
import { parseExtractionArguments } from "../scripts/catalog/extract-population-recruitment.mjs";

const snapshot = JSON.parse(readFileSync(new URL("../src/catalog/data/population-recruitment-6.37.json", import.meta.url), "utf8")) as ReturnType<typeof extractPopulationRecruitment>;
const compact = JSON.parse(readFileSync(new URL("../src/catalog/data/dom6-6.37-units.json", import.meta.url), "utf8")) as { gameVersion: string; units: [number, string, number][] };
const catalog = new Map(compact.units.map(([id, name]) => [id, name]));
const cli = fileURLToPath(new URL("../scripts/catalog/extract-population-recruitment.mjs", import.meta.url));

function record(slots: number[]) {
  const bytes = new Uint8Array(168), view = new DataView(bytes.buffer);
  slots.forEach((value, index) => view.setInt32(index * 4, value, true));
  return bytes;
}

test("the durable catalogue retains all 82 rows, exact role order and source-bound layout", () => {
  assert.equal(snapshot.format, "pantokrator-atlas/population-recruitment");
  assert.equal(snapshot.formatVersion, 1);
  assert.equal(snapshot.gameVersion, "6.37");
  assert.deepEqual(snapshot.populations.map(row => row.poptype), Array.from({ length: 82 }, (_, i) => i + 25));
  const membership = JSON.stringify(snapshot.populations.map(row => [row.poptype, row.troopIds, row.commanderIds]));
  assert.equal(sha256(new TextEncoder().encode(membership)), "91fcebf891c45013e2f27fb6b09541e80d159b5189213b2dbcb6626fef92fc43");
  assert.equal(snapshot.layout.fileOffset, "0x3091c50");
  assert.equal(snapshot.layout.recordBytes, 168);
  assert.equal(snapshot.layout.signedInt32Slots, 42);
  assert.equal(snapshot.layout.byteOrder, "little-endian");
  assert.equal(snapshot.layout.troopCommanderSeparator, -2);
  assert.equal(snapshot.layout.listTerminator, -1);
  assert.deepEqual(snapshot.layout.initializedIndexes, [0, 106]);
  assert.deepEqual(snapshot.layout.zeroReservedIndexes, [107, 249]);
  for (const row of snapshot.populations) {
    assert.equal(row.fileOffset, `0x${(POPULATION_RECRUITMENT_SOURCE.tableOffset + row.poptype * 168).toString(16)}`);
    assert.equal(row.separatorSlot, row.troopIds.length);
    assert.equal(row.terminatorSlot, row.troopIds.length + row.commanderIds.length + 1);
    const bytes = record([...row.troopIds, -2, ...row.commanderIds, -1]);
    const expected = { poptype: row.poptype, troopIds: row.troopIds, commanderIds: row.commanderIds,
      separatorSlot: row.separatorSlot, terminatorSlot: row.terminatorSlot };
    assert.deepEqual(decodePopulationRecruitmentRecord(bytes, row.poptype, catalog), expected);
  }
});

test("known empty and troop-only rosters never acquire invented commanders", () => {
  const row44 = snapshot.populations.find(row => row.poptype === 44)!;
  const row106 = snapshot.populations.find(row => row.poptype === 106)!;
  assert.deepEqual(row44.troopIds, [447]);
  assert.deepEqual(row44.commanderIds, []);
  assert.deepEqual([row106.troopIds, row106.commanderIds], [[], []]);
  assert.deepEqual(decodePopulationRecruitmentRecord(record([-2, -1]), 106, catalog).commanderIds, []);
  assert.throws(() => decodePopulationRecruitmentRecord(record([]), 107, catalog), /delimiters/,
    "all-zero reserved storage is not a delimited empty roster");
});

test("population 75 preserves its legitimate dual-role ID without name or leadership inference", () => {
  const row = snapshot.populations.find(value => value.poptype === 75)!;
  assert.deepEqual(row.troopIds, [483, 271, 273, 1196]);
  assert.deepEqual(row.commanderIds, [272, 1196, 1195, 1198]);
  assert.deepEqual(snapshot.validation.bothCategories, [75]);
  const decoded = decodePopulationRecruitmentRecord(record([...row.troopIds, -2, ...row.commanderIds, -1]), 75, catalog);
  assert.ok(decoded.troopIds.includes(1196));
  assert.ok(decoded.commanderIds.includes(1196));
});

test("all 175 extracted unit identities join exactly to the pinned catalogue and installed-record offsets", () => {
  assert.equal(compact.gameVersion, snapshot.gameVersion);
  assert.equal(snapshot.identities.length, 175);
  const ids = snapshot.identities.map(entry => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  assert.deepEqual(new Set(ids), new Set(snapshot.populations.flatMap(row => [...row.troopIds, ...row.commanderIds])));
  for (const entry of snapshot.identities) {
    assert.equal(catalog.get(entry.id), entry.name);
    assert.equal(entry.monsterFileOffset, `0x${(POPULATION_RECRUITMENT_SOURCE.monsterOffset + (entry.id - 1) * 888).toString(16)}`);
  }
  const names = new Map(snapshot.identities.map(entry => [entry.id, entry.name]));
  assert.deepEqual(joinPopulationRecruitmentIdentities(snapshot.populations, catalog, names), snapshot.identities);
});

test("native evidence distinguishes numeric panels, unique-name joins, equipment and disambiguating traits", () => {
  assert.equal(snapshot.scope.nativeControlEra, 2);
  assert.equal(snapshot.scope.nativeControlNation, 60);
  assert.equal(snapshot.scope.nativeControlMods, "none");
  assert.equal(snapshot.validation.nativeControls.length, 8);
  const controls = new Map(snapshot.validation.nativeControls.map(control => [control.poptype, control]));
  assert.equal(controls.get(81)!.method, "native-numeric-ID-panels");
  for (const id of [84, 94]) {
    assert.equal(controls.get(id)!.method, "native-unique-names-and-attributes");
    assert.match(controls.get(id)!.notes, /No numeric-ID panel claimed/);
  }
  assert.equal(controls.get(93)!.method, "native-disambiguating-attributes");
  for (const id of [65, 89]) assert.equal(controls.get(id)!.method, "native-role-order-and-exact-equipment");
  assert.deepEqual([controls.get(65)!.troopIds, controls.get(65)!.commanderIds], [[974, 975], [976]]);
  assert.match(snapshot.scope.eraEvidence, /Runtime era, terrain, nation and mod overrides are not ruled out/);
  assert.match(snapshot.scope.excludedEvidence, /Initial-army counts and post-capture PD are not extracted/);
  assert.match(snapshot.scope.templateBoundary, /before promoting any defense template/);
  assert.equal(Object.hasOwn(snapshot, "profiles"), false);
  assert.equal(Object.hasOwn(snapshot.executable, "path"), false, "release data must not leak machine-local paths");
  for (const control of controls.values()) {
    const row = snapshot.populations.find(value => value.poptype === control.poptype)!;
    assert.deepEqual([row.troopIds, row.commanderIds], [control.troopIds, control.commanderIds]);
  }
});

test("single-record decoding rejects corrupt roles, IDs, padding and buffer bounds without mutations", () => {
  const invalid = [
    [1465, 1463, -1], [1465, -2, 1463], [-1, -2], [1465, -2, -2, 1463, -1],
    [1465, -2, 1463, -1, -1], [1465, -2, 1463, -1, 9], [0, -2, 1463, -1],
    [19999, -2, 1463, -1], [20000, -2, 1463, -1], [-3, -2, 1463, -1],
    [1465, 1465, -2, 1463, -1], [1465, -2, 1463, 1463, -1],
  ];
  for (const slots of invalid) {
    const bytes = record(slots), before = Uint8Array.from(bytes);
    assert.throws(() => decodePopulationRecruitmentRecord(bytes, 81, catalog), /Population 81/);
    assert.deepEqual(bytes, before);
  }
  for (const length of [0, 167, 169]) assert.throws(() => decodePopulationRecruitmentRecord(new Uint8Array(length), 81, catalog), /168 bytes/);
  for (const id of [-1, 250, NaN, Infinity, 1.5]) assert.throws(() => decodePopulationRecruitmentRecord(record([-2, -1]), id, catalog), /population index/);
  const padded = new Uint8Array(180);
  padded.set(record([1465, -2, 1463, -1]), 7);
  const first = decodePopulationRecruitmentRecord(padded.subarray(7, 175), 81, catalog);
  first.troopIds.push(999);
  assert.deepEqual(decodePopulationRecruitmentRecord(padded.subarray(7, 175), 81, catalog).troopIds, [1465]);
});

test("catalogue parsing and exact joins reject missing, duplicate and conflicting identities", () => {
  const names = parseRecruitmentUnitCatalog("id\tname\tleader\n17\tSame name\t50\n18\tSame name\t0\n");
  assert.deepEqual([...names], [[17, "Same name"], [18, "Same name"]]);
  const rows = [{ troopIds: [17], commanderIds: [18] }];
  assert.deepEqual(joinPopulationRecruitmentIdentities(rows, names, names).map(entry => entry.id), [17, 18]);
  for (const text of ["name\tid\nA\t1", "id\tname\n", "id\tname\n17\tA\n17\tB", "id\tname\n0\tA", "id\tname\n17\t", "id\tname\n17\t A", "id\tname\n1.5\tA", "id\tname\n20000\tA"]) {
    assert.throws(() => parseRecruitmentUnitCatalog(text));
  }
  assert.throws(() => parseRecruitmentUnitCatalog("x".repeat(4 * 1024 * 1024 + 1)), /bound/);
  assert.throws(() => joinPopulationRecruitmentIdentities(rows, names, new Map([[17, "Same name"]])), /18/);
  assert.throws(() => joinPopulationRecruitmentIdentities(rows, names, new Map([[17, "Different"], [18, "Same name"]])), /17/);
  assert.throws(() => joinPopulationRecruitmentIdentities(rows, new Map([[17, "Same name"]]), names), /18/);
});

test("unknown versions and changed source bytes fail closed without an offset or catalogue fallback", () => {
  const source = { ...POPULATION_RECRUITMENT_SOURCE };
  assert.doesNotThrow(() => assertSupportedRecruitmentSource(source));
  for (const change of [{ gameVersion: "6.38" }, { gameVersion: "6.36" }, { gameVersion: "6.37 " },
    { executableBytes: source.executableBytes - 1 }, { executableSha256: "0".repeat(64) },
    { catalogBytes: source.catalogBytes + 1 }, { catalogSha256: "1".repeat(64) }]) {
    assert.throws(() => assertSupportedRecruitmentSource({ ...source, ...change }));
  }
  assert.throws(() => extractPopulationRecruitment(new Uint8Array(), new Uint8Array(), "6.38"), /Unsupported game version/);
  assert.throws(() => extractPopulationRecruitment(new Uint8Array(), new Uint8Array(), "6.37"), /executable/);
  assert.equal(snapshot.executable.sha256, source.executableSha256);
  assert.equal(snapshot.provenance.catalog.sha256, source.catalogSha256);
  assert.ok(Object.isFrozen(POPULATION_RECRUITMENT_SOURCE));
});

test("the optional CLI requires explicit paths and rejects ambiguous arguments before file IO", () => {
  assert.deepEqual(parseExtractionArguments(["--help"]), { help: true });
  const valid = ["--game-version", "6.37", "--exe", "a game/Dominions6.exe", "--catalog", "a dump/BaseU.csv"];
  assert.deepEqual(parseExtractionArguments(valid), { help: false, gameVersion: "6.37", executablePath: valid[3], catalogPath: valid[5] });
  for (const args of [[], ["--exe", "game"], [...valid, "--exe", "other"], [...valid, "--output", "file"],
    ["--help", ...valid], ["--game-version", "6.38", ...valid.slice(2)], ["--exe"], ["--exe", " "]]) {
    assert.throws(() => parseExtractionArguments(args));
  }
  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8", timeout: 10000 });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Writes catalogue JSON to stdout only/);
  const missing = spawnSync(process.execPath, [cli], { encoding: "utf8", timeout: 10000 });
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, "");
  const wrongFile = spawnSync(process.execPath, [cli, "--game-version", "6.37", "--exe", cli, "--catalog", cli], { encoding: "utf8", timeout: 10000 });
  assert.equal(wrongFile.status, 1);
  assert.equal(wrongFile.stdout, "", "failure must not emit partial catalogue data");
  assert.match(wrongFile.stderr, /exact reviewed length/);
});
