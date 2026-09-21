# Native guardian battle and capture — September 21, 2026

An isolated unmodded Dominions 6.37 Middle Age game tested the generated Inferno encounter through battle, conquest, recruitment, and province-defence inspection. This is one functional encounter check, not multiplayer difficulty calibration or universal PD verification.

## Setup

- Source: the earlier 48-province Inferno guardian fixture, editable JSON SHA-256 `dff1a6b85d52ee034b209b5a5fd4ff17575d149733d3858f85bc80fbd1f0079c`.
- A new package, `Atlas_Guardian_Capture_K6f4If`, and new workspace-only native configuration/map/save root were created. Existing user maps, saves and settings were not modified. A disposable MA Ulm pretender was copied, not moved.
- MA Ulm #60 human, MA Abysia #63 normal AI; conquest victory, independent strength 4, random sites 0, no mods.
- Neutral province 1 retained the original generated army byte-for-byte in editable guardian data: Demonbred #87, 15 Devils #304 and 24 Imps #303, commander experience 3. Population type remained Lava-born #94; the target was outside both capital two-rings.
- Adjacent owned province 2 supplied three test Demonbred commanders, each with 20 Devils and 20 Imps. Forty demons per commander is below the source's explicit demon/undead leadership 50. These intentionally overwhelming attackers are test apparatus, not generated-map balance settings.
- The target had population 10,000, no fort or recruitment sites, and a lab/temple for the control. The temple was destroyed on capture, as the native report stated.

## Observed result

1. All three armies were ordered into province 1 through the native UI. Ending the turn produced a battle report for the designated **GUARDIAN TEST** target, not an unrelated independent fight.
2. The report listed exactly three attacking Demonbreds, 60 Devils and 60 Imps, versus one defending Demonbred, 15 Devils and 24 Imps. Ulm conquered the province; all 40 defenders were reported dead. The native battle replay opened and rendered the cave battlefield and units successfully.
3. Recruitment in the conquered province displayed exactly one Lava-born Commander choice and one Lava-born troop choice. Commander details matched the earlier population-94 control: 15 HP, leadership 50, Battleaxe, Iron Cap and Scale Mail Hauberk.
4. One commander and one troop were queued. Limited resources required separate recruitment turns. The completed commander appeared in the province and its native details identified it as a Lava-born Commander. After the next turn, army setup showed **one unit in garrison**; native details identified that new troop as Lava-born, with 14 HP and the expected equipment. The three test armies remained present with their original 20/20 squads.
5. The captured province began with native defence level 1. Its defence preview displayed a **Commander of Ulm**, not the former independent Demonbred. Raising the test level to 10 displayed four troop sprites; inspection identified a **Lava-born** troop. The numeric level remained 10 after hosting. This corroborates the distinction between initial guardians, local recruitment, and native post-capture PD: they are not one interchangeable army.

No new persistent PD roster was authored. No replenishment battle, other nation/era, modded game, aquatic encounter, or broad seasonal acceptance is established by this test. Numeric identities for the uniquely named Lava-born units are joined to the pinned 6.37 catalog and independently extracted recruitment table; no new numeric-ID panel is claimed here.
