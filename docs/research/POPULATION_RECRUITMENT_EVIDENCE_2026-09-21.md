# Population recruitment evidence — 21 September 2026

This is a research checkpoint, not a complete vanilla recruitment catalogue or a balance recommendation. It distinguishes a population's recruitable roster from its randomly generated initial defenders and from purchased province defence.

## Current coverage

The native verification session reported one exact roster in unmodded Dominions 6.37: the MA Ulm control game `r21`, province 65, dry Cave terrain, population type 81. Its recruitment screen contained commander **1463 Pale One Commander** and troop **1465 Pale One**, with both IDs checked in the native detail panels. Commander leadership was ordinary 75, magical 0 and undead 0. This source-research pass did not operate or repeat the native session.

| Priority population | Current recruitment evidence | Safe treatment at this checkpoint |
| --- | --- | --- |
| 81 — Pale Ones | Native observation above; current identity and traits corroborated below; native initial-army check below | v2 template: unmodded 6.37, Middle Age, dry Cave only |
| 94 — Lava-born | Official population label only | Preserve engine defenders; roster unverified |
| 44 — Troglodytes | Official population label only | Preserve engine defenders; roster unverified |
| 84 — Cavemen | Official population label only | Preserve engine defenders; roster unverified |
| 88 — Ko-Oni | Official population label only | Preserve engine defenders; roster unverified |
| 93 — Zotz | Official population label only | Preserve engine defenders; roster unverified |
| 106 — Nexus | Official population label only | Preserve engine defenders; roster unverified |

The labels come from the [official modding manual, Poptype Modding](https://www.illwinter.com/dom6/dom6modman.pdf). An unverified roster is **unknown**, not empty. The subsequent implementation promotes only the narrowly scoped population-81 template described below; the source-research pass alone did not establish engine acceptance.

## Follow-up catalog-only verification

The September 21 follow-up checked the bundled catalog against all thirteen hash-pinned Inspector 6.37 input files. All **4,091 unit IDs and exact names** match `BaseU.csv`, with no duplicate numeric IDs. All **82 population records** have the expected sequential IDs 25–106. The **45 distinct population IDs** in the generator's archetype, variant and aquatic pools all resolve to catalog labels. All **75 distinct guardian unit IDs** exist, and all **45 listed water-capable guardians** retain an Aquatic, Amphibian or Poor Amphibian source flag. These are identity and habitat checks, not recruitment-membership, leadership-capacity or combat acceptance for every guardian army.

The compact population records contain only an ID and label. The full unit table has 535 columns but no population-membership column. The pinned upstream repository tree and its data-loading source were also checked: recruitment relationship files concern nations or sites, not population types. This catalog-only pass therefore establishes **no additional population recruitment rosters**. All other 81 population types remain unsupported by the automatic-defender registry.

The following are exact unit facts from the pinned [unit table](https://raw.githubusercontent.com/larzm42/dom6inspector/c30c6c14e18ab284415d599b81579af9b3070112/gamedata/BaseU.csv), found by searching the relevant names. They are candidates for membership verification, **not asserted population rosters or proposed army templates**.

| Population label | Catalog-confirmed unit facts | Remaining uncertainty |
| --- | --- | --- |
| 44 — Troglodytes | Troglodyte #447; Troglodyte Lord #1461 has ordinary leadership 10; Troglodyte Trainer #2483 has ordinary leadership 20 | Which commanders and troops belong to this population, rather than national recruitment |
| 84 — Cavemen | Caveman #1615; Caveman Champion #1616 has ordinary leadership 10 | Recruitable roles, population membership and roster completeness; copying the Pale One template's 15 troops would exceed that base leadership |
| 88 — Ko-Oni | Two distinct Ko-Oni records, #1260 and #1836, both flagged Demon and each with a different second-shape ID | Correct population variant and recruitable commander membership |
| 93 — Zotz | Zotz #2504; Zotz Batab #2733 has ordinary leadership 75; Camazotz has multiple distinct IDs (#2505, #2681, #2719, #2754) | Correct population variants, commander choices and completeness |
| 94 — Lava-born | Lava-born #2510; Lava-born Commander #2511 has ordinary leadership 50 | Population membership and completeness; matching names alone do not establish either |
| 106 — Nexus | The population label exists; no unit record has the exact name Nexus | The label cannot identify its commander or troop roster |

Blank source fields were kept unknown rather than converted to zero. A unit's ordinary leadership field does not establish that it appears in the commander recruitment row. The same caveat applies to national/site role tags. As further examples of name ambiguity, Commander has five IDs and Heavy Infantry has five IDs in this snapshot.

The focused catalog, catalog-UI and real-profile suite passed **33 tests** after this check. No population profiles, gameplay data or default armies were changed by the audit. Remaining membership verification requires a current, separately verified population-to-unit table or controlled native recruitment observations; further manual user review was not requested.

## Exact current unit evidence

The [Inspector 6.37 commit](https://github.com/larzm42/dom6inspector/commit/c30c6c14e18ab284415d599b81579af9b3070112) is pinned to `c30c6c14e18ab284415d599b81579af9b3070112`, dated 18 September 2026. Its tab-delimited [BaseU.csv](https://raw.githubusercontent.com/larzm42/dom6inspector/c30c6c14e18ab284415d599b81579af9b3070112/gamedata/BaseU.csv) has SHA-256 `185675d8906b87dc94070d52776e19cfefec4d2efcee9b6e8084aeba059e4ec5`.

- Row `id=1463` has name `Pale One Commander` and `leader=75`; `undeadleader` and `magicleader` are blank. The native observation establishes the displayed zero special capacities rather than assuming every blank numeric field means zero.
- Rows 1463 and 1465 have `amphibian=1`, `neednoteat=1`, `darkvision=100`, and `coldblood=1`. Their `aquatic`, `undead`, `demon`, `magicbeing`, `inanimate`, and `mind` flags are blank.
- These traits corroborate an ordinary living troop and dry-cave survival. Amphibious capability does **not** establish underwater recruitment membership. Row 1465 also has a leadership value, which does **not** make it a recruitable commander; the native recruitment category establishes its role.

A selected troop count no greater than the observed command capacity avoids that capacity overflow; it is not a proof of fair difficulty. Do not infer initial-army counts from recruitment cost fields or reuse independent-strength formulas. The observation covers MA only; the profile requires an explicit Middle Age host declaration and does not extrapolate to other eras.

## Native initial-army acceptance

The installed binary reports `Dominions 6, version 6.37 (Sep 8 2026 17:44:22)`. A separate 32-province fixture, `Atlas_PaleOne_Initial_1sd9wo`, was compiled with a test-only injection of the proposed v2 template. Province 3 has dry Cave terrain and population type 81; it lies outside both capital two-rings. The source province has no authored guardian group. Its emitted army is one `#commander 1463` followed by `#units 15 1465`.

The fixture's map SHA-256 is `FE54099CF54A95CB2D8B986DB645005C14CFAD0958A2C612FF52E80E9830F983`. Scripted native creation and hosting ran under newly created workspace-only configuration, map and save directories, with no mods, Middle Age, human Ulm 60 and AI Abysia 63. The human pretender was copied from the disposable `r21` test; that save and existing user maps/configuration were not modified.

Both `--newgame` and `--host` exited successfully with empty stderr. The native creation log records, in order:

```text
popgang 0 1463 0
newcom: mnr 1463, lnr 3, unr 1489
startagemagic for Earthfinger the Pale One Commander
squad with 'Pale One' (k 15, arc 15, fly 0) got preord 2
```

The subsequent native host completed its turn, including `validateldrlimits`, and recorded that commander alive with 22 HP in province 3. This establishes actual army instantiation and squad assignment, beyond parsing a valid map file. Dry-medium suitability is additionally supported by the pinned unit traits above. It does **not** establish calibrated combat difficulty, underwater recruitment, post-capture PD, or acceptance of other population types. Exact post-turn troop counts and an attacking battle have not been separately observed.

Local evidence is retained under `tmp/population-native-kAD4KZ/`: creation-log SHA-256 `D98E225575244CAA7505C55F56DDF6327A65803193E8396C43BC8482ECDCE428`; host-log SHA-256 `C151074792F4A5F07584DAFB479F6824E3E94B187C4EBCB97CCB6AC136BE7ACD`. Full native logs are not distributed because they contain machine-local details. Counts of 15 are an explicit fixed template choice, not a copied game formula or an independent-strength guarantee.

The first usable revision is `dom6-6.37-native-2026-09-21-v2`. The previously exposed empty v1 remains unsupported; saved maps do not silently acquire armies when data is added. Patch, era, mods, exact catalog identities, terrain and protected-start checks must all pass before exporting this template. Custom guardians are never replaced.

## Why existing bulk sources do not fill the gap

The pinned [Inspector data-loading source](https://github.com/larzm42/dom6inspector/blob/c30c6c14e18ab284415d599b81579af9b3070112/scripts/loaddata.js) and repository tree expose units, sites, national recruitment relationships and other records, but no population-to-recruitment membership table. They can validate many known unit IDs at once; matching names or national recruitment does not recover population membership.

The current extractor was also checked at [dom6utils revision fcb98596a4c092be2c8e8f0b5aae7fa4592d3eab](https://github.com/larzm42/dom6utils/tree/fcb98596a4c092be2c8e8f0b5aae7fa4592d3eab). Its [entry point](https://github.com/larzm42/dom6utils/blob/fcb98596a4c092be2c8e8f0b5aae7fa4592d3eab/src/dom6utils/Dom6Utils.java) invokes no population indexer, and [Starts.java](https://github.com/larzm42/dom6utils/blob/fcb98596a4c092be2c8e8f0b5aae7fa4592d3eab/src/dom6utils/Starts.java) supplies no population table offset or layout. Simply rerunning that extractor cannot produce the missing relationship.

[Loggy's historical EA independent-army study](https://illwiki.com/dom5/user/loggy/indies-ea) explicitly concerns generated defenders. It is useful for choosing test candidates, not for proving current recruitment lists. In particular, the [official map-making manual](https://www.illwinter.com/dom6/dom6mapman.pdf) distinguishes changing `#poptype` from replacing initial units. An unrelated army observed after setting population 94 therefore does not establish a wrong population ID.

## Practical next source-based step

No ready-to-run, current public bulk membership exporter was established in this bounded search. The missing input is a versioned table separating recruitable commander IDs from troop IDs, not another monster catalogue.

If a maintainer provides that table, or a separately reviewed extractor gains a documented current-version population layout:

1. Record the exact game build, source revision and data hash; keep commander and troop membership separate from PD and initial-army definitions.
2. Join by exact numeric IDs to the pinned unit data. Validate expected names, provenance, leadership categories, habitat and transformations. Reject unresolved or conflicting rows.
3. Calibrate the extractor against the native type-81 control and additional distinct populations before accepting bulk rows. Record era, terrain, mod set, sites, buildings and nation as test conditions.
4. Publish only supported, version-pinned templates. Unsupported populations must retain normal engine behaviour; profile counts remain explicit design choices, not claimed vanilla army formulas.

The existing MA Ulm fixture avoids the known Arcoscephale non-fort Hiereia addition. Population specimens must remain outside capital rings, without forts or recruitment sites; labs and temples may expose genuine population mages and priests. Nation, terrain and site additions must never be mistaken for the population roster.

## Provenance and copying boundary

The [Inspector licence](https://github.com/larzm42/dom6inspector/blob/c30c6c14e18ab284415d599b81579af9b3070112/LICENSE) is GPL-3.0; dom6utils source notices specify GPL v3 or later. This note records narrow factual observations and links; it imports no third-party implementation, sprite or bulk table. Any future redistribution must retain the applicable upstream provenance and notices rather than assuming the project's own licence changes them.
