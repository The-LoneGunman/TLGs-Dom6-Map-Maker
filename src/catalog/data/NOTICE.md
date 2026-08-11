# Dominions catalog notices

`dom6-6.35.json` is a compact, generated selector index. It contains only the
fields needed by Pantokrator Atlas: factual numeric IDs, display names, site
location/path/rarity/home metadata, unit recruitment roles, nation labels, and
plane lookup values.

## Dom6 Inspector data

- Repository: <https://github.com/larzm42/dom6inspector>
- Pinned source tree: <https://github.com/larzm42/dom6inspector/tree/cfac4311bc0b58053b8dead7bffbc036ba9bd5dc/gamedata>
- Revision: `cfac4311bc0b58053b8dead7bffbc036ba9bd5dc`
- Revision date: 2026-05-26
- Upstream description: “Update to 6.35”
- License: GNU General Public License v3.0; see `LICENSE.dom6inspector.txt`
- Used for: units and nation-recruitable commander/troop roles, magic sites and nation home-site references, nations, special plane IDs, site-location lookup values, and the generated province-name reservation set (playable nation names/epithets, nation home-site names, official plane names, and Nexus)
- Source paths: `gamedata/BaseU.csv`, `gamedata/MagicSites.csv`,
  `gamedata/nations.csv`, `gamedata/other_planes.csv`, and
  `gamedata/site_terrain_types.csv`; `gamedata/attributes_by_nation.csv` and
  `gamedata/attribute_keys.csv`; and the `fort_`, `coast_`, and `nonfort_`
  `leader_types_by_nation.csv` / `troop_types_by_nation.csv` tables

The large upstream CSV files are not copied into this repository. To reproduce
the compact bundle, download those thirteen files from the pinned tree into
`tmp/catalog-source/`, then run
`node scripts/build-dom6-catalog.mjs tmp/catalog-source`.

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
