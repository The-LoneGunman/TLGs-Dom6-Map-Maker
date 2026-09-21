# Dominions 6 content catalog

Current source ships a searchable Dominions **6.37** selector catalog. The
map-making manual remains the authority for map commands, population types,
and fortification IDs, but it predates later nations, units, and thrones.

The current selector data is generated from Dom6 Inspector revision
`c30c6c14e18ab284415d599b81579af9b3070112` (2026-09-18), whose upstream commit
is described as “Update to 6.37.” The source refresh was verified on September
21, 2026. Hosted and installer releases can lag current source; consult the
README's version table for their status.

The bundled catalog is pinned to 6.37; it does not automatically track later
game or Inspector updates. Custom catalog imports add editor metadata only,
not game content.

This is a selector index, not a complete game-rules or combat-stat database.
The intended patch/mod declarations in the workbench do not replace this
data or certify nation balance. Current source imports merge
in selection order; reset invalidates pending imports, and a failed save leaves
the prior catalog active. Both ZIP and direct-install validation reports use
the active merged catalog and state its assumptions. Custom catalog JSON and
any required game mods must be backed up and distributed separately.

Saved 6.35 custom catalogs remain importable. Their verified custom names and
metadata are preserved rather than silently relabelled as 6.37 observations.
Built-in home-site and throne classifications remain protected when an import
overrides an ID. Ordinary-site browsing must keep non-random Inspector sites
separate, including records carrying the historical 6.35 provenance.

## Post-publication content and map-manual table gaps

The supplied 6.26 map manual's nation table jumps from nation #121 to #125.
Pantokrator Atlas also includes the two playable nations omitted by that table:

- **LA Pyrène, Cambion Kings — nation #123**
- **LA Zemaitia, Sylvan Knights — nation #124**

### Dominions 6.08

| IDs | Names |
|---|---|
| #4020–#4023 | Armored Unicorn; Lich Oracle; Student of the Sword; Master of the Sword |
| #4024–#4026 | Mother Mandragora; Titan Mandragora; Black Minotaur |
| #4027–#4031 | Carrion Fury; Carrion Enkidu; Carrion Ogre; Carrion Giant; Carrion Titan |
| #4032–#4033 | Worm Soul (two forms) |

### Dominions 6.12

The official update introduced **LA Pyrène, Cambion Kings (#123)**. Its
verified roster block is:

| IDs | Names |
|---|---|
| #4034–#4040 | Pyrènian Crossbowman; Pyrènian Spearman; Pyrènian Footman; Pyrènian Man at Arms; Pyrènian Swordsman; Pyrènian Knight; Pyrènian Scout |
| #4041–#4047 | Pyrènian Castellan; Pyrènian Marquess; Pyrènian Monk; Pyrènian Priest; Blood Bishop; Sorgina; Black Cat |
| #4048–#4053 | Cambion King; Cambion Count; Cambion Knight; Cambion Queen; Cambion Countess; Incubus |
| #4054–#4061 | Cambion Progeny (two forms); Black Goat; Markata Mystic; Black Goat; Red Mistress; Crimson King; Centaur Manikin |

### Dominions 6.23 and 6.24

| ID | Name |
|---:|---|
| #4062 | C'tissian Medium Infantry |
| #4063 | Azenach Shaman Chief |
| #4064 | Agrimandri Shaman Chief |
| #4065 | Fommepori Shaman Chief |
| #4066 | Vintefolei Shaman Chief |
| #4067 | Spirit Horse |

### Dominions 6.30

The official update introduced **LA Zemaitia, Sylvan Knights**, available in
the nation picker as **nation #124**, plus new Zemaitian, Fay, Wight, and Moose
units. The verified unit IDs are:

| IDs | Names |
|---|---|
| #4068–#4070 | Zemaite Archer; Zemaite Warrior (two forms) |
| #4071–#4076 | Zemaite Infantry; Zemaite Heavy Infantry; Zemaite Chud Warrior; Zemaite Crossbowman; Zemaite Pikeneer; Zemaite Castle Guard |
| #4077–#4081 | Zemaite Skinshifter; Werewolf; Zemaite Chud Skinshifter; Werebear; Scout |
| #4082–#4089 | Zemaite Chieftain; Seniunas; Chud Seniunas; Vedun; Chud Vedun; Antlered Vedun; Vedun Mage Smith; Antlered Hochmeister |
| #4090–#4092 | Sylvan Knight; Sacred Moose; Lauma |
| #4093–#4099 | Fay Folk Stablehand; Fay Folk Musician; Fay Folk Cat Knight; Fay Cat; Fay Folk Snail Knight; Snail; Fay Folk Emperor |
| #4100–#4106 | Wight Hag; Wight Spider; Wight Hag; Wight Mage; Fay Folk Sheep Knight; Ram; Fay Folk Donkey-In-Waiting |
| #4107–#4111 | Great Moose; Ghost Moose; Moose Vedun; Lost Knight; Fay Moose |

### Dominions 6.32

The official update added Nidavangr-specific longdead forms:

| IDs | Names |
|---|---|
| #4112–#4114 | Longdead (three forms) |

### Dominions 6.34

The two new pretender chassis are **Draugadrott #2194** (whose alternate
Flayed Bull form is **#2195**) and **Buraq #4115**.

| ID | Name |
|---:|---|
| #4116 | Fay Archer |
| #4117 | Unseelie Archer |
| #4118–#4122 | Unseelie Folk (five forms) |
| #4123 | Unseelie Stablehand |
| #4124 | Unseelie Musician |
| #4125 | Unseelie Cat Knight |
| #4126 | Unseelie Cat |
| #4127 | Fay Folk Swan Knight |
| #4128 | Fay Swan |
| #4129 | Unseelie Raven Knight |
| #4130 | Unseelie Raven |
| #4131 | Shah of Horses |

The same pinned update records the renamed Draug forms as **Draugherse #2192**
and **Draugherse #2193**.

### Dominions 6.35

| ID | Name |
|---:|---|
| #4132 | Gnu |
| #4133 | Gnu Clan Cavalry |
| #4134 | Gnu Clan Commander |
| #1405 (site) | The Throne of Violence |

### Dominions 6.36–6.37 source refresh

Comparing the previous 6.35 pin with the 6.37 export found **no new, removed,
renamed, or renumbered selector entries**. All compact unit IDs/names/roles,
site metadata, nation labels, and other lookup tables are unchanged. Coverage
remains 4,091 unit records, 1,253 sites, 106 selectable nations including the
three independent-owner IDs, 82 population labels, and 28 fortifications.

Twelve of the thirteen source tables are byte-identical. `BaseU.csv` changes
statistics on 22 existing units; the compact selector does not store those
statistics. None of those changed rows belongs to the existing generated
guardian pools or the verified water-capable guardian list. This refresh does
not change guardian IDs, army compositions, or province-name reservations, and
does not itself require raising existing maps' minimum `#domversion`.

Pale One Commander **#1463** and Pale One **#1465** retain their exact names and
IDs. The commander still has normal leadership 75, and both retain Amphibian
and Darkvision 100 in the source. These unit facts alone do not prove their
membership in population type #81. The Inspector tables do not provide a
population-to-recruitment roster; that relationship requires separate native
verification. Matching unit names is not a substitute.

## Other post-6.26 thrones

The throne-only selector also contains:

- The Throne of the Fool #1398
- The Throne of Pride #1399
- The White Throne #1400
- The Black Throne #1401
- The Throne of Deeper Fires #1402
- The Throne of Deeper Waters #1403
- The Throne of Secrets #1404

Thrones remain excluded from the ordinary province-site picker and are exposed
only through the fixed-throne workflow.

## Commander, troop, and internal-record handling

Role-focused guardian lists combine the Inspector's fort, coast, and non-fort
nation recruitment tables with magic-site `hcom`/`hmon` and
`natcom`/`natmon` slots. This yields **850 known commander-role units** and
**842 known troop-role units**, including capital-site-only Zemaitian units
that a nation-table-only filter would omit.

The compact catalog retains all 4,091 source unit records for exact numeric-ID
lookup. Normal browsing hides 13 records whose source names explicitly identify
them as Test, Debug, XXX, or Unused data, leaving 4,078 records after that
name-based exclusion. This filter does not establish that every remaining unit
is recruitable or suitable for a guardian army.
Typing a verified raw numeric ID remains supported, and a hidden record already
selected in a project remains visible.

## Provenance boundary

Official patch announcements establish which named content was introduced in
each game update. They do not publish every numeric internal ID. Numeric IDs,
duplicate-form distinctions, recruitment-role tags, and complete selector
coverage come from the pinned GPL-3.0 Dom6 Inspector data export documented in
[`src/catalog/data/NOTICE.md`](../src/catalog/data/NOTICE.md).

The [catalog builder](../scripts/build-dom6-catalog.mjs) verifies SHA-256 hashes
for all thirteen input files before writing `dom6-6.37.json`; the same hashes
are recorded in that bundle. Rebuilding from older or modified source bytes is
rejected rather than producing a misleading 6.37 provenance label. Game
updates can still change balance while keeping every selector ID unchanged.
