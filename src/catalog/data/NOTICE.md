# Dominions catalog notices

`dom6-6.37.json` is a compact, generated selector index. It contains only the
fields needed by Pantokrator Atlas: factual numeric IDs, display names, site
location/path/rarity/home metadata, unit recruitment roles, nation labels, and
plane lookup values.

## Dom6 Inspector data

- Repository: <https://github.com/larzm42/dom6inspector>
- Pinned source tree: <https://github.com/larzm42/dom6inspector/tree/c30c6c14e18ab284415d599b81579af9b3070112/gamedata>
- Revision: `c30c6c14e18ab284415d599b81579af9b3070112`
- Revision date: 2026-09-18
- Upstream description: “Update to 6.37.”
- License: GNU General Public License v3.0; see [LICENSE.dom6inspector.txt](LICENSE.dom6inspector.txt)
- Used for: units; commander/troop roles from nation and magic-site recruitment slots; magic sites and nation home-site references; nations; special plane IDs; site-location lookup values; and the generated province-name reservation set (playable nation names/epithets, nation home-site names, official plane names, and Nexus)
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
native evidence. The Inspector export contains no population roster table.

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
