# Static population recruitment table — 21 September 2026

The versioned [membership catalogue](../../src/catalog/data/population-recruitment-6.37.json) contains all 82 documented population types, IDs 25–106, and 175 referenced unit identities. It records the default recruitment lists found in one exact Windows x64 Dominions 6.37 executable. It is **not** an initial-army registry, a province-defence table, or a combat-balance model.

This follow-up closes the earlier source-availability gap in [the population evidence checkpoint](POPULATION_RECRUITMENT_EVIDENCE_2026-09-21.md). Inspector provides unit identities but no population roster relationship. The new relationship was independently identified through read-only static-file inspection, then checked against separate [native recruitment observations](NATIVE_RECRUITMENT_BATCH_2026-09-21.md).

## Reproduce without modifying the game

The optional [command-line extractor](../../scripts/catalog/extract-population-recruitment.mjs) requires an installed, licensed copy of the exact reviewed build and the exact pinned `BaseU.csv`. It is not run during application startup, installation, generation, normal tests or the build.

```text
node scripts/catalog/extract-population-recruitment.mjs --game-version 6.37 --exe "PATH/TO/Dominions6.exe" --catalog "PATH/TO/BaseU.csv"
```

Paths are explicit; there is no installation discovery or default game location. `--help` needs no game files. Successful execution prints deterministic catalogue JSON to stdout. Errors go to stderr, exit nonzero and produce no partial JSON. The tool opens both files read-only, checks exact lengths, performs bounded reads and verifies hashes. It never starts the game, inspects live process memory, changes settings or saves, downloads dependencies, writes game files, or enables defense profiles. Save stdout to a separate review file if comparing a fresh extraction with the committed catalogue.

The separately importable [pure decoder](../../scripts/catalog/population-recruitment-decoder.mjs) accepts bytes and ID/name maps without filesystem access. Its malformed-record tests do not require Dominions to be installed.

## Exact inputs and layout

| Input | Pin |
| --- | --- |
| Game build | Dominions 6.37, Windows x64 |
| Executable length | 76,009,984 bytes |
| Executable SHA-256 | `d77cd364fe447e85e564cdd9460fcb5591f7e0b2089d6e58e9d2f2d907ee294c` |
| Inspector revision | `c30c6c14e18ab284415d599b81579af9b3070112` |
| `BaseU.csv` length | 2,504,944 bytes |
| `BaseU.csv` SHA-256 | `185675d8906b87dc94070d52776e19cfefec4d2efcee9b6e8084aeba059e4ec5` |

The population table begins at **file offset `0x3091c50`**. Record `p` starts at `0x3091c50 + p × 168`. Each record holds 42 signed, little-endian 32-bit integers:

```text
troop IDs, -2, commander IDs, -1, zero padding
```

The catalogue preserves both role lists in their original order and records each separator/terminator slot. Positive IDs must resolve exactly. A role may be empty, and an ID may occur in both roles: Hoburg population 75 includes unit 1196 in each. Neither a unit's name nor its ordinary leadership field determines its recruitment category.

Indexes 0–24 are delimited empty entries. The 82 documented entries occupy indexes 25–106. Indexes 107–249 contain all-zero reserved storage, which must **not** be interpreted as verified empty recruitment lists. A separate 68-byte-stride attribute/PD candidate is not used here.

All 175 referenced IDs also match the installed monster-name records and the pinned [Inspector unit table](https://github.com/larzm42/dom6inspector/blob/c30c6c14e18ab284415d599b81579af9b3070112/gamedata/BaseU.csv). The name-record base `0x032ee3f8`, 888-byte stride and one-based ID indexing follow the published [dom6utils layout constants](https://github.com/larzm42/dom6utils/blob/fcb98596a4c092be2c8e8f0b5aae7fa4592d3eab/src/dom6utils/Starts.java); the [monster extractor](https://github.com/larzm42/dom6utils/blob/fcb98596a4c092be2c8e8f0b5aae7fa4592d3eab/src/dom6utils/MonsterStatIndexer.java) establishes ISO-8859-1 name decoding. That upstream extractor does not export the population table.

## Independent native controls

Controls were observed in unmodded Middle Age, human MA Ulm #60, outside capital rings, with labs and temples but no forts or recruitment sites. Source-based numeric identification is distinguished from a native numeric-ID panel.

| Population | Troops, in observed order | Commanders | Identification evidence |
| --- | --- | --- | --- |
| 44 — Troglodytes | 447 | None | Native troop-only list; unique Troglodyte name |
| 65 — Ichtyids | 974, 975 | 976 | Native Sea roster/order and distinctive equipment |
| 81 — Pale Ones | 1465 | 1463 | Prior native numeric-ID panels |
| 84 — Cavemen | 1615 | 1616 | Unique names and attributes, including leadership 10; no numeric-ID panel claimed |
| 89 — Fir Bolg | 1749, 1758, 1756 | 1750 | Native Plain roster/order and exact equipment |
| 93 — Zotz | 2504 | 2505 | Camazotz variant distinguished by leadership 50/50, MR13 and Death1 |
| 94 — Lava-born | 2510 | 2511 | Unique names and attributes, including leadership 50; no numeric-ID panel claimed |
| 106 — Nexus | None | None | Native empty commander and troop lists |

For population 65, the unarmoured Ichtyid has Net and Stone Spear. The Warrior has Stone Spear and Turtle Shell Hauberk, Turtle Shell Shield and Turtle Cap. The Lord has Bone Trident and the same armour set. Population 89 distinguishes Bronze Spear Militia, Sling/Bronze Dagger Slingers and Bronze Axe Warriors; the Champion has Bronze Sword and Javelin. Equipment IDs/names are joined to the same pinned [weapons](https://github.com/larzm42/dom6inspector/blob/c30c6c14e18ab284415d599b81579af9b3070112/gamedata/weapons.csv) and [armour](https://github.com/larzm42/dom6inspector/blob/c30c6c14e18ab284415d599b81579af9b3070112/gamedata/armors.csv) tables. Displayed totals may include equipment or host modifiers; this control does not assert that every rendered stat equals a raw `BaseU.csv` value.

## Failure boundaries and remaining acceptance

Extraction stops on an unknown version, changed length/hash, malformed header, duplicate or invalid catalogue IDs, unresolved members, incorrect or repeated delimiters, duplicate members within one role, nonzero trailing padding, changed reserved boundaries, mismatched installed/catalogue names, or a failed native control. Future patches and other platforms need independently reviewed pins and layouts; there is no offset-search fallback in the release tool.

One population-indexed default table was identified, with no era field or alternative era block in these records. This does not rule out runtime era, terrain, nation or mod overrides. Native control coverage remains Middle Age and the specific tested terrain contexts. A recruitment list also does not establish leadership capacity, survival in every medium, initial-army counts, post-capture PD, conquest difficulty or multiplayer fairness. Troglodytes' missing commander and Nexus's empty roster must not be filled with invented leaders or empty replacement armies.

Defense-profile promotion remains a separate workflow requiring suitable leadership, habitat checks and actual native army acceptance. Reading or rebuilding this evidence catalogue does not alter existing or generated guardians, starts, terrain, map generation, or the opt-in policy registry.

## Provenance and distribution

Only factual IDs, short names, layout metadata, checks and evidence notes are distributed. No executable bytes, sprites, artwork, descriptions or third-party implementation are included. The extraction implementation is original project code. Unit-name cross-references retain attribution to the GPL-3.0 Inspector snapshot and the existing [upstream licence file](../../src/catalog/data/LICENSE.dom6inspector.txt); public availability does not change upstream licensing. The installed game is a separate prerequisite for re-extraction, not part of this repository or installer.
