# Dominions catalog notices

`dom6-6.37.json` is a compact, generated selector index. It contains only the
fields needed by Pantokrator Atlas: factual numeric IDs, display names, site
location/path/rarity/home metadata, unit recruitment roles, nation labels, and
plane lookup values.

`population-recruitment-6.37.json` is a separate static membership catalogue.
Its provenance, extraction boundary and relationship to initial-army templates
are described below; it does not replace the selector index.

## Dom6 Inspector data

- Repository: <https://github.com/larzm42/dom6inspector>
- Pinned source tree: <https://github.com/larzm42/dom6inspector/tree/c30c6c14e18ab284415d599b81579af9b3070112/gamedata>
- Revision: `c30c6c14e18ab284415d599b81579af9b3070112`
- Revision date: 2026-09-18
- Upstream description: “Update to 6.37.”
- License: GNU General Public License v3.0; see [LICENSE.dom6inspector.txt](LICENSE.dom6inspector.txt)
- Used for: units; commander/troop roles from nation and magic-site recruitment slots; magic sites and nation home-site references; nations; special plane IDs; site-location lookup values; the generated province-name reservation set (playable nation names/epithets, nation home-site names, official plane names, and Nexus); and exact unit-name cross-checks for the separate population membership catalogue
- Source paths: `gamedata/BaseU.csv`, `gamedata/MagicSites.csv`,
  `gamedata/nations.csv`, `gamedata/other_planes.csv`, and
  `gamedata/site_terrain_types.csv`; `gamedata/attributes_by_nation.csv` and
  `gamedata/attribute_keys.csv`; and the `fort_`, `coast_`, and `nonfort_`
  `leader_types_by_nation.csv` / `troop_types_by_nation.csv` tables

The large upstream CSV files are not copied into this repository. To reproduce
the compact bundle, download those thirteen raw files from the pinned tree into
`tmp/catalog-source-6.37/`, then run
`node scripts/build-dom6-catalog.mjs tmp/catalog-source-6.37`.
The builder checks SHA-256 fingerprints for all thirteen input files before
writing output; the compact bundle records the same fingerprints. An older or
locally modified dump cannot silently inherit the newer provenance label.

### 6.35 to 6.37 verification

The September 21, 2026 update compared the prior pinned 6.35 snapshot
`cfac4311bc0b58053b8dead7bffbc036ba9bd5dc` with the source above. Twelve input
tables are byte-identical. `BaseU.csv` changes statistics on 22 existing unit
records, with no added, removed, or renamed units. Every compact collection
(IDs, names, recruitment roles, site metadata, nations, population labels,
forts, planes, and site terrain types) is unchanged. Catalog provenance now
identifies the verified 6.37 source; no guardian IDs or army compositions were
changed by this refresh.

Pale One Commander `#1463` and Pale One `#1465` retain their IDs and exact names.
The source still records normal leadership 75 for the commander, Amphibian and
Darkvision 100 for both. These unit facts do **not** establish membership in
population type `#81`; population-to-recruitment membership requires separate
evidence. The Inspector export contains no population roster table. The static
extraction and native controls below supply that separate evidence; they were
not part of the historical selector refresh.

The compact selector does not store combat statistics and is not a balance
model. Updated game statistics can change gameplay without changing a unit ID
or this selector index. No new IDs were introduced by this refresh, so it does
not itself require raising existing maps' minimum `#domversion`.

### Post-publication content verification

The bundled selector is intentionally newer than the original manual and also
fills later content gaps in the 6.26 map manual's nation tables. The following
official content updates remain represented in the pinned 6.37 data:

- [Dominions 6.08](https://steamcommunity.com/games/2511500/announcements/detail/4102287868180507538): new Asphodel pretenders, sacreds, and manikin forms.
- [Dominions 6.12](https://steamcommunity.com/games/2511500/announcements/detail/4186734796832156327): LA Pyrène, Cambion Kings, and its roster.
- [Dominions 6.23](https://steamcommunity.com/games/2511500/announcements/detail/4468229436805743728): C'tissian Medium Infantry.
- [Dominions 6.24](https://steamcommunity.com/games/2511500/announcements/detail/785412209072145808): heathen shaman commanders and additional thrones.
- [Dominions 6.30](https://steamcommunity.com/games/2511500/announcements/detail/516348030198220655): LA Zemaitia and additional Fay content.
- [Dominions 6.32](https://steamcommunity.com/games/2511500/announcements/detail/607550464526909529): Nidavangr-specific longdead forms.
- [Dominions 6.34](https://steamcommunity.com/games/2511500/announcements/detail/534376383746409027): Fay Archer, Unseelie units, Draugadrott, and Buraq.
- [Dominions 6.35](https://steamcommunity.com/games/2511500/announcements/detail/679624547358474861): Gnu, Gnu Clan Cavalry, Gnu Clan Commander, and the Throne of Violence.

The resulting built-in catalog includes LA Pyrène as nation `#123`, Zemaitia
as nation `#124`, gameplay units through Gnu Clan Commander `#4134`, and
throne sites through the Throne of Violence `#1405`. See
[catalog coverage](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/CONTENT_CATALOG.md) and [catalog tests](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/tests/catalog.test.ts) for the exact verified
name/ID coverage. Patch announcements establish which content was added;
numeric game IDs come from the pinned Dom6 Inspector 6.37 export.

Role filters use the six fort/coast/non-fort nation leader/troop tables plus
the `hcom`, `hmon`, `natcom`, and `natmon` fields in `MagicSites.csv`. The
result is 850 known commander-role units and 842 known troop-role units.
All 4,091 source unit records remain in the compact bundle for exact ID lookup;
normal selector browsing hides 13 explicitly named Test, Debug, XXX, or Unused
data records without preventing raw numeric-ID entry.

## Static population recruitment membership

`population-recruitment-6.37.json` preserves the default recruitment lists for
82 documented population types (IDs 25–106), their troop/commander slot order,
and 175 exact unit identities. These membership lists were independently
identified in a local, read-only static executable inspection, not copied from
Inspector or inferred from names. The executable pin is:

- Dominions 6.37, Windows x64, `Dominions6.exe`
- Length: 76,009,984 bytes
- SHA-256: `d77cd364fe447e85e564cdd9460fcb5591f7e0b2089d6e58e9d2f2d907ee294c`
- Recruitment table: file offset `0x3091c50`, 168-byte records, signed
  little-endian integers; `-2` separates troops and commanders, `-1` ends a list

Referenced unit names are checked against the installed monster records and
the pinned Inspector `BaseU.csv` above, SHA-256
`185675d8906b87dc94070d52776e19cfefec4d2efcee9b6e8084aeba059e4ec5`.
Inspector attribution and its GPL-3.0 licence remain applicable to those
cross-references.

The published [dom6utils layout constants](https://github.com/larzm42/dom6utils/blob/fcb98596a4c092be2c8e8f0b5aae7fa4592d3eab/src/dom6utils/Starts.java)
and [monster-name reader](https://github.com/larzm42/dom6utils/blob/fcb98596a4c092be2c8e8f0b5aae7fa4592d3eab/src/dom6utils/MonsterStatIndexer.java)
are references for monster-record offsets, stride and ISO-8859-1 decoding.
Their source notices specify GPL v3 or later. No third-party implementation
was copied into the new extractor; the upstream tool does not export the
population table.

Eight native recruitment controls corroborate the membership table in
unmodded Middle Age under MA Ulm. Only the earlier population-81 control
claims numeric-ID panels. Other controls use observed roles and order with
unique-name/attribute joins, distinguishing traits or exact equipment. See
the [static-table evidence](../../../docs/research/POPULATION_RECRUITMENT_TABLE_2026-09-21.md)
and [native batch notes](../../../docs/research/NATIVE_RECRUITMENT_BATCH_2026-09-21.md)
for the individual methods and terrain contexts.

The optional [extractor](../../../scripts/catalog/extract-population-recruitment.mjs)
requires explicit paths to the exact reviewed game executable and catalogue
source. It opens files read-only, rejects changed versions/lengths/hashes,
validates record bounds and identities, and emits complete JSON to stdout only
after success. It is not invoked by application startup, map generation,
installation or normal tests. No installed-game access is required to use the
bundled membership data. The separate pure-decoder tests use synthetic records
and do not require the game.

No executable bytes, game artwork, sprites, descriptions or game source code
are distributed with this dataset. A licensed game copy must be obtained
separately to re-extract it. The new extraction implementation is original
project code; the project's licence does not change upstream attribution or
licensing.

Membership is not an initial-army template or persistent-PD formula. Era,
terrain, nation and mod effects remain separate runtime concerns. Population
44 has no recruitable commander; 106 has an observed empty roster; 75 contains
a legitimate dual-role ID. These distinctions are preserved without invented
units. New automatic-defender templates require their own leadership, habitat
and native army-acceptance evidence, and remain revision-pinned and opt-in.
Adding this catalogue alone does not change custom guardians or ordinary
initial armies.

## Illwinter map manual

- Source: *Dominions 6 Map Making Manual*
- Version: 6.26
- Used for: poptype table (PDF p.7) and fortification table (PDF p.8)

The official map manual does not include complete magic-site or unit ID/name
tables; those selector catalogs are therefore attributed to Dom6 Inspector,
not to Illwinter’s manual.

Province-name vocabulary in `src/naming.ts` is original to Pantokrator Atlas
and uses ordinary historical and geographic terms. No third-party map's name
list is copied. Dominions labels derived from the pinned tables are used only
as names ordinary generated provinces must avoid.
