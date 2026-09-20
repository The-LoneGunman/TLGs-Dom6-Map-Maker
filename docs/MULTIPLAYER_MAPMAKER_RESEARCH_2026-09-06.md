# Multiplayer mapmaking: comparative research and improvement plan

Research date: 2026-09-06. Atlas baseline: application v0.1.4 at [ba19a51](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/commit/ba19a5147930828827a02ece88b013c7aea71050).

This is a historical research and design proposal, not a record of implemented features or a claim that a map is competitively balanced. It compares creator documentation and selected source code, inspects Atlas at the baseline above, and records bounded in-memory diagnostics. Competing applications were not installed or benchmarked, and no new Dominions multiplayer sessions or participant usability studies were conducted. See [implementation status](MULTIPLAYER_IMPLEMENTATION_STATUS.md) for what has since been built; competitor descriptions and proposed targets below remain dated research, not fresh verification.

## Main conclusion

Atlas already has substantial generation, multi-plane, editing, validation, and export capabilities. Its highest-value next step is to make those capabilities easier to reason about: show what will change, explain what the balance analysis actually measures, and let users improve one part of a map without losing the rest.

The recommended direction is **a simple default workflow with inspectable advanced controls**, not a larger first screen of sliders. Fairness should mean comparable opportunities under declared assumptions, not identical geography, equal nation strength, or a high aggregate score.

Nation-specific accommodations must remain optional and tied to a verified game/mod ruleset. Patches can invalidate recruitment requirements, movement assumptions, guardian difficulty, and economic estimates. No permanent nation-strength tier list should drive map generation.

## 1. What other mapmakers offer

These are relevant capabilities documented by their creators, not a ranking of popularity, reliability, aesthetics, or match outcomes.

| Tool | Evidence relevant to this project | Opportunity for Atlas |
|---|---|---|
| MapNuke for Dominions 5 | The legacy creator page describes nation selection, generic starts, disciples, editable layouts, manual province/connection editing, and terrain-distribution controls. It explicitly identifies this edition as Dom5-only and no longer receiving the latest codebase changes. | Reusable layout recipes and a player/team roster, while preserving generic starts. [Creator page](https://nuke-haus.itch.io/mapnuke) |
| MapNuke 2 for Dominions 6 | Its creator documents editable nation/layout data, clustering underwater nations, labeled previews, and advanced generation settings. Its published changelog includes separate cave-water ranges. | Separate ocean topology from aquatic-player placement; expose per-terrain ranges and per-plane overrides. [Creator page](https://nuke-haus.itch.io/mapnuke-2) |
| Cartographic Revision 2.2 | Nation-oriented setup and age-sensitive terrain distributions; native D6M output. The August 2026 notes describe rejecting exports with undersized capital surroundings and clarifying intended player/throne counts. | A concise setup flow, declared start-region requirements, and clear host-setting expectations. Its nation-specific approach should not become an unversioned balancing rule in Atlas. [Creator page](https://corbeau.itch.io/cartographic-revision) |
| DreamAtlas | Its creator documents regional generation, inspection lenses, an object explorer, map import/editing, and land/water/cave economic controls. Disciples support is described in version 1.2; the 2.0 UI rewrite is listed as upcoming. Per-stage reseeding is described as code-level functionality, not a confirmed one-click GUI feature. | Regional planning, analytical overlays, and scoped regeneration. Do not describe planned competitor features as shipped. [Creator page](https://tlaloca.itch.io/dreamatlas) |
| Native Dominions 5/6 tools | The official manuals describe terrain proportions, wrapping, province/connection editing, and the need to inspect generated connections. Dom6's native generator uses D6M geography. | Retain straightforward native export and provide a useful inspection/repair workflow, rather than assuming generation removes the need to review a map. [Dom5 manual](https://www.illwinter.com/dom5/mapmanual.html), [Dom6 map manual](https://illwinter.com/dom6/dom6mapman.pdf) |
| Dominions 6 Arena Map Tool | A narrowly focused flow selects nations, configures commanders/units, and exports a package. Its page explicitly warns about missing age and land/water validation. | A later isolated battle-test workflow for guardian templates; useful task-focused design, not evidence of multiplayer-map balance. [Tool and instructions](https://utils-dom5.com.de/dom6/arena-mapgen/) |

Source inspection supports the distinction between coarse and granular control. MapNuke's settings define separate terrain, lake, cave-lake, size-modifier, river, road, and pass frequency ranges, and its settings UI binds corresponding fields. Its nation model contains capital terrain, surrounding terrain, underground-start, and entrance information. These are useful examples of inspectable data, not authoritative balance facts for future patches. [Generator settings](https://github.com/nuke-haus/mapnuke/blob/master/Assets/Scripts/WorldGen/GeneratorSettings.cs), [settings UI](https://github.com/nuke-haus/mapnuke/blob/master/Assets/Scripts/Interactive/SettingsManager.cs), [nation model](https://github.com/nuke-haus/mapnuke/blob/master/Assets/Scripts/Data/NationData.cs).

DreamAtlas's settings separately represent homeland size, capital connections, neighboring players, periphery size, and different region types. This is a particularly relevant distinction: province-level branching and the number of neighboring empires are different controls. [Settings model](https://github.com/DreamTlaloc/DreamAtlas/blob/main/DreamAtlas/classes/class_settings.py).

### Authored maps as reference cases

Pymous's own porting thread lists Biddyn, Biddyn Deep, Peliwyr, Snerdryn, and Edowyn, with differing land/sea/cave counts. Biddyn Deep adds 20 caves to 81 land and 9 sea provinces; Snerdryn lists 127 land and 20 sea. These are useful reference cases for different world compositions, not proof that one province/player ratio suits every roster. [Author's map thread](https://steamcommunity.com/app/2511500/discussions/2/4139438760457376903/).

A future reference gallery should describe a map's intended player mix, wrapping, regional structure, cave access, and early-conflict pressure. Use graph and layout motifs as inspiration. Do not mistake an attractive screenshot, subscription count, or an author's recommended player range for a measured balance guarantee.

## 2. Atlas: existing strengths and material gaps

The baseline below was checked against the [guide at that revision](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/ba19a5147930828827a02ece88b013c7aea71050/docs/USER_GUIDE.md), [settings model](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/ba19a5147930828827a02ece88b013c7aea71050/src/domain.ts#L292), and [editor implementation](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/ba19a5147930828827a02ece88b013c7aea71050/src/MapMakerApp.tsx).

| Area | Already present | Improvement still needed |
|---|---|---|
| Entry and delivery | Hosted GUI, Windows installer, portable release, direct map installation and ZIP | A compact guided first-map path; a task-oriented distinction between project backup, playable map, and preview |
| Generation controls | Five ocean layouts, cohesion, three economy policies, three overland topology policies, core/bonus sizing | Reusable complete recipes; terrain/connection ranges; per-plane overrides; transparent requested-versus-effective values |
| Starts | Five categories, scaling separation, per-plane reservations, cave-nation assignments, manual specific/team starts | A unified optional roster and team-aware analysis; explicit capital-region requirements |
| Multi-plane worlds | Eight authored planes, themed defenders, flooded caves, Styx, configurable gate networks | Regional difficulty/reward controls and comparisons of access to bonus realms |
| Editing | Per-province flags, guardians, sites, economy, borders, gates, Undo/Redo | Search/jump, multi-selection, batch edits, locks, and scoped regeneration |
| Inspection | Live headline scores, warnings, validation navigation, condition previews, host topology report | Per-start comparisons and analytical map lenses; condition previews are currently cosmetic |
| Reuse | Atlas project JSON and separately imported catalogs | Settings-only recipe files; an external-map inspection/import path |
| Data provenance | A pinned 6.35 selector catalog and provenance metadata | Ruleset-specific balance assumptions and explicit uncertainty; the selector index is not a complete combat/economic simulator |

Preserve the existing safety work: protected starts, validation, cancellation, transactional-style installation safeguards, recovery backups, and clear mod/native-format boundaries. Several apparent competitor features are already present in Atlas; ocean styles and soft/hard population correction do not need to be reinvented.

### The current score is a structural heuristic

The inspected implementation establishes these limits:

1. Expansion value sums `population / 1000`, plus 2 for farmland, within two graph steps. It also compares the number of nearby provinces. It does not calculate actual resources, recruitment points, income under scales, or conquest difficulty. Unspecified population contributes zero to this proxy; that is not an estimate of what Dominions will assign.
2. Global movement uses unweighted province connections and gates. It does not take a nation's capabilities or the configured sailing distance as inputs. Rivers and mountain passes are included unless explicitly impassable.
3. All identified starts participate in separation calculations. Team affiliation does not distinguish allied from hostile starts.
4. Throne access compares the number of preferred/fixed locations within four graph steps. It does not compare throne levels, defender difficulty, or guarantee which preferred sites the host's game setup will actually use.
5. Connected sparse planes can receive a full connectivity score despite very different branching and route redundancy. That is reasonable for a connectivity test, but does not measure strategic complexity.
6. Terrain variety and connectivity partly aggregate across the whole atlas. A huge bonus realm should not be allowed to obscure a weak core starting region in the headline presentation.

These conclusions come from [calculateFairness](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/ba19a5147930828827a02ece88b013c7aea71050/src/generator.ts#L4567), [globalMovementAdjacency](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/ba19a5147930828827a02ece88b013c7aea71050/src/generator.ts#L4760), and [population correction](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/ba19a5147930828827a02ece88b013c7aea71050/src/generator.ts#L4194).

Movement profiles matter because the game distinguishes ground, aquatic, amphibious, flying, and sailing movement, and conditional crossings depend on capabilities or conditions. Graph hops should not be labeled as actual conquest turns. [Official movement rules, manual p.48](https://www.illwinter.com/dom6/dom6manual.pdf), [official ability definitions](https://www.illwinter.com/dom6/dom6modman.pdf).

## 3. Diagnostic evidence from this review

These probes ran against Atlas functions in memory. They did not alter a saved project, application code, map installation, or hosted deployment.

### Four sensitivity probes

Seed: `research-20260906-score-probes`; six players, 96 provinces, otherwise fresh-project defaults.

The baseline had no validation errors and scored 90 overall, although throne access scored 68 and already produced an uneven-access note.

| In-memory change | Observed result |
|---|---|
| Add Demon General #1314 with 200 Demon Knights #489 to province 4, two graph steps from the nearest start | The entire fairness result remained identical; validation still reported no errors |
| Change sailing distance from 1 to 10 | The entire fairness result remained identical |
| Annotate the six generic starts as three two-player team groups | The entire fairness result remained identical |
| Change a standard edge away from capitals to a river | The entire fairness result remained identical |

These are reproducible demonstrations of what the score does not model. They do not establish that a particular army is unbeatable, that every sailing-distance change affects every roster, or that a river is closed in every game state.

### Twelve-map coverage sample

Four seeds each used these profiles:

- `default-ffa`: fresh settings, six Land starts.
- `island-mixed-water`: Island Chains, 48% water, two Land, two Coastal, two Water starts.
- `surface-cave-dream`: three Land, two Cave, one Other start; auto-sized Cave and Dream planes added before generation.

Seeds are `research-20260906-<profile>-1` through `-4`. All other settings remained at fresh-project defaults. The comparison graph removed aquatic provinces to represent a simple ground-only sensitivity check; it did not model seasons, flight, sailing, ownership, or battles.

| Profile | Map count | Total provinces per map | Overall score range | Maps with validation errors | Largest reduction in a dry start's two-step province count under the ground-only filter |
|---|---:|---:|---:|---:|---:|
| Default FFA | 4 | 96 | 89–94 | 0 | 8 |
| Mixed-water island chains | 4 | 96 | 90–95 | 0 | 13 |
| Surface/Cave/Dream | 4 | 104 | 91–92 | 0 | 9 |

Every sampled map had at least one dry start whose structural two-step region included water. Six of the twelve maps had a throne-access subscore of 68 while their overall score remained at least 89. This is a small diagnostic sample, not a representative failure rate or a comparative benchmark against other tools.

The actionable conclusion is to expose model assumptions and individual deficiencies, not simply to retune the aggregate score until it looks lower.

## 4. Proposed user experience

### A. A short default path, with an unrestricted expert workspace

Offer a compact first-map flow:

1. **Game:** free-for-all or teams; player count; generic starts by default; optional nation roster.
2. **World:** a visual recipe, core size, sea style, and optional planes.
3. **Review:** candidate map, assumptions, worst-off starting regions, and actionable warnings.
4. **Export:** host settings, playable package, and separate editable backup.

Experienced users should be able to enter the existing workbench immediately. Do not force repeated next/back navigation for interdependent roster, terrain, and size choices. Advanced controls should be grouped and reachable without hiding errors or deleting existing features. This combines a guided entry point with progressive disclosure, whose purpose is to defer infrequent choices without restricting capability. [NN/G: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/).

Initial recipes could include Balanced FFA, Team Frontiers, Naval Contest, Continental Rivalry, and Multi-plane Conquest. Each should state its intended roster range, typical conflict pressure, start policy, and known constraints. These are proposed recipes, not claims of universal optimal settings.

### B. Show scope and timing on every control

Use consistent labels: **next generation**, **edits current map**, **preview only**, or **export/host setting**. Keep a visible summary of pending generation changes alongside the last generated map.

Show a province budget with separate core, bonus, reserved-plane minimums, manually fixed sizes, and capacity-driven enlargement. Show requested and effective water/continent/guardian values where constraints cause adjustments. A size or roster change should explain its effect before the user commits to rebuilding geography.

Keep cosmetic condition previews separate from future movement-analysis lenses. Put terrain's readable flag summary ahead of the numeric bitmask. Label Biome as descriptive metadata or move it out of the primary gameplay controls. Consider renaming **Sites & PD** to **Sites & guardians**, keeping owned numeric PD under ownership/economy. These recommendations follow the current control semantics, not a proposed change to game rules.

### C. Make balance inspectable on the map

Add a searchable province/start explorer with local and global IDs and cross-plane jump links. Initial analytical lenses should show:

- Capital surroundings and protected zones.
- Exclusive versus contested expansion space.
- Resource/economic estimates, with assumptions and unknown values visible.
- Distance to rival starts, objectives, and realm entrances.
- Conditional routes, ocean access, bottlenecks, and alternate paths.
- Initial guardian locations, declared challenge tiers, and fixed versus merely preferred thrones.

Provide a per-player table behind every aggregate result. Clicking the weakest value should highlight the contributing provinces and routes. The existing [bridge-analysis helper](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/ba19a5147930828827a02ece88b013c7aea71050/src/generator.ts#L4531) and [host topology report](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/ba19a5147930828827a02ece88b013c7aea71050/src/hostReport.ts#L45) provide useful starting points.

Prefer three separate indicators to one reassuring number: **structural validity**, **selected profile targets**, and **analysis confidence**. Existing red errors must remain blocking regardless of scores. A low important subscore should remain visible even when the weighted average is high.

### D. Make warnings repairable

Warnings should identify the location, measured value, requested target, and likely trade-off. For example, a constrained start-region warning could offer an enlarged-core preview, a different start mix, or a reroll with preserved geography where supported.

Every repair should show an affected-object count and before/after comparison, respect locks, and be Undoable. Never silently relax a hard target to obtain a green result. This applies established error-prevention, visibility, and recovery principles to the mapmaking workflow. [NN/G: Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/).

## 5. Granular controls worth adding

| Control group | Proposed controls | Guardrails |
|---|---|---|
| Capital regions | Exact or target capital-neighbor count; protected-region depth; local terrain requirements/preferences; expansion-space target | Keep the current four-exit default unless testing supports changing it. Offer other counts explicitly; no universal five-province rule. Preserve separation and shared-surroundings protections. |
| Regional structure | Homeland size, contested frontier width, neighboring-empires target, regional barriers and alternate exits | Distinguish player-level contact from province degree. Preserve deliberate asymmetry within opportunity tolerances. |
| Terrain composition | Ranges for primary terrain types, separate additive-flag frequencies, regional cohesion and rare-feature distribution | Primary choices and overlapping flags are different distributions: additive flags need not sum to 100%. Show achieved counts after protected-region constraints. |
| Oceans and caves | Aquatic starts together/separate/paired; connected-sea targets; islands/lakes; flooded-cave share; wet/dry entrance policies | Do not equate ocean shape with fair aquatic-player allocation. Explain land access and sailing shortcuts under the selected movement assumptions. |
| Roads and barriers | Road, river, bridge and pass ranges; conditional-crossing allowance; regional loop density | Validate visible ownership and exported movement together. Treat a required Styx crossing as intended geography, not automatically a defect. |
| Bonus realms | Per-plane inherited or overridden size, guardian coverage/tier, reward density, entrance number/access policy | Keep start protections. Distinguish difficult conquest from local recruitment and replenishing PD. Do not claim troop count alone measures army difficulty. |
| Objectives | Preferred versus fixed placement; optional level-aware targets; frontier/central/realm objectives | Explain that preferred locations do not force the engine's final throne selection. Never conceal host-setting dependencies. |

Use project defaults with clearly marked plane/region overrides. Do not require users to configure every plane independently. A recipe should remain a short set of meaningful choices; the advanced groups expose detail only when wanted.

### Safer iteration and reuse

- **Locks and scoped rerolls:** preserve geography, starts, selected provinces, names, or authored forces while changing permitted content. Dependency changes must be explicit: moving a start may require clearing or relocating nearby generated thrones/guardians; changing geography can invalidate downstream features. Refuse contradictory locks instead of ignoring them.
- **Candidate comparison:** generate a small, bounded set of distinct alternatives and compare trade-offs. Avoid selecting exclusively by the current overall score. Store the recipe, generator version, component seeds, and ruleset with the chosen result.
- **Batch editing:** select a region or filtered set, preview a change count, apply an atomic Undoable edit, and rerun affected checks. Explicitly distinguish adding flags from replacing terrain.
- **Settings-only recipes:** save/share configuration without duplicating a whole map. Keep editable projects as the exact geography/content backup.
- **Project library:** named local projects and recovery snapshots, building on existing autosave. Do not introduce cloud synchronization or telemetry by default.
- **External-map interoperability:** begin with read-only `.map`/`.d6m` inspection and an unsupported-command report. Add editable import incrementally; do not promise lossless import of all custom image maps or raw directives. Native geography is distinct from the preview artwork. [D6M specification](https://illwinter.com/dom6/dom6fileformats.pdf).
- **Host/player exports:** offer a host package and a player handoff that omits unnecessary editable projects, diagnostic dossiers, and annotated spoilers. Explain that playable map files can themselves reveal information; this is spoiler reduction, not secrecy or anti-cheat protection.

## 6. Patch-aware nation handling

This requirement applies to movement and economic assumptions as well as named-nation templates.

### Separate three kinds of information

1. **Neutral map properties:** topology, declared terrain, starts, ownership, gates, and structural constraints.
2. **Ruleset-dependent facts:** IDs, recruitment locations, movement capabilities, and economic rules verified for a particular game/mod combination.
3. **Balance opinions:** suggested forest access, resource budgets, guardian challenge, or other accommodations. These must be optional, editable, and labeled as recommendations.

Atlas currently bundles an ID/selector snapshot, not enough authoritative data to infer every nation's expansion or recruitment needs. Its generation model explicitly notes the absence of an authoritative cave-capability flag. The existing minimum map-format version must not be mistaken for a fully specified game-patch balance profile. [Catalog boundary](CONTENT_CATALOG.md), [generation model](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/ba19a5147930828827a02ece88b013c7aea71050/src/domain.ts#L292).

### Proposed versioning contract

Each project/recipe should record the selected game version, enabled mod identifiers and versions or hashes where available, data snapshot, optional nation-profile version, generator version, and verification status. The browser cannot be assumed to detect the user's installed game or mods automatically.

- Default to neutral, generic map balancing. Selecting a nation must not silently enable terrain or resource compensation.
- Offer optional compatibility checks and separately opt-in accommodation profiles.
- Unknown or mismatched rulesets retain structural analysis but clearly mark unsupported estimates. Missing information is **unknown**, not zero, safe, or balanced.
- Treat a newer patch as unverified until the relevant profile has been rechecked. Allow an explicit host override, retained in the exported report; do not silently claim the old profile applies.
- Updates should show changed assumptions and offer reanalysis. Never automatically regenerate or rewrite an existing saved map.
- Retain old profile snapshots for reproducibility. A new version should create a new analysis result, not revise historical evidence in place.
- Keep user/mod-supplied profiles visibly distinct from verified bundled data. Schema validity does not authenticate a profile's claims.
- Separate terrain compatibility from attempts to equalize nation strength. Do not compensate for presumed metagame tiers by granting hidden extra provinces or income.

A patch review should include ID validation, relevant movement/recruitment examples, guardian-template checks, a fixed regression corpus, and engine-load tests. Empirical claims about expansion difficulty need battle or playtest evidence under the new ruleset. No automatic process can certify that a patch has left the multiplayer metagame unchanged.

## 7. Metrics and proposed acceptance targets

The numerical targets below are initial product hypotheses for a **neutral competitive FFA profile**, not published community standards or promises already met. Calibrate them with hosts and actual games. Team, naval, and challenge profiles need different targets.

Use exact values where they are known, model-based estimates where justified, and an explicit unknown state otherwise. Show both the group spread and the worst-off start; an average alone can hide an outlier.

| Dimension | Measurement | Initial target or rule |
|---|---|---|
| Structural safety | Valid identifiers/geometry, start compatibility, protected contents, supported package structure | Zero violations in every exported candidate; scores never override errors |
| Capital surroundings | Reliable legal neighbors for the chosen baseline movement profile; shared directly connected surroundings | Meet the preset's declared minimum, normally the current four; spread at most one; zero shared surroundings in the strict neutral profile |
| Start spacing | Nearest hostile-start distance; scaled target; distance spread | Preserve the existing hard three-hop structural floor. Separately test profile-specific shortcuts; target a nearest-hostile spread no greater than one graph step where feasible |
| Practical expansion | Reachable province opportunities at two and three steps, split into exclusive and contested access | Initial within-profile coefficient of variation no greater than 15%; show counts and worst shortfall, not only a grade |
| Economy/resources | Separate population/income potential, recruitment resources, and other justified estimates in accessible regions | Initial within-profile CV no greater than 15% for supported estimates; never substitute population equality for resource equality |
| Throne access | Planned/confirmed status, distance to first objectives, nearby counts, known level/value and defenders | Target nearby-count spread at most one and nearest-objective distance spread at most one; report value/difficulty separately |
| Rival exposure | Number of rival regions, frontier contact, access through gates/water | Warn about isolated or uniquely overexposed starts; use profile-specific bands rather than maximizing contact |
| Route redundancy | Graph bridges, articulation bottlenecks, independent useful exits, loop density | Aim for two practical outward routes from a normal FFA homeland. Exempt explicitly intended island/challenge/Styx structures and display the trade-off |
| Aquatic/cave opportunity | Connected compatible territory per relevant start, homeland quality, surface/sea entrance access | Compare compatible opportunities, not only total plane area; target CV no greater than 15% within comparable roles where data supports it |
| Bonus-realm access | Distance to viable entrances, independent entrance routes, challenge/reward distribution | Report per-start access asymmetry separately from core fairness; no universal reward or conquest-time guarantee |
| Guardian difficulty | Template identity, capabilities/hazards, tested ruleset, observed battle outcomes when available | No automatic scalar derived only from unit count or gold cost. Preserve unguarded starts and use explicit challenge bands |
| Strategic/geographic variety | Regional terrain distribution, coast/island structure, junction/loop distribution, distinct candidate layouts | Match the selected recipe, not maximum entropy or maximum province degree; evaluate readability alongside topology |

For an opportunity quantity `x`, CV is its standard deviation divided by its mean. When the mean is zero or the model is unsupported, show not-applicable/unknown instead of a perfect score. Compare genuinely comparable roles; a single aquatic start provides no within-aquatic fairness distribution.

Overlapping expansion regions need explicit treatment. Display distance advantage and ties; for a simple diagnostic, contested provinces can contribute fractional credit among equally close eligible starts. This is an opportunity model, not a forecast of who wins the province. Keep terrain movement costs separate from conquest costs and never label weighted path cost as an exact turn count without a validated model.

When analyzing gates, report gateway groups explicitly. Their all-to-all endpoint connections should not artificially inflate a strategic loop metric. Calculate ordinary regional topology and portal access separately.

### Usability and reliability goals

These are proposed tests, not measured achievements:

- At least 8 of 10 first-time participants produce a valid six-player package in five minutes of active work, without consulting the full guide; record installation and generation wait time separately.
- At least 8 of 10 correctly explain core versus bonus sizing and current-map versus next-generation changes after using the flow.
- At least 8 of 10 locate the weakest start and explain one contributing factor within one minute.
- At least 8 of 10 repair a representative warning without an unexplained full regeneration or lost edits.
- All scripted cancellation, lock-conflict, batch-Undo, and failed-import tests preserve the prior project. Forced process termination remains a separate recovery limitation.
- Immediate input acknowledgment should target 100 ms; analytical updates should be cancellable and show progress when slower. Measure p50/p95 time and peak memory on specified hardware before setting generation-time promises.
- Every reproducibility test uses the same generator version, recipe, ruleset/profile snapshots, and component seeds. A seed alone is not a cross-version guarantee.
- Unknown rulesets and missing data must trigger visible uncertainty in every relevant test; no verified badge may survive a mismatched profile silently.

## 8. Validation plan and implementation order

### Validation design

1. Build a fixed, versioned seed corpus covering common FFA, team, naval, cave, and multi-plane recipes. Keep a held-out set to avoid tuning only to known seeds.
2. Use pairwise coverage for interacting options, plus explicit boundary cases: 2/6/12/32 players; 8/16/30 provinces per player; 1/2/8 planes; all ocean/wrap modes; reserved starts; manual edits; large bonus percentages; sparse choke realms; conflicting locks; unknown/modded nations.
3. Target at least 1,000 feasible preset seeds for release evaluation. Initially aim for at least 99% reaching declared quality targets within a bounded search budget; every miss must disclose the failed target or refuse the strict profile. Zero silently weakened hard constraints.
4. Compare mapmaking workflows on the same briefs: a normal FFA, a mixed land/water game, a team game, and a multi-plane conquest map. Measure task success, manual repairs, comprehension, and package readiness. No competing-tool timing or superiority claims until those tests are actually run.
5. Add known adversarial cases: short sailing/flight routes, seasonal barriers, a high-value but strongly defended expansion province, allied starts, a throne-rich but inaccessible realm, and oversized bonus layers that would dominate atlas-wide statistics.
6. Validate in-engine examples for each supported format/ruleset change. Conduct blinded start-position reviews and balanced player/position rotations before claiming competitive parity. Win rate alone is confounded by nation choice, player skill, diplomacy, and patches.
7. Track both fairness and map identity. A seed that meets parity targets by flattening terrain, eliminating regional distinctions, or making every layout identical is not a successful result.

### Recommended sequence

| Stage | Deliverables | Why this order |
|---|---|---|
| 1. Explain the existing product | Control-scope labels, pending-change summary, province budget, clearer export/guardian language, per-start structural breakdown, explicit score assumptions | High utility without immediately changing generation balance or introducing fragile nation data |
| 2. Safer iteration | Province search, analytical overlays, batch edits, locks, scoped rerolls, candidate comparison, settings-only recipes | Makes the existing flexibility usable and reduces destructive trial-and-error |
| 3. Better opportunity analysis | Movement profiles, contested expansion, separate economic/resource estimates, team-aware exposure, objective and realm-access comparisons | Addresses the demonstrated heuristic blind spots; requires versioned assumptions and calibration |
| 4. Richer generation | Regional planning, granular terrain/routes/water controls, optional patch-aware nation accommodations, guardian/reward profiles | Adds control on top of an inspectable model rather than hiding more assumptions in a larger settings panel |
| 5. Interoperability and testing tools | External-map inspection/import, host/player handoffs, isolated guardian test scenarios | Valuable extensions, but not prerequisites for the clearest improvements above |

Stage 1 should define the ruleset/profile metadata boundary even if optional nation accommodations arrive later. Hardcoded compensations must not become an interim shortcut.

The first implementation slice should therefore be **control-scope clarity plus a per-start balance inspector**, retaining the existing generator. This creates a trustworthy foundation for later granular controls and a measurable way to judge whether they improve multiplayer maps.
