# Pantokrator Atlas User Guide

Pantokrator Atlas is a local-first map maker for Dominions 6. It generates deterministic, multiplayer-oriented atlases with one to eight planes and exports native `.map` and `.d6m` files that Dominions can load directly.

This guide describes the current hosted/source edition: the recommended workflow, major interface options, manual editing, validation, installation, and common problems. Older Windows releases may not include all controls; check the release notes before moving projects between versions. For development from a GitHub checkout, see [Develop from source](../README.md#develop-from-source).

## Contents

- [Quick start](#quick-start)
- [The safest editing workflow](#the-safest-editing-workflow)
- [Screen layout](#screen-layout)
- [Generate tab](#generate-tab)
- [Planes tab](#planes-tab)
- [Planned links and existing gateways](#planned-links-and-existing-gateways)
- [Scenario tab](#scenario-tab)
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

Uninstall through **Windows Settings -> Apps -> Installed apps -> Pantokrator Atlas**. Uninstall removes application files and shortcuts but does not delete browser-held autosave data. Export important projects as editable JSON before uninstalling or changing local addresses.

### 3. Make your first map

1. In **Generate**, enter a seed, player count, provinces per player, and a start allocation whose total equals the player count.
2. Open **Planes** and add every plane you want. Configure each plane's archetype, variant, size, wrapping, and planned links.
3. Set any hosting restrictions in **Scenario**.
4. Return to **Generate** and choose **Generate balanced atlas**.
5. Review the map, generation notice, fairness report, and **Validate** results.
6. Make province, border, site, guardian, throne, and actual-gateway edits.
7. Resolve every red validation error.
8. Choose **Install / export** and either install directly into the Dominions user-data `maps` folder or download the ready ZIP.

## The safest editing workflow

> **Generate before detailed manual editing.** Generate reconstructs province geometry, terrain, economy, sites, guardians, battle settings, province directives, starts, throne preferences, borders, and actual gateways. Plane and Scenario configuration remain, and manually authored province names are deliberately preserved, but most other province-level edits are replaced.

The recommended order is:

1. Choose the project name and generation settings.
2. Add and configure every plane.
3. Configure planned plane links and Scenario settings.
4. Generate the atlas.
5. Make detailed manual changes.
6. Validate and export.

On a populated atlas, Generate first shows what will be replaced and offers **Download backup**. After you confirm, the completed generation is still one Undoable project edit.

Adding a plane to the generation plan preserves every existing actual gateway; the new draft does not receive endpoints until you generate or add them manually. Removing a plane removes its specific starts and only the gateway endpoints on that plane; groups left with fewer than two endpoints are removed.

## Screen layout

The main areas and controls are:

- **Header:** project name, autosave state, New atlas, Save now, Undo, Redo, Validate, and Install / export.
- **Setup panel:** Find a province, then Generate, Planes, and Scenario tabs.
- **Map workbench:** the active plane, editing tools, condition preview, zoom, plane strip, and generation/fairness status.
- **Province inspector:** Terrain, Gameplay, Sites & guardians, and Advanced tabs for the selected province.
- **Open project:** the fixed button near the lower-left corner imports a saved Atlas project JSON.

Selecting a plane in the Planes list or the strip below the map makes it active. Selecting a province opens it in the inspector.

**Find a province** searches all planes by province name, plane name, or number. Numbers (with or without `#`) match either the global export number or the local province number. Add a plane-name word to narrow ambiguous local numbers. The first 30 matches are shown with both numbers. Selecting a result switches to **Select** and cancels any armed border/gateway endpoint; it does not edit the map.

Control labels identify their scope: **Next generation**, **Current Map**, **Current Map + next generation**, **Host / export**, **Preview only**, **Saved note only**, or **On project open**. Current-map changes are reflected in later exports; they do not alter a map already installed in Dominions. Biome and patch notes are descriptive, while primary terrain and terrain flags affect artwork and game rules.

The map marker legend distinguishes all authored gameplay markers instead of collapsing them into a generic symbol: **S/#/N** means generic/team/nation-specific start, **♜/♛/×** means preferred/fixed/avoided throne, **✦/M** means a placed site/many-sites terrain, **G** means guardian groups, and **◎** means a gateway endpoint. A province can show several badges at once. The selected-province screen-reader status announces its combined terrain, the same marker meanings, and relevant group, nation, site, guardian, and gate numbers.

The **Project** name in the header becomes the map title and the basis for the exported folder and filenames. Export shows the safe normalized file stem before writing anything; changing the displayed project name does not rename an already installed folder on disk.

## Generate tab

Generation controls define the next generated atlas. Changing most of them does not alter existing geography until **Generate balanced atlas** is pressed.

### Generation plan and province budget

The **Next generation** summary shows core, bonus, and total planned provinces. Expand **Province budget by plane** to compare each plane's current count with its next target, including manual-size preservation, start-buffer minimums, start blocking, and the 800-province per-plane cap. It uses the same sizing calculation as generation; counts do not guarantee feasible start spacing or water allocation.

The pending summary groups inputs changed since the last generation recorded by this editor. It deliberately excludes manual province edits, name rerolls, host options, and patch notes. “Plan matches” is not proof that the current map is unedited. Older projects have no recorded baseline and say so; generating establishes one. Resolution, wrapping, and archetype changes can also affect current display/export behavior before generation, as their scope labels indicate.

**Review current starts** opens the start-region inspector described below. It analyzes the current map, not the ungenerated plan.

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
| Biome cohesion | 68% |
| Economy balance | Hard competitive balance |
| Overland topology | Competitive mix |
| Bonus-plane size | 30% of core |
| Recommended throne locations | 8 |
| Resolution | 3840 x 2160 |
| Initial plane | Surface, Temperate, 96 provinces |
| Initial wrapping | East/west and north/south |

Device autosave may restore your previous atlas instead of showing a fresh project. Use **New atlas** in the header when you deliberately want a clean project.

### New atlas

Opens an explicit replacement confirmation for the current project. The dialog lists the current plane, province, and gateway totals and offers **Download backup** before continuing. Confirming creates the fresh-project defaults above with a new random seed, clears the selection and armed tools, and clears Undo/Redo history. The new project becomes the device autosave, so the downloaded editable JSON is the recovery path for the replaced atlas.

### Reset generator defaults

Resets the Generate options, name-reroll counter, plane resolution, and active-plane wrapping without replacing the current atlas. It also turns off **Fresh generated names on open** and restores the fixed example seed `pantokrator-001`; use the seed-shuffle button for another world. It preserves planes, provinces, Scenario settings, gateways, manual edits, manual specific starts, and each plane's **Block generated starts** choice. Generated cave-nation assignments are removed until you generate again. The reset is Undoable and does not itself generate.

### Seed

A free-text deterministic seed. A first visit without a saved atlas and each **New atlas** use a fresh random seed. Reopening an existing project preserves its seed. The same effective settings and seed reproduce the same generated atlas. The icon beside the field creates another random realm-style seed for the next **Generate**; it does not immediately rename or regenerate the current map. To change only names, use the name controls below.

### Players

Range: **2-32**. This is the recommended player count and the required total for the five start categories.

When the current allocation exactly matches the old player count, increasing Players adds the difference to Land. Decreasing it removes starts in this order: Land, Other, Cave, Coastal, Water. If the old allocation was already incomplete or overfilled, adjust it manually.

### Provinces / player

Range: **8-30**. This sizes the core overland and cave realms; it does not multiply every bonus plane independently. See [Automatic plane sizing](#automatic-plane-sizing).

### Start allocation

Each category accepts 0-32. The five values must total Players exactly, or Generate remains disabled.

- **Land:** dry, non-cave overland land with no adjacent water.
- **Coastal:** overland land adjacent to water.
- **Water:** aquatic provinces on eligible Surface or surface-like solid Custom planes.
- **Cave:** dry Cave/Great Cavern starts. If no Cave/Great Cavern plane permits generated starts, eligible Underworld, Infernal, or Abyss planes supply the slots.
- **Other:** dry special-realm terrain outside the overland and cave families, such as Cloud, Air, Dream, or Elemental.

**Put remainder on land** appears when too few starts are allocated and fills the unassigned slots with Land starts.

Make sure the required plane families exist and permit generated starts. For example, Cave starts need an eligible cave-family plane (preferring Cave/Cavern) and Other starts need an eligible bonus realm. A plane whose **Block generated starts on this plane** option is checked is not eligible for any automatically allocated start category. An impossible category displays a persistent **Generation plan cannot place all starts** summary and disables Generate until you permit starts on a compatible plane, add one, or change the allocation. Existing and imported atlases remain subject to start-count, category, and safety validation; blocking future generation does not itself invalidate existing starts.

### Deterministic cave-start nations

This is an ordered list of playable nation IDs.

- **Empty list:** Dominions uses its native cave-start preferences on the generic cave starts.
- **Configured list:** after Generate, the program binds each nation in priority order to a distinct generated Cave start with `#specstart`.
- The host must enable **special starting locations** for guaranteed `#specstart` placement.
- Changing the list removes stale generated assignments. Generate again to create the new assignments.
- If the list is longer than the Cave-start allocation, Generate is disabled. Increase Cave starts or remove lower-priority nations.
- If Cave starts is zero, neither configured assignments nor native cave preference has a cave slot.
- IDs 5 and above can be entered for mod nations, but the matching mod must be enabled in Dominions.

Use the arrow controls to change priority.

### Target useful connections at starts

Range: **1-8**. Default: **4**.

The generator tries to give all starts a comparable number of traversable exits and nearby expansion space. Four is the recommended multiplayer baseline; higher targets are best-effort.

Capital spacing is a separate rule:

- No two starts may be fewer than three global movement steps apart.
- The preferred distance scales upward with traversable provinces per start, up to eight.
- If the hard three-step floor is preserved but the preferred scaled target is infeasible, generation displays a non-blocking warning.
- A distance below three is a validation error and blocks playable export.

If the target cannot fit safely, Atlas reports a warning. Increase map size, simplify the start mix, lower the degree target, change wrapping, or try another seed.

### Water provinces

Range: **0-60%**. Default: **18%**.

This is the requested water share on water-capable generated realms. Generation may raise it to satisfy water/coastal starts, an Oceanic variant, or Island Chains. Flooded Cave/Cavern chambers and the Underworld's Styx are archetype features rather than ordinary overland water-quota results.

### Overland ocean layout

- **Natural / varied:** organic seed-driven land and water patches.
- **Single continent:** one connected major landmass with peripheral sea.
- **Multiple continents:** separate movement-connected landmasses.
- **Island chains:** coast-heavy, ribbon-like islands and sea routes.
- **Central inland sea:** one connected central water body enclosed by connected land.

**Major continents** appears for Multiple continents and accepts **2-6**. It is a topology target. If the selected water percentage and wrapping cannot support the requested count, generation reports the achieved count instead of pretending a connected landmass is multiple continents.

Island Chains needs enough sea to look and play like islands. If Water is below 48%, generation raises the effective setting to 48% and reports the change.

### Biome cohesion

Range: **0-100%**. Default: **68%**.

- Lower values make smaller, more varied terrain patches.
- Higher values create larger connected biome regions.

The generator still enforces minimum terrain variety, so the relationship is directional rather than a promise that every low-cohesion seed will have fewer same-terrain neighbors than every high-cohesion seed.

### Economy balance

- **None / natural:** preserves generated populations without correcting unequal early economies.
- **Soft correction:** nudges start economies toward parity, caps corrections at 12%, and applies less than half the Hard adjustment.
- **Hard competitive balance (default):** strongly equalizes early start economies for competitive multiplayer.

This policy changes generated population values, not the identity of independently recruitable poptypes or a nation's persistent post-capture PD roster.

### Overland topology

- **Open movement:** turns generated rivers into bridges and other blocking or seasonal overland borders into ordinary links.
- **Competitive mix (default):** keeps a terrain-shaped mix of open routes, rivers, passes, and borders.
- **Strategic regions:** adds deterministic regional chokepoints away from every capital while keeping the movement graph connected.

This affects solid Surface and surface-like Custom planes. Cave-family and sparse special realms retain their own topology.

### Province-name controls

**Reroll generated names (preserve manual)** immediately renames generated provinces on every plane without changing geography. Names use plane, terrain, coast, flooded-cave, and Styx context. Names edited in the province inspector and legacy names with no provenance are preserved. The action is Undoable.

**Replace every province name** opens a confirmation and replaces generated, manual, and legacy names. Use it to repair duplicate or poorly matched names in older projects. It is also Undoable.

Generated names are unique across the atlas and avoid known nation, epithet, home/capital-site, and special-realm names.

Names blend article-free forms such as **Silver Grove** with occasional **The**-prefixed forms. Roughly one in four candidates uses **The**, including longer compound names. Existing saved names stay unchanged by default: use **Reroll generated names (preserve manual)** to apply the new blend without regenerating the map.

The vocabulary also includes 528 original named places and landmarks, interleaved with descriptive names: **Bellroot Vault** for caves, **Candlewake Ferry** for the Styx, **Larkglass** in the Dreamlands, and **Orphaned Meridian** in the Abyss. Terrain-specific pools keep farms, forests, seas, flooded caves, and other landscapes distinct; special realms retain their own naming character. These names use the same uniqueness and capital-name protections.

**Fresh generated names on open** is an optional setting saved with each project. Enable it to shuffle generated names whenever the project opens from JSON or is restored on page load. It does not rename anything immediately, change the world seed, or regenerate geography, guardians, or starts. Manual and legacy names are preserved, and conflict/recovery copies are always opened unchanged. After a page-load reroll, **Undo** restores the saved names. Turn this option off before sharing a multiplayer map whose province names should stay fixed; exported game maps never reroll names when loaded in Dominions.

### Each bonus plane size (% of core)

Range: **1-500%**. Default: **30%**.

Each auto-sized bonus plane independently receives this percentage of the combined core, up to 800 provinces. Values over 100% are allowed. Manually sized planes are unchanged.

### Recommended throne locations

Range: **0-64**. Default: **8**.

This marks preferred throne provinces; it does not set Ascension points and does not force exact named throne sites. The generator distributes preferences while protecting start and gate exclusion zones. If all requested locations cannot fit safely, validation warns with the achieved count. Lower the target or enlarge the atlas if exact capacity matters.

### Output resolution

- **Compact:** 1536 x 1024
- **2K:** 2048 x 1152
- **ChatGPT max / 4K:** 3840 x 2160
- **Square max:** 2880 x 2880
- **Custom per plane**

A preset immediately applies its dimensions to every plane. Custom exposes Width and Height in Planes for the active plane. Each axis must be 256-3840 pixels, and the total may not exceed 8,294,400 pixels.

Choose the final aspect ratio before generation because it affects geometry. Large multi-plane 4K packages are faster and more memory-efficient with direct installation than ZIP export.

### Wrap east/west and north/south

These affect only the active plane.

- East/west links the left and right seams.
- North/south links the top and bottom seams.
- Changing a wrap setting immediately resynchronizes the border graph.
- Wrapping affects generated ocean topology and continent feasibility.
- Surface-style planes default to both wraps.
- Underworld defaults to neither so the Styx can divide it into two banks.

A fully wrapped Underworld is allowed, but validation warns that one river band cannot truly divide a torus.

Generation uses chamber-and-corridor ownership for the Underworld so the Styx crossings agree with the playable map. Imported solid Underworlds are converted only when you generate, with a notice explaining the change.

### Configure plane archetypes & selected links

Switches to Planes without changing the map. Use it to finish plane planning before Generate.

### Generate balanced atlas

Rebuilds every planned plane from the seed and settings, including terrain, topology, starts, generated gateways, throne recommendations, independent details, cave-nation assignments, and generated names. Plane/Scenario configuration and manually authored province names remain; most other province edits do not.

On a populated atlas, Atlas confirms what will be replaced and offers a project backup. The progress card lets you cancel safely, and generation never installs a partial result. If you edit the project while generation runs, a stale result is discarded. A completed generation is Undoable.

### Generation balance notice

Appears when generation used a safe best-effort result, especially:

- Start spacing below the preferred scale-aware target while retaining the hard three-step floor.
- Unequal start connection counts.
- A manually constrained special plane cannot retain the intended number of themed guardian provinces outside the preferred two-move guardian buffer.

These warnings do not block export. Hard spacing failures remain red validation errors.

### Synchronize visible borders

The button reads **Synchronize N project border issues**, or **Visible borders synchronized** when no repair is needed. It repairs all planes when the saved Dominions neighbor graph differs from visible ownership boundaries. Use it for imported projects that show topology errors; it preserves valid authored border types.

### Automatic plane sizing

- Land, Coastal, and Water starts are allocated among eligible Surface-like planes; Cave starts use eligible Cave/Great Cavern planes, with the fallback described under [Start allocation](#start-allocation). Allocation is capacity-weighted, including manually sized planes. Each auto-sized core plane targets its allocated starts multiplied by Provinces / player, subject to size limits.
- Each auto-sized bonus plane uses the selected percentage of the combined core total. Manual core sizes still contribute to that total.
- If there are no core planes, bonus percentages use Players x Provinces / player as their reference instead.
- Starts can enlarge an auto-sized plane so their spacing and neutral guardian buffers have room, up to the 800-province ceiling.
- Auto-sized planes have an 18-province minimum. Manual targets use 8-800 provinces and are not changed by player count, provinces per player, or the bonus percentage.

Core planes are Surface, Cave, Great Cavern, and solid Custom realms with Temperate, Wild, Frozen, Arid, or Oceanic variants. Cloud, Air, Underworld, Infernal, Abyss, Dream, and Elemental are bonus realms. All sparse Custom realms and Custom realms with Fungal, Crystal, Volcanic, Storm, Infernal, or Void variants are also bonus planes.

## Planes tab

An atlas can have **one to eight planes**. Auto-sizing and planned-link changes apply to the next generation. Archetype changes immediately update the current plane's identity, ownership presentation and borders; surviving authored border types are preserved. Terrain, starts, sites and guardians are not regenerated until **Generate**. Wrap changes, including **Reset generator defaults**, also synchronize current borders in the same undoable edit. Review validation after changing topology because start spacing may change.

### Add plane to plan

Stages a new auto-sized Underworld draft with no provinces. Configure it, then Generate. Existing actual gateways are preserved; the draft has no endpoints until generation or manual gateway editing adds them.

### Plane name

The in-game plane name. Untouched generated names can update to a suitable unique default when the archetype changes. A manually edited name remains as entered.

### Plane archetype

| Archetype | Generated character |
|---|---|
| Surface | Solid overland with ordinary land and water; dense multiplayer topology. |
| Cave | Sparse native-style chambers, fungal defaults, cave populations, and some flooded Sea + Cave chambers. |
| Great cavern | Broader and more connected underground vaults with crystal-oriented defaults. |
| Cloud realm | Sparse aerial islands and routes with Air/Glamour themes. |
| Air plane | Stronger aerial, storm, and Astral themes. |
| Underworld | Sparse death realm, undead/spectral populations and guardians, and a connected River Styx dividing two dry banks with one or two crossings. |
| Infernal realm | Hot Waste/Highland cave-family realm with Fire, Death, Blood, demons, and strong special defenders. |
| Abyss | Hostile void realm with Death/Astral themes, horrors/demons, branching corridors, and sparse ownerless space. |
| Dream realm | Glamour/Astral/Nature terrain with fay and magical defenders. |
| Elemental | Fire, Air, Water, and Earth extremes with themed elementals. |
| Custom | Neutral solid overland profile for manual combinations; variants can supply special themes. |

Surface and ordinary Custom default to full province ownership. Other archetypes use sparse chambers, junctions, routes, and native owner-zero negative space. Special bonus realms receive substantially stronger initial guardian groups than most Surface variants and Cave/Great Cavern, and use themed population types. See [Guardian groups](#guardian-groups) for Oceanic Surface and Custom-variant exceptions. Persistent post-capture PD still follows Dominions' nation/poptype rules.

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

### Auto-size from player count and Province target

With auto-size on, the plane uses the formulas under [Automatic plane sizing](#automatic-plane-sizing). Turning it off reveals **Province target**, range 8-800.

### Block generated starts on this plane

Unchecked by default. When checked, the next **Generate balanced atlas** does not allocate generic generated starts to that plane. Use this to reserve a dangerous bonus realm, keep a thematic plane neutral, or direct the requested start categories into other compatible planes. If the remaining eligible planes cannot satisfy the allocation, the Generate tab names the impossible categories and disables Generate instead of silently ignoring the policy.

This affects only automatic allocation. Existing starts remain until regeneration, and you can add generic, team, or nation-specific starts manually afterward. The setting is preserved by saving, importing, Undo/Redo, and **Reset generator defaults**.

Whether a start was generated or placed manually, its capital province and every province directly connected to it form a protected capital zone. Generation does not place neutral guardians, special defender units, or thrones in that zone. Assigning a nation-specific start also clears conflicting capital content already on the capital as described under [Starts](#starts).

### Wrap settings

Create movement and ownership seams across the selected axis. Underworld defaults to no wrap so its Styx remains a permanent barrier with controlled crossings.

### Custom resolution

When Generate's resolution is Custom, Width and Height appear here for the active plane. Each is 256-3840 and total pixels may not exceed 8,294,400.

### Plane display & native flags

- **Reveal this plane's map image:** Inherit project setting, On, or Off. Controls per-plane `#mapnohide` behavior.
- **Disable random deep caves from this plane:** Inherit, On, or Off. Controls per-plane `#nodeepcaves` behavior.
- **Province-name color:** four decimal RGBA values from 0 to 1 for `#maptextcol`. Default: `0.93 0.88 0.70 1.0`.
- **Dominion-overlay color:** four integer RGBA values from 0 to 255 for `#mapdomcol`. Default: `238 205 112 42`.

### Themed backdrops

Sparse-plane art appears behind ownerless areas in the editor and PNG preview, while terrain materials adapt to province size and shape. These are preview features: Dominions renders owner-zero space and terrain with its native presentation.

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

**Default pairs for all enabled links** sets 1-3 distinct gateway pairs for every enabled plane pair. Each visible row can be enabled/disabled and can override its pair count. Rows show only links involving the active plane. The compatibility percentage is a generation heuristic, not a travel chance.

All generated links are bidirectional. Dominions treats every province sharing the same `#gate` number as one bidirectional network; one-way gateways are not supported by the engine.

### Existing gateways editor

Shows actual gate groups touching the active plane.

- A gate number must be a unique positive safe integer.
- Every endpoint with the same number is mutually connected; a group with three or more endpoints is a network, not a sequence.
- Each endpoint displays its plane, local province number, name, and stable ID.
- An endpoint can be reassigned to another province on its stored plane.
- The same province cannot appear twice in one group.
- Delete removes the entire gateway group.

Validation requires at least two valid, non-blocked endpoints and a route from every plane back to plane 1. Surface-to-Cave/Cavern/Underworld endpoints must match wet/dry status. Generated endpoints try to remain at least two connections from every start; adjacent fallbacks produce warnings.

## Scenario tab

Scenario options affect export directly and do not require regeneration.

- **Description:** main map description. Secondary planes receive the description plus their plane name.
- **Minimum Dominions version:** range 600-999; emits `#domversion`. The default 635 means Dominions 6.35 and matches the bundled catalog revision.
- **Sail distance:** range 1-10; emits `#saildist`.
- **Site frequency:** range 0-100; emits the global `#features` value.
- **Ascension points:** optional 1-999; emits `#victorycondition 6 N`. Blank leaves that victory condition unspecified.
- **Allowed nations:** emits `#allowedplayer`. Empty means unrestricted. A nonempty list must contain at least as many distinct nations as Players.
- **Computer-controlled nations:** forces selected nations to AI. Easy = 1, Normal = 2, Difficult = 3, Mighty = 4, Master = 5.
- **Cannot-win nations:** emits `#cannotwin`.
- **Reveal map image:** project-level `#mapnohide`.
- **Disable random deep-cave planes:** project-level `#nodeepcaves`.
- **Hide deep-plane choice:** emits `#nodeepchoice`.
- **Disable homeland names:** emits `#nohomelandnames`; useful when authored capital names must be preserved.
- **Disable name filter:** emits `#nonamefilter`.
- **Map-level directives:** advanced commands appended only to plane 1.

Playable nation IDs must be safe integers 5 or greater. Unknown IDs require matching custom content in Dominions.

## Map tools and navigation

### Select

Selects a province and opens the inspector.

### Link

Click two provinces on the active plane.

After the first click, the armed-state banner identifies the source plane and province number. If you switch planes, return to the source plane for a shared-border destination, or click a province on the active plane to replace the source. **Cancel endpoint** clears the pending source.

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

Options are Normal, Frozen/winter, Forested, Submerged, Wasted, and Farmland. These change only the editor and exported PNG preview. They do not modify terrain or create alternate files. Native D6M terrain lets Dominions render actual condition changes.

### Pan, zoom, Fit, and plane switching

Drag to pan, use the wheel/trackpad to zoom from 78% to 400%, and choose **Fit** to return to 100% and center the plane. Use the strip below the map to switch planes.

## Province inspector

The header shows the editable province name and the decimal Dominions 64-bit terrain mask. Editing the name marks it manual, so normal generation and name rerolls preserve it.

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
- Cave wall = blocked Cave-wall terrain; selecting it also removes generic, team, and nation-specific starts, throne setup, and guardian groups

Changing primary terrain does not normally recalculate manually edited population, poptype, guardians, or biome. Cave wall is the safety exception: blocked space cannot retain a start, throne, or guardian group.

#### Biome

Biome is saved descriptive metadata. Changing it alone does not change terrain flags, artwork, province names, or gameplay. Use Primary terrain and Additional terrain flags to change terrain. The available labels are:

Heartland, Wildwood, Marshlands, Sunscorched, High country, Tundra, Archipelago, Deep ocean, Living caves, Crystal deeps, Ashen deeps, and Void reaches.

#### Terrain property cards

- **Small province** and **Large province** are mutually exclusive.
- **No random start** blocks random placement and clears a generic start.
- **Many sites** adds the site-rich terrain bit.
- **Fresh-water marker** is an auxiliary bit; it remains land unless Sea is also set.
- **Warmer** and **Colder** are mutually exclusive climate bits.

#### Additional terrain flags

Sea, Highland, Swamp, Wasteland, Forest, Farm, Deep sea, Cave, Mountains, and Impassable cave wall can be combined additively.

Changes repaint the map immediately and appear in the [high-resolution PNG preview](#preview-png). Mixed terrain combines its colors, materials, and symbols: Farm adds field rows, Forest adds trees (kelp under water), and Cave adds a cave arch. Mountains, hills, marshes, waste, and water have their own marks. Details fit within the province and remain clipped on irregular, narrow, and wrapped shapes; zoom in on small provinces. Fresh water adds a water marker without turning land into a sea. Deep sea only has an effect when Sea is also present.

Download or install the package again after editing; a new Dominions game uses the updated terrain mask and elevation. You do not need to regenerate the atlas or edit image files. The game draws its own native terrain artwork, so it will not be pixel-identical to Atlas's preview. The [official D6M specification](https://www.illwinter.com/dom6/dom6fileformats.pdf) separates geography in `.d6m` from terrain in `.map`; Atlas exports both from the current province flags. Existing games do not automatically adopt terrain edits.

Useful combinations:

- Sea + Mountains/Highland: underwater-mountain terrain matching.
- Sea + Forest: underwater forest or kelp.
- Sea + Cave: flooded cave.
- Fresh water without Sea: land.
- Deep without Sea: no aquatic effect.
- Cave wall: blocked, No start, and no generic start.

Validation warns when Forest, Swamp, Waste, Highland, and Mountains exceed the manual's recommendation of at most two adverse types.

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
- The default picker includes all ordinary rarity 0-4 province sites.
- **Show terrain mismatches:** reveals entries that do not match the province's additive terrain/coast location mask.
- **Include all non-capital sites:** adds verified non-random sites that are not nation homes/capitals or thrones.
- Nation home/capital sites are deliberately excluded. Thrones are selected under Gameplay.
- **Place magic site:** adds a row; fill or remove it because an empty row blocks export.
- **Known:** emits `#knownfeature`; unchecked emits hidden `#feature`.

Compatibility includes plain, forest, mountain, waste, farm, sea, coast, swamp, deep sea, cave, underwater mountain, underwater forest, and underwater coast.

#### Guardian groups

Guardian groups are explicit initial independent defenders, not replenishing post-capture PD.

- The standard picker browses gameplay unit records; obvious test, debug, and unused records stay hidden.
- **Use role-focused lists** narrows the picker to known commanders or troops. Unusual summons and independents remain available in the broader list.
- Exact numeric IDs remain accepted, including valid records hidden from normal browsing.
- A group contains a Commander, optional display name, and any number of squads.
- Each squad has a unit and count.
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
| Custom | 0-255 | Preserves an imported stored value |

The UI does not currently expose a numeric Custom-value editor. Prefer the named types unless project JSON already contains the intended value.

#### Province battlefield

- **Skybox:** emits `#skybox`.
- **Battle map:** emits `#batmap`; `empty` is accepted.
- **Ground RGB**, **Rock RGB**, and **Fog RGB:** normalized 0-1 or integer 0-255 triplets; normalized values are converted to integer channels.

Referenced `.tga`, `.rgb`, or `.d3m` assets are not bundled automatically. Copy them into the exported map folder; validation warns when external assets are referenced.

#### Raw province directives

Appended inside that province's `#land` or `#setland` block after structured features and guardian commands. See [Raw directives](#raw-directives).

### Raw directives

- **Province directives:** appended inside that province block.
- **Map-level directives:** appended to plane 1 after structured province blocks.
- **Plane directives:** appended at the end of the selected plane file.
- Only trimmed lines beginning with `#` or `--` are exported; other text is discarded.
- Raw commands are not syntax-checked, deduplicated, or reconciled with structured controls.
- Command order and scope are your responsibility.
- They do not install mods or package referenced assets.

Use the official map manual. Rare scenario commands such as `#god`, `#dominionstr`, and `#scale` belong at map level. Leave mandatory generated commands such as `#dom2title`, `#imagefile`, dimensions, and structured geography to the program.

## Catalog manager

The bundled Dominions 6.35 catalog covers units, sites, population types, nations, and forts. See the [catalog coverage and provenance notes](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/CONTENT_CATALOG.md) for its pinned source and exact IDs. It does not automatically track later game updates. Pickers search names, aliases, tags, and numeric IDs.

- **Sources & license:** shows data provenance.
- **Import verified JSON:** accepts up to 8 MiB of UTF-8 JSON and merges a schema-valid catalog with bundled entries. Custom entries override matching IDs for lookup/display. The label does not independently authenticate user-supplied data; use a source you trust.
- **Download template:** downloads the required schema and provenance structure.
- **Reset custom entries:** removes device-stored additions and returns to bundled-only lookup.

Custom catalogs are stored separately on the device and are not embedded game content. Importing an ID does not install a `.dm` mod or add that content to Dominions. Back up custom catalog JSON separately and enable any matching game mod when required.

## Validation and balance report

Choose **Validate** in the header before export.

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

Open **Review current starts** under Generate, **Inspect starts** in the footer, or **Inspect every start** in Validate. The panel separates export blockers, the legacy score (including low subscores), and limited analysis confidence. All generic, team, and nation-specific start locations are included and deduplicated. Manual map edits recalculate the current diagnostics; they do not need regeneration.

Choose an access model:

- **Potential connections:** includes land/water transitions and potentially traversable rivers/passes. This is a topology view, not an army-movement prediction.
- **Conservative dry / water-separated routes:** keeps dry starts on dry provinces and water starts underwater. It excludes rivers, mountain passes, mountain borders, and their corresponding custom border bits. A gate must connect the same medium to be traversed in this view.

Both models count a gate as one graph hop, ignore blocked provinces, and omit all capitals from expansion counts. Neither simulates sailing, flight, seasonal scales, movement costs, ownership, battle outcomes, or conquest turns. Same-number team-start annotations are treated as allies, including group zero; the host must configure the intended teams.

Each row shows useful exits, provinces within two/three steps, two-step exclusive/contested access, known population plus the number of unknown provinces, authored guardian provinces, nearby preferred/fixed throne markers, and nearest rival/throne/cross-plane entrance. Exclusive means strictly closer than every competing start; contested includes ties and provinces a rival reaches sooner. Neither predicts ownership. Population is not income/resources; random independents and guardian difficulty remain unknown. Throne markers do not certify final engine placement.

Click a start name to navigate safely to it and highlight its two-step region in teal. The overlay is editor-only, works across plane switches, and is hidden after project edits so it cannot present stale results. **Clear highlight** removes it. PNG and playable exports never include this overlay. `—` means no reachable target, a blocked start, or incomplete analysis.

Analysis is capped at 64 start locations for responsiveness. Larger imported start sets show an incomplete-analysis warning and no exclusive/contested comparison. This is an analysis limit, not a new limit on saved scenario starts.

### Patch and mod assumptions

Under **Game patch and mod assumptions**, record the intended game patch and mod names/versions. These are user-declared notes, not auto-detected compatibility. They are saved in project JSON and the host-facing reports; editing them never changes geography or applies nation compensation.

A missing patch, a mismatch with the selector catalog, or declared mods is explicitly unverified. Even an exact catalog-version match certifies neither nation movement nor combat balance. The model identifier (`structural-inspector-1`) versions these structural assumptions independently of game patches. Reassess nation-specific expectations after any game or mod update.

## Saving and reopening projects

### Autosave

Atlas autosaves shortly after project changes. Wait for the saved status or choose **Save now** before closing when the map matters.

- **Device autosave:** IndexedDB, the preferred large-project store.
- **Limited autosave:** localStorage fallback with a smaller quota.
- **Autosave unavailable:** no browser copy could be written; download project JSON immediately.

Autosave belongs to the current browser and site address. It is not cloud synchronization, clearing browser data removes it, and it stores one current project rather than a project library. If another tab or storage copy conflicts, autosave pauses and asks whether to inspect/load the newer copy or keep the current one. **New atlas** replaces the autosave after confirmation; Undo history does not survive a reload. Keep portable project JSON backups.

If saved data cannot be opened, automatic saving pauses and **Download recovery data** preserves the original bytes. **Keep this copy** downloads that recovery backup before replacing them. Edits exceeding project limits are rejected with a persistent message; the previous project stays intact. Unfinished guardian groups can still be saved and reopened, but must be completed before playable export.

`Pantokrator-Atlas-autosave-recovery.json` preserves unreadable saved text for recovery; it is not directly importable with **Open project**. Keep it separately from normal `.atlas.json` backups.

### Undo and Redo

The header buttons keep up to 30 project snapshots. A new edit clears Redo. Undo/Redo restores project data but not view-only state such as zoom, pan, active tool, inspector tab, condition preview, or catalog filters. There is no global Ctrl/Cmd+Z shortcut; use the visible buttons.

### Editable project JSON

Projects saved by this version can contain optional analysis notes and generation-input snapshots. This version opens older schema-v1 projects without inventing a generation baseline; older app versions may reject these newly added fields. Keep a pre-upgrade backup if you need to return to an older app.

Choose **Install / export -> Editable project JSON** for a portable backup named `<map-name>.atlas.json`. Every playable package also includes `atlas_project.json`.

Choose **Open project** and select either file to reopen it. The importer accepts up to 16 MiB of UTF-8 Atlas schema-v1 JSON with at most 8 planes and 800 provinces per plane. It does not open ZIP, `.map`, `.d6m`, custom catalog JSON, or arbitrary JSON.

After choosing **Add plane to plan**, the new plane has no provinces until generation. That planned state round-trips through autosave and project JSON, but it remains a playable-export error until you configure the plan and Generate.

Project JSON is editable source, not a playable map. Custom catalogs are stored separately and should be backed up separately.

## Installing and exporting

Open **Install / export** in the header after validation.

### Package contents

A playable package contains:

- Main `.map` and `.d6m` files.
- `_plane2` through `_plane8` `.map` and `.d6m` files as needed.
- `INSTALL.txt`.
- `atlas_project.json`.
- `balance_report.txt`: legacy score, validation, both per-start structural models, and unverified patch/mod assumptions. Treat this as host-facing analysis.
- `host_settings.txt`: intended host setup and the same declared patch/mod notes.
- `host_topology.txt` — a host-only spoiler dossier listing every plane, local/global province number, start/throne marker, connection, border type, and gateway endpoint. Do not distribute it to players.

The first plane uses the normalized map name with no suffix. Later plane display names do not change the `_planeN` file convention.

### Install directly

Choose **Install directly** and select the top-level Dominions user-data `maps` directory. Do not select the Steam game installation, the user-data parent, an existing individual map folder, or create the map folder yourself. The program creates/updates the normalized subfolder.

In Dominions, use **Tools & Manuals -> Open User Data Directory** to find the correct location, then select its `maps` folder in the picker.

An existing nonempty map folder must contain a valid `atlas_project.json` identifying that normalized map name, unless it contains only recognizable staging files from an interrupted first install. Otherwise Atlas refuses the reinstall without changing files. Choose a different project name, or back up and move the conflicting folder before trying again.

Back up an existing same-named map folder before an important reinstall. Atlas stages the package and attempts to restore touched files if installation fails; follow any recovery message before hosting the map.

### Download ready ZIP

Extract the single contained map folder into the Dominions user-data `maps` directory. When replacing an older export, delete or replace the old same-named folder first. Do not merge the ZIP into it, because stale numbered plane files would remain active.

If you added custom battle assets manually, back them up before replacing the folder and copy them into the new one afterward.

Large packages may show a ZIP memory warning or disable only **Download ready ZIP**. **Install directly**, **Editable project JSON**, and active-plane preview remain available. Prefer direct installation for large multi-plane 4K atlases.

### Editable project JSON

Downloads the portable source backup described above.

### Preview PNG

Choose the **High-res … preview of …** button in **Install / export**. It exports the active plane at its configured resolution using the currently selected Condition preview. The PNG includes combined terrain materials and symbols, shape-safe procedural detail, and sparse-plane backdrops. It is not the native playable D6M.

### Filename normalization

Folder and file stems use safe ASCII letters, digits, and underscores, with a maximum of 64 characters. Unsafe characters and reserved Windows filenames are normalized automatically; the export dialog shows the exact result before writing. A normalization warning does not block export.

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

For the setup and inspector tab groups, Arrow keys move between tabs and Home/End jumps to the first/last tab.

In catalog fields, type a name or ID, use Up/Down to move through results, Enter to commit, and Escape to close and restore the previous value. Nation, population-type and fort fields accept numeric IDs (including `#15`) or an exact unique name on blur. An ambiguous name such as **Agartha**, which exists in several eras, keeps the previous value and asks you to choose a result. Only explicitly clearing the field removes its assignment. Unit and site fields still accept raw mod references.

Validation, replacement-confirmation, and export dialogs trap focus. Escape closes them unless package export is busy. Export progress, autosave, start allocation, selected province/tool, armed endpoints, and balance notices are announced to assistive technology. The layout reflows on narrow screens and respects reduced-motion settings.

## Troubleshooting

| Message or symptom | Meaning and response |
|---|---|
| Windows shows Unknown publisher | The setup is not currently code-signed. Confirm it came from this project's GitHub release and verify the matching `.sha256` file before proceeding. |
| Portable copy says Node.js is required | Install Node.js 22.13.0 or newer from the official link opened by the launcher, then run it again. The installed edition bundles its own private runtime. |
| Launcher startup fails | For the installer edition, reinstall the latest setup. For a portable copy, keep the extracted release in a writable folder and do not run inside the ZIP. If it still fails, include the complete terminal error in a [GitHub issue](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/issues). |
| GUI opens on a different local port and the autosave looks empty | Use the same browser profile and exact Atlas address as before. If Atlas is still running there, reopen that instance and export **Editable project JSON** for import at the new address. An old port may now serve another application; do not stop unrelated programs to recover Atlas. If the previous Atlas address is unavailable, use a JSON backup. |
| Generate is disabled | The five start categories must total Players, each category needs a compatible plane that permits generated starts, and configured cave nations cannot exceed Cave starts. Read the generation-plan summary and correct the allocation, nation list, or plane policy. |
| Compatibility blocker / playable export unavailable | Open Validate and resolve every red Error. Warnings and fairness alone do not block export. |
| Scale-aware spacing below preferred | The hard three-step floor was retained but the larger preferred target did not fit. Increase provinces/player, simplify start categories, change wrapping, or generate again. |
| Start connection counts vary | Identical exits could not fit without breaking harder safety rules. Lower the connection target or enlarge the core realms. |
| Requested N thrones, but only M fit | Protected start/gate zones prevented all recommendations. Lower the target or enlarge the atlas. |
| Island chains used at least 48% water | Intentional minimum required to separate the islands. |
| Requested continents, but topology sustains fewer | Increase water, change wrapping, lower the continent count, and Generate again. |
| River Styx cannot divide a torus | Disable at least one Underworld wrap axis and Generate again. |
| Cave-start nation lacks `#specstart` | Generate after changing the cave-nation list or Cave starts, and enable special starts when hosting. |
| Visible border topology error | Use **Synchronize N project border issues**, especially for older project JSON. |
| Plane not linked to main plane | Add/regenerate a valid gateway path to plane 1. |
| Dry/aquatic gateway mismatch | Move an endpoint so both sides have matching water status or regenerate. This blocks export. |
| Guardian or throne at/adjacent to a start | Remove it or regenerate. Start capitals and their directly connected provinces are a protected one-ring zone. |
| Gate is too close to a start | Generated gates prefer endpoints at least two moves away, but a constrained fallback can produce a warning. Move the endpoint, enlarge the plane, reduce the gate count, or regenerate. |
| Direct folder access unavailable | Use Download ready ZIP. If ZIP is disabled by the memory ceiling, lower resolution/plane count or move the project to a supported browser for direct install. Editable project JSON remains available. |
| Direct reinstall refuses an existing folder | A nonempty folder needs a valid `atlas_project.json` matching its normalized name. Atlas leaves it untouched. Use a different project name, or back up and move the conflicting folder before retrying. |
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
| Backdrop differs in Dominions | Expected: backdrops are editor/PNG-only; native D6M owner-zero space is game-rendered. |
| Terrain looks unchanged after editing | Biome is metadata only; change Primary terrain or Additional terrain flags. For Dominions, export/install the package again and start a new game. Atlas's PNG artwork is not embedded in native D6M. |
| Guardians cannot be added to a start | Intentional protection for the nation's starting army and pretender. |

## Dominions engine boundaries

Pantokrator Atlas aims to be honest about what a standalone map can do:

- **Initial guardians vs persistent PD:** guardian groups create initial independents. Persistent post-capture rosters come from a nation/poptype and wholly new rosters require `.dm` modding.
- **Population types:** `#poptype` controls local recruitment; it is not a separate PD-roster ID and does not replace the initial random army.
- **Gate direction:** all provinces sharing a `#gate` number are connected bidirectionally.
- **Sparse backdrops:** native D6M has no custom image layer behind owner-zero space. Backdrops are editor/PNG-only.
- **Condition preview:** editor/PNG visualization only. Actual seasonal/submerged/forested/etc. rendering is driven by native terrain data in Dominions.
- **External battle assets:** supported by directives but not bundled automatically.
- **Custom catalogs:** metadata for the editor, not installed game content.
- **Steam Workshop:** package upload, banner, visibility, and publishing remain outside ordinary local installation.
- **Raw directives:** powerful but not syntax-checked. A project can pass structured validation and still contain an invalid raw command.

## License and bundled data

Pantokrator Atlas application code and original project materials use the permissive [0BSD license](../LICENSE). Bundled dependencies retain the terms listed in [`THIRD_PARTY_LICENSES.txt`](../THIRD_PARTY_LICENSES.txt).

The generated selector catalog is separately licensed from its pinned Dom6 Inspector source. See its [provenance notice](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/src/catalog/data/NOTICE.md) and [GPL-3.0 license](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/src/catalog/data/LICENSE.dom6inspector.txt). The root 0BSD license does not relicense that catalog. Offline copies are in `licenses/dom6-catalog` in the installed Windows edition, or `src/catalog/data` in source checkouts and portable releases.

## Official references

- [Dominions 6 Map Editing Manual](https://illwinter.com/dom6/dom6mapman.pdf)
- [Dominions 6 File Formats](https://illwinter.com/dom6/dom6fileformats.pdf)
- [Dominions 6 Modding Manual](https://illwinter.com/dom6/dom6modman.pdf)
