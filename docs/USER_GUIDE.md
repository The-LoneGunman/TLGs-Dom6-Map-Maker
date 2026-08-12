# Pantokrator Atlas User Guide

Pantokrator Atlas is a local-first map maker for Dominions 6. It generates deterministic, multiplayer-oriented atlases with one to eight planes and exports native `.map` and `.d6m` files that Dominions can load directly.

This guide covers the recommended workflow, every major option in the interface, manual editing, validation, installation, and common problems.

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

## Quick start

### 1. Obtain the program from GitHub

Pantokrator Atlas currently runs from its GitHub source repository; it is not installed through Steam or a standalone Windows installer.

Repository: [The-LoneGunman/TLGs-Dom6-Map-Maker](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker)

> **Current build status:** this is a source/testing build, not yet a packaged public release. The P1 engineering blockers found by the 2026-08-11 audit have regression-tested fixes; the remaining release gate is a live Dominions 6 smoke test of representative installed packages. Review the [audit and remediation record](FULL_AUDIT_2026-08-11.md), and keep **Editable project JSON** backups for important maps.

If the repository is private, the owner must first invite your GitHub account as a collaborator. Sign in to that authorized account in GitHub or GitHub Desktop before trying to download it. Someone without repository access cannot install the program from this link; the owner must grant access or publish a release/public copy.

Choose one acquisition method:

#### GitHub Desktop on Windows

1. Install [GitHub Desktop](https://desktop.github.com/) and sign in.
2. Open the repository link above in your browser.
3. Select **Code -> Open with GitHub Desktop**, or in GitHub Desktop choose **File -> Clone repository -> URL** and enter:

   ```text
   https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker.git
   ```

4. Choose a local folder and select **Clone**.
5. Use **Fetch origin** and **Pull origin** in GitHub Desktop whenever you want the newest version.

#### Download a source ZIP

1. Sign in to GitHub and open the repository.
2. Choose **Code -> Download ZIP**.
3. Extract the ZIP to a normal writable folder such as Documents. Do not run it from inside the compressed archive.
4. To update later, download a new ZIP and replace the old source folder after backing up any files you deliberately added there. Atlas projects should be backed up with **Editable project JSON**, not kept as source-code changes.

#### Git command line

If Git is installed:

```powershell
git clone https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker.git
cd "TLGs-Dom6-Map-Maker"
```

Later updates use:

```powershell
git pull --ff-only
```

### 2. Install the runtime and dependencies

Install [Node.js](https://nodejs.org/) **22.13.0 or newer**. GitHub Desktop users still need Node.js because the application runs locally through Node and npm.

Open PowerShell, Command Prompt, or a terminal in the cloned/extracted project folder, then run:

```powershell
npm.cmd ci
```

This installs the exact JavaScript dependencies recorded in the committed lockfile. Internet access is required the first time and whenever dependencies change.

### 3. Start Pantokrator Atlas

From the project folder:

```powershell
npm.cmd run dev
```

Keep that terminal open while using the application. Open the local address shown by the development server, normally [http://localhost:3000/](http://localhost:3000/). Stop the server with **Ctrl+C** in the terminal.

If port 3000 is already occupied, the development server may show a different local port; open the exact address printed in the terminal.

### 4. Make your first map

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

The application has four main areas:

- **Header:** project name, autosave state, New atlas, Save now, Undo, Redo, Validate, and Install / export.
- **Setup panel:** Generate, Planes, and Scenario tabs.
- **Map workbench:** the active plane, editing tools, condition preview, zoom, plane strip, and generation/fairness status.
- **Province inspector:** Terrain, Gameplay, Sites & PD, and Advanced tabs for the selected province.

Selecting a plane in the Planes list or the strip below the map makes it active. Selecting a province opens it in the inspector.

The **Project** name in the header becomes the map title and the basis for the exported folder and filenames. Export shows the safe normalized file stem before writing anything; changing the displayed project name does not rename an already installed folder on disk.

## Generate tab

Generation controls define the next generated atlas. Changing most of them does not alter existing geography until **Generate balanced atlas** is pressed.

### Fresh-project defaults

| Option | Default |
|---|---:|
| Seed | `pantokrator-001` |
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

Opens an explicit replacement confirmation for the current project. The dialog lists the current plane, province, and gateway totals and offers **Download backup** before continuing. Confirming creates the fresh-project defaults above, clears the selection and armed tools, and clears Undo/Redo history. The new project becomes the device autosave, so the downloaded editable JSON is the recovery path for the replaced atlas.

### Reset generator defaults

Resets the seed and the options visible in Generate to their initial values without replacing the current map. It also:

- Resets the province-name reroll counter.
- Sets every plane to 3840 x 2160.
- Resets wrapping on the active plane: both axes on normally, both off for Underworld.
- Removes generated cave-nation specific-start assignments, which must be regenerated.
- Preserves current planes, provinces, Scenario settings, gate plan, actual gateways, manual map edits, and manual specific starts.
- Is Undoable and does not itself generate.

### Seed

A free-text deterministic seed. The same effective settings and seed reproduce the same generated atlas. The icon beside the field creates a random realm-style seed. Press Generate after changing it.

### Players

Range: **2-32**. This is the recommended player count and the required total for the five start categories.

When the current allocation exactly matches the old player count, increasing Players adds the difference to Land. Decreasing it removes starts in this order: Land, Other, Cave, Coastal, Water. If the old allocation was already incomplete or overfilled, adjust it manually.

### Provinces / player

Range: **8-30**. This sizes the core overland and cave realms; it does not multiply every bonus plane independently. See [Automatic plane sizing](#automatic-plane-sizing).

### Start allocation

Each category accepts 0-32. The five values must total Players exactly, or Generate remains disabled.

- **Land:** dry, non-cave overland land with no adjacent water.
- **Coastal:** overland land adjacent to water.
- **Water:** aquatic provinces, preferring overland water when available.
- **Cave:** dry cave-family terrain. Cave and Great Cavern are preferred; Underworld, Infernal, or Abyss can supply compatible slots when necessary.
- **Other:** dry special-realm terrain outside the overland and cave families, such as Cloud, Air, Dream, or Elemental.

**Put remainder on land** appears when too few starts are allocated and fills the unassigned slots with Land starts.

Make sure the required plane families exist. For example, Cave starts need a cave-family plane and Other starts need an appropriate bonus realm. An impossible category displays a persistent **Generation plan cannot place all starts** summary and disables Generate until you add a compatible plane or change the allocation; the same condition remains an export-validation error for imported projects.

### Deterministic cave-start nations

This is an ordered list of playable nation IDs.

- **Empty list:** Dominions uses its native cave-start preferences on the generic cave starts.
- **Configured list:** after Generate, the program binds each nation in priority order to a distinct generated Cave start with `#specstart`.
- The host must enable **special starting locations** for guaranteed `#specstart` placement.
- Changing the list removes stale generated assignments. Generate again to create the new assignments.
- If the list is longer than the Cave-start allocation, only the entries that fit can receive cave capitals and the UI warns.
- If Cave starts is zero, neither configured assignments nor native cave preference has a cave slot.
- IDs 5 and above can be entered for mod nations, but the matching mod must be enabled in Dominions.

Use the arrow controls to change priority.

### Target useful connections at starts

Range: **1-8**. Default: **4**.

The generator tries to give all starts a comparable number of useful traversable exits and balanced nearby expansion space. Four is the recommended multiplayer baseline. Targets above four are best-effort when the map cannot fit identical high-degree capitals safely.

Capital spacing is a separate rule:

- No two starts may be fewer than three global movement steps apart.
- The preferred distance scales upward with traversable provinces per start, up to eight.
- If the hard three-step floor is preserved but the preferred scaled target is infeasible, generation displays a non-blocking warning.
- A distance below three is a validation error and blocks playable export.

If constraints force unequal start degrees or reduced preferred spacing, increase map size, simplify the start mix, lower the degree target, change wrapping, or generate another layout.

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

This policy affects only solid Surface and surface-like Custom planes. Cave-family and sparse special realms keep their own chamber, corridor, hub, Styx, and route profiles.

### Province-name controls

**Reroll generated names (preserve manual)** immediately renames generated provinces on every plane without changing geography. Names use plane, terrain, coast, flooded-cave, and Styx context. Names edited in the province inspector and legacy names with no provenance are preserved. The action is Undoable.

**Replace every province name** opens a confirmation and replaces generated, manual, and legacy names. Use it to repair duplicate or poorly matched names in older projects. It is also Undoable.

Generated names are unique across the atlas and avoid known nation, epithet, home/capital-site, and special-realm names.

### Each bonus plane size (% of core)

Range: **1-500%**. Default: **30%**.

Each auto-sized bonus plane independently receives this percentage of the combined generated core. Values over 100% intentionally create a bonus realm larger than all core realms combined, up to 800 provinces per plane. Manually sized planes are unchanged.

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

Choose the final aspect ratio before generation because it affects geometry. Direct installation streams one D6M at a time; ZIP construction holds the package in memory and may be slower for many 4K planes.

### Wrap east/west and north/south

These affect only the active plane.

- East/west links the left and right seams.
- North/south links the top and bottom seams.
- Changing a wrap setting immediately resynchronizes the border graph.
- Wrapping affects generated ocean topology and continent feasibility.
- Surface-style planes default to both wraps.
- Underworld defaults to neither so the Styx can divide it into two banks.

A fully wrapped Underworld is allowed, but validation warns that one river band cannot truly divide a torus.

### Configure plane archetypes & selected links

Switches to Planes without changing the map. Use it to finish plane planning before Generate.

### Generate balanced atlas

Rebuilds every planned plane from the seed and settings. It recreates terrain, topology, starts, generated gateways, throne recommendations, independent details, and generated names. It refreshes generated cave-nation assignments and applies planned bidirectional plane links.

It preserves plane/Scenario configuration and manually authored province names. Do not expect other detailed province edits to survive. On any populated atlas, a confirmation lists the current replacement scope and offers an editable JSON backup before generation begins. Generation returns to plane 1, clears current selections, reports the province total and seed, and is Undoable.

Generation runs in a background browser worker, so large eight-plane atlases do not freeze the editor. The progress card appears immediately and **Cancel generation** stops the worker without replacing the current atlas. You can inspect or edit the current atlas while generation runs; if the project changes before the worker finishes, Atlas safely discards that now-stale result and asks you to Generate again with the latest settings.

Closing or navigating away from the app also cancels active generation. Atlas never commits a partially generated plane: the existing project is replaced only after the worker returns the complete atlas, and a successful replacement remains Undoable.

### Generation balance notice

Appears when generation safely used a best-effort result, especially:

- Start spacing below the preferred scale-aware target while retaining the hard three-step floor.
- Unequal start connection counts.
- A manually constrained special plane cannot retain the intended number of themed guardian provinces outside every capital's protected two-ring.

These warnings do not block export. Hard spacing failures remain red validation errors.

### Synchronize visible borders

Repairs all planes when the saved Dominions neighbor graph differs from visible ownership boundaries. It adds missing shared-border links, removes stale links that cross province interiors, includes wrap seams, and preserves valid authored border types.

Use it for older imported projects that show topology errors.

### Automatic plane sizing

- **Overland core:** `(Land + Coastal + Water starts) x provinces/player`, divided among auto-sized Surface-like core planes, minimum 18 each.
- **Cave core:** `Cave starts x provinces/player`, divided among auto-sized Cave and Great Cavern planes, minimum 18 each.
- A solid, ordinary Surface-like Custom plane can count as core.
- **Bonus plane:** bonus percentage x combined generated core total, independently for each auto-sized bonus plane.
- An auto-sized bonus plane with starts expands its minimum using the requested start-degree target, leaving room for capital two-rings and neutral themed guardians whenever the 800-province ceiling permits it.
- Every auto bonus plane has a minimum of 18 and maximum of 800.
- Manual targets are 8-800 and are not changed by Players, Provinces/player, or the bonus percentage.
- Manual core sizes still contribute to the core total used to size auto bonus planes.

Cloud, Air, Underworld, Infernal, Abyss, Dream, Elemental, sparse Custom, and special-themed Custom realms are bonus planes.

## Planes tab

An atlas can have **one to eight planes**. Archetype, variant, auto-sizing, and planned-link changes are inputs to the next generation; they do not transform existing provinces immediately.

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

Surface and ordinary Custom default to full province ownership. Other archetypes use sparse chambers, junctions, routes, and native owner-zero negative space. Special bonus realms receive substantially stronger initial guardian groups than Surface/Cave/Cavern and use themed population types. Persistent post-capture PD still follows Dominions' nation/poptype rules.

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

Sparse-plane art appears behind ownerless areas in the editor and PNG preview. Dominions' D6M format has no second raster-underlay field, so the native game uses its own owner-zero presentation. The backdrop is not missing when the in-game result looks different.

### Remove this plane

Available when the atlas has more than one plane. A confirmation lists the affected provinces, touching gateways, and nation-specific starts and offers a backup first. Confirming removes the plane, its nation-specific starts, its planned-link rules, and its gateway endpoints. Gateway groups left with fewer than two endpoints are removed, and the full edit is Undoable.

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

Toggles a generic player start. Enabling it clears No random start and changes throne treatment to Avoid.

### Throne

Cycles **Neutral -> Preferred -> Avoid -> Neutral** and clears a fixed-throne selection.

### Site

Toggles the **Many sites** terrain bit. It does not place a named magic site; use Sites & PD for that.

### Condition preview

Options are Normal, Frozen/winter, Forested, Submerged, Wasted, and Farmland. These change only the editor and exported PNG preview. They do not modify terrain or create alternate files. Native D6M terrain lets Dominions render actual condition changes.

### Pan, zoom, Fit, and plane switching

Drag to pan, use the wheel/trackpad to zoom from 78% to 400%, and choose **Fit** to return to 100% and center the plane. Use the strip below the map to switch planes.

## Province inspector

The header shows the editable province name and the decimal Dominions 64-bit terrain mask. Editing the name marks it manual, so normal generation and name rerolls preserve it.

### Terrain tab

#### Primary terrain

The primary terrain controls artwork and contributes mechanical flags:

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

Biome affects Atlas presentation, generated context, and contextual naming rather than adding a separate Dominions bit:

Heartland, Wildwood, Marshlands, Sunscorched, High country, Tundra, Archipelago, Deep ocean, Living caves, Crystal deeps, Ashen deeps, and Void reaches.

#### Terrain property cards

- **Small province** and **Large province** are mutually exclusive.
- **No random start** blocks random placement and clears a generic start.
- **Many sites** adds the site-rich terrain bit.
- **Fresh-water marker** is an auxiliary bit; it remains land unless Sea is also set.
- **Warmer** and **Colder** are mutually exclusive climate bits.

#### Additional terrain flags

Sea, Highland, Swamp, Wasteland, Forest, Farm, Deep sea, Cave, Mountains, and Impassable cave wall can be combined additively.

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

- **Generic player start:** emits `#start`, clears No random start, and avoids thrones.
- **Team-start group:** emits `#teamstart`; use a non-negative integer smaller than the number of teams selected by the host.
- **Specific-start nation:** emits `#specstart` for a playable nation and the province's global cross-plane number. Assigning it clears independent guardians, placed sites, throne setup, ownership, economy/PD overrides, forts, labs, temples, battle overrides, raw province directives, and any team-start marker. It preserves terrain, geography, climate, province name, and an existing generic-start marker. Undo is available if you selected the wrong province.

Generic, team, and nation-specific starts all count as start locations in safety validation and in the live fairness calculation. Starts must remain at least three global movement steps apart and may not have blocking or condition-dependent starting borders. After any manual start edit, spacing, two-ring expansion, nearby-throne access, local connection degree, and the overall score recalculate immediately across ordinary borders and cross-plane gates. The start-allocation score remains based on generated generic slots, so a nation or team annotation does not falsely change the requested land/coastal/water/cave counts.

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

### Sites & PD tab

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

- The standard picker browses 4,078 gameplay unit records. Thirteen explicitly named Test, Debug, XXX, or Unused source records stay hidden during normal browsing.
- **Use role-focused lists** filters to 850 known commanders and 842 known troops, combining nation recruitment with magic-site recruitment slots; unusual summons and independents remain available in the broader list.
- All 4,091 bundled source IDs remain valid for exact raw numeric-ID entry. A hidden record already selected in an imported project remains visible.
- A group contains a Commander, optional display name, and any number of squads.
- Each squad has a unit and count.
- Commander details include experience 0-900, random items 0-4, specific item names, Clear innate magic, bodyguard unit/count, and Fire/Air/Water/Earth/Astral/Death/Nature/Glamour/Blood/Holy levels 0-10.
- Holy exports as priest magic.
- Multiple groups create multiple commander blocks.
- Empty commanders or squads are validation errors.
- Specific items use item names, not numeric IDs.
- Guardians are disabled on generic, team, and nation-specific starts to protect the nation's starting army and pretender. Assigning a nation-specific start also removes any guardians already present, and validation blocks stale imported/manual capital content until that start is reassigned through the editor.

Generated Surface/Cave/Cavern groups are ordinary independents. Cloud, Air, Underworld, Infernal, Abyss, Dream, Elemental, and similar bonus realms use stronger, themed commanders and multiple large squads to make expansion a deliberate challenge.

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

The bundled Dominions 6.35 catalogs contain:

- 4,091 raw unit records (4,078 shown in normal browsing)
- 1,253 sites
- 82 population types
- 106 active/special nations
- 28 forts

Coverage is current through Dominions 6.35, including LA Pyrène (#123), LA Zemaitia (#124), post-manual units through Gnu Clan Commander (#4134), and thrones through #1405; see the [content catalog and provenance notes](CONTENT_CATALOG.md).

Pickers search names, aliases, tags, and numeric IDs and show up to 12 ranked matches.

- **Sources & license:** shows data provenance.
- **Import verified JSON:** merges a schema-valid catalog with bundled entries. Custom entries override matching IDs for lookup/display.
- **Download template:** downloads the required schema and provenance structure.
- **Reset custom entries:** removes device-stored additions and returns to bundled-only lookup.

Custom catalogs are stored separately on the device and are not embedded game content. Importing an ID does not install a `.dm` mod or make it exist in Dominions. Keep a copy of custom catalog JSON and enable matching game content when required.

## Validation and balance report

Choose **Validate** in the header before export.

- **Error:** blocks direct install and ready ZIP.
- **Warning:** does not block export but identifies compatibility or quality risk.
- **Info:** confirms readiness or provides context.

Editable project JSON and PNG preview remain available even when playable export is blocked.

Validation checks include start counts/categories/spacing, start exits, throne and gate exclusion zones, terrain combinations, catalog IDs, site compatibility, plane connectivity, wet/dry underground gateways, border topology, D6M dimensions/ownership, filenames, Scenario ranges, and required map commands.

### Fairness score

The score is diagnostic, not an export gate:

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

Nearby-throne parity counts thrones reachable within four actual movement steps, including valid gates. Remote or unreachable thrones are neutral. The score penalizes unequal nearby-throne counts between starts; it does not punish an equal abundance of nearby thrones.

Sparse bonus realms are scored according to their intended route/chamber profiles rather than being treated as defective because ordinary provinces have only one or two exits.

Clicking a validation issue that identifies a plane/province navigates to it when possible.

## Saving and reopening projects

### Autosave

An autosave is scheduled 200 ms after the last project change, and the asynchronous storage write completes sometime after that. The header changes from **Saving changes** to a saved state only after the write finishes. Closing or reloading while **Saving changes** is visible can still lose the latest edit; use **Save now** before closing when the map matters.

- **Device autosave:** IndexedDB, the preferred large-project store.
- **Limited autosave:** localStorage fallback with a smaller quota.
- **Autosave unavailable:** no browser copy could be written; download project JSON immediately.

Autosave belongs to this browser and site profile. It is not cloud synchronization, and clearing browser data removes it. All Pantokrator Atlas tabs on the same origin share one current-project slot. Saves use a compare-and-set revision check: if another tab changed that slot, automatic saving pauses and a persistent conflict bar asks you to **Load newer copy** or explicitly **Keep this copy**. This prevents a stale tab from silently replacing the detected newer revision, but it is still one recovery slot rather than a recent-project library. **New atlas** deliberately replaces the current autosave after a backup-oriented confirmation and clears history; **Reset generator defaults** preserves the existing planes, provinces, gateways, and manual edits. There is no separate Clear autosave command. Undo history is session-only and does not return after a reload.

### Undo and Redo

The header buttons keep up to 30 project snapshots. Every new edit clears stale Redo, including Water and Biome slider changes. A continuous pointer drag or held-key slider adjustment is stored as one Undo step. Undo/Redo restores project data and clears the selected province and armed Link/Gate endpoint, but it does not restore UI-only state such as zoom, pan, tool, inspector tab, condition preview, or temporary catalog filters.

There is no global Ctrl/Cmd+Z shortcut; use the visible buttons.

### Editable project JSON

Choose **Install / export -> Editable project JSON** for a portable backup named `<map-name>.atlas.json`. Every playable package also includes `atlas_project.json`.

Choose **Open project** and select either file to reopen it. The importer accepts Pantokrator Atlas schema-v1 JSON. It does not open ZIP, `.map`, `.d6m`, custom catalog JSON, or arbitrary JSON.

Current staged-plane exception: after choosing **Add plane to plan**, the new plane has no provinces until generation. The current importer rejects that draft state. Generate immediately after staging all planes before reloading the page or depending on that JSON backup. If you staged a plane accidentally, use Undo before leaving the page.

Project JSON is editable source, not a playable map. Custom catalogs are stored separately and should be backed up separately.

## Installing and exporting

Open **Install / export** in the header after validation.

### Package contents

A playable package contains:

- Main `.map` and `.d6m` files.
- `_plane2` through `_plane8` `.map` and `.d6m` files as needed.
- `INSTALL.txt`.
- `atlas_project.json`.
- `balance_report.txt`.
- `host_settings.txt`.
- `host_topology.txt` — a host-only spoiler dossier listing every plane, local/global province number, start/throne marker, connection, border type, and gateway endpoint. Do not distribute it to players.

The first plane uses the normalized map name with no suffix. Later plane display names do not change the `_planeN` file convention.

### Install directly

Choose **Install directly** and select the top-level Dominions user-data `maps` directory. Do not select the Steam game installation, the user-data parent, an existing individual map folder, or create the map folder yourself. The program creates/updates the normalized subfolder.

In Dominions, use **Tools & Manuals -> Open User Data Directory** to find the correct location, then select its `maps` folder in the picker.

Back up an existing same-named map folder before an important reinstall. The browser file API has no atomic rename, so Atlas uses a recoverable transaction instead: it stages every file, keeps disk-backed copies of existing Atlas targets, publishes all D6Ms before their `.map` references, rolls touched targets back after a failure, and removes temporary and obsolete numbered-plane files last. If rollback or cleanup itself is denied, Atlas keeps recoverable backup files and reports that the install must be retried before hosting. It does not broadly delete unrelated assets.

### Download ready ZIP

Extract the single contained map folder into the Dominions user-data `maps` directory. When replacing an older export, delete or replace the old same-named folder first. Do not merge the ZIP into it, because stale numbered plane files would remain active.

If you added custom battle assets manually, back them up before replacing the folder and copy them into the new one afterward.

Atlas estimates ZIP working memory before assembly. Large packages show a warning in the export dialog; packages estimated to exceed the browser safety ceiling disable only **Download ready ZIP**. **Install directly**, **Editable project JSON**, and the active-plane preview remain available. Direct install is the recommended path for large multi-plane 4K atlases because it stages one D6M at a time instead of retaining the entire ZIP in memory.

### Editable project JSON

Downloads the portable source backup described above.

### Preview PNG

Exports the active plane at its configured resolution using the currently selected Condition preview. The PNG includes editor artwork and sparse-plane backdrops. It is not the native playable D6M.

### Filename normalization

Folder and file stems are normalized to a letters/underscores name with a maximum of 64 characters. The export dialog shows the actual result. Windows device basenames `CON`, `PRN`, `AUX`, and `NUL` are automatically suffixed with `_map`. A normalization warning does not block export.

### Browser limitations

Direct folder access requires a browser context with the File System Access API. If it is unavailable, use the ZIP. For large 4K multi-plane atlases, direct installation is more memory-efficient than ZIP generation.

## Keyboard and accessibility controls

When the map has keyboard focus:

- Right/Down Arrow: next province.
- Left/Up Arrow: previous province.
- Home/End: first/last province.
- Enter/Space: apply the active tool exactly once.
- Arrow navigation never applies Start, Throne, Link, Gate, or Site.

For the setup and inspector tab groups, Arrow keys move between tabs and Home/End jumps to the first/last tab.

In catalog fields, type a name or ID, use Up/Down to move through results, Enter to commit, and Escape to close and restore the previous value.

Validation, replacement-confirmation, and export dialogs trap focus. Escape closes them unless package export is busy. Export progress, autosave, start allocation, selected province/tool, armed endpoints, and balance notices are announced to assistive technology. The layout reflows on narrow screens and respects reduced-motion settings.

## Troubleshooting

| Message or symptom | Meaning and response |
|---|---|
| PowerShell says `npm.ps1 cannot be loaded` | Windows execution policy blocked the PowerShell shim. Run `npm.cmd ci` and `npm.cmd run dev`, or use Command Prompt. Do not weaken the machine's execution policy merely to start Atlas. |
| Generate is disabled | The five start categories do not total Players. Correct them or use Put remainder on land. |
| Compatibility blocker / playable export unavailable | Open Validate and resolve every red Error. Warnings and fairness alone do not block export. |
| Scale-aware spacing below preferred | The hard three-step floor was retained but the larger preferred target did not fit. Increase provinces/player, simplify start categories, change wrapping, or generate again. |
| Start connection counts vary | Identical exits could not fit without breaking harder safety rules. Lower the connection target or enlarge the core realms. |
| Requested N thrones, but only M fit | Protected start/gate zones prevented all recommendations. Lower the target or enlarge the atlas. |
| Island chains used at least 48% water | Intentional minimum required to separate the islands. |
| Requested continents, but topology sustains fewer | Increase water, change wrapping, lower the continent count, and Generate again. |
| River Styx cannot divide a torus | Disable at least one Underworld wrap axis and Generate again. |
| Cave-start nation lacks `#specstart` | Generate after changing the cave-nation list or Cave starts, and enable special starts when hosting. |
| Visible border topology error | Use Synchronize visible borders, especially for older project JSON. |
| Plane not linked to main plane | Add/regenerate a valid gateway path to plane 1. |
| Dry/aquatic gateway mismatch | Move an endpoint so both sides have matching water status or regenerate. This blocks export. |
| Gate or throne at/adjacent to a start | Move it or regenerate; generated placement normally protects a two-ring exclusion zone. |
| Direct folder access unavailable | Use Download ready ZIP. If ZIP is disabled by the memory ceiling, lower resolution/plane count or move the project to a supported browser for direct install. Editable project JSON remains available. |
| Map does not appear in Dominions | Confirm `user data/maps/<Map_Name>/<Map_Name>.map`; avoid the game installation or doubled folder nesting. |
| Removed planes still appear | Delete/replace the old folder before extracting a new ZIP, or use direct reinstall. |
| ZIP is slow or memory-heavy | Use direct install, lower resolution, or reduce plane sizes/count. |
| Autosave unavailable / storage full | Download Editable project JSON immediately. |
| Latest edit disappeared after reload | Reload may have occurred while **Saving changes** was still visible. Use **Save now**, wait for a saved badge, and keep Editable project JSON backups. A same-origin revision conflict now pauses autosave and presents an explicit choice instead of silently overwriting. |
| Planned plane is empty after reopen | Expected: a staged plane round-trips in autosave/JSON but remains a playable-export error until you configure it and Generate. |
| JSON will not open | Use a schema-v1 Atlas `.atlas.json` or package `atlas_project.json`, not a ZIP/map/D6M/catalog file. |
| Filename changed | Export normalized it. Use the folder/file stem shown in the package summary. |
| Unknown catalog ID | Enable matching custom content. Catalog metadata does not install a mod. |
| Skybox/battle-map asset warning | Copy referenced `.tga`, `.rgb`, or `.d3m` files beside the map files. |
| Backdrop differs in Dominions | Expected: backdrops are editor/PNG-only; native D6M owner-zero space is game-rendered. |
| `#defence` warning on independents | Numeric PD requires a playable-nation owner; use guardian groups for initial independents. |
| Guardians cannot be added to a start | Intentional protection for the nation's starting army and pretender. |
| Need wholly custom persistent PD | Requires an accompanying `.dm` nation/poptype mod. Initial map guardians do not replenish. |
| One-way gate expected | Dominions gate numbers are bidirectional shared networks. |
| Steam Workshop upload expected | Atlas creates a local ready-to-play folder. Workshop upload remains a separate Steam/Dominions step. |

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

## Official references

- [Dominions 6 Map Editing Manual, version 6.26](https://illwinter.com/dom6/dom6mapman.pdf)
- [Dominions 6 File Formats](https://illwinter.com/dom6/dom6fileformats.pdf)
- [Dominions 6 Modding Manual](https://illwinter.com/dom6/dom6modman.pdf)
