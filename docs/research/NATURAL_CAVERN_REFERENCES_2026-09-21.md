# Natural cavern and sparse-plane references — 2026-09-21

## Scope and edition guard

This note extracts geometry motifs from official Dominions 6 material and creator-posted Workshop galleries. It does **not** authorize copying, tracing, sampling, or redistributing any referenced artwork. Only abstract layout ideas are applicable to Atlas.

Illwinter identifies **Multiple Planes** as a Dominions 6 addition: its default generator can add an underground cave realm and a void plane. Therefore, older Dominions 4/5 maps that visually depict several worlds are useful composition references, but they are not evidence of native multi-plane behavior. Sources and observations below are dated to September 21, 2026.

## Primary references

### Official Dominions 6 cave rendering

- **Source:** [Illwinter's Dominions 6 feature list](https://www.illwinter.com/dom6/changes.html) and [official Agartha cave screenshot](https://illwinter.com/dom6/ss/mapagartha.jpg).
- **Description:** Illwinter says the default generator adds an underground cave realm. This is a native Dominions 6 plane, not an imitation within an overland image.
- **Visual observation:** The explored floor forms two large, irregular province groups joined by a substantial neck. Provinces inside each group adjoin across broad shared boundaries. Long provinces such as Stumbledown Passage are still visibly wide floor areas, while dark ownerless space forms bays, holes, and separation around them. Smaller satellite caverns remain possible without making every province an isolated room.

### Biddyn Deep — Pymous

- **Source:** [Biddyn Deep Workshop page and gallery](https://steamcommunity.com/workshop/filedetails/?id=3492310104).
- **Description:** The author calls this a Dominions 6 “Cave Layer Edition” with 20 cave provinces, in addition to 81 surface lands and 9 seas.
- **Visual observation:** The cave screenshot uses a wide, branching floor mass. Neighboring provinces read as subdivisions of larger chambers; a few elongated provinces carry the route between lobes. Rock walls and crystals frame the floor instead of reducing links to hairline strokes.
- **Caution:** A player report on the same page describes the mechanical cave graph as mostly degree two and “stringy.” Use the visual massing as inspiration, but do not copy that low-connectivity topology for cave starts.

### Phantasia and the Underground Realm — Welzi

- **Source:** [Phantasia and the Underground Realm Workshop page and gallery](https://steamcommunity.com/sharedfiles/filedetails/?id=3146608154).
- **Description:** The creator states that its fixed underground plane has about 60 cave provinces arranged into **four cave systems**, with ten gateways to the main plane. Most underground starts have at least four connections; a few have three.
- **Visual observation:** The underground overview clearly separates several macro-complexes. Large complexes contain many adjoining provinces and broad shared floor. One system bends around internal ownerless pockets, producing a ring or horseshoe rather than a filled disk. Narrow inter-lobe sections are several substantial province areas, not tiny nodes connected by lines.

### Realm of Treacherous Tortoises — Enzo

- **Source:** [Realm of Treacherous Tortoises Workshop page and gallery](https://steamcommunity.com/workshop/filedetails/?id=3148689648).
- **Description:** The creator describes an experimental Dominions 6 cave layer intended to support zero or one cave player.
- **Visual observation:** Its cave plane is a single large, asymmetric complex with several roomy basins, constricted waists, internal wall islands, and long branches. Province borders divide the continuous floor. A visible underground river crosses full-sized provinces and reinforces geography without becoming the only connection. This is the clearest custom-map reference for “adjoining regions first, passages second.”

### The Lost Capital — amuys

- **Source:** [The Lost Capital Workshop page and gallery](https://steamcommunity.com/sharedfiles/filedetails/?id=3146126454).
- **Description:** The creator explicitly describes a four-player Dominions 6 scenario fought across three planes.
- **Visual observation:** The extra-plane previews use strong macro-silhouettes: one realm is organized as a wide ring around a central void; another contains four broad terrain islands separated by negative space. Even in this proof-of-concept presentation, playable regions occupy meaningful area and the void establishes the realm's identity.

### Latus — historical visual analogue, not a native plane map

- **Source:** [Latus Dominions 5 Workshop port](https://steamcommunity.com/workshop/filedetails/?id=1364753091). The uploader states that this is an adaptation of an older Dominions 4 map and is not their original work.
- **Description:** The page describes central Latus, eight magic-themed worlds, asteroids, portals, and fleet connections, all within one enormous Dominions 5 map.
- **Visual observation:** A very large central world is surrounded by strongly shaped thematic regions. Each peripheral “world” combines one dominant body with smaller satellite islands or asteroids, using empty space to separate themes and a few explicit long-distance links to preserve navigation.
- **Edition conclusion:** Because Illwinter lists Multiple Planes as new in Dominions 6, Latus must be treated as a visually partitioned single map, not evidence that Dominions 5 supported native planes. It is useful for compositional hierarchy only.

The similarly named [Plane of Soaring Saurians](https://steamcommunity.com/workshop/filedetails/?id=3149892427) is also a Dominions 5 map port. Its uploader explicitly says the Dominions 6 port has no cave layer. It can inspire an airy palette or large-scale land/water silhouette, but it is not a native sky-plane reference.

## Procedural motifs to adopt

1. **Generate complexes before provinces.** Partition a sparse plane into roughly two to five macro-complexes at ordinary sizes, then subdivide each complex into adjoining provinces. Phantasia's four systems over about 60 cave provinces provide a useful scale reference. Avoid constructing the whole realm as independent circles joined afterward.
2. **Make the floor continuous inside a complex.** Most provinces in a cavern group should share broad borders with other floor provinces. Render rooms as lobes of a common irregular mask; use ownerless space to carve the exterior and occasional holes. Province coloring and borders should subdivide the floor without visually separating every province.
3. **Make passages provinces, not lines.** A connector should usually be one to three elongated province shapes, approximately 1.8–4 times longer than wide, with visible floor width and flared mouths. Its narrowest rendered width should remain a substantial fraction of a normal chamber's width and comfortably contain the capital marker/label. Hairline corridor primitives should be reserved for purely decorative cues, never the playable ownership raster.
4. **Alternate basins, junctions, and necks.** Use roomy 3–6-edge junction basins, short 1–2-province necks, and occasional loops. Limit long uninterrupted runs of degree-two provinces, especially around cave starts. Preserve at least four useful exits and a comparable two-ring expansion basin for intended cave starts, following Phantasia's stated start standard rather than Biddyn's reported stringiness.
5. **Use negative space as geography.** Internal wall islands, C-shaped chambers, horseshoes, bays, and split lobes make a complex feel excavated or eroded. Large void pockets should reshape routes but must not create accidental ownerless slivers, invisible adjacency, or impassable start basins.
6. **Give other realms a macro-silhouette.** For Cloud/Air, Dream, Inferno, Abyss, or Elemental planes, retain the same substantial-region rule but vary the grammar: broad cloud-island groups, a central body with satellites, a ring around a void, fractured plates, or several themed basins. Latus and The Lost Capital support this hierarchy visually; their artwork and exact outlines must not be reused. Gate provinces should sit in legible hubs or island mouths rather than at the end of an arbitrary hairline spur.

## Acceptance checks for Atlas geometry

- At fit view, each province must read as an area, not a dot; every playable inter-group connection must read as a passage with area.
- The ownership raster, visible floor, and movement graph must agree at every shared border and neck.
- A generated cave start must retain the requested useful degree and a competitive two-ring province count after silhouette construction.
- Inspect degree histograms for long degree-two chains, but judge them alongside geometry: a short scenic neck is desirable; an entire cave nation trapped on a linear rail is not.
- Test labels, markers, rivers, gate symbols, wrap seams, and minimum-resolution exports inside the narrowest permitted passage.
- Keep all reference art external. Implement motifs with project-owned procedural shapes and original assets only.
