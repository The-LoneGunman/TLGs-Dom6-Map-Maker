import { createHash } from "node:crypto";

/** Exact reviewed inputs. A different platform/build requires a new reviewed layout. */
export const POPULATION_RECRUITMENT_SOURCE = Object.freeze({
  gameVersion: "6.37",
  executableBytes: 76009984,
  executableSha256: "d77cd364fe447e85e564cdd9460fcb5591f7e0b2089d6e58e9d2f2d907ee294c",
  catalogBytes: 2504944,
  catalogSha256: "185675d8906b87dc94070d52776e19cfefec4d2efcee9b6e8084aeba059e4ec5",
  inspectorRevision: "c30c6c14e18ab284415d599b81579af9b3070112",
  extractorReferenceRevision: "fcb98596a4c092be2c8e8f0b5aae7fa4592d3eab",
  tableOffset: 0x3091c50,
  recordBytes: 168,
  recordSlots: 42,
  monsterOffset: 0x032ee3f8,
  monsterRecordBytes: 888,
});

const SOURCE = POPULATION_RECRUITMENT_SOURCE;
const MAX_UNIT_ID = 19999;
const hex = value => `0x${value.toString(16)}`;

/** @param {Uint8Array} bytes */
export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Pure check: no fallback to a nearby patch, alternate binary, or changed catalogue. */
export function assertSupportedRecruitmentSource({ gameVersion, executableBytes, executableSha256, catalogBytes, catalogSha256 }) {
  if (gameVersion !== SOURCE.gameVersion) throw new Error(`Unsupported game version: expected exactly ${SOURCE.gameVersion}.`);
  if (executableBytes !== SOURCE.executableBytes || executableSha256 !== SOURCE.executableSha256) {
    throw new Error("The executable does not match the reviewed Windows x64 build; no extraction is permitted.");
  }
  if (catalogBytes !== SOURCE.catalogBytes || catalogSha256 !== SOURCE.catalogSha256) {
    throw new Error("BaseU.csv does not match the pinned Inspector 6.37 snapshot.");
  }
}

/** Read-only ID/name parsing. Blank fields never become a zero ID or inferred role.
 * @param {string} text
 * @returns {Map<number, string>}
 */
export function parseRecruitmentUnitCatalog(text) {
  if (typeof text !== "string" || text.length > 4 * 1024 * 1024) throw new Error("Unit catalogue text exceeds the supported bound.");
  const lines = text.split(/\r?\n/);
  if (lines.length > MAX_UNIT_ID + 2) throw new Error("Unit catalogue has too many records.");
  const columns = lines.shift()?.split("\t");
  if (columns?.[0] !== "id" || columns[1] !== "name") throw new Error("Expected a tab-delimited id/name catalogue header.");
  const catalog = new Map();
  for (const line of lines) {
    if (!line) continue;
    const [rawId, name] = line.split("\t", 3);
    const id = Number(rawId);
    if (!/^[1-9]\d{0,4}$/.test(rawId) || id > MAX_UNIT_ID || catalog.has(id)) throw new Error("Invalid or duplicate catalogue unit ID.");
    if (!name || name !== name.trim() || name.length > 63
      || [...name].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
      throw new Error(`Invalid catalogue name for unit ${id}.`);
    }
    catalog.set(id, name);
  }
  if (!catalog.size) throw new Error("The unit catalogue is empty.");
  return catalog;
}

/**
 * Pure single-record decoder, deliberately independent of file IO or installed games.
 * Roles are defined by slots, not names, leadership values, or national recruitment.
 * A unit may legitimately appear in both roles (population 75 does).
 * @param {Uint8Array} bytes
 * @param {number} poptype
 * @param {ReadonlyMap<number, string>} catalog
 */
export function decodePopulationRecruitmentRecord(bytes, poptype, catalog) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== SOURCE.recordBytes) throw new Error("A recruitment record must contain exactly 168 bytes.");
  if (!Number.isSafeInteger(poptype) || poptype < 0 || poptype > 249) throw new Error("Invalid population index.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const slots = Array.from({ length: SOURCE.recordSlots }, (_, i) => view.getInt32(i * 4, true));
  const separatorSlot = slots.indexOf(-2), terminatorSlot = slots.indexOf(-1);
  if (separatorSlot < 0 || terminatorSlot <= separatorSlot || slots.filter(value => value === -2).length !== 1
    || slots.filter(value => value === -1).length !== 1) throw new Error(`Population ${poptype}: invalid role delimiters.`);
  if (slots.slice(terminatorSlot + 1).some(value => value !== 0)) throw new Error(`Population ${poptype}: nonzero trailing padding.`);
  const troopIds = slots.slice(0, separatorSlot), commanderIds = slots.slice(separatorSlot + 1, terminatorSlot);
  for (const [role, ids] of [["troop", troopIds], ["commander", commanderIds]]) {
    if (new Set(ids).size !== ids.length) throw new Error(`Population ${poptype}: duplicate ${role} entry.`);
    for (const id of ids) if (id < 1 || id > MAX_UNIT_ID || !catalog.has(id)) throw new Error(`Population ${poptype}: unresolved ${role} ID ${id}.`);
  }
  return { poptype, troopIds, commanderIds, separatorSlot, terminatorSlot };
}

/** Exact, order-independent joins; duplicate display names remain distinct numeric IDs.
 * @param {readonly {troopIds: readonly number[], commanderIds: readonly number[]}[]} populations
 * @param {ReadonlyMap<number, string>} catalog
 * @param {ReadonlyMap<number, string>} installedNames
 */
export function joinPopulationRecruitmentIdentities(populations, catalog, installedNames) {
  const ids = [...new Set(populations.flatMap(row => [...row.troopIds, ...row.commanderIds]))].sort((a, b) => a - b);
  return ids.map(id => {
    const name = catalog.get(id), installedName = installedNames.get(id);
    if (!Number.isSafeInteger(id) || id < 1 || id > MAX_UNIT_ID || !name || name !== installedName) {
      throw new Error(`Unit ${id}: installed and pinned catalogue identities do not match.`);
    }
    return { id, name, monsterFileOffset: hex(SOURCE.monsterOffset + (id - 1) * SOURCE.monsterRecordBytes) };
  });
}

const NATIVE_CONTROLS = [
  { poptype: 44, troopIds: [447], commanderIds: [], terrain: "dry Cave", method: "native-role-list-and-unique-name", notes: "Troop only; no recruitable commander observed. No numeric-ID panel claimed." },
  { poptype: 65, troopIds: [974, 975], commanderIds: [976], terrain: "Sea, not Cave", method: "native-role-order-and-exact-equipment", notes: "Ichtyid with Net/Stone Spear; armored Ichtyid Warrior; Ichtyid Lord with Bone Trident. No numeric-ID panel or exact rendered-stat-total claim." },
  { poptype: 81, troopIds: [1465], commanderIds: [1463], terrain: "dry Cave", method: "native-numeric-ID-panels", notes: "Both numeric IDs observed in the earlier r21 control." },
  { poptype: 84, troopIds: [1615], commanderIds: [1616], terrain: "dry Cave", method: "native-unique-names-and-attributes", notes: "Unique Caveman/Caveman Champion names and commander leadership 10. No numeric-ID panel claimed." },
  { poptype: 89, troopIds: [1749, 1758, 1756], commanderIds: [1750], terrain: "Plain", method: "native-role-order-and-exact-equipment", notes: "Militia, Slinger and Warrior distinguished by Bronze Spear, Sling/Bronze Dagger and Bronze Axe; Champion has Bronze Sword/Javelin. No numeric-ID panel claimed." },
  { poptype: 93, troopIds: [2504], commanderIds: [2505], terrain: "dry Cave", method: "native-disambiguating-attributes", notes: "Camazotz variant distinguished by ordinary/magic leadership 50/50, MR13 and Death1; not a name-only match. No numeric-ID panel claimed." },
  { poptype: 94, troopIds: [2510], commanderIds: [2511], terrain: "dry Cave", method: "native-unique-names-and-attributes", notes: "Unique Lava-born/Lava-born Commander names and commander leadership 50. No numeric-ID panel claimed." },
  { poptype: 106, troopIds: [], commanderIds: [], terrain: "dry Cave", method: "native-empty-role-lists", notes: "Neither commanders nor troops observed; distinct from missing data." },
];

/** Full extraction is also pure: supplied bytes in, detached catalogue out, no IO.
 * @param {Uint8Array} executable
 * @param {Uint8Array} catalogBytes
 * @param {string} gameVersion
 */
export function extractPopulationRecruitment(executable, catalogBytes, gameVersion) {
  if (!(executable instanceof Uint8Array) || !(catalogBytes instanceof Uint8Array)) throw new Error("Extraction requires byte arrays.");
  assertSupportedRecruitmentSource({ gameVersion, executableBytes: executable.byteLength, executableSha256: sha256(executable),
    catalogBytes: catalogBytes.byteLength, catalogSha256: sha256(catalogBytes) });
  const catalog = parseRecruitmentUnitCatalog(new TextDecoder("utf-8", { fatal: true }).decode(catalogBytes));
  const initialized = Array.from({ length: 107 }, (_, poptype) => {
    const offset = SOURCE.tableOffset + poptype * SOURCE.recordBytes;
    return { ...decodePopulationRecruitmentRecord(executable.subarray(offset, offset + SOURCE.recordBytes), poptype, catalog), fileOffset: hex(offset) };
  });
  for (const row of initialized.slice(0, 25)) if (row.troopIds.length || row.commanderIds.length) throw new Error("Reserved initial population rows changed.");
  for (let poptype = 107; poptype < 250; poptype++) {
    const offset = SOURCE.tableOffset + poptype * SOURCE.recordBytes;
    if (executable.subarray(offset, offset + SOURCE.recordBytes).some(value => value !== 0)) throw new Error("Reserved population boundary changed.");
  }
  for (const control of NATIVE_CONTROLS) {
    const row = initialized[control.poptype];
    if (JSON.stringify([row.troopIds, row.commanderIds]) !== JSON.stringify([control.troopIds, control.commanderIds])) {
      throw new Error(`Native recruitment control ${control.poptype} failed.`);
    }
  }
  const populations = initialized.slice(25);
  const ids = [...new Set(populations.flatMap(row => [...row.troopIds, ...row.commanderIds]))];
  const installedNames = new Map();
  for (const id of ids) {
    const offset = SOURCE.monsterOffset + (id - 1) * SOURCE.monsterRecordBytes;
    const bytes = executable.subarray(offset, offset + 64), end = bytes.indexOf(0);
    if (bytes.length !== 64 || end < 1) throw new Error(`Unit ${id}: missing bounded monster-name terminator.`);
    // Matches the published monster extractor's ISO-8859-1 character encoding.
    installedNames.set(id, String.fromCharCode(...bytes.subarray(0, end)));
  }
  const identities = joinPopulationRecruitmentIdentities(populations, catalog, installedNames);
  return {
    format: "pantokrator-atlas/population-recruitment", formatVersion: 1, gameVersion, evidenceDate: "2026-09-21",
    purpose: "Static default recruitment membership evidence, not initial-army templates or a combat-balance model.",
    executable: { filename: "Dominions6.exe", platform: "Windows x64", bytes: SOURCE.executableBytes, sha256: SOURCE.executableSha256 },
    provenance: {
      membership: "Read-only extraction of the exact installed executable identified above; eight separately observed native recruitment controls.",
      catalog: { filename: "BaseU.csv", bytes: SOURCE.catalogBytes, sha256: SOURCE.catalogSha256, revision: SOURCE.inspectorRevision,
        source: `https://github.com/larzm42/dom6inspector/blob/${SOURCE.inspectorRevision}/gamedata/BaseU.csv`,
        license: "GPL-3.0", licenseFile: "LICENSE.dom6inspector.txt" },
      monsterLayoutReference: `https://github.com/larzm42/dom6utils/blob/${SOURCE.extractorReferenceRevision}/src/dom6utils/Starts.java`,
      monsterNameEncodingReference: `https://github.com/larzm42/dom6utils/blob/${SOURCE.extractorReferenceRevision}/src/dom6utils/MonsterStatIndexer.java`,
      note: "No executable bytes, game art, descriptions or third-party implementation are included. The population-table layout was independently identified from native controls; the referenced extractor does not export this table.",
    },
    layout: { fileOffset: hex(SOURCE.tableOffset), recordBytes: SOURCE.recordBytes, signedInt32Slots: SOURCE.recordSlots, byteOrder: "little-endian",
      indexRule: "fileOffset + populationId * recordBytes", troopCommanderSeparator: -2, listTerminator: -1, trailingPadding: 0,
      initializedIndexes: [0, 106], publishedPopulationIndexes: [25, 106], zeroReservedIndexes: [107, 249],
      monsterNameBase: hex(SOURCE.monsterOffset), monsterRecordBytes: SOURCE.monsterRecordBytes, monsterIndexRule: "base + (unitId - 1) * recordBytes" },
    scope: { nativeControlEra: 2, nativeControlMods: "none", nativeControlNation: 60,
      eraEvidence: "One population-indexed default table was identified. No era field or alternate era block was identified in these records. Runtime era, terrain, nation and mod overrides are not ruled out.",
      roleEvidence: "Recruitment categories and order come from positions before and after -2, not names, leadership fields or national recruitment.",
      excludedEvidence: "The separate 68-byte attribute/PD candidate is not used. Initial-army counts and post-capture PD are not extracted.",
      emptyVsUnknown: "Population106 is a delimited empty roster corroborated natively. All-zero reserved rows107-249 are not published as empty rosters.",
      templateBoundary: "Verify habitat, leadership, intended era and actual native initial-army export before promoting any defense template; membership alone does not choose commanders, counts or difficulty." },
    validation: { populationRows: populations.length, exactInstalledAndCatalogIdentities: identities.length,
      strictChecks: "Exact version, lengths and hashes; one separator and terminator; positive resolved IDs; unique IDs within each role; zero trailing padding; reserved bounds; exact installed/catalog names; native controls.",
      bothCategories: populations.filter(row => row.troopIds.some(id => row.commanderIds.includes(id))).map(row => row.poptype),
      nativeControls: structuredClone(NATIVE_CONTROLS) },
    populations, identities,
  };
}
