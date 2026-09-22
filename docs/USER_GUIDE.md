# Pantokrator Atlas User Guide

Pantokrator Atlas is a local-first map maker for Dominions 6. It generates deterministic, multiplayer-oriented atlases with one to eight planes and exports playable packages that Dominions can load directly. Native `.map`/`.d6m` scenery remains the default; current `main` also offers illustrated realm images.

Reviewed September 22, 2026, including the [seed and numeric-edit audit repairs](AUDIT_REPAIRS_2026-09-22.md); the package version remains **0.1.5**. **Unreleased development** means source additions not yet published to the hosted GUI or Windows installer. Those editions (Site version 13 and Windows v0.1.5) still use `581b2b8`. Check [Versions and documentation](../README.md#versions-and-documentation) before looking for a missing control.

The merged additions are automatic [connected-region layouts](#province-layout), [procedural realm artwork](#procedural-realm-appearance), [Illustrated realms export](#in-game-artwork), [coastal/ocean/lake shapes](#overland-ocean-layout), [connected rivers](#connected-border-rivers), [smaller default biomes](#biome-cohesion), and [cave-wall/mixed-terrain repairs](#additional-terrain-flags). They are not in the published 0.1.5 build. Keep a pre-upgrade JSON backup; regeneration can replace geography and content, and older builds may reject the new saved fields.

The [release verification record](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/RELEASE_VERIFICATION_0.1.5.md) separates completed tests from remaining limits and delivery. Native testing covers specific map-loading, winter appearance, defender-template and guardian-capture cases; it does not certify every seasonal visual, PD roster or multiplayer matchup. Supplemental evidence and catalog links open GitHub and require internet access; the installed Windows edition bundles this guide and the README for offline use.

## Contents

- [Quick start](#quick-start)
- [The safest editing workflow](#the-safest-editing-workflow)
- [Screen layout](#screen-layout)
- [Generate tab](#generate-tab)
- [Planes tab](#planes-tab)
- [Planned links and existing gateways](#planned-links-and-existing-gateways)
- [Scenario tab](#scenario-tab)
- [Iterate tab](#iterate-tab)
- [Map tools and navigation](#map-tools-and-navigation)
- [Province inspector](#province-inspector)
- [Catalog manager](#catalog-manager)
- [Validation and balance report](#validation-and-balance-report)
- [Saving and reopening projects](#saving-and-reopening-projects)
- [Installing and exporting](#installing-and-exporting)
- [Keyboard and accessibility controls](#keyboard-and-accessibility-controls)
- [Troubleshooting](#troubleshooting)
- [Dominions engine boundaries](#dominions-engine-boundaries)
- [License and bundled data](#license-and-bundled-data)
- [Official references](#official-references)

## Quick start

### 1. Choose the hosted or local GUI

The simplest route is the [hosted GUI](https://pantokrator-atlas.mbatlle7.chatgpt.site). Open it in a current browser; Edge or Chrome is recommended for direct folder installation. Atlas is local-first: projects, imported catalogs, and downloads remain in that browser profile or on your device and are not cloud-synchronized.

Use the local Windows release if you want an offline copy. Source, releases, and issue reporting are available in the public [GitHub repository](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker).

For the unreleased features already on `main`, follow [Develop from source](../README.md#develop-from-source). Downloading the same v0.1.5 installer again will not add them.

### 2. Run a local Windows copy

1. Download `Pantokrator-Atlas-Setup-x64.exe` from the [latest GitHub release](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/releases/latest).
2. Run setup. Installation is for the current Windows user and does not require administrator access. The optional Desktop shortcut is unchecked by default.
3. Open **Pantokrator Atlas** from the Start Menu.
4. Keep the launcher terminal open while using Atlas. Press **Ctrl+C** there, or close it, when finished.

The installer includes the tested application and a private Node.js runtime. It does not modify the system Node.js installation, run npm, or download dependencies. The launcher runs only on your computer and opens Atlas when ready at `http://127.0.0.1:<port>/`, choosing a free port from 3000 through 3099.

The setup is not currently code-signed, so Windows may show an unknown-publisher warning. Download it only from the project's GitHub release page. To check integrity, download its matching `Pantokrator-Atlas-Setup-x64.exe.sha256`, open PowerShell in that download folder, and run:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath "Pantokrator-Atlas-Setup-x64.exe"
Get-Content -LiteralPath "Pantokrator-Atlas-Setup-x64.exe.sha256"
```

The hash values must match, ignoring letter case. Do not run the installer if they differ. This checks the downloaded bytes; it does not replace publisher signing.

For a portable copy instead, download `Pantokrator-Atlas-Windows.zip`, install [Node.js 22.13.0 or newer](https://nodejs.org/en/download), extract the archive to a writable folder, and run **Start Pantokrator Atlas.cmd** there. Never run the launcher inside the ZIP or from the Steam game directory. GitHub's **Source code** archives are not this prepared portable release.

Storage follows the browser profile and exact origin, not the application folder. Installer and portable copies share autosave when opened at the same address; different ports, `localhost`, `127.0.0.1`, and the hosted site use separate storage. Use **Editable project JSON** to move projects between them.

### Updating a local copy

Before updating, open **Install / export -> Editable project JSON** and save important work. Atlas projects belong in browser storage and project JSON backups, not as edits inside the application source folder.

After backing up, close Atlas's launcher terminal before updating. Download and run the newer setup; it upgrades the existing per-user installation. For a portable copy, extract the new release to a new folder instead of merging it over the old one, then launch that copy.

For a Git clone or GitHub source ZIP, follow [Updating a source checkout](../README.md#updating-a-source-checkout) instead. Preserve local file changes, refresh locked dependencies and restart the server; a source update does not update an installed Windows release.

Uninstall through **Windows Settings -> Apps -> Installed apps -> Pantokrator Atlas**. Uninstall removes application files and shortcuts but does not delete browser-held autosave data. Export important projects as editable JSON before uninstalling or changing local addresses.

### 3. Make your first map

1. In **Generate**, enter a seed, player count, provinces per player, and a start allocation whose total equals the player count.
2. Open **Planes** and add every plane you want. Configure each plane's archetype, variant, size, wrapping, and planned links.
3. Set any hosting restrictions in **Scenario**.
4. Return to **Generate** and choose **Generate balanced atlas**.
5. Review the map, generation notice, fairness report, and **Validate** results.
6. Make province, border, site, guardian, throne, and actual-gateway edits.
7. Resolve every red validation error.
8. Choose **Install / export**, select the desired **In-game artwork** when using current source, and either install directly into the Dominions user-data `maps` folder or download the ready ZIP.

While no province is selected, the province inspector shows these steps as a **Getting started** checklist: Generate, Planes, Scenario, Validate, and Install. Each step opens its tab or dialog.

## The safest editing workflow

> **Generate before detailed manual editing.** Full generation rebuilds geography, starts, borders, gateways, and most province content. Plane/Scenario configuration and manually authored names remain. Field locks can retain compatible content during same-seed generation; they do not make arbitrary regeneration lossless. Use content-only rerolls when geography must stay fixed.

The recommended order is:

1. Choose the project name and generation settings.
2. Add and configure every plane.
3. Configure planned plane links and Scenario settings.
4. Generate the atlas.
5. Make detailed manual changes; use Iterate's locks, previews, or content-only rerolls when appropriate.
6. Validate and export.

On a populated atlas, Generate first shows what will be replaced and offers **Download backup**. After you confirm, the completed generation is still one Undoable project edit.

Adding a plane to the generation plan preserves every existing actual gateway; the new draft does not receive endpoints until you generate or add them manually. Removing a plane removes its specific starts and only the gateway endpoints on that plane; groups left with fewer than two endpoints are removed.

## Screen layout

The main areas and controls are:

- **Header:** project name, autosave state, the **File** menu, Undo, Redo, Validate, and Install / export. **File** contains **New atlas**, **Open project…** (imports a saved Atlas project JSON), **Save now** (writes device autosave immediately), and **Download project JSON** (the same editable backup as Install / export -> Editable project JSON).
- **Setup panel:** Generate, Planes, Scenario, and Iterate tabs.
- **Map workbench:** editing tools, **Find a province**, condition preview, the active plane with its legend, zoom, the plane strip, and generation/fairness status.
- **Province inspector:** Terrain, Gameplay, Sites & guardians, and Advanced tabs for the selected province, or a Getting started checklist when nothing is selected.

Selecting a plane in the Planes list or the strip below the map makes it active. Selecting a province opens it in the inspector. **+ Add plane** at the end of the plane strip adds the same draft plane as **Add plane to plan** and opens the Planes tab. A draft plane has no provinces yet, so the map shows a **Draft plane** notice with **Go to Generate** and **Configure on Planes tab**.

On screens narrower than 980 pixels the workbench stacks vertically: the map comes first, then the province inspector, then the setup panel. The **Map**, **Province**, and **Setup** bar stays at the top of the screen and jumps to each section. Selecting a province on the map, in search results, or from a validation issue scrolls to the inspector. The plane title card is hidden there because the plane strip shows the same plane.

**Find a province** is the search box in the map toolbar. Press `/` anywhere except inside a text field, or select the box, to open it; **Escape** closes it. It searches all planes by province name, plane name, or number. Numbers (with or without `#`) match either the editor's global number or the local province number; these match Native scenery export. Illustrated image provinces can have different in-game numbers; use the mapping in `host_settings.txt` to cross-reference them. Add a plane-name word to narrow ambiguous local numbers. The first 30 matches are shown with both editor numbers. Selecting a result switches to **Select** and cancels any armed border/gateway endpoint; it does not edit the map.

Scope badges say when a change takes effect: **Next generation**, **Current Map**, **Current Map + next generation**, **Host / export**, **Preview only**, **Saved note only**, or **On project open**. In the Generate, Planes and Scenario tabs each section states its scope once, in its heading. Only a control whose scope differs from its section carries its own badge, beside its label: for example **Output resolution** (Current Map + next generation), **Plane name** (Current Map) and **Fresh generated names on open** (On project open). The badge is not part of the control's accessible name. Current-map changes are reflected in later exports; they do not alter a map already installed in Dominions. Biome and patch notes are descriptive, while primary terrain and terrain flags affect artwork and game rules.

Setup sections are collapsible; a collapsed heading summarizes the section's current values. Help notes show one line, and **More…** reveals the full explanation. The Generate and Planes tabs keep **Generate balanced atlas**, the start-allocation status and generation progress pinned at the bottom of the setup panel.

The map marker legend (**Legend** in the lower-left corner of the map folds and unfolds it; it starts folded when the window is 1,220 pixels wide or less) distinguishes all authored gameplay markers instead of collapsing them into a generic symbol: **S/#/N** means generic/team/nation-specific start, **♜/♛/×** means preferred/fixed/avoided throne, **✦/M** means a placed site/many-sites terrain, **G** means guardian groups, and **◎** means a gateway endpoint. A province can show several badges at once. The selected-province screen-reader status announces its combined terrain, the same marker meanings, and relevant group, nation, site, guardian, and gate numbers.

The **Project** name in the header becomes the map title and the basis for the exported folder and filenames. Export shows the safe normalized file stem before writing anything; changing the displayed project name does not rename an already installed folder on disk.

## Generate tab

Generation controls define the next generated atlas. Changing most of them does not alter existing geography until **Generate balanced atlas** is pressed.

The tab is grouped into collapsible sections: **Basics**, **Starts**, **World shape** and **Balance & routes** start open; **Plane size & output** and **Province names** start collapsed. A collapsed section's heading summarizes its current values, and Atlas remembers which sections you opened while you switch tabs. Each help note shows one line; choose **More…** for the full explanation. The Generate button and allocation status stay pinned below the sections.

### Fresh-project defaults

| Option | Default |
|---|---:|
| Seed | Fresh random `realm-…` seed |
| Fresh generated names on open | Off |
| Players | 6 |
| Provinces / player | 16 |
| Starts | 6 Land |
| Useful start connections | 4 |
| Water | 18% |
| Ocean layout | Natural / varied |
| Major continents | 3 |
| Biome cohesion | 58% on current main (68% in published 0.1.5) |
| Economy balance | Hard competitive balance |
| Overland topology | Competitive mix |
| Bonus-plane size | 30% of core |
| Recommended throne locations | 8 |
| Resolution | 3840 x 2160 |
| Initial plane | Surface, Temperate, 96 provinces |
| Initial wrapping | East/west and north/south |

Device autosave may restore your previous atlas instead of showing a fresh project. Use **File -> New atlas** in the header when you deliberately want a clean project.

### New atlas

Opens an explicit replacement confirmation for the current project. The dialog lists the current plane, province, and gateway totals and offers **Download backup** before continuing. Confirming creates the fresh-project defaults above with a new random seed, clears the selection and armed tools, and clears Undo/Redo history. The new project becomes the device autosave, so the downloaded editable JSON is the recovery path for the replaced atlas.

### Basics

Seed, player count, provinces per player and the generation plan summary.

#### Seed

A free-text deterministic seed. A first visit without a saved atlas and each **New atlas** use a fresh random seed. Reopening an existing project preserves its seed. The same effective settings and seed reproduce the same generated atlas within the same generator revision; updates can change generation, so keep project JSON when an exact map matters. The icon beside the field creates another random realm-style seed for the next **Generate**; it does not immediately rename or regenerate the current map. To change only names, use the name controls below.

Current source also reproduces generation across independently created atlases: use the same seed, plane order, names and configuration, with no differing authored content or locks. Earlier builds mixed internal plane IDs into some generation/art decisions. Saved maps keep their existing outlines and artwork when opened; the fix takes effect on explicit Generate. Older builds may reject the new applied-generation metadata, so retain a pre-upgrade JSON backup.

#### Players

Range: **2-32**. This is the recommended player count and the required total for the five start categories.

When the current allocation exactly matches the old player count, increasing Players adds the difference to Land. Decreasing it removes starts in this order: Land, Other, Cave, Coastal, Water. If the old allocation was already incomplete or overfilled, adjust it manually.

#### Provinces / player

Range: **8-30**. This sizes the core overland and cave realms; it does not multiply every bonus plane independently. See [Automatic plane sizing](#automatic-plane-sizing).

#### Generation plan and province budget

At the end of **Basics**, the **Next generation** summary shows core, bonus, and total planned provinces. Expand **Province budget by plane** to compare each plane's current count with its next target, including manual-size preservation, start-buffer minimums, start blocking, and the 800-province per-plane cap. Each row also lists the plane's generated start count. Generate sizes every plane and places its generated starts from this same plan, and manual planes are measured by their next-generation target rather than their current province count. Counts still do not guarantee feasible start spacing or water allocation.

The pending summary groups inputs changed since the last generation recorded by this editor. It deliberately excludes manual province edits, name rerolls, host options, and patch notes. “Plan matches” is not proof that the current map is unedited. Older projects have no recorded baseline and say so; generating establishes one. Resolution, wrapping, and archetype changes can also affect current display/export behavior before generation, as their scope labels indicate.

**Start analysis…** opens the [start-region analysis](#start-region-analysis) described below. It analyzes the current map, not the ungenerated plan.

### Starts section

The five start categories, the connection target, and the nested cave-start nation list.

#### Start allocation

Each category accepts 0-32. The five values must total Players exactly, or Generate remains disabled.

- **Land:** dry, non-cave overland land with no adjacent water.
- **Coastal:** overland land adjacent to water.
- **Water:** aquatic provinces on eligible Surface or surface-like solid Custom planes.
- **Cave:** dry Cave/Great Cavern starts. If no Cave/Great Cavern plane permits generated starts, eligible Underworld, Infernal, or Abyss planes supply the slots.
- **Other:** dry special-realm terrain outside the overland and cave families, such as Cloud, Air, Dream, or Elemental.

The allocation status is pinned above **Generate balanced atlas**. **Put remainder on land** appears there when too few starts are allocated and fills the unassigned slots with Land starts.

Make sure the required plane families exist and permit generated starts. For example, Cave starts need an eligible cave-family plane (preferring Cave/Cavern) and Other starts need an eligible bonus realm. A plane whose **Block generated starts on this plane** option is checked is not eligible for any automatically allocated start category. An impossible category displays a persistent **Generation plan cannot place all starts** summary in the pinned Generate bar and disables Generate until you permit starts on a compatible plane, add one, or change the allocation. Existing and imported atlases remain subject to start-count, category, and safety validation; blocking future generation does not itself invalidate existing starts.

#### Deterministic cave-start nations

This is an ordered list of playable nation IDs, collapsed inside **Starts**. It opens automatically when nations are configured.

- **Empty list:** Dominions uses its native cave-start preferences on the generic cave starts.
- **Configured list:** after Generate, the program binds each nation in priority order to a distinct generated Cave start with `#specstart`.
- The host must enable **special starting locations** for guaranteed `#specstart` placement.
- Changing the list removes stale generated assignments. Generate again to create the new assignments.
- If the list is longer than the Cave-start allocation, Generate is disabled. Increase Cave starts or remove lower-priority nations.
- If Cave starts is zero, neither configured assignments nor native cave preference has a cave slot.
- IDs 5 and above can be entered for mod nations, but the matching mod must be enabled in Dominions.

Use the arrow controls to change priority.

#### Target useful connections at starts

Range: **1-8**. Default: **4**.

The generator tries to give all starts a comparable number of traversable exits and nearby expansion space. Four is the recommended multiplayer baseline; higher targets are best-effort.

Capital spacing is a separate rule:

- No two starts may be fewer than three global movement steps apart.
- The preferred distance scales upward with traversable provinces per start, up to eight.
- If the hard three-step floor is preserved but the preferred scaled target is infeasible, generation displays a non-blocking warning.
- A distance below three is a validation error and blocks playable export.

If the target cannot fit safely, Atlas reports a warning. Increase map size, simplify the start mix, lower the degree target, change wrapping, or try another seed.

Generate keeps generated starts at least three moves from manual nation-specific and team starts on the same plane, alongside the usual spacing between generated starts. When a manual nation-specific start is too close to another start or lacks connections, a **Nation-specific starts need spacing** notice appears below **Starts** and in the **Generate and replace** confirmation. It does not block Generate; each row offers **Remove nation N start**. If a regenerated map still cannot keep that distance, a generation notice names the nation, its province, the nearest generated start and the distance achieved.

### World shape

#### Water provinces

Range: **0-60%**. Default: **18%**.

This is the requested water share on water-capable generated realms. Generation may raise it to satisfy water/coastal starts, an Oceanic variant, or Island Chains. A plane's optional [generation preferences](#generation-preferences) can override the inherited request. Flooded Cave/Cavern chambers have a separate preference; the Underworld's Styx is an archetype feature, not an ordinary water-quota result.

#### Overland ocean layout

- **Natural / varied:** organic seed-driven land and water patches.
- **Single continent:** one connected major landmass with peripheral sea.
- **Multiple continents:** separate movement-connected landmasses.
- **Island chains:** coast-heavy, ribbon-like islands and sea routes.
- **Central inland sea:** one connected central water body enclosed by connected land.

**Major continents** appears for Multiple continents and accepts **2-6**. It is a topology target. If the selected water percentage and wrapping cannot support the requested count, generation reports the achieved count instead of pretending a connected landmass is multiple continents.

Island Chains needs enough sea to look and play like islands. If Water is below 48%, generation raises the effective setting to 48% and reports the change.

Narrow islands may have too few inland **Land** candidates with enough safe exits and spacing. Prefer more **Coastal** starts, increase provinces per player, or choose a continental layout if validation reports missing starts. Island generation does not silently fill oceans or relax capital-safety rules to satisfy an impossible start mix.

On current main, explicit ocean presets keep their water layout during start placement. If a coast-heavy map cannot fit the requested inland capitals safely, review the spacing/category notices, allocate more Coastal or Water starts, or increase provinces per player. The generator no longer scatters the chosen ocean just to accommodate those starts.

**Unreleased natural landforms:** new generations curve shared province boundaries, including shorelines. Single Continent grows a connected peripheral sea; Multiple Continents and Island Chains try broad, winding separators before falling back to their capacity-safe layouts; Central Inland Sea uses an asymmetric, lobed basin. Natural / Varied keeps its existing seed-driven water distribution with the new boundary shapes. The existing water budget, start placement and connectivity safeguards still apply; constrained settings may limit the achievable outline or continent count. These are cartographic shapes, not a physical erosion simulation.

Water remains a set of playable Sea/Deep Sea provinces, not a painted overlay. Preview, clicking and native export use the same ownership. Older saved maps do not change just by loading, exporting or rerolling content; back up the project and **Generate** to obtain the new shapes. A settings recipe is not an exact map backup: it uses the current generator when you subsequently generate.

Coastal boundaries use stronger bays/headlands than inland divisions; ocean interiors use broader curves, and small enclosed lakes receive rounded basin outlines. The generator saves these shape hints separately from editable terrain. Manually changing Sea or other flags changes the province's art and game terrain, not its borders. Generate again when you want water placement and shapes rebuilt together.

#### Biome cohesion

Range: **0-100%**. Current-main default: **58%** (published 0.1.5 uses 68%). Saved settings are not automatically lowered.

- Lower values make smaller, more varied terrain patches.
- Higher values create larger connected biome regions.

The current-main generator blends a little more regional moisture/elevation detail into ordinary temperate land at low and medium cohesion. This produces smaller, more varied plains, forest and highland patches while preserving connected terrain regions. Deliberate high cohesion (80% and above), themed variants, explicit terrain weights and regional plans retain their existing behavior and priority; this does not force equal terrain percentages.

The generator still enforces minimum terrain variety, so the relationship is directional rather than a promise that every low-cohesion seed will have fewer same-terrain neighbors than every high-cohesion seed.

### Balance & routes

#### Economy balance

- **None / natural:** preserves generated populations without correcting unequal early economies.
- **Soft correction:** nudges start economies toward parity, caps corrections at 12%, and applies less than half the Hard adjustment.
- **Hard competitive balance (default):** strongly equalizes early start economies for competitive multiplayer.

This policy changes generated population values, not the identity of independently recruitable poptypes or a nation's persistent post-capture PD roster.

#### Overland topology

- **Open movement:** turns generated rivers into bridges and other blocking or seasonal overland borders into ordinary links.
- **Competitive mix (default):** keeps a terrain-shaped mix of open routes, rivers, passes, and borders.
- **Strategic regions:** adds deterministic regional chokepoints away from every capital while keeping the movement graph connected. Wet chokepoints are routed as part of connected border rivers (with the usual bridge crossings); a chokepoint that no continuous river can pass, such as a coastal border, becomes a mountain pass instead.

This affects solid Surface and surface-like Custom planes. Cave-family and sparse special realms retain their own topology.

##### Connected border rivers

Unreleased feature on current main; published 0.1.5 retains the earlier border-river generator.

On newly generated solid Surface and surface-like Custom maps, small river borders form connected channels instead of isolated random stretches. Routes use the actual junctions where province borders meet, including enabled wrap seams. Upland and lake headwaters are preferred, with routes favoring valleys toward larger water bodies. Tributaries can join existing downstream channels. Where no coast is reachable, rivers drain to another water body, an unwrapped map edge, or a low inland basin on fully wrapped dry maps. This is terrain-guided layout, not a physical water-flow simulation.

Capital exits and road crossings use bridges so the river remains visually continuous without adding a seasonal river blocker there. **Open movement** uses bridged rivers throughout unless an explicit plane border-mix override is configured. Bridges retain a blue watercourse beneath their crossing marks in the editor and PNG; the native package uses the game's river/bridge border commands.

Use **Planes → Generation preferences → Eligible dry-land border mix → River share (%)** to change the amount, or enter **0** to disable generated border rivers. The share is approximate: complete routes take priority over filling the percentage with disconnected pieces, and constrained explicit requests produce a generation notice. River crossings can replace some requested road borders with bridges. Regenerate to apply these settings; loading, synchronizing or exporting an existing map does not reroute authored rivers. The River Styx, ocean provinces, cave waterways, and sparse-realm passages are unchanged.

#### Recommended throne locations

Range: **0-64**. Default: **8**.

This marks preferred throne provinces; it does not set Ascension points and does not force exact named throne sites. The generator distributes preferences while protecting start and gate exclusion zones. If all requested locations cannot fit safely, validation warns with the achieved count. Lower the target or enlarge the atlas if exact capacity matters.

### Plane size & output

Collapsed by default. Its heading shows the bonus-plane percentage and output resolution.

#### Each bonus plane size (% of core)

Range: **1-500%**. Default: **30%**.

Each auto-sized bonus plane independently receives this percentage of the combined core, up to 800 provinces. Values over 100% are allowed. Manually sized planes are unchanged.

#### Output resolution

- **Compact:** 1536 x 1024
- **2K:** 2048 x 1152
- **4K:** 3840 x 2160
- **Square max:** 2880 x 2880
- **Custom per plane**

This control carries its own **Current Map + next generation** badge. A preset immediately applies its dimensions to every plane. Custom exposes Width and Height in Planes for the active plane. Each axis must be 256-3840 pixels, and the total may not exceed 8,294,400 pixels.

Choose the final aspect ratio before generation because it affects geometry. Large multi-plane 4K packages are faster and more memory-efficient with direct installation than ZIP export.

#### Wrap east/west and north/south

Wrapping is set per plane in **Planes → Selected plane**. **Plane size & output** shows the selected plane's setting as a read-only line (for example, *Selected plane (Pantokrator's Realm) wraps east/west and north/south*), followed by the button that opens Planes.

- East/west links the left and right seams.
- North/south links the top and bottom seams.
- Changing a wrap setting immediately resynchronizes the border graph.
- Wrapping affects generated ocean topology and continent feasibility.
- Surface-style planes default to both wraps.
- Underworld defaults to neither so the Styx can divide it into two banks.

A fully wrapped Underworld is allowed, but validation warns that one river band cannot truly divide a torus.

Generation uses chamber-and-corridor ownership for the Underworld so the Styx crossings agree with the playable map. Every generated passage stays clear of unrelated chambers, so the exported borders equal the plane's connections. A bridge is drawn over the river it crosses, and each Styx province it touches is linked to the bank on that side (a ford link). Very small Underworlds (about 8–12 provinces) that cannot fit such a layout keep the previous construction; validation warns when an Underworld's drawn borders and connections disagree, for example after authoring a crossing link. Imported solid Underworlds are converted only when you generate, with a notice explaining the change.

#### Configure plane archetypes & selected links

Switches to Planes without changing the map. It is the last control in **Plane size & output**. Use it to finish plane planning before Generate.

### Province-name controls

These controls are in the **Province names** section, which starts collapsed and is scoped **Current Map** because its actions apply immediately.

**Reroll generated names (preserve manual)** immediately renames generated provinces on every plane without changing geography. Names use plane, terrain, coast, flooded-cave, and Styx context. Names edited in the province inspector and legacy names with no provenance are preserved. The action is Undoable.

**Replace every province name** opens a confirmation and replaces generated, manual, and legacy names, except provinces protected by a name lock. Unlock those names first if they should also change. Use it to repair duplicate or poorly matched names in older projects. It is also Undoable.

Generated names are unique across the atlas and avoid known nation, epithet, home/capital-site, and special-realm names.

Names blend article-free forms such as **Silver Grove** with occasional **The**-prefixed forms. Roughly one in four candidates uses **The**, including longer compound names. Existing saved names stay unchanged by default: use **Reroll generated names (preserve manual)** to apply the new blend without regenerating the map.

The vocabulary also includes 528 original named places and landmarks, interleaved with descriptive names: **Bellroot Vault** for caves, **Candlewake Ferry** for the Styx, **Larkglass** in the Dreamlands, and **Orphaned Meridian** in the Abyss. Terrain-specific pools keep farms, forests, seas, flooded caves, and other landscapes distinct; special realms retain their own naming character. These names use the same uniqueness and capital-name protections.

**Fresh generated names on open** (scoped **On project open**) is an optional setting saved with each project. Enable it to shuffle generated names whenever the project opens from JSON or is restored on page load. It does not rename anything immediately, change the world seed, or regenerate geography, guardians, or starts. Manual and legacy names are preserved, and conflict/recovery copies are always opened unchanged. After a page-load reroll, **Undo** restores the saved names. Turn this option off before sharing a multiplayer map whose province names should stay fixed; exported game maps never reroll names when loaded in Dominions.

### Reset generator defaults

The quiet **Reset generator defaults** link sits at the bottom of the Generate tab. It resets the Generate options, name-reroll counter, plane resolution, and active-plane wrapping without replacing the current atlas. It also turns off **Fresh generated names on open** and restores the fixed example seed `pantokrator-001`; use the seed-shuffle button for another world. It preserves planes, provinces, Scenario settings, gateways, manual edits, manual specific starts, and each plane's **Block generated starts** choice. Generated cave-nation assignments are removed until you generate again. The reset is Undoable and does not itself generate. Per-plane generation preferences have their own reset under Planes; layout/start locks can reject conflicting reset changes.

### Pinned Generate bar

#### Generate balanced atlas

The button is pinned at the bottom of the Generate and Planes tabs, together with the allocation status, any start-plan errors, generation progress and border status, so it stays visible while you scroll. It rebuilds every planned plane from the seed and settings, including terrain, topology, starts, generated gateways, throne recommendations, independent details, cave-nation assignments, and generated names. Plane/Scenario configuration and manually authored province names remain. Compatible field-locked content can survive same-seed generation; most other province edits do not. Layout lock blocks full generation, and conflicting start/field locks reject the result without replacing the atlas.

On a populated atlas, Atlas confirms what will be replaced and offers a project backup. The progress card in the pinned bar lets you cancel safely, and generation never installs a partial result. If you edit the project while generation runs, a stale result is discarded. A completed generation is Undoable.

#### Generation balance notice

Appears below **Starts** when generation used a safe best-effort result, especially:

- Start spacing below the preferred scale-aware target while retaining the hard three-step floor.
- Unequal start connection counts.
- A manually constrained special plane cannot retain the intended number of themed guardian provinces outside the preferred two-move guardian buffer.

These warnings do not block export. Hard spacing failures remain red validation errors.

#### Synchronize visible borders

When repairs are needed, the pinned Generate bar shows a **Synchronize N project border issues** button; otherwise it shows the status text **Visible borders synchronized**. It repairs all planes when the saved Dominions neighbor graph differs from visible ownership boundaries. Use it for imported projects that show topology errors; it preserves valid authored border types.

### Automatic plane sizing

- Land, Coastal, and Water starts are allocated among eligible Surface-like planes; Cave starts use eligible Cave/Great Cavern planes, with the fallback described under [Start allocation](#start-allocation). Allocation is capacity-weighted, including manually sized planes. Each auto-sized core plane targets its allocated starts multiplied by Provinces / player, subject to size limits.
- Each auto-sized bonus plane uses the selected percentage of the combined core total. Manual core sizes still contribute to that total.
- If there are no core planes, bonus percentages use Players x Provinces / player as their reference instead.
- Starts can enlarge an auto-sized plane so their spacing and neutral guardian buffers have room, up to the 800-province ceiling.
- Auto-sized planes have an 18-province minimum. Manual targets use 8-800 provinces and are not changed by player count, provinces per player, or the bonus percentage.

Core planes are Surface, Cave, Great Cavern, and solid Custom realms with Temperate, Wild, Frozen, Arid, or Oceanic variants. Cloud, Air, Underworld, Infernal, Abyss, Dream, and Elemental are bonus realms. All sparse Custom realms and Custom realms with Fungal, Crystal, Volcanic, Storm, Infernal, or Void variants are also bonus planes.

## Planes tab

An atlas can have **one to eight planes**. Auto-sizing and planned-link changes apply to the next generation. Archetype changes immediately update the current plane's identity, ownership presentation and borders; surviving authored border types are preserved. Terrain, starts, sites and guardians are not regenerated until **Generate**. Wrap changes, including **Reset generator defaults**, also synchronize current borders in the same undoable edit. Review validation after changing topology because start spacing may change.

The plane list and **+ Add plane to plan** stay at the top. Settings for the selected plane follow in collapsible sections:

- **Selected plane** (Current Map + next generation; open): name, archetype, terrain variant, province layout, wrapping, custom width/height and **Remove this plane…**. Plane name has its own **Current Map** badge.
- **Generation preferences** (Next generation; open): auto-size or province target, **Block generated starts on this plane**, and the per-plane generation preferences.
- **Display, flags & plane directives** (Host / export; collapsed): map-image and deep-cave overrides, name and dominion colors, and the plane's raw directives.
- **Planned links** (Next generation): open when the atlas has more than one plane. With a single plane it starts collapsed and shows no link rows.
- **Existing gateways (N)** (Current Map; collapsed): actual saved gateways touching the selected plane.

The pinned **Generate balanced atlas** bar stays below these sections.

### Add plane to plan

Stages a new auto-sized Underworld draft with no provinces. Configure it, then Generate. Existing actual gateways are preserved; the draft has no endpoints until generation or manual gateway editing adds them.

### Plane name

The in-game plane name. Untouched generated names can update to a suitable unique default when the archetype changes. A manually edited name remains as entered.

### Plane archetype

| Archetype | Generated character |
|---|---|
| Surface | Solid overland with ordinary land and water; dense multiplayer topology. |
| Cave | Sparse native-style chambers, fungal defaults, cave populations, some flooded Sea + Cave chambers, and textured rock/fungal preview art. |
| Great cavern | Broader and more connected underground vaults with crystal-oriented defaults and textured crystal preview art. |
| Cloud realm | Sparse aerial islands and routes with Air/Glamour themes; editor/PNG previews use procedural floating islands and cloud banks. |
| Air plane | Stronger aerial, storm, and Astral themes with the same procedural editor/PNG sky renderer. |
| Underworld | Sparse death realm, undead/spectral guardians, cave-appropriate vanilla recruitment, and a connected River Styx dividing two dry banks with controlled crossings; preview art uses tomb-like stones and mist. |
| Infernal realm | Hot Waste/Highland cave-family realm with Fire, Death, Blood, demons, and ember-lit preview art. |
| Abyss | Hostile void realm with Death/Astral themes, horrors/demons, branching corridors, and obsidian preview art. |
| Dream realm | Glamour/Astral/Nature terrain with fay, magical defenders, mist, and enchanted-vegetation preview art. |
| Elemental | Fire, Air, Water, and Earth extremes with themed elementals and variant-led preview accents. |
| Custom | Neutral solid overland profile for manual combinations; variants can supply special themes. |

Surface and ordinary Custom default to full province ownership. Other archetypes use sparse chambers, junctions, routes, and native owner-zero negative space. Cave, Great Cavern, Underworld, Infernal and Abyss shapes use irregular chamber contours, softly curved passages where clearance permits, and smoother native elevation. Styx water routes and explicit bridge crossings retain their controlled geometry. These visual updates can change an older project's rendered appearance without changing its authored movement links.

Special bonus realms receive substantially stronger initial guardian groups than most Surface variants and Cave/Great Cavern, and use themed population types. See [Guardian groups](#guardian-groups) for Oceanic Surface and Custom-variant exceptions. Persistent post-capture PD still follows Dominions' nation/poptype rules.

### Terrain variant

Variants reweight climate, terrain, site paths, population pools, guardian themes, and names at the next generation. They do not change the plane's fundamental solid/sparse family.

- **Temperate:** baseline.
- **Wild:** wetter, Nature/Glamour oriented.
- **Frozen:** colder terrain and frequent Colder markers.
- **Arid:** drier terrain.
- **Oceanic:** stronger water share where appropriate.
- **Fungal:** moist living-cave emphasis.
- **Crystal:** cave-highland and crystal emphasis.
- **Volcanic:** hot, dry, Fire/Earth emphasis.
- **Storm:** Air/Astral storm emphasis.
- **Infernal:** Fire/Death/Blood emphasis.
- **Void:** Death/Astral/Glamour abyssal emphasis.

### Province layout

Unreleased feature on current main; not available in the published 0.1.5 build.

Sparse realms automatically use **Connected regions & passages**: adjacent province masses joined by broad passage provinces. The Planes panel explains the current layout; there is no classic-layout selector. **Generate** builds the corresponding clustered movement graph and remains a separate, confirmed regeneration step. Merely opening an existing map does not replace province IDs, contents, starts or movement links.

Cloud and Air use broader, wind-shaped floating-island groups with irregular coastlines and gently curved, variable-width causeways. Passage provinces remain playable, and neighboring provinces in each group share substantial borders. These outlines update compatible current maps without regeneration; province centers, links, guardians and starts stay unchanged. The editor, Preview PNG, native geography and illustrated export all use the same click areas. Choose **Illustrated realms** to carry the cloud background and floating-island artwork into the game; native scenery still uses the game's art.

The Underworld uses its dedicated **River Styx layout** to preserve its water barrier and controlled crossings. Solid planes retain full province ownership.

New generations additionally use **natural landforms**: solid planes have irregular shared boundaries rather than straight cell edges; Cave has rounded irregular chambers, Great Cavern elongated vaults, Infernal rounded facets, Abyss warped pockets, Dream lobed basins, and Elemental rounded shard-like rooms. Passage provinces stay broad. Cloud/Air keep the wind-shaped treatment above, and the Styx layout is unchanged. This newer pass is applied only by Generate; existing saves without its style marker retain their previous outlines. The Planes panel distinguishes saved outlines from the new applied shapes. A content edit or recipe does not silently enable the new style; explicit geometry settings can still reshape a map as documented.

Some older or manually linked planes have nonlocal connections that cannot be represented by adjacent regional provinces. Atlas retains compatibility geometry and displays a notice instead of silently deleting or rewriting those links. Keep the authored map, or back up and **Generate** for the new regional layout; normal regeneration can replace province content as described above. Compatibility geometry is a preservation safeguard, not another selectable generation style.

Atlas checks native-resolution ownership before displaying regional geometry. Detached pixel fragments are cleared into the background. If the resolution cannot preserve the intended shared borders, a notice advises increasing resolution or reducing province density. Increasing resolution rechecks the layout without requiring regeneration or changing the movement graph.

Old project and recipe `sparseLayout` fields remain readable as compatibility metadata but cannot select the removed layout. Layout locks still protect geometry, and older generation snapshots are marked pending where the generator's effective layout has changed. Isolated guardian fixtures use the same automatic layout rule.

### Procedural realm appearance

In current source, the editor and **Preview PNG** render Cloud/Air as floating islands over clouds; Cave/Cavern with textured rock and fungal or crystal details; the Underworld with tomb-like stones and mist around the Styx; Infernal with ember fissures; Abyss with obsidian forms; Dream with mist and enchanted vegetation; and Elemental realms with variant-led accents. The pixels are generated locally and deterministically from project data, without external artwork, downloads, or new dependencies.

Primary terrain, additional flags, realm presets, and the selected Condition preview still determine the effective appearance. Actual Sea remains blue and receives aquatic-colored details, including the Styx and mixed water terrain on Infernal or Abyss planes; realm theming cannot repaint it as dry ground. Frozen/winter adds illustrative snow only where the existing preview policy allows it. Cloud/Air dry islands can receive snow, while the newly illustrated Cave/Cavern, Underworld, Infernal, Abyss, Dream, and Elemental realms retain their normal palette.

The default **Native scenery** export uses `.map`/`.d6m`; Dominions supplies its scenery and may show black ownerless space. To carry these procedural landscapes into the game, choose **Install / export → In-game artwork → Illustrated realms (custom artwork)**. Atlas includes the generated TGA art, terrain/winter sheets and province ownership areas automatically, while Surface and Custom planes retain native scenery. The province **Skybox** setting still changes battle scenery only. See [In-game artwork](#in-game-artwork) and the [September 22 verification record](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/ILLUSTRATED_EXPORT_2026-09-22.md).

### Auto-size from player count and Province target

With auto-size on, the plane uses the formulas under [Automatic plane sizing](#automatic-plane-sizing). Turning it off reveals **Province target**, range 8-800.

### Block generated starts on this plane

Unchecked by default. When checked, the next **Generate balanced atlas** does not allocate generic generated starts to that plane. Use this to reserve a dangerous bonus realm, keep a thematic plane neutral, or direct the requested start categories into other compatible planes. If the remaining eligible planes cannot satisfy the allocation, the pinned Generate bar (visible on both Generate and Planes) names the impossible categories and disables Generate instead of silently ignoring the policy.

This affects only automatic allocation. Existing starts remain until regeneration, and you can add generic, team, or nation-specific starts manually afterward. The setting is preserved by saving, importing, Undo/Redo, and **Reset generator defaults**.

Whether a start was generated or placed manually, its capital province and every province directly connected to it form a protected capital zone. Generation does not place neutral guardians, special defender units, or thrones in that zone. Assigning a nation-specific start also clears conflicting capital content already on the capital as described under [Starts](#starts).

### Wrap settings

**Wrap east / west** and **Wrap north / south** in **Selected plane** are the only wrap controls; Generate shows the setting read-only. They create movement and ownership seams across the selected axis and immediately resynchronize that plane's borders. Underworld defaults to no wrap so its Styx remains a permanent barrier with controlled crossings.

### Custom resolution

When Generate's resolution is Custom, Width and Height appear here for the active plane. Each is 256-3840 and total pixels may not exceed 8,294,400.

### Generation preferences

In the **Generation preferences** section, expand **Generation preferences · Next generation** for the active plane. Blank values inherit the established generator. Current provinces remain unchanged until Generate; **Reset plane preferences to inherited** removes all overrides for that plane.

| Preference | What it does |
| --- | --- |
| Plane water / Cave ocean (%) | Requests 0–60% water on the supported plane family. Cave ocean applies to Cave/Great Cavern. Neither removes the Underworld's edge-to-edge Styx. Starts, ocean style, and topology can override a requested share. |
| Dry-terrain weights | Values 0–5 bias Plains, Forest, Farmland, Swamp, Waste, Highlands, and Mountains. Blank or 1 retains the normal preference; 0 is not an absolute exclusion because variety and safety repairs take priority. Caves use underground equivalents; Farmland has no underground effect. Water and cave walls are excluded. |
| Regional plans | Assign a dry-terrain preference to the north/south/east/west half or central quarter. Up to 16 plans per plane; the first matching plan wins. Normalized bounds scale with map dimensions, and saved recipes can specify custom rectangles. These are generation plans, not saved province selections. |
| Eligible dry-land border mix | On solid overland planes, road/river/mountain-pass shares total at most 100%. Capital access, water, impassable borders, and mountain barriers are preserved. River share budgets complete connected routes, including bridges, rather than independent border rolls; barriers and outlet access can reduce the achieved share. This overrides the topology policy only on eligible edges. |
| Guarded share | Requests authored guardians on 0–80% of eligible provinces, outside the two-step capital buffer, using the plane's existing themed pools. |
| Guardian troop-count multiplier | Inherit, 0.5×, 1×, 1.5×, or 2× squad counts. This is not a calibrated difficulty rating; review commander leadership warnings and test combat in Dominions. |
| Many-sites share | Requests the Many sites terrain flag outside capital rings. It does not place named sites or guarantee rewards. |

Treat these as preferences, not exact quotas. Locks, terrain variety, ocean constraints, and safe starts take priority. **Current result** summarizes the existing plane, not the ungenerated plan; compare it again after generation.

### Plane display & native flags

These are in the collapsed **Display, flags & plane directives** section (Host / export). Its heading counts the settings that differ from the inherited defaults.

- **Reveal this plane's map image:** Inherit project setting, On, or Off. Controls per-plane `#mapnohide` behavior.
- **Disable random deep caves from this plane:** Inherit, On, or Off. Controls per-plane `#nodeepcaves` behavior.
- **Province-name color:** four decimal RGBA values from 0 to 1 for `#maptextcol`. Default: `0.93 0.88 0.70 1.0`.
- **Dominion-overlay color:** four integer RGBA values from 0 to 255 for `#mapdomcol`. Default: `238 205 112 42`.
- **Plane directives:** raw commands appended at the end of this plane's map file. It edits the same text as **Plane directives** in the province inspector's Advanced tab. See [Raw directives](#raw-directives).

### Themed backdrops

Sparse-plane art appears behind ownerless areas in the editor and PNG preview, while terrain materials adapt to province size, shape, effective flags, and realm. Bundled bitmap backdrops and material textures remain preview assets. Current main's **Illustrated realms** exporter separately paints procedural backgrounds and terrain for the nine supported realm types into playable TGA sheets, so their empty sky/rock areas need not appear black. Those areas remain unowned and unplayable. **Native scenery** still uses Dominions' own background and terrain rendering.

### Remove this plane

Available when the atlas has more than one plane. A confirmation shows affected content and offers a backup. Removing the plane also removes its specific starts, planned links, and gateway endpoints; invalid one-endpoint gateway groups are removed. The edit is Undoable.

## Planned links and existing gateways

These are different systems:

- **Planned generation links** are rules for the next Generate.
- **Existing gateways** are actual saved `#gate` groups in the current atlas.

### Link presets

- **Main-plane hub:** every other plane connects to plane 1.
- **Plane chain:** 1-2, 2-3, and so on.
- **Closed ring:** the chain plus a final last-plane-to-plane-1 link.
- **Compatibility graph:** a deterministic high-compatibility spanning tree that keeps every plane reachable without connecting every pair.

Choosing a preset replaces the planned pair rules for the atlas.

These rules are in the **Planned links** section of Planes. It starts collapsed and lists no rows while the atlas has only one plane; the preset and default pair count remain editable there.

**Default pairs for all enabled links** sets 1-3 distinct gateway pairs for every enabled plane pair. Each visible row can be enabled/disabled and can override its pair count. Rows show only links involving the active plane. The compatibility percentage is a generation heuristic, not a travel chance.

All generated links are bidirectional. Dominions treats every province sharing the same `#gate` number as one bidirectional network; one-way gateways are not supported by the engine.

### Existing gateways editor

The collapsed **Existing gateways (N)** section of Planes shows actual gate groups touching the active plane.

- A gate number must be a unique positive safe integer.
- Every endpoint with the same number is mutually connected; a group with three or more endpoints is a network, not a sequence.
- Each endpoint displays its plane, local province number, and name. Hover the province line to see its stable internal ID.
- An endpoint can be reassigned to another province on its stored plane.
- The same province cannot appear twice in one group.
- Delete removes the entire gateway group.

Validation requires at least two valid, non-blocked endpoints and a route from every plane back to plane 1. Surface-to-Cave/Cavern/Underworld endpoints must match wet/dry status. Generated endpoints try to remain at least two connections from every start; adjacent fallbacks produce warnings.

## Scenario tab

Scenario options affect export directly and do not require regeneration. They are grouped into collapsible sections. **Game info** starts open; the others start collapsed, and each heading summarizes the current values (for example *Sail 2 · sites 50 · no ascension target*).

**Game info** (Host / export)

- **Description:** main map description. Secondary planes receive the description plus their plane name.
- **Minimum Dominions version:** range 600-999; emits `#domversion`. The default 635 means Dominions 6.35. This is a minimum file-compatibility declaration, not the host's actual patch or the selector-catalog version. The 6.37 catalog refresh added no IDs and does not automatically raise existing maps' minimum version.

**Victory & rules** (Host / export)

- **Sail distance:** range 1-10; emits `#saildist`.
- **Site frequency:** range 0-100; emits the global `#features` value.
- **Ascension points:** optional 1-999; emits `#victorycondition 6 N`. Blank leaves that victory condition unspecified.

**Nations & AI** (Host / export)

- **Allowed nations:** emits `#allowedplayer`. Empty means unrestricted. A nonempty list must contain at least as many distinct nations as Players.
- **Computer-controlled nations:** forces selected nations to AI. Easy = 1, Normal = 2, Difficult = 3, Mighty = 4, Master = 5.
- **Cannot-win nations:** emits `#cannotwin`.

**Visibility & naming** (Host / export)

- **Reveal map image:** project-level `#mapnohide`.
- **Disable random deep-cave planes:** project-level `#nodeepcaves`.
- **Hide deep-plane choice:** emits `#nodeepchoice`.
- **Disable homeland names:** emits `#nohomelandnames`; useful when authored capital names must be preserved.
- **Disable name filter:** emits `#nonamefilter`.

**Advanced: map-level directives** (Host / export)

- **Map-level directives:** advanced commands appended only to plane 1.

**Population-matched defenders** opens by default only when the policy is on; its heading reads **Off** or **On · N provinces**. **Catalog data** holds the [Catalog manager](#catalog-manager).

Playable nation IDs must be safe integers 5 or greater. Unknown IDs require matching custom content in Dominions.

### Population-matched initial defenders

In **Scenario → Population-matched defenders**, enable **Match ordinary defenders to recruitment population** to replace eligible ordinary initial armies at export. The option is off by default. Both manually assigned and generated population types use the same rule; changing a province's population type updates its preview immediately without regenerating the map.

The current **v3** revision supports **76 population types**, including 41 of the 45 types used by the generator, for **unmodded Dominions 6.37, Middle Age**. Declare the host patch and era explicitly; neither is auto-detected. Each template lists its tested land/water and Cave requirements under **Verified template scope**. For example, Cavemen use one Caveman Champion and eight Cavemen; Pale Ones use one Pale One Commander and fifteen Pale Ones in dry Cave terrain. The coverage panel lists matched, preserved, excluded and unsupported provinces so partial coverage is visible.

Onyx Amazons #43, Troglodytes #44, Mermen #72, Ko-Oni #88, Wet Ones #105 and Nexus #106 remain unsupported. Missing commanders, empty recruitment lists and unresolved mount/shape behavior are not filled with guessed armies. Other eras, patches, mods and unsupported terrain also retain native defenders.

Existing custom or generated guardian groups always take priority and remain unchanged. Starts and every directly connected neighbor, including gateways, cannot receive automatic armies. Locks, explicit owners, blocked provinces and thrones are also excluded. Raw directives anywhere in the atlas suppress all automatic templates because those commands can select or change other provinces.

Inspect the read-only **Initial-defender preview** in the selected province's inspector to see its resulting commander and squads. This option does not change recruitable units, create game content, modify replenishing post-capture PD, or guarantee equal combat difficulty. Counts are fixed template choices, not the game's independent-strength formula.

Saved projects pin a template revision. The earlier empty v1 remains empty, and v2 retains its single Pale One template. Use **Use current verified profiles** explicitly to adopt v3, then review coverage. No saved map silently adopts different armies during an update. [Evidence, counts and verification limits](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/research/NATIVE_POPULATION_DEFENDERS_2026-09-21.md) are available for maintainers. Native creation and hosting were checked; exact final troop counts and combat-equivalent difficulty are not claimed.

## Iterate tab

Tools for refining the current atlas. Sections run from everyday edits to rarely used tools: **Choose provinces / named regions**, **Batch edit selected provinces**, **Reroll content without changing geography**, **Protect authored fields**, **Layout and start safeguards**, and **Compare generated candidates**, followed by a **Tools** group with settings recipes, read-only native-map inspection, and the isolated guardian test scenario.

Batch edits, field locks, regions, rerolls, recipes, and candidate replacements show a preview before **Apply previewed change**. The preview card opens directly below the section that produced it, scrolls into view, and receives keyboard focus; errors appear in the same place. Selection-based previews also highlight in teal the provinces they would change (or, if nothing changes, the matched selection); **Clear highlight** on the map banner removes it, and applying the change ends it. Each application is one Undoable edit. **Discard preview** leaves the atlas unchanged; after either button, focus returns to the control that opened the preview. Previews tied to an older project are not applied over newer edits. Continue to save JSON backups before major changes.

### Choose provinces and save regions

Work on the active plane. Select **Only the currently selected province**, or combine role, primary terrain, effective terrain flag, name/local number, and named-region filters. **Non-capitals** excludes generic, team, and nation-specific starts; it does not mean the province has no owner. The effective-flag filter includes flags supplied by primary terrain as well as additive flags.

Check the match count and use **Highlight selection** before editing. Up to 64 named regions can remember selected province IDs. Removing a region removes only its bookmark. Regeneration or plane removal can trim or remove bookmarks when their province IDs disappear; bookmarks do not constrain future geography. Use [regional generation plans](#generation-preferences) for a persistent north/south/etc. terrain preference instead.

### Batch editing and content rerolls

Batch operations add/remove terrain flags, replace primary terrain, set population/poptype, change Many sites or climate, or clear guardian groups. Review matched/changed/skipped counts and sample provinces. Relevant locks and protected capitals are skipped; site changes also protect their direct surroundings. Clearing unlocked guardian groups remains possible to repair conflicts. A preview that introduces new export errors cannot be applied. Existing errors still need attention before export.

Content-only rerolls use the **Content / candidate seed** and selected provinces. Choose generated names, population/local recruitment, site flags/affinities, or initial guardians. Geography, borders, starts, and gateways remain fixed; manual names remain intact. Economy/site rerolls exclude capital rings, and guardian rerolls use a two-step buffer. Rerolling site content does not promise a new set of named magic sites or a combat-balanced reward.

### Layout, start, and field locks

- **Lock layout, borders, gateways and dimensions:** rejects changes to that structure and blocks full generation. Content-only edits and rerolls remain available.
- **Lock generic, team and nation starts:** rejects changes to saved start locations/assignments. Unlock before moving starts or generating a different start layout.
- **Protect authored fields:** select provinces and a field group, then preview **Protect selected** or **Unlock selected**.

| Field group | Protected content |
| --- | --- |
| Name | Province name and generated/manual provenance |
| Terrain | Primary/additive terrain, biome, size, freshwater, and climate markers |
| Economy | Population, poptype, unrest, ownership, owned PD, fort, temple, and laboratory |
| Sites | Placed sites, Many sites, site affinities, random-site removal, and throne setup |
| Guardians | Guardian groups, battle settings, and raw province directives |

Field locks protect batch/reroll tools and compatible same-seed generation. They do not prevent intentional edits in the province inspector, and they do not lock positions. Changing the world seed changes province IDs: full generation is rejected if locked provinces would disappear. Changed sizes, terrain media, or capital safety can also conflict with locks. Use a content-only reroll or unlock explicitly; Atlas does not silently discard protected content.

### Compare generated candidates

Generate two or three alternatives in background workers using the world seed plus the content/candidate seed. The current atlas is unchanged until you review a candidate replacement and apply it. Cancel stops the run; no candidate is selected automatically by its score.

Cards show structural score, smallest two-step start region, two-step spread (CV), and export blockers/warnings. A lower CV means more similar region counts, not equivalent economies or combat access. Expand a candidate's preview and select any of its planes to inspect it; maps render only when requested. No displayed score proves practical multiplayer balance. Layout lock blocks candidate generation; field/start locks can reject alternatives that conflict with them. Candidate replacement is Undoable, but save a project backup before accepting a new geography.

### Tools

The last group holds tools most sessions do not need: settings recipes, read-only inspection of external native maps, and the isolated guardian test scenario. None of them edits the current atlas unless you apply a recipe preview.

#### Settings recipes

**Balanced FFA**, **Continental rivalry**, **Naval geography**, and **Strategic frontiers** provide starting settings, not guaranteed balanced maps. They do not choose nations or change the player/start allocation for you. Preview and apply, review the generation plan, then Generate.

**Download settings recipe** saves generation settings, plane configuration/preferences, declared host patch/era/mod assumptions, and any pinned population-defender policy. The world seed is optional and excluded by default. Open a recipe file or paste its JSON to preview it; the limit is 256 KiB. Imports match plane configurations by order, preserve existing plane names/content, stage missing planes, and refuse to delete extra existing planes. Older recipes that omit host assumptions or the defender policy leave those current settings unchanged. Changes to archetype, dimensions, or wrapping can update current ownership presentation/borders; layout locks still apply. Full generation follows only when you request it.

A recipe is not a map backup: it omits authored provinces, actual gateways, field locks, and saved selections. Use **Editable project JSON** for an exact atlas copy.

Including the seed lets an equivalent fresh atlas reproduce generation in the same generator revision, even when its internal plane IDs differ. Match plane order and names as well as settings; destination manual names, authored starts and locks remain intentional differences. Older recipes remain readable but run the current generator when you choose Generate, not their historical generator.

#### Inspect external native maps

Expand **Inspect external native maps · Read only**. Paste `.map` text, inspect the current plane's compiled native text, or choose a `.map`/`.d6m` file. `.map` input is limited to 16 MiB; `.d6m` input to 40 MiB with additional dimension/structure limits.

The report inventories terrain records, names, starts, neighbors, border modifiers, gates, commanders, units, and unrecognized commands. A D6M report checks supported binary structure. Nothing is executed, followed, uploaded, or added to the atlas. Image references are shown but not opened. Recognition is not full command validation or proof of game compatibility. Lossless editable import of arbitrary native maps, TGA artwork, and custom raster ownership is not supported.

#### Isolated guardian test scenario

Choose an authored guardian province and **Prepare separate fixture**. Atlas generates a separate two-player, 48-province map in the background, in the source plane's family, with the copied encounter named **GUARDIAN TEST** outside protected capital zones. The source selection is held while generation runs; **Cancel fixture generation** stops it. Download the fixture's own JSON or ZIP; the current atlas is not replaced and no game saves are written by this tool.

When no matching dry/water/cave target exists, Atlas can adapt a safe target province to the source terrain and displays that limitation in the fixture description. The surrounding test geography is not copied from the source. Preparation fails without changing the source if no safe target fits or the fixture has export errors.

Install the fixture as a separate map and create a new test game. Choose suitable nations, mods, host settings, and attacking armies yourself, including movement abilities needed to reach water/cave targets. Random independents elsewhere still follow game/host rules, and referenced battle assets need separate copying. The fixture is a manual playtest aid, not a combat simulator or proof that a guardian roster is fair.

## Map tools and navigation

### Select

Selects a province and opens the inspector.

### Link

Click two provinces on the active plane.

After the first click, the armed-state banner at the top of the map identifies the source plane and province number. If you switch planes, return to the source plane for a shared-border destination, or click a province on the active plane to replace the source. **Cancel endpoint** clears the pending source.

- Existing links are not duplicated.
- On a solid plane, provinces must share a positive-length visible border.
- On a sparse plane, a new link creates the corresponding visible and D6M corridor.
- It creates a Standard border; change its type in Advanced.
- It does not delete an existing border.

Use Gate for cross-plane travel or a remote connection that should not be a normal neighboring border.

### Gate

Click the first province, switch planes if desired, then click the destination. The armed-state banner retains the exact source while you navigate; **Cancel endpoint** or clicking the armed province again cancels. The tool creates a new two-endpoint gateway with the next unused number and reports whether the result is same-plane or cross-plane. It permits a remote same-plane pair.

### Start

Toggles a generic player start. Enabling it clears that capital's guardian groups and fixed throne, clears No random start, and changes throne treatment to Avoid. Other authored economy, sites, and buildings remain. See [Starts](#starts) for nation-specific cleanup and nearby validation.

### Throne

Cycles **Neutral -> Preferred -> Avoid -> Neutral** and clears a fixed-throne selection.

### Site

Toggles the **Many sites** terrain bit. It does not place a named magic site; use Sites & guardians for that.

### Condition preview

Options are Normal, Frozen/winter, Forested, Submerged, Wasted, and Farmland. The **?** button beside the selector explains the preview limits, and the plane title card names the active preview whenever it is not Normal. This selector changes only the editor and exported PNG preview, not project terrain or the starting conditions of a game. Native D6M lets Dominions render actual condition changes. The optional Illustrated realms exporter independently builds its complete terrain/winter image set; you do not need to select or export each preview condition.

These previews are illustrative, not simulations of temperature or game events. Winter cover skips water and caves. Cloud/Air dry islands receive their existing winter treatment; the newly illustrated Underworld, Infernal, Abyss, Dream, and Elemental realms do not gain snow. Warmer and Colder flags adjust cover only on eligible dry land. Submerged adds water while retaining cave identity and turning forest cover into kelp. Forested, Wasted, and Farmland replace incompatible vegetation instead of leaving the original symbols underneath; Farmland does not turn seas or caves into fields.

### Pan, zoom, Fit, and plane switching

Drag to pan, use the wheel/trackpad to zoom from 78% to 400%, and choose **Fit** to return to 100% and center the plane. Use the strip below the map to switch planes.

The editor preserves the map's aspect ratio, so unused space may appear around it. Province labels appear from 135% zoom; they avoid markers and other labels, and labels that cannot fit are hidden. Hover over or select a province at any zoom to read its full name and start, throne, or gateway details.

## Province inspector

The header shows the editable province name and a **Current Map** note: every inspector edit changes the current map immediately, and Undo reverts it. Editing the name marks it manual, so normal generation and name rerolls preserve it. The decimal Dominions 64-bit terrain mask is shown on the Advanced tab.

### Terrain tab

#### Primary terrain

The primary terrain is a preset that contributes mechanical flags. Artwork uses the complete combination, including any additional flags:

- Plains
- Forest
- Farmland
- Swamp
- Waste
- Highlands
- Mountains
- Sea
- Deep sea = Sea + Deep
- Kelp forest = Sea + Forest
- Caves
- Cave forest = Cave + Forest
- Cave swamp = Cave + Swamp
- Cave waste = Cave + Waste
- Cave highlands = Cave + Highland
- Cave wall = blocked Cave-wall terrain; selecting it also removes generic, team, and nation-specific starts, throne setup, catalogued throne sites, and guardian groups

Changing primary terrain does not normally recalculate manually edited population, poptype, guardians, or biome. Cave wall is the safety exception: blocked space cannot retain a start, throne, or guardian group. The same cleanup applies when a primary-terrain edit retains an additional Cave Wall flag.

#### Biome

Biome is saved descriptive metadata. Changing it alone does not change terrain flags, artwork, province names, or gameplay. Use Primary terrain and Additional terrain flags to change terrain. The available labels are:

Heartland, Wildwood, Marshlands, Sunscorched, High country, Tundra, Archipelago, Deep ocean, Living caves, Crystal deeps, Ashen deeps, and Void reaches.

#### Size, climate, and terrain properties

- **Province size:** Normal, Small province, or Large province. Small and Large are mutually exclusive bits.
- **Climate:** Normal, Warmer, or Colder. Warmer and Colder are mutually exclusive climate bits.
- **No random start** blocks random placement and clears a generic start.
- **Many sites** adds the site-rich terrain bit.
- **Fresh-water marker** is an auxiliary bit; it remains land unless Sea is also set.

#### Additional terrain flags

Sea, Highland, Swamp, Wasteland, Forest, Farm, Deep sea, Cave, Mountains, and Impassable cave wall can be combined additively. The tab shows what the primary terrain already contributes and the resulting effective mask; **About terrain flags** holds the combination, Cave Wall, and artwork notes.

The cave-wall cleanup and mixed Swamp/Sea relief corrections described below are unreleased repairs on current main. The published 0.1.5 build does not include them.

Changes repaint the map immediately and appear in the [high-resolution PNG preview](#preview-png). Mixed terrain combines its colors, materials, and symbols: Farm adds field rows, Forest adds trees (kelp under water), and Cave adds cave details. Mountains, hills, marshes, waste, and water have their own marks. Details fit within the province and remain clipped on irregular, narrow, and wrapped shapes; zoom in on small provinces. Fresh water adds a water marker without turning land into a sea. Deep sea only has an effect when Sea is also present.

Download or install the package again after editing; a new Dominions game uses the updated terrain flags. You do not need to regenerate the atlas or edit image files. Native scenery carries geography/elevation in `.d6m` and terrain in `.map`, then lets Dominions draw its own art. Illustrated realms also rebuilds the supported realms' custom images from the current flags. It does not bake editor labels, selection or analysis overlays into the game image. Existing games do not automatically adopt terrain edits; use a new game when changing export mode or province numbering.

Useful combinations:

- Sea + Mountains/Highland: underwater-mountain terrain matching.
- Sea + Forest: underwater forest or kelp.
- Sea + Cave: flooded cave.
- Fresh water without Sea: land.
- Deep without Sea: no aquatic effect.
- Swamp + Forest: wooded marsh, retaining low swamp relief (also for Cave + Swamp + Forest). Explicit Highland or Mountains still raises land relief.
- Cave wall: blocked and No start; either the primary preset or additional flag clears all start assignments, throne setup, sites identified as thrones by the active catalog, and guardian groups.
- Sea + Cave wall: still blocked, with both terrain flags retained and submerged native relief. Validation warns that this mixed terrain's in-game appearance has not been verified. Remove Cave Wall if you intend navigable water.

Validation warns when Forest, Swamp, Waste, Highland, and Mountains exceed the manual's recommendation of at most two adverse types.

Cave-wall cleanup is a single Undo-able edit. Unchecking the flag does not restore deleted contents; use Undo to restore the previous province and its start assignments. A global start lock refuses edits that would change starts. Batch edits respect field locks; intentional inspector edits can override them as described under [authoring locks](#layout-start-and-field-locks).

Unrelated economy, ordinary or unrecognized sites, battle settings, and raw directives are preserved. Recognized guardian/throne-site commands in a blocked province's raw directives must be removed explicitly before export. Imported projects are not silently cleaned: validation and playable-package export reject blocked provinces with throne setup, catalogued throne sites, or guardian groups/commands. Project JSON can still be saved while resolving these errors. Plane/project-level raw commands are not fully interpreted by this check and still require host review; they can override structured content or terrain.

#### Magic path bias

Fire, Air, Water, Earth, Astral, Death, Nature, Glamour, Blood, and Holy add random-site affinity bits. They influence random site selection; they do not place a site or grant magic to a province.

### Gameplay tab

#### Starts

- **Generic player start:** emits `#start`.
- **Team-start group:** emits `#teamstart`; use a non-negative integer smaller than the number of teams selected by the host.
- **Specific-start nation:** emits `#specstart` for a playable nation and the province's global cross-plane number. Assigning it clears independent guardians, placed sites, throne setup, ownership, economy/PD overrides, forts, labs, temples, battle overrides, raw province directives, and any team-start marker. It preserves terrain, geography, climate, province name, and an existing generic-start marker. Undo is available if you selected the wrong province.

Enabling a generic start or assigning a team-start group clears that capital's guardian groups and fixed throne, clears No random start, and sets throne treatment to Avoid. Unlike nation-specific assignment, it preserves other authored economy, sites, and buildings. Nearby authored conflicts are reported by validation, not automatically erased.

Generic, team, and nation-specific starts all count as start locations in safety validation and in the live fairness calculation. Starts must remain at least three global movement steps apart and may not have blocking or condition-dependent starting borders. Their provinces and directly connected neighbors are protected from generated guardians, special defender units, and thrones. After any manual start edit, spacing, two-ring expansion, nearby-throne access, local connection degree, and the overall score recalculate immediately across ordinary borders and cross-plane gates. The start-allocation score remains based on generated generic slots, so a nation or team annotation does not falsely change the requested land/coastal/water/cave counts.

#### Thrones

- **Neutral:** no preference.
- **Preferred:** recommends the province to Dominions.
- **Avoid:** discourages throne placement.
- **Fixed throne site:** places an exact catalog-verified Throne of Ascension as a hidden feature.

The Generate throne count creates preferred locations, not fixed sites. Fixed thrones can conflict with random unique-site selection, so preferred locations are safer for ordinary multiplayer generation. Starts and thrones should be at least two connections apart.

#### Ownership and economy

This section is folded unless the province already has an override; its heading shows how many values are set.

- **Owner nation:** `#owner`; valid independent owners are 0, 2, and 4, or use a playable nation ID 5+.
- **Population type:** vanilla `#poptype`, controlling local recruitment.
- **Fortification:** `#fort`.
- **Population:** 0-50,000.
- **Unrest:** 0-500.
- **Owned PD level:** 0-125; emits `#defence` only for a playable-nation owner.
- **Temple:** `#temple`.
- **Laboratory:** `#lab`.

Population type affects local recruitment; it is not a separate initial-army or custom-PD roster identifier.

### Sites & guardians tab

#### Placed magic sites

- **Remove randomly generated sites:** emits `#killfeatures` before authored sites.
- The default picker includes all ordinary rarity 0-4 province sites. The filter row shows how many sites the picker currently offers; **About these lists** gives the pool sizes and notes.
- **Show terrain mismatches** (filter chip): reveals entries that do not match the province's additive terrain/coast location mask.
- **Include all non-capital sites** (filter chip): adds verified non-random sites that are not nation homes/capitals or thrones.
- Nation home/capital sites are deliberately excluded. Thrones are selected under Gameplay.
- **Place magic site:** adds a row; fill or remove it because an empty row blocks export.
- **Known:** emits `#knownfeature`; unchecked emits hidden `#feature`.

Compatibility includes plain, forest, mountain, waste, farm, sea, coast, swamp, deep sea, cave, underwater mountain, underwater forest, and underwater coast.

#### Guardian groups

Guardian groups are explicit initial independent defenders, not replenishing post-capture PD.

- The **Initial-defender preview** for population-matched defenders appears above the guardian groups on this tab.
- The standard picker browses gameplay unit records; obvious test, debug, and unused records stay hidden.
- **Use role-focused lists** (filter chip) narrows the picker to known commanders or troops. Unusual summons and independents remain available in the broader list. **About these lists** explains the map-only boundary and the role sources.
- Exact numeric IDs remain accepted, including valid records hidden from normal browsing.
- A group contains a Commander, optional display name, and any number of squads.
- Each squad has a unit and count from 1 to 1,000.
- Commander details include experience 0-900, random items 0-4, specific item names, Clear innate magic, bodyguard unit/count, and Fire/Air/Water/Earth/Astral/Death/Nature/Glamour/Blood/Holy levels 0-10.
- Holy exports as priest magic.
- Multiple groups create multiple commander blocks.
- Empty commanders or squads are validation errors.
- Specific items use item names, not numeric IDs.
- Guardians are disabled on generic, team, and nation-specific starts to protect the nation's starting army and pretender. Generation also leaves every directly connected province free of guardian and special-defender groups. Assigning a nation-specific start removes conflicting capital content already present, and validation blocks stale imported/manual capital content until that start is reassigned through the editor.

Cave/Great Cavern and most Surface variants use ordinary independent strength. Cloud, Air, Underworld, Infernal, Abyss, Dream, and Elemental use stronger themed commanders and multiple large squads. The same stronger setup also applies to Oceanic Surface and all Custom variants except Temperate, Frozen, and Arid; guardian strength is not determined solely by whether a plane counts as bonus size.

Persistent post-capture PD comes from a vanilla population type or nation. A wholly new replenishing PD roster requires a separate `.dm` mod.

### Advanced tab

#### Incident borders

Every saved border emits `#neighbour`; its type may add `#neighbourspec`:

| Type | Special value | Meaning |
|---|---:|---|
| Standard | 0 | Ordinary connection |
| Road | 8 | Road |
| River | 2 | River |
| Bridge | 16 | Bridge |
| Mountain pass | 33 | Mountain border + pass |
| Mountain border | 32 | Mountain border |
| Impassable | 4 | Declared neighbor but blocked movement |
| Custom | 0-255 | Editable native border bitmask |

Choosing Custom starts with the existing border value (0 for Standard) and reveals a numeric editor. Combine documented bits by adding them: pass 1, river 2, impassable 4, road 8, bridge 16, and mountain 32. For example, 10 combines river and road. The preview layers the recognized styles; undocumented bits 64 and 128 receive a purple dotted indication without claiming a game effect. Use named types unless you need a combination or know the intended native value.

#### Province battlefield

- **Skybox:** emits `#skybox`.
- **Battle map:** emits `#batmap`; `empty` is accepted.
- **Ground RGB**, **Rock RGB**, and **Fog RGB:** normalized 0-1 or integer 0-255 triplets; normalized values are converted to integer channels.

Referenced `.tga`, `.rgb`, or `.d3m` assets are not bundled automatically. Copy them into the exported map folder; validation warns when external assets are referenced.

#### Terrain mask and raw directives

**Terrain mask** shows the decimal Dominions 64-bit value built from the Terrain tab's primary terrain, flags, and climate.

**Province directives** are appended inside that province's `#land` or `#setland` block after structured features and guardian commands. **Plane directives** apply to the whole selected plane, not only this province; the same plane-level text can also be edited from the Planes tab. See [Raw directives](#raw-directives).

### Raw directives

- **Province directives:** appended inside that province block.
- **Map-level directives:** appended to plane 1 after structured province blocks.
- **Plane directives:** appended at the end of the selected plane file. Edit them in **Planes → Display, flags & plane directives** or in the province inspector's Advanced tab.
- Only trimmed lines beginning with `#` or `--` are exported; other text is discarded.
- Raw commands are not syntax-checked, deduplicated, or reconciled with structured controls.
- Command order and scope are your responsibility.
- They do not install mods or package referenced assets.

Any active raw `#` command, whether at map, plane or province level, blocks **Illustrated realms** export. Its numeric province references cannot be safely inferred after image-based renumbering. Use **Native scenery**, or move the command's intent into supported structured controls. Comment-only raw notes do not trigger this restriction.

Use the official map manual. Rare scenario commands such as `#god`, `#dominionstr`, and `#scale` belong at map level. Leave mandatory generated commands such as `#dom2title`, `#imagefile`, dimensions, and structured geography to the program.

## Catalog manager

The 0.1.5 source bundles a pinned Dominions 6.37 selector catalog covering units, sites, population types, nations, and forts. See the [catalog coverage and provenance notes](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/CONTENT_CATALOG.md) for its source and exact IDs. It does not automatically track later game updates. Pickers search names, aliases, tags, and numeric IDs. Older published builds may still use the 6.35 snapshot. The separate recruitment-membership table is evidence for roster identities, not a claim that every population has an accepted automatic defender template.

- **Sources & license:** shows data provenance.
- **Import verified JSON:** accepts up to 8 MiB of UTF-8 JSON and merges a schema-valid catalog with bundled entries. Custom entries override matching IDs for lookup/display. The label does not independently authenticate user-supplied data; use a source you trust.
- **Download template:** downloads the required schema and provenance structure.
- **Reset custom entries:** removes device-stored additions and returns to bundled-only lookup.

Custom catalogs are stored separately on the device and are not embedded game content. Importing an ID does not install a `.dm` mod or add that content to Dominions. Back up custom catalog JSON separately and enable any matching game mod when required.

Imports merge in selection order. Reset cancels pending imports, and a failed save leaves the previous catalog active. Validation reports in both ready ZIPs and direct installs use the active catalog and identify its version assumptions; they do not certify custom content or include the custom catalog JSON.

## Validation and balance report

Choose **Validate** in the header before export. The drawer starts with the number of export blockers, warnings, and notes, then lists the issues grouped in that order. The structural fairness score and its subscores are in the folded **Structural fairness** section at the end.

- **Error:** blocks direct install and ready ZIP.
- **Warning:** does not block export but identifies compatibility or quality risk.
- **Info:** confirms readiness or provides context.

Editable project JSON and PNG preview remain available even when playable export is blocked.

Validation checks include start counts/categories/spacing, start exits, throne and gate exclusion zones, terrain combinations, catalog IDs, site compatibility, plane connectivity, wet/dry underground gateways, border topology, D6M dimensions/ownership, filenames, Scenario ranges, and required map commands.

### Fairness score

The score is a legacy structural heuristic, not an export gate or certificate of nation, combat, or economic balance. Its display bands are:

- **85-100:** excellent
- **70-84:** fair
- **Below 70:** poor

It combines:

- Expansion parity: 22%
- Start spacing: 20%
- Nearby-throne parity: 14%
- Start-degree parity: 14%
- Terrain variety: 10%
- Connectivity: 10%
- Start-category allocation: 10%

Nearby-throne parity counts throne markers within four potential graph hops, including valid gates. These are not conquest turns: the graph does not simulate sailing, flight, seasonal barriers, or a nation's ability to enter water. Remote or unreachable thrones are neutral. The score penalizes unequal nearby-throne counts between starts; it does not punish an equal abundance of nearby thrones.

Sparse bonus realms are scored according to their intended route/chamber profiles rather than being treated as defective because ordinary provinces have only one or two exits.

Clicking a validation issue that identifies a plane/province navigates to it when possible.

### Start-region analysis

Open **Start analysis…** under Generate, from the fairness status in the footer, or in Validate's **Structural fairness** section. The panel separates export blockers, the **Structural score** (including low subscores), and limited analysis confidence. All generic, team, and nation-specific start locations are included and deduplicated. Manual map edits recalculate the current diagnostics; they do not need regeneration.

Choose an access model:

- **Potential connections:** includes land/water transitions and potentially traversable rivers/passes. This is a topology view, not an army-movement prediction.
- **Conservative dry / water-separated routes:** keeps dry starts on dry provinces and water starts underwater. It excludes rivers, mountain passes, mountain borders, and their corresponding custom border bits. A gate must connect the same medium to be traversed in this view.

Both models count a gate as one graph hop, ignore blocked provinces, and omit all capitals from expansion counts. Neither simulates sailing, flight, seasonal scales, movement costs, ownership, battle outcomes, or conquest turns. Same-number team-start annotations are treated as allies, including group zero; the host must configure the intended teams.

Each row shows useful exits, provinces within two/three steps, two-step exclusive/contested access, known population plus the number of unknown provinces, authored guardian provinces, nearby preferred/fixed throne markers, and nearest rival/throne/cross-plane entrance. Exclusive means strictly closer than every competing start; contested includes ties and provinces a rival reaches sooner. Neither predicts ownership. Missing or invalid population values count as unknown rather than inflating the total; invalid values still block playable export. Population is not income/resources; random independents and guardian difficulty remain unknown. Throne markers do not certify final engine placement.

The analysis also shows:

- **Fractional opportunity:** one share for a distance lead, a split share for rival ties, and zero where a rival is closer. Allies do not compete; do not sum these values as a team economy.
- **Hostile frontier groups:** distinct opposing team/start regions touching the two-step neighborhood, not a count of gates or enemy armies.
- **Nearest ally** and **shared direct surroundings:** reveal nearby team support and overlapping capital neighbors; shared surroundings include allies.
- **Nearest preferred/fixed throne:** separates recommended locations from explicitly placed thrones.

Click a start name to navigate safely to it and highlight its two-step region in teal. The overlay is editor-only, works across plane switches, and is hidden after project edits so it cannot present stale results. **Clear highlight** removes it. PNG and playable exports never include this overlay. `—` means no reachable target, a blocked start, or incomplete analysis.

Analysis is capped at 64 start locations for responsiveness. Larger imported start sets show an incomplete-analysis warning and no exclusive/contested comparison. This is an analysis limit, not a new limit on saved scenario starts.

### Patch and mod assumptions

Under **Game patch and mod assumptions**, record the intended game patch, era and mod names/versions. These are user declarations, not auto-detected compatibility or settings applied to Dominions. They are saved in project JSON and host-facing reports. Editing them never changes geography or applies nation compensation; if population-matched defenders are enabled, the declarations also control which templates are eligible at export.

A missing patch, a mismatch with the selector catalog, or declared mods is explicitly unverified. Even an exact catalog-version match certifies neither nation movement nor combat balance. The model identifier (`structural-inspector-2`) versions these structural assumptions independently of game patches. Reassess nation-specific expectations after any game or mod update.

### Optional nation terrain requirements

**Optional nation terrain requirements · Check only** is inside the start-analysis panel. Declare a patch first, then record a requirement label, nation ID, terrain flag, minimum count (1–20), and graph radius (1–3). These are host requests, not facts about what a nation needs. Up to 64 can be saved with the project and included in host reports.

Each check needs exactly one nation-specific start. Random/team slots alone do not identify a nation. Counts exclude every capital and use potential graph connections, not a nation's real movement or recruiting ability. Results are **met**, **shortfall**, **unassigned**, or **unverified**. Changing patch/mod declarations invalidates the snapshot until you deliberately reconfirm it; reconfirming is a host declaration, not game-data verification.

Atlas never grants automatic terrain, income, resources, or nation bonuses from these requests. If you choose to accommodate one, inspect the start and preview an explicit edit through Iterate, then reassess the whole map.

## Saving and reopening projects

### Autosave

Atlas autosaves shortly after project changes. Wait for the saved status or choose **Save now** before closing when the map matters.

- **Device autosave:** IndexedDB, the preferred large-project store.
- **Limited autosave:** localStorage fallback with a smaller quota.
- **Autosave unavailable:** no browser copy could be written; download project JSON immediately.

Autosave belongs to the current browser and site address. It is not cloud synchronization, clearing browser data removes it, and it stores one current project rather than a project library. If another tab or storage copy conflicts, autosave pauses and asks whether to inspect/load the newer copy or keep the current one. **New atlas** replaces the autosave after confirmation; Undo history does not survive a reload. Keep portable project JSON backups.

Loading a recovery/conflict copy preserves the displaced project in Undo during that session. If you edit the project or start another project-opening action while the copy is being read, the older request is discarded instead of replacing your newer work.

If saved data cannot be opened, automatic saving pauses and **Download recovery data** preserves the original bytes. **Keep this copy** downloads that recovery backup before replacing them. Edits exceeding project limits are rejected with a persistent message; the previous project stays intact. Unfinished guardian groups can still be saved and reopened, but must be completed before playable export.

`Pantokrator-Atlas-autosave-recovery.json` preserves unreadable saved text for recovery; it is not directly importable with **Open project**. Keep it separately from normal `.atlas.json` backups.

### Undo and Redo

The header buttons keep up to 30 project snapshots. A new edit clears Redo. Undo/Redo restores project data but not view-only state such as zoom, pan, active tool, inspector tab, condition preview, or catalog filters. There is no global Ctrl/Cmd+Z shortcut; use the visible buttons.

### Editable project JSON

Projects saved by current source can contain optional analysis requirements, host-era declarations, pinned population-defender policies, generation-input snapshots, per-plane preferences, locks, saved selections, and natural-landform/water-shape provenance. It opens older schema-v1 projects without inventing a generation baseline, upgrading their defender revision or adding the new natural-shape marker. Older app versions may reject these fields; keep a pre-upgrade backup if you need to return to an older app.

Choose **Install / export -> Editable project JSON** for a portable backup named `<map-name>.atlas.json`. Host packages and direct installs also include `atlas_project.json`; player ZIPs deliberately do not.

Choose **File -> Open project…** and select either file to reopen it. **File -> Download project JSON** saves the same `<map-name>.atlas.json` backup from the header. The importer accepts up to 16 MiB of UTF-8 Atlas schema-v1 JSON with at most 8 planes and 800 provinces per plane. It does not open ZIP, `.map`, `.d6m`, custom catalog JSON, or arbitrary JSON.

After choosing **Add plane to plan**, the new plane has no provinces until generation. That planned state round-trips through autosave and project JSON, but it remains a playable-export error until you configure the plan and Generate.

Project JSON is editable source, not a playable map. Custom catalogs are stored separately and should be backed up separately.

## Installing and exporting

Open **Install / export** in the header after validation.

### In-game artwork

This selector is available on **current main**, but not in the published hosted app or Windows v0.1.5:

| Choice | Playable output |
| --- | --- |
| **Native scenery (existing exporter)** — default | `.map`/`.d6m` for every plane; Dominions draws terrain and seasonal scenery. Atlas's custom realm pixels are not embedded. |
| **Illustrated realms (custom artwork)** | Generated TGA landscapes and exact province ownership for Cloud, Air, Cave, Great Cavern, Underworld, Infernal, Abyss, Dream and Elemental planes. Surface and Custom remain native. No extra mod or image assembly is required. |

Illustrated export produces 18 sheets per supported plane: base and winter, plus forest, waste, farm, swamp, highland, plain, kelp and water, each with a winter counterpart. The engine chooses the appropriate areas during play. Cloud/Air winter sheets add snow on eligible dry islands; the other illustrated realms intentionally retain their palette in winter. Sheets preserve province silhouettes and click areas; they do not imply that every terrain/season transition has been visually tested in-game.

Image-based province numbers follow Dominions' white-pixel scan order. Atlas remaps structured starts, guardians, sites, neighbors and gateways automatically without changing the editable project or its analysis. The editor, `balance_report.txt` and `host_topology.txt` retain editor numbers; `host_settings.txt` includes the editor-local/global → in-game-local/global mapping for every province.

**Start a new game when changing artwork modes.** Do not replace a running game's files with a differently numbered export. Keep the same complete package for host and players. Active advanced raw commands block illustrated export; they remain available with Native scenery.

Illustrated packages take longer to render and can be much larger. The dialog's size and memory checks change with the selected mode. Prefer **Install directly** for large illustrated maps; it stages one image at a time. [Verification and remaining limits](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/ILLUSTRATED_EXPORT_2026-09-22.md#verification-and-limits) distinguish actual native-game observations from automated checks.

### Package contents

A host package (**Download ready ZIP** or **Install directly**) contains:

- Main `.map` and `_plane2` through `_plane8` `.map` files as needed.
- Native planes' corresponding `.d6m` files. If the first plane is illustrated, later native planes use `_realmN.d6m` aliases instead of `_planeN.d6m`; Atlas writes the matching references automatically.
- With Illustrated realms: 18 TGA images for each supported plane, named `<map-name>_realmN.tga`, `<map-name>_realmN_winter.tga`, and terrain variants, plus `atlas_artwork.json` ownership records. These image names are intentional; do not rename them to `_planeN`.
- `INSTALL.txt`.
- `atlas_project.json`.
- `balance_report.txt`: legacy score, validation, both per-start structural models, declared patch/era/mod assumptions and requirements, plus enabled population-defender coverage. Treat this as host-facing analysis.
- `host_settings.txt`: intended host setup, the same patch/era/mod declarations, enabled population-defender revision/coverage notes, and the illustrated-number mapping when applicable.
- `host_topology.txt` — a host-only spoiler dossier listing every plane, editor local/global province number, start/throne marker, connection, border type, and gateway endpoint. Do not distribute it to players.

The first `.map` uses the normalized map name with no suffix. Later plane display names do not change the `_planeN.map` convention. Illustrated images use the separate `_realmN` stem to avoid mixed-format lookup ambiguity; the package remains one selectable atlas, without auxiliary selectable maps.

### Install directly

Choose **Install directly** and select the top-level Dominions user-data `maps` directory. Do not select the Steam game installation, the user-data parent, an existing individual map folder, or create the map folder yourself. The program creates/updates the normalized subfolder.

In Dominions, use **Tools & Manuals -> Open User Data Directory** to find the correct location, then select its `maps` folder in the picker.

An existing nonempty map folder must contain a valid `atlas_project.json` identifying that normalized map name, unless it contains only recognizable staging files from an interrupted first install. Otherwise Atlas refuses the reinstall without changing files. Choose a different project name, or back up and move the conflicting folder before trying again.

Back up an existing same-named map folder before an important reinstall. Atlas stages the package and attempts to restore touched files if installation fails; follow any recovery message before hosting the map.

Illustrated updates additionally verify `atlas_artwork.json` and SHA-256 hashes before overwriting or deleting TGA images and any `_realmN.d6m` aliases. An existing, unrecorded file with a generated target name, or an edited previously owned file, causes a refusal rather than silent replacement. Choose a new project name, or back up and move the conflicting file yourself. Atlas preserves unrelated files. When you remove planes or return to Native scenery, it cleans up only unchanged, previously owned artwork after the new package is published. The ownership record can retain hashes for deleted files so an interrupted cleanup can be retried safely; it is not an editable project backup.

### Download ready ZIP

Extract the single contained map folder into the Dominions user-data `maps` directory. When replacing an older export, back up and replace the old same-named folder first. Do not merge the ZIP into it, because stale numbered planes or terrain images can change the map. Keep all supplied image variants and ownership records together.

If you added custom battle assets manually, back them up before replacing the folder and copy them into the new one afterward.

Large packages may show a ZIP memory warning or disable both ZIP options. **Install directly**, **Editable project JSON**, and active-plane preview remain available. Prefer direct installation for large multi-plane 4K atlases.

### Download player ZIP

Downloads `<map-name>_players.zip` with the same playable `.map`/`.d6m` files, illustrated TGAs and `atlas_artwork.json` when applicable, and `PLAYER_README.txt`, but no `atlas_project.json`, balance report, host settings, or host topology dossier. It uses the same artwork mode, validation and ZIP-memory limits as the host ZIP. Extract its single map folder into the Dominions user-data `maps` directory, replacing an older same-named folder instead of merging it.

This reduces accidental spoilers; it is **not secrecy protection**. Playable map files still reveal starts, terrain, guardians, and other content when inspected. Keep the host package and editable JSON yourself, and tell players the intended game version, mods, and host settings separately. A player package is not an editable Atlas backup.

### Editable project JSON

Downloads the portable source backup described above.

### Preview PNG

Choose the **High-res … preview of …** button in **Install / export**. It exports the active plane at its configured resolution using the currently selected Condition preview. The PNG includes combined terrain materials and symbols, shape-safe procedural detail, sparse-plane backdrops, and the procedural realm landscape used by the editor. It remains a standalone preview, not a playable map asset, and is not installed with the package. Illustrated export separately generates the game-ready TGA set with the required numbering markers and ownership areas.

### Filename normalization

The normalized project root uses safe ASCII letters, digits, and underscores, with a maximum of 64 characters. Automatic plane, realm and condition suffixes are added after that root. Unsafe characters and reserved Windows filenames are normalized automatically; the export dialog shows the exact result before writing. When the only change is spaces becoming underscores (such as the default **Pantokrator Atlas** → `Pantokrator_Atlas`), validation lists it as **Info**; other character changes, truncation or reserved names are a **Warning**. Neither blocks export.

### Browser limitations

Direct folder access requires a secure browser context with the File System Access API and Web Locks. If either is unavailable, use the ZIP. Atlas permits only one direct installation at a time across tabs using the same app address. Do not install into the same folder from different app addresses, browsers or profiles simultaneously: browser locks do not cover those writers. Atlas also checks for outside changes and retains recovery backups rather than overwriting a detected conflict.

A retry can use a folder containing only recognizable staging files from an interrupted first install; those old files are preserved, not deleted. If recovery reports retained backups or an unrecognized folder, do not host it yet. Review the folder and backups, or choose a new atlas name for a clean installation. For large 4K multi-plane atlases, direct installation is more memory-efficient than ZIP generation.

## Keyboard and accessibility controls

When the map has keyboard focus:

- Right/Down Arrow: next province.
- Left/Up Arrow: previous province.
- Home/End: first/last province.
- Enter/Space: apply the active tool exactly once.
- Arrow navigation never applies Start, Throne, Link, Gate, or Site.

For the setup and inspector tab groups, Arrow keys move between tabs and Home/End jumps to the first/last tab. Setup section headings and **More…** notes are native disclosure buttons: Tab to one and press Enter or Space to expand or collapse it.

Press `/` to open **Find a province** from anywhere except a text field, select box, or open dialog; Escape closes the search and returns focus to it. In the header **File** menu, Tab moves through the actions and Escape closes the menu.

In catalog fields, type a name or ID, use Up/Down to move through results, Enter to commit, and Escape to close and restore the previous value. Tab commits the typed value and moves on to the next control; results are not separate Tab stops. Nation, population-type and fort fields accept numeric IDs (including `#15`) or an exact unique name on blur. An ambiguous name such as **Agartha**, which exists in several eras, keeps the previous value and asks you to choose a result. Only explicitly clearing the field removes its assignment. Unit and site fields still accept raw mod references.

Validation, replacement-confirmation, and export dialogs trap focus. Escape closes them unless package export is busy. Export progress, autosave, start allocation, selected province/tool, armed endpoints, and balance notices are announced to assistive technology. The layout reflows on narrow screens and respects reduced-motion settings.

## Troubleshooting

| Message or symptom | Meaning and response |
|---|---|
| A documented control is missing | Check [Versions and documentation](../README.md#versions-and-documentation). The hosted GUI and Windows installer may be older than the source guide; reinstalling the same release will not add newer controls. |
| Windows shows Unknown publisher | The setup is not currently code-signed. Confirm it came from this project's GitHub release and verify the matching `.sha256` file before proceeding. |
| Portable copy says Node.js is required | Install Node.js 22.13.0 or newer from the official link opened by the launcher, then run it again. The installed edition bundles its own private runtime. |
| Launcher startup fails | For the installer edition, reinstall the latest setup. For a portable copy, keep the extracted release in a writable folder and do not run inside the ZIP. If it still fails, include the complete terminal error in a [GitHub issue](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/issues). |
| GUI opens on a different local port and the autosave looks empty | Use the same browser profile and exact Atlas address as before. If Atlas is still running there, reopen that instance and export **Editable project JSON** for import at the new address. An old port may now serve another application; do not stop unrelated programs to recover Atlas. If the previous Atlas address is unavailable, use a JSON backup. |
| Generate is disabled | The five start categories must total Players, each category needs a compatible plane that permits generated starts, and configured cave nations cannot exceed Cave starts. Read the generation-plan summary and correct the allocation, nation list, or plane policy. |
| Locked layout/start/field conflict | Unlock explicitly in Iterate or use a content-only reroll. Different world seeds change province IDs; field-locked provinces cannot be silently replaced. A rejected edit leaves the current atlas intact; bounded numeric controls restore the accepted value rather than displaying a rejected draft. |
| Batch preview cannot apply | Review newly introduced export blockers, locked/protected skipped provinces, or a zero-change result. Change the operation/selection; existing export errors also still need repair. |
| Named region disappeared after generation | It was a bookmark of old province IDs, not a geographic generation constraint. Use Planes → Generation preferences → Regional plans for future terrain areas. |
| Preference did not produce its exact percentage | Safety, topology, ocean style, minimum terrain variety, and locks take priority. Inspect Current result after generation. Blank values inherit the established generator. |
| Nation requirement is unassigned/unverified | Assign exactly one nation-specific start, or review/reconfirm the request after changing patch/mod declarations. Reconfirmation is not independent verification of the request. |
| External map will not open as an editable project | Open project accepts Atlas JSON only. Use Iterate's read-only native inspection for `.map`/`.d6m`; arbitrary native raster geometry cannot yet be imported losslessly. |
| Guardian fixture could not be prepared | No safe encounter province may fit, or the source/fixture has export errors. The source atlas remains unchanged; review the reported error. Any target-media adaptation is separately disclosed in the fixture description. |
| Population-matched defenders remain unsupported | Declare the actual host patch and era, then check the population, terrain and mod scope in **Verified template scope**. Unsupported contexts keep native armies; catalog imports alone do not verify them. |
| An older project still offers only Pale Ones or no automatic templates | Its saved v2 or v1 revision is intentionally pinned. Review coverage and explicitly choose **Use current verified profiles** to adopt v3; toggling the option off/on does not upgrade it. |
| A supported population has no automatic army | Check the status in **Initial-defender preview**. Custom guardians, start protection, locks, owners, blocked terrain, thrones or raw directives can exclude it. Existing custom groups take priority. |
| Compatibility blocker / playable export unavailable | Open Validate and resolve every red Error. Warnings and fairness alone do not block export. |
| Scale-aware spacing below preferred | The hard three-step floor was retained but the larger preferred target did not fit. Increase provinces/player, simplify start categories, change wrapping, or generate again. |
| Start connection counts vary | Identical exits could not fit without breaking harder safety rules. Lower the connection target or enlarge the core realms. |
| Requested N thrones, but only M fit | Protected start/gate zones prevented all recommendations. Lower the target or enlarge the atlas. |
| Island chains used at least 48% water | Intentional minimum required to separate the islands. |
| Requested continents, but topology sustains fewer | Increase water, change wrapping, lower the continent count, and Generate again. |
| An ocean preset cannot fit the requested inland starts | Explicit layouts keep their water geography. Allocate more Coastal/Water starts, enlarge the map or reduce water, then Generate; start-category and hard-spacing errors still block export. |
| A river preference produces fewer borders than requested | Routes need connected shared borders and suitable outlets. Barriers, capital crossings and geography take priority over an exact quota; 0 disables generated border rivers. |
| A new coast style is missing, or terrain edits did not reshape a lake | Loading preserves saved natural-shape provenance. Terrain flags repaint the province but do not move its borders. Back up and Generate to rebuild geography with current shapes. |
| Dense solid map warns about tiny contacts | Fewer than 512 native pixels per province can lose short contacts when rasterized. Increase output resolution or reduce province count, then inspect; this advisory is not a complete pixel-topology guarantee. |
| River Styx cannot divide a torus | Disable at least one Underworld wrap axis and Generate again. |
| Cave-start nation lacks `#specstart` | Generate after changing the cave-nation list or Cave starts, and enable special starts when hosting. |
| Visible border topology error | Use **Synchronize N project border issues**, especially for older project JSON. |
| Plane not linked to main plane | Add/regenerate a valid gateway path to plane 1. |
| Dry/aquatic gateway mismatch | Move an endpoint so both sides have matching water status or regenerate. This blocks export. |
| Guardian or throne at/adjacent to a start | Remove it or regenerate. Start capitals and their directly connected provinces are a protected one-ring zone. |
| Blocked Cave Wall contains a throne or guardians | Resolve the structured content or recognized province-level raw commands reported by validation. Current-source playable export refuses the conflict; saving editable JSON remains available. |
| Sea + Cave Wall warning | The province is still blocked even though native relief is submerged. Remove Cave Wall for navigable water; the mixed terrain's native appearance still needs visual verification. |
| Gate is too close to a start | Generated gates prefer endpoints at least two moves away, but a constrained fallback can produce a warning. Move the endpoint, enlarge the plane, reduce the gate count, or regenerate. |
| Direct folder access unavailable | Use Download ready ZIP. If ZIP is disabled by the memory ceiling, lower resolution/plane count or move the project to a supported browser for direct install. Editable project JSON remains available. |
| Direct reinstall refuses an existing folder | A nonempty folder needs a valid `atlas_project.json` matching its normalized name. Atlas leaves it untouched. Use a different project name, or back up and move the conflicting folder before retrying. |
| Artwork file is not an unchanged Atlas-owned file | Its name collides with a generated image or its bytes no longer match `atlas_artwork.json`. Back up and move that file yourself, or choose a new atlas name. Do not delete the ownership record to bypass the check. |
| Illustrated export rejects raw commands | Any active map/plane/province raw command can contain unsafe numeric references. Use Native scenery or supported structured controls. |
| Map does not appear in Dominions | Confirm `user data/maps/<Map_Name>/<Map_Name>.map`; avoid the game installation or doubled folder nesting. |
| Removed planes still appear | Delete/replace the old folder before extracting a new ZIP, or use direct reinstall. |
| ZIP is slow or memory-heavy | Use direct install, lower resolution, or reduce plane sizes/count. |
| Autosave unavailable / storage full | Download Editable project JSON immediately. |
| Latest edit disappeared after reload | Reload may have occurred while **Saving changes** was visible. Use **Save now**, wait for the saved status, and keep project JSON backups. |
| Planned plane is empty after reopen | Expected: a staged plane round-trips in autosave/JSON but remains a playable-export error until you configure it and Generate. |
| JSON will not open | Use a schema-v1 Atlas `.atlas.json` or package `atlas_project.json` within the 16 MiB limit, not a ZIP/map/D6M/catalog or autosave-recovery file. |
| Filename changed | Export normalized it. Use the folder/file stem shown in the package summary. |
| Unknown catalog ID | Enable matching custom content. Catalog metadata does not install a mod. |
| Skybox/battle-map asset warning | Copy referenced `.tga`, `.rgb`, or `.d3m` files beside the map files. |
| Realm art or backdrop differs in Dominions | Native scenery intentionally uses the game's renderer. In current source, select Illustrated realms and install the complete package to use custom art on supported planes. Surface/Custom and editor-only overlays still differ. |
| Terrain looks unchanged after editing | Biome is metadata only; change Primary terrain or Additional terrain flags. Export/install the package again and start a new game. The selected artwork mode determines whether supported realms use generated TGA art or native scenery. |
| In-game province numbers differ from the editor | Expected for Illustrated realms: image markers determine numbering. Use the table in the host package's `host_settings.txt`. Do not swap artwork modes in a running game. |
| Province labels are hidden or cut off at the screen edge | Names appear from 135% zoom and can be omitted to avoid collisions. Pan to bring a province into view, or hover/select it for the complete name and marker details. |
| Preview colors differ from the game | Condition previews are illustrative. They do not simulate temperature, events, army movement, or the game's exact artwork. |
| Guardians cannot be added to a start | Intentional protection for the nation's starting army and pretender. |

## Dominions engine boundaries

Native checks for the published `581b2b8` build include loading and visual inspection of all eight planes, [161 accepted population-template terrain cases](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/research/NATIVE_POPULATION_DEFENDERS_2026-09-21.md), and one [generated Inferno battle/capture followed by recruitment and PD inspection](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/research/NATIVE_GUARDIAN_CAPTURE_2026-09-21.md). See [release verification](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/RELEASE_VERIFICATION_0.1.5.md) for that build's scope. These observations do not establish every seasonal visual, nation/population PD combination, calibrated guardian difficulty or a full multiplayer game.

The merged illustrated exporter has separate [September 22 evidence](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/ILLUSTRATED_EXPORT_2026-09-22.md): custom sky, cave, Underworld, Infernal/Abyss, Dream and Elemental artwork was visually inspected in Dominions 6.37, including production sky snow. An eight-plane fixture retained province coordinates, adjacency and a Dreamlands nation start. The latest sky/natural contours, connected rivers and mixed Sea + Cave Wall relief still need a fresh in-game visual pass; their automated checks do not extend the earlier visual evidence. See the [current source checkpoint](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/README.md#current-source-checkpoint).

Native map data and Atlas's preview have different roles:

- **Initial guardians vs persistent PD:** guardian groups create initial independents. Persistent post-capture rosters come from a nation/poptype and wholly new rosters require `.dm` modding.
- **Population types:** `#poptype` controls local recruitment; it is not a separate PD-roster ID and does not replace the initial random army.
- **Gate direction:** all provinces sharing a `#gate` number are connected bidirectionally.
- **Procedural realm art:** Native scenery has no Atlas raster layer. The optional Illustrated realms export supplies custom TGA art and ownership areas for nine realm types, keeping Surface and Custom native. It does not export every editor texture or overlay.
- **Condition preview:** changes only the editor/PNG. Illustrated export separately includes every supported terrain/winter sheet for the engine to select; this is not a simulation of game events or climate.
- **External battle assets:** supported by directives but not bundled automatically.
- **Custom catalogs:** metadata for the editor, not installed game content.
- **Steam Workshop:** package upload, banner, visibility, and publishing remain outside ordinary local installation.
- **Raw directives:** powerful but not syntax-checked in Native scenery. Active raw commands are blocked in Illustrated realms because arbitrary province references cannot be safely renumbered.

## License and bundled data

Pantokrator Atlas application code and original project materials use the permissive [0BSD license](../LICENSE). Bundled dependencies retain the terms listed in [`THIRD_PARTY_LICENSES.txt`](../THIRD_PARTY_LICENSES.txt).

The generated selector catalog is separately licensed from its pinned Dom6 Inspector source. See its [provenance notice](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/src/catalog/data/NOTICE.md) and [GPL-3.0 license](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/src/catalog/data/LICENSE.dom6inspector.txt). The root 0BSD license does not relicense that catalog. Offline copies are in `licenses/dom6-catalog` in the installed Windows edition, or `src/catalog/data` in source checkouts and portable releases.

## Official references

- [Dominions 6 Map Editing Manual](https://illwinter.com/dom6/dom6mapman.pdf)
- [Dominions 6 File Formats](https://illwinter.com/dom6/dom6fileformats.pdf)
- [Dominions 6 Modding Manual](https://illwinter.com/dom6/dom6modman.pdf)
