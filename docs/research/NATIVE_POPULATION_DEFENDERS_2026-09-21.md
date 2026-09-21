# Population-matched initial defenders — native batch acceptance

Reviewed September 21, 2026. Registry **`dom6-6.37-native-2026-09-21-v3`** supports **76 population types**, including **41 of the 45 types used by the generator**, for declared **unmodded Dominions 6.37, Middle Age**. All claimed Sea/Cave combinations were included in the native trial. The option remains off by default, preserves custom guardians, and does not change recruitment or persistent PD.

The [released templates](../../src/catalog/data/population-defense-6.37-v3.json) are immutable fixed-count choices. The [82-row recruitment table](POPULATION_RECRUITMENT_TABLE_2026-09-21.md) establishes membership separately. The older v2 Pale One profile and empty v1 remain unchanged; saved projects must explicitly adopt v3.

## Native test and independent review

An isolated 240-province map contained 163 test provinces for 77 trial profiles, covering each proposed dry/water × Cave/non-Cave combination. Thirty-eight provinces in the two capital two-rings were protected. Targets were neutral, with no authored guardian arrays, forts, recruitment sites, raw overrides or thrones. Candidate armies were supplied to the production resolver/compiler/package exporter under a distinct test-only revision.

Native context was Windows x64 Dominions 6.37, no mods, Middle Age Ulm #60 human and Abysia #63 normal AI. New configuration, map and save directories were created beneath workspace temporary storage. Existing saves/settings were not modified. The game was created and hosted twice; each process exited successfully with empty stderr. A second independent agent correlated the manifest, emitted commands, native creation and both hosting logs by province and commander instance.

- All 163 map blocks emitted the exact proposed commander IDs, troop IDs and counts.
- All 163 native creation blocks reported the expected commander monster ID and province, with correlated squad names/counters.
- All 163 commander instances appeared in the same province with positive HP after leadership validation in both hosts. This confirms survival through the first complete shape/drowning/aftermath cycle.
- No candidate-specific battle, damage, negative-HP or reassignment evidence appeared. The second host's battle concerned a protected control province, not a trial target; it reported no recycled units or freed commanders.
- Mounted squads required explicit mount/rider-aware interpretation. Five ordinary cavalry can produce ten logged entities. Five two-rider Moose units produce fifteen; five three-rider Elephant units produce twenty. These are not extra authored recruits or failed counts.
- The first host's 9,180 purged units and 350 freed commanders matched the pre-existing random armies deliberately cleared by `#land` during creation. Those cleanup lines must not be counted as new-template casualties.

Population 43 remained held despite its successful creation/commander checks, leaving **76 released profiles and 161 accepted terrain cases**. Exact per-case commands, correlated counts, native line references and source hashes are retained in the [compact evidence matrix](POPULATION_DEFENDER_BATCH_6.37.json).

## Counts, scope and exclusions

Each template uses one listed recruitment commander and at most **15 total troops**, reduced to **8** where the evidenced limiting leadership is 10. Multiple troop types share that total approximately evenly, with remainders following recruitment-table order. This is transparent variety, not combat-equivalent army strength. It does not scale with Dominions' independent-strength setting.

Aquatic-only templates are restricted to water. Six ordinary amphibious populations have separately tested dry and water cases. Pale Ones #81, Cavemen #84 and Zotz #93 initially require dry Cave terrain. Other accepted profiles were tested in both Cave and non-Cave terrain for every allowed medium. Check the UI's **Verified template scope** for each profile.

| Unsupported population | Why native defenders remain |
| --- | --- |
| 43 — Onyx Amazons | Nightmare Rider's undead mount creates an unresolved special-leadership question. Generic host success is insufficient. |
| 44 — Troglodytes | Recruitment lists a troop but no commander; no leader is invented. |
| 72 — Mermen | Land/water forms require targeted shape-transition acceptance. |
| 88 — Ko-Oni | Demon leadership and the spirit/death form need targeted acceptance. |
| 105 — Wet Ones | Commander/troop land-water transformations need targeted acceptance. |
| 106 — Nexus | The recruitment roster is empty; no empty replacement army is emitted. |

The 45 generator populations are `25,26,27,28,29,30,31,34,37,39,40,44,45,48,49,50,51,52,53,54,55,56,57,58,59,60,63,64,65,72,73,81,84,89,90,91,92,93,94,95,96,97,98,105,106`. Unsupported generator members are 44, 72, 105 and 106. Coverage still depends on terrain, declarations and start/custom-guardian exclusions.

## Evidence limits

Native squad logs print names and counters, not independent numeric troop IDs. Exact IDs come from the emitted map commands and the separately verified membership catalog. The logs do **not** expose a complete post-turn troop census or final squad assignment dump. No exact final troop-count claim, combat calibration, all-era support, runtime mod compatibility, or persistent-PD replacement is made.

The separate [Inferno battle/capture control](NATIVE_GUARDIAN_CAPTURE_2026-09-21.md) successfully exercised an existing generated guardian encounter and subsequent Lava-born recruitment/PD inspection. It is not a battle-balance trial for all 76 ordinary templates.

## Reproduction pins

| Artifact | SHA-256 |
| --- | --- |
| Windows 6.37 executable | `d77cd364fe447e85e564cdd9460fcb5591f7e0b2089d6e58e9d2f2d907ee294c` |
| Original 77-profile candidate input | `12b54585a3f31c82f68136f3371c7cf5f7a93a584e528202f8842ead19ff047a` |
| Trial map | `f8a71a1228edc7fc19d4a95ae7f95d6bb7575782daf38b0624e79f6d6d52d599` |
| Creation log | `0cce2c9b1711c5faadb18ed584cf12a29e97d26d04657df00a0feca7a357b6a3` |
| First host log | `6acfa606468ec15f21b5ab3e894a82e3e6f2cfabbd344045dd797f60229d383e` |
| Second host log | `d973029e4bf2c7daa2d35b281ed9393af8d7537e7b4496d31fb87bb9817c9499` |

The extraction CLI requires the exact installed executable and pinned source data; it is never run during normal application use. Regression tests independently exercise every released terrain scope, source membership, immutable revisions, manual population edits, disabled-export parity and start/custom-guardian safeguards. Neither those tests nor a clean process exit alone establish native troop survival or multiplayer balance.
