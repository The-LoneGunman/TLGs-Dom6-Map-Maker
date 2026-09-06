import { BUILTIN_DOM6_CATALOG } from "./catalog/builtin";
import {
  effectiveProvinceTerrainFlags,
  isWaterProvince,
  type Plane,
  type PlaneVariant,
  type Province,
} from "./domain";

type WordList = readonly string[];

interface PlaneNameTheme {
  modifiers: WordList;
  nouns: WordList;
  epithets: WordList;
}

interface TerrainNameTheme {
  nouns: WordList;
  epithets: WordList;
}

export interface ProvinceNameContext {
  planeTheme: string;
  terrainThemes: readonly string[];
  coastal: boolean;
}

export interface ProvinceNamingReport {
  generated: number;
  authoredPreserved: number;
  reservedCount: number;
  collisionProbes: number;
  numericFallbacks: number;
}

const terms = (value: string): string[] => value.split("|").map((item) => item.trim()).filter(Boolean);

const COMMON_EPITHETS = terms("Dawn|Dusk|Rain|Rime|Stars|Moons|Echoes|Whispers|Old Roads|Lost Kings|Seven Stones|Long Shadows|Falling Light|Hidden Springs|Ancient Oaths|Wandering Winds|Silent Bells|Broken Spears|Green Fire|White Birds|Red Leaves|Deep Wells|Far Horizons|Returning Tides|First Snow|Last Light|Summer Thunder|Winter Suns|Forgotten Songs|Pilgrim Paths|Sleeping Giants|Empty Thrones");

const PLANE_THEMES: Record<string, PlaneNameTheme> = {
  surface: {
    modifiers: terms("Amber|Ancient|Bright|Broad|Elder|Golden|Green|Grey|Long|Old|Red|River|Silver|Summer|White|Windward|Winter|Crowned|Eastern|Western"),
    nouns: terms("Reach|March|Vale|Crossing|Country|Ward|Domain|Tract|Quarter|Land|Way|Bounds|Expanse|Terrace|District|Fields|Meads|Lowlands|Hearth|Frontier"),
    epithets: COMMON_EPITHETS,
  },
  cave: {
    modifiers: terms("Buried|Chthonic|Deep|Dripping|Echoing|Fungal|Glimmering|Hollow|Lower|Mosslit|Resonant|Rootbound|Shadowed|Stone|Subterranean|Umbral|Under|Vaulted|Veiled|Forgotten"),
    nouns: terms("Cavern|Grotto|Gallery|Hollow|Vault|Delve|Chamber|Maze|Burrow|Tunnel|Hall|Crevasse|Sink|Deep|Warren|Chasm|Fissure|Crypt|Undercroft|Labyrinth"),
    epithets: terms("Blind Rivers|Stone Roots|Pale Fungi|Buried Bells|Fallen Pillars|Sleeping Bats|Old Delvers|Endless Drips|Hidden Fires|Deep Echoes|Mossy Idols|Lost Miners|Crystal Tears|Black Wells|Forgotten Kings|Ancient Worms|Quiet Hammers|Sunless Years|Rooted Stone|Lower Roads|Sealed Doors|Hollow Winds|Glittering Dust|Distant Thunder|Carven Faces|Broken Lamps|Stalactites|Under Stars|Cold Springs|Warm Stone|Veiled Depths|Silent Footsteps"),
  },
  cavern: {
    modifiers: terms("Amethyst|Ancient|Argent|Crystal|Deep|Diamond|Echoing|Faceted|Gemlit|Gilded|Glittering|Grand|Hidden|Lower|Opaline|Prismatic|Resonant|Stalactite|Vast|Vaulted"),
    nouns: terms("Basilica|Cavern|Chamber|Crystalhall|Gallery|Geode|Gorge|Hall|Labyrinth|Rotunda|Sanctum|Vault|Deep|Nave|Pillarfield|Grotto|Colonnade|Amphitheater|Fissure|Undercity"),
    epithets: terms("Shattered Gems|A Thousand Echoes|Prisoned Light|Silver Veins|Golden Dust|Singing Stone|Faceted Shadows|Hidden Columns|Ancient Pillars|Deep Reflections|Buried Stars|Slow Rivers|Glittering Roofs|Crystal Rain|Old Masonry|Vast Silence|Lower Fires|Mineral Winds|Forgotten Vaults|Gemmed Walls|Pale Lanterns|Distant Hammers|Stone Choirs|Prismatic Pools|Seven Galleries|Fallen Arches|Endless Columns|Sealed Doors|Quartz Teeth|Opal Smoke|Sunless Splendor|Resounding Steps"),
  },
  cloud: {
    modifiers: terms("Aerial|Azure|Cirrus|Cloudborne|High|Lightning|Lofty|Nimbus|Rainbright|Silver|Skybound|Stormlit|Sunward|Tempest|Thunder|Upper|Vaporous|White|Windborne|Zephyr"),
    nouns: terms("Aerie|Cloudbank|Crown|Drift|Firmament|Height|Nimbus|Pavilion|Reach|Shelf|Skyhold|Spire|Updraft|Vapor|Vault|Way|Isle|Strand|Terrace|Roost"),
    epithets: terms("Four Winds|Summer Lightning|High Rain|Sunlit Feathers|Distant Thunder|White Wings|Storm Bells|Falling Hail|Blue Distance|Racing Clouds|Skyward Roads|Upper Suns|Silver Rain|Flying Banners|Quiet Air|Dawn Tempests|Evening Gusts|Circling Birds|Open Heavens|Cold Lightning|Warm Breezes|Wandering Storms|Cloud Castles|Winged Pilgrims|Rainbow Mists|Riven Skies|Hollow Thunder|Golden Haze|North Winds|South Winds|Eastern Gales|Western Gales"),
  },
  air: {
    modifiers: terms("Breathless|Celestial|Gale|High|Horizon|Invisible|Jetstream|Open|Radiant|Rushing|Skyward|Stormborne|Stratospheric|Tempestuous|Thin|Thunderous|Upper|Vast|Windcut|Zephyrous"),
    nouns: terms("Current|Draft|Gale|Gyre|Height|Passage|Reach|Rift|Stream|Surge|Way|Windroad|Expanse|Confluence|Spiral|Vortex|Channel|Crosswind|Shear|Vault"),
    epithets: terms("Unbound Winds|Seven Gales|Thunderheads|Empty Skies|Far Horizons|Invisible Roads|High Pressure|Dancing Vapors|Swift Feathers|Storm Voices|Cold Currents|Warm Updrafts|Blue Silence|Lightning Paths|Circling Eagles|Falling Rain|Upper Air|Wandering Clouds|Open Distance|Sunward Flight|Moonlit Gusts|Breathless Heights|Riven Weather|Four Quarters|Long Jetstreams|Silver Thunder|Whistling Reaches|Endless Blue|Storm Seasons|Quiet Calms|Racing Shadows|Sky Fires"),
  },
  underworld: {
    modifiers: terms("Ashen|Charonian|Dusky|Ebon|Funereal|Ghostlit|Grave|Hollow|Last|Mourning|Pallid|Sepulchral|Shadebound|Silent|Spectral|Stygian|Tombward|Umbral|Wan|Wraith"),
    nouns: terms("Barrow|Catacomb|Crypt|Deadland|Mausoleum|Necropolis|Ossuary|Sepulcher|Shade|Tomb|Vault|Hollow|March|Court|Gallery|Precinct|Passage|Reliquary|Charnel|Underway"),
    epithets: terms("Unburied Kings|Pale Shades|Last Rites|Silent Ferries|Mourning Bells|Forgotten Dead|Empty Tombs|Grey Processions|Ancient Bones|Restless Ghosts|Black Candles|Final Doors|Lost Names|Cold Ashes|Wandering Souls|Funeral Songs|Broken Urns|Dim Lanterns|Long Memory|Quiet Graves|Dusty Crowns|Unseen Judges|Withered Laurels|Departed Heroes|Pallid Courts|Shadowed Paths|Unending Night|Sepulchral Winds|Hollow Footsteps|Bone Gates|Last Journeys|Nameless Dead"),
  },
  hell: {
    modifiers: terms("Ashen|Blackened|Blazing|Brazen|Brimstone|Cinder|Crimson|Damned|Ember|Flayed|Furnace|Infernal|Iron|Molten|Pyre|Scorched|Searing|Smoldering|Sulfurous|Tormented"),
    nouns: terms("Caldera|Crucible|Furnace|Gehenna|Kiln|Lavafield|Pit|Pyre|Rift|Scoria|Torment|Waste|Basin|Chasm|Forge|Maw|Scar|Vents|Gorge|Anvil"),
    epithets: terms("Red Chains|Burning Winds|Black Flames|Iron Whips|Endless Thirst|Falling Cinders|Brazen Gates|Boiling Stone|Sulfur Rains|Scorched Wings|Damned Legions|Molten Crowns|Charred Bones|Searing Trumpets|Broken Oaths|Ember Storms|Blood Red Skies|Furnace Roars|Unquenched Fires|Ashen Hosts|Smoking Rivers|Flaming Swords|Iron Judgments|Hot Darkness|Cinder Seas|Cracked Earth|Burning Pits|Brimstone Clouds|Last Mercy|Fiery Ruin|Tormented Kings|Smoldering Altars"),
  },
  abyss: {
    modifiers: terms("Black|Blank|Broken|Dissolving|Distant|Endless|Fractured|Hollow|Impossible|Lightless|Lost|Nameless|Null|Outer|Silent|Starless|Unmade|Unseen|Vacant|Voiceless"),
    nouns: terms("Absence|Beyond|Breach|Chasm|Fold|Gap|Interstice|Nullity|Reach|Rift|Scar|Threshold|Void|Aperture|Nexus|Pocket|Rent|Seam|Interval|Unspace"),
    epithets: terms("Dead Stars|No Return|Broken Angles|Distant Screams|Unwritten Hours|Empty Light|Lost Constellations|Falling Worlds|Silent Orbits|Cold Infinity|Unseen Eyes|Fractured Time|Nameless Shapes|Outer Dark|Vanished Suns|Impossible Depths|Hollow Distance|Unmade Roads|Forgotten Reality|Black Mirrors|Endless Descent|Vacant Heavens|Dissolving Forms|Voiceless Things|Last Horizons|Absent Gods|Riven Space|Blind Eternity|Nowhere Beyond|Starless Ages|Shattered Reason|Final Silence"),
  },
  dream: {
    modifiers: terms("Dancing|Dreaming|Enchanted|Fay|Glamoured|Gloaming|Iridescent|Liminal|Lucid|Moonlit|Oneiric|Phantasmal|Rainbow|Reverie|Silver|Slumbering|Soft|Twilight|Unreal|Whispering"),
    nouns: terms("Bower|Court|Dream|Garden|Grove|Labyrinth|Masque|Meadow|Mirror|Reverie|Threshold|Wild|Glade|Palace|Pageant|Orchard|Mosaic|Hollow|Festival|Wonder"),
    epithets: terms("Midsummer Sleep|Dancing Lights|Unfinished Tales|Silver Apples|Moonlit Revels|Whispered Wishes|Painted Birds|Changing Paths|Velvet Night|Glass Butterflies|Hidden Laughter|Sleeping Queens|Twilight Music|Golden Dreams|Unseen Dancers|Soft Footfalls|Wild Hunts|Mirror Moons|Blooming Stars|Forgotten Childhood|Rainbow Rain|Fay Lanterns|Lucid Rivers|Glamoured Thorns|Impossible Gardens|Slumbering Beasts|Phantom Bells|Endless Masques|Waking Dreams|Iridescent Mists|Secret Names|Reverie Winds"),
  },
  elemental: {
    modifiers: terms("Aetheric|Balanced|Chaotic|Concordant|Elemental|Flowing|Fourfold|Living|Primal|Pure|Quintessential|Riven|Shifting|Sublime|Titanic|Transforming|Untamed|Vast|Worldborn|Worldforged"),
    nouns: terms("Confluence|Crucible|Dominion|Fount|Junction|Meld|Principle|Quarry|Source|Vortex|Expanse|Matrix|Concord|Bastion|Font|Axis|Maelstrom|Convergence|Engine|Foundation"),
    epithets: terms("Fire and Rain|Stone and Sky|Four Winds|Living Flame|Deep Waters|Moving Earth|Primal Storms|World Roots|Burning Seas|Crystal Air|Shifting Matter|Untamed Powers|Elemental Kings|First Creation|Titanic Forces|Pure Essences|Four Quarters|Roaring Fountains|Mountain Fire|Ocean Thunder|Aether and Clay|Riven Foundations|Boiling Rain|Dancing Stone|World Forging|Endless Change|Concordant Powers|Opposing Forces|Birth of Mountains|Storming Seas|Ancient Elements|Primal Balance"),
  },
};

Object.assign(PLANE_THEMES, {
  "custom:temperate": { ...PLANE_THEMES.surface },
  "custom:wild": { ...PLANE_THEMES.dream },
  "custom:frozen": {
    ...PLANE_THEMES.air,
    modifiers: terms("Boreal|Cold|Frostbound|Frosted|Frozen|Glacial|Hoarfrost|Icebound|Icy|Northward|Pale|Polar|Rimed|Shivering|Snowbound|Snowy|White|Wintry|Wolfswinter|Zeroed"),
  },
  "custom:arid": {
    ...PLANE_THEMES.surface,
    modifiers: terms("Arid|Bleached|Burning|Copper|Desert|Dry|Dun|Dusty|Ochre|Parched|Red|Salt|Scoured|Sere|Sunburnt|Sunscorched|Thirsting|Umber|White|Windworn"),
  },
  "custom:oceanic": {
    ...PLANE_THEMES.surface,
    modifiers: terms("Azure|Briny|Coral|Currentbound|Deepblue|Foaming|Islanded|Mariner|Oceanic|Pearl|Pelagic|Salt|Sapphire|Seaward|Stormtossed|Tidal|Turquoise|Wavebound|Windward|Whaleward"),
  },
  "custom:fungal": { ...PLANE_THEMES.cave },
  "custom:crystal": { ...PLANE_THEMES.cavern },
  "custom:volcanic": {
    ...PLANE_THEMES.elemental,
    modifiers: terms("Ashfall|Basalt|Burning|Caldera|Cinder|Crimson|Ember|Eruptive|Fireborn|Igneous|Lava|Magma|Molten|Obsidian|Pyroclastic|Scoria|Smoldering|Sulfurous|Volcanic|Worldfire"),
  },
  "custom:storm": { ...PLANE_THEMES.air },
  "custom:infernal": { ...PLANE_THEMES.hell },
  "custom:void": { ...PLANE_THEMES.abyss },
} satisfies Record<string, PlaneNameTheme>);

const TERRAIN_THEMES: Record<string, TerrainNameTheme> = {
  plains: { nouns: terms("Downs|Fields|Grassland|Lea|Lowland|March|Meadow|Plain|Reach|Steppe|Vale|Wold|Prairie|Meads|Flats|Country|Pasture|Tableland|Open|Sward"), epithets: terms("Tall Grass|Open Skies|Lark Song|Long Roads|Wild Horses|Summer Rain|Broad Rivers|Golden Light|Old Stones|Distant Hills|Pilgrim Ways|Fallen Leaves|Morning Mists|Evening Stars|Green Barrows|White Clouds|Wandering Herds|Wind Bent Grass|Ancient Tracks|Quiet Hamlets|Seven Oaks|Low Horizons|Sunlit Miles|Returning Cranes|Grey Rains|Wide Valleys|Field Flowers|Earthbound Winds|Clear Springs|Stone Circles|Old Frontiers|Harvest Moons") },
  farm: { nouns: terms("Acres|Barleyfield|Croft|Farmland|Grange|Harvest|Orchards|Pastures|Ryevale|Steading|Vineyard|Wheatland|Demesne|Fallow|Hedgerows|Homestead|Plantation|Terraces|Tilth|Village"), epithets: terms("Ripe Barley|High Wheat|Autumn Grain|Old Mills|Plough Songs|Harvest Bells|Stone Fences|Village Wells|Red Orchards|White Sheep|Long Furrows|Green Vines|Golden Sheaves|Threshing Floors|Quiet Barns|Market Roads|Summer Hay|Winter Stores|Apple Trees|River Farms|Hill Crofts|Ancient Ploughs|Fallow Years|Brown Earth|Mown Fields|Farmstead Fires|Hedged Lanes|Harvest Moons|Village Oaks|Rye Bread|Cider Presses|Returning Geese") },
  forest: { nouns: terms("Boughs|Copse|Forest|Glade|Grove|Holt|Thicket|Timberland|Weald|Wildwood|Wood|Brake|Canopy|Dells|Greenwood|Oaks|Pines|Shade|Sylva|Woods"), epithets: terms("Ancient Oaks|Whispering Leaves|White Stags|Green Shadows|Twisted Roots|Bird Song|Falling Acorns|Mossy Stones|Hidden Paths|Tall Pines|Moonlit Boughs|Red Foxes|Deep Shade|Old Druids|Wild Bees|Silver Birches|Summer Canopy|Winter Branches|Emerald Ferns|Hollow Trees|Running Deer|Forest Springs|Black Thorns|Golden Leaves|Seven Groves|Quiet Owls|Woodland Mists|Rooted Hills|Crowned Trees|Dancing Dryads|Verdant Silence|Leafy Ways") },
  swamp: { nouns: terms("Bog|Fen|Marsh|Mere|Mire|Morass|Quagmire|Reedlands|Slough|Wetland|Bayou|Carr|Fens|Marish|Moor|Pools|Sedge|Sink|Swale|Wash"), epithets: terms("Black Reeds|Croaking Frogs|Pale Mists|Still Pools|Sinking Paths|Green Water|Muddy Lights|Willow Roots|Hidden Leeches|Slow Streams|Rotting Logs|Grey Herons|Fen Fires|Buzzing Flies|Drowned Oaks|Soft Earth|Marsh Bells|Bitter Vapors|Long Sedges|Shallow Graves|Bog Iron|Reed Boats|Murk Waters|Rain Pools|Twilight Gnats|Lost Causeways|Fallen Willows|Brackish Springs|Mire Flowers|Swamp Stars|Sodden Ruins|Peat Smoke") },
  waste: { nouns: terms("Badlands|Barrens|Desert|Dunes|Exile|Flats|Saltpan|Scar|Waste|Wilderness|Erg|Expanse|Hamada|Sands|Desolation|Drylands|Gravel|Reach|Steppe|Wold"), epithets: terms("White Salt|Red Sand|Bleached Bones|Empty Wells|Scouring Winds|Lost Caravans|Burning Days|Cold Nights|Broken Stones|Distant Mirages|Dust Devils|Sun Cracks|Withered Thorns|Dry Rivers|Ancient Tracks|Shifting Dunes|Desert Stars|Silent Camps|Glass Sand|Weathered Idols|Scorpion Trails|Dead Trees|Fallen Towers|Long Thirst|Riven Earth|Ashen Skies|Bitter Dust|Forgotten Roads|Unshaded Miles|Stone Graves|Empty Horizons|Wandering Sand") },
  highland: { nouns: terms("Brae|Craglands|Fells|Heights|Highlands|Moor|Plateau|Ridge|Shelf|Upland|Ben|Escarpment|Headland|Hillcountry|Mesa|Rise|Shoulder|Tor|Wolds|Tableland"), epithets: terms("Heather Hills|High Winds|Eagle Flight|Stone Cairns|Mountain Rain|Old Clans|Ringing Valleys|Grey Sheep|Cloud Shadows|Steep Roads|Red Heather|Cold Springs|Hill Forts|Long Ridges|Distant Peaks|Weathered Stones|Crowned Hills|Moorland Mists|Granite Bones|Wild Goats|Sunset Cliffs|Upland Rivers|Hidden Valleys|Ancient Cairns|Windy Passes|Falcon Cries|Stormy Heights|High Meadows|Sloping Fields|Rocky Shelves|Purple Heather|Open Summits") },
  mountains: { nouns: terms("Crown|Massif|Mountain|Needles|Peak|Pinnacle|Range|Spine|Summit|Teeth|Alps|Cliffs|Horn|Mount|Precipice|Sierra|Crags|Rampart|Ridge|Tor"), epithets: terms("Snowy Peaks|Granite Faces|Eagle Nests|Avalanche Paths|High Passes|Cloud Crowns|Deep Valleys|Stone Giants|Frozen Springs|Iron Veins|Mountain Goats|Storm Summits|Ancient Ice|Sheer Cliffs|White Crags|Thunder Echoes|Hidden Caves|Wind Carved Stone|Distant Horns|Falling Rocks|Sky Temples|Glacial Lakes|Crowned Peaks|Cold Shadows|Pine Slopes|Mountain Suns|Riven Granite|Steep Ascents|Old Footpaths|High Altars|Silver Snows|Summit Stars") },
  coast: { nouns: terms("Bay|Cape|Coast|Cove|Estuary|Haven|Headland|Inlet|Shore|Strand|Beach|Cliffs|Harbor|Landing|Reaches|Roadstead|Sound|Tideway|Bight|Rivermouth"), epithets: terms("Gull Cries|Returning Tides|Salt Winds|White Cliffs|Fishing Boats|Storm Waves|Beacon Fires|Drowned Bells|Driftwood|Sea Caves|Pearl Foam|Coastal Pines|Sandy Paths|Blue Horizons|Hidden Coves|Rocky Shores|Long Beaches|Sailor Graves|Tidal Pools|Crashing Surf|Mariner Stars|Salt Marshes|Coral Sands|River Mouths|Sunset Sails|Sea Mist|Old Lighthouses|Black Rocks|Windward Dunes|Quiet Harbors|Moonlit Bays|Seaward Roads") },
  sea: { nouns: terms("Bay|Bight|Bluewater|Current|Gulf|Ocean|Reach|Roadstead|Sea|Sound|Strait|Tide|Waters|Channel|Main|Passage|Swell|Brine|Seaway|Gyre"), epithets: terms("Blue Waves|White Gulls|Long Swells|Salt Winds|Distant Sails|Moon Tides|Storm Petrels|Flying Fish|Rolling Seas|Hidden Shoals|Mariner Stars|Sunken Bells|Pearl Foam|Black Currents|Warm Waters|Cold Waters|Open Ocean|Changing Tides|Sea Smoke|Wandering Whales|Tidal Roads|Silver Waves|Coral Banks|Drowned Stars|Seaward Winds|Deep Blue|Sailor Songs|Far Islands|Ocean Rain|Quiet Calms|Storm Horizons|Returning Ships") },
  deep_sea: { nouns: terms("Abyss|Basin|Deep|Depths|Fathoms|Trench|Undersea|Blackwater|Chasm|Deepwater|Gulf|Hadals|Rift|Sounding|Sunless Sea|Trough|Blue Hole|Dropoff|Ocean Floor|Subduction"), epithets: terms("Sunken Stars|Whale Falls|Black Water|Crushing Depths|Blind Fish|Cold Vents|Drowned Mountains|Fathomless Night|Ancient Currents|Leviathan Roads|Falling Snow|Lightless Miles|Deep Echoes|Undersea Ridges|Lost Fleets|Silent Pressure|Midnight Waters|Abyssal Winds|Sinking Light|Black Smokers|Hidden Trenches|Ocean Bones|Sunken Moons|Slow Tides|Endless Descent|Deep Coral|Distant Songs|Buried Islands|Cold Darkness|Great Squid|Forgotten Wrecks|Last Soundings") },
  kelp: { nouns: terms("Canopy|Forest|Garden|Grove|Kelpwood|Tangle|Weedbank|Wrack|Beds|Bower|Fronds|Greenwater|Holdfast|Kelp Sea|Marine Wood|Reefwood|Sargassum|Thicket|Underforest|Wall"), epithets: terms("Amber Kelp|Dancing Fronds|Green Tides|Sea Dragons|Silver Fish|Hidden Otters|Kelp Lanterns|Sunken Oaks|Whale Song|Living Currents|Coral Roots|Drowned Leaves|Swaying Canopy|Pearl Light|Tangled Nets|Forest Tides|Seaweed Dreams|Deep Gardens|Underwater Birds|Holdfast Stones|Kelp Shadows|Glowing Algae|Drifting Leaves|Green Silence|Reef Wolves|Ocean Grazers|Sargassum Moons|Submerged Boughs|Saltwood|Eel Paths|Living Reefs|Wave Bent Fronds") },
  freshwater: { nouns: terms("Brook|Lake|Mere|Pool|River|Spring|Stream|Waters|Beck|Falls|Ford|Loch|Pond|Rill|Run|Watercourse|Well|Oxbow|Reservoir|Rivulet"), epithets: terms("Clear Water|Leaping Trout|River Stones|Cold Springs|Reed Banks|Willow Shade|Silver Fish|Mossy Fords|Water Mills|Lake Mists|Singing Brooks|Deep Pools|Falling Water|Green Banks|Wading Birds|Old Bridges|River Bends|Spring Flowers|Rain Fed Streams|Quiet Ponds|White Rapids|Fresh Currents|Peaked Reflections|Flooded Meadows|Water Lilies|Pebbled Beds|Long Tributaries|Hidden Wells|Snowmelt|Blue Lakes|Ancient Fords|Running Water") },
  cave: { nouns: terms("Cavern|Chamber|Delve|Gallery|Grotto|Hollow|Tunnel|Vault|Burrow|Deep|Fissure|Hall|Maze|Passage|Undercroft|Warren|Sink|Crevasse|Crypt|Labyrinth"), epithets: PLANE_THEMES.cave!.epithets },
  cave_forest: { nouns: terms("Funguswood|Mossgrove|Rootcave|Sporewood|Underforest|Mushroom Grove|Mycelium|Puffball Wood|Lichen Hall|Glowcap Grove|Root Vault|Fungal Garden|Moss Grotto|Spore Cavern|Blindwood|Mold Forest|Underbrush|Cave Copse|Buried Grove|Sunless Wood"), epithets: terms("Glowing Caps|Pale Spores|Stone Roots|Mossy Pillars|Blind Beetles|Ancient Mycelia|Fungal Lanterns|Buried Trees|Soft Rot|Dripping Leaves|Root Tunnels|Giant Mushrooms|Green Darkness|Spore Clouds|Lichen Walls|Underworld Seeds|Hidden Beetles|Sunless Ferns|Crystal Dew|Mold Gardens|Twisted Roots|Puffball Fields|Glowworms|Moss Curtains|Fungal Giants|Deep Compost|Pale Blossoms|Rooted Stone|Spore Winds|Blind Flowers|Underground Rain|Verdant Dark") },
  cave_swamp: { nouns: terms("Blackpool|Dripfen|Flooded Hollow|Gloomfen|Mirecave|Mud Grotto|Sump|Underbog|Wet Vault|Brackish Hall|Cavern Mire|Drowned Gallery|Flooded Deep|Muck Tunnel|Seepage|Silt Chamber|Sodden Cavern|Sunless Marsh|Undermire|Waterlogged Delve"), epithets: terms("Blind Eels|Black Mud|Dripping Roofs|Pale Reeds|Stagnant Pools|Cave Leeches|Sunless Water|Buried Fens|Sodden Moss|Slow Seepage|Mud Falls|Gloomy Vapors|Lost Causeways|Flooded Tombs|Grey Silt|Hidden Sumps|Mire Lights|Wet Stone|Blind Frogs|Brackish Springs|Under Reeds|Deep Puddles|Moldy Banks|Drowned Roots|Cavern Mists|Subterranean Rain|Quiet Pools|Soft Footing|Black Water|Fungal Marshes|Buried Streams|Sinking Tunnels") },
  cave_waste: { nouns: terms("Ash Cavern|Barren Deep|Cinder Vault|Dead Grotto|Dust Hall|Empty Delve|Salt Cave|Scoria Chamber|Sterile Hollow|Waste Tunnel|Black Fissure|Burnt Gallery|Dry Sink|Gravel Vault|Lifeless Maze|Parched Deep|Soot Cavern|Stone Waste|Sunless Desert|Withered Grotto"), epithets: terms("Cold Ash|Empty Veins|Cracked Stone|Buried Cinders|Dead Fungi|Dry Wells|Black Dust|Forgotten Fires|Sterile Depths|Salt Pillars|Scoria Floors|Soot Winds|Burnt Roots|Hollow Rocks|Parched Tunnels|Ancient Eruptions|Lifeless Halls|Grey Sand|Deep Drought|Charred Bones|Lost Miners|Silent Fissures|Cinder Rains|Withered Moss|Barren Stone|Empty Galleries|Dry Echoes|Ashen Walls|Broken Strata|Sunless Heat|Cold Desolation|Dusty Vaults") },
  cave_highland: { nouns: terms("Basalt Rise|Cavern Ridge|Crystal Tor|Deep Crag|Granite Shelf|High Vault|Pillar Peak|Stalagmite Crown|Stone Heights|Undercliff|Buried Mountain|Cave Massif|Chthonic Ridge|Deep Escarpment|Gemstone Peak|Lower Summit|Rock Spire|Subterranean Tor|Vaulted Heights|Underpeak"), epithets: terms("Stone Teeth|Crystal Peaks|Deep Cliffs|Fallen Pillars|Echoing Summits|Granite Bones|Buried Ranges|Stalagmite Forests|High Caverns|Hidden Passes|Rock Slides|Glittering Crags|Sunless Heights|Mineral Winds|Ancient Faults|Vaulted Roofs|Under Mountains|Sharp Columns|Quartz Ridges|Deep Ascents|Cold Stone|Pale Crystals|Echo Peaks|Broken Shelves|Gemmed Heights|Steep Tunnels|Carven Summits|Titanic Pillars|Dark Precipices|Rising Stone|Hidden Crown|Resonant Cliffs") },
  flooded_cave: { nouns: terms("Black Lake|Drowned Cavern|Flooded Hall|Grotto Sea|Subterranean Lake|Sunless Waters|Underground Sea|Water Vault|Blue Grotto|Cavern Sound|Deep Cistern|Drowned Gallery|Flooded Deep|Hidden Loch|Lower Ocean|Sump Sea|Underlake|Water Cave|Wet Chasm|Abyssal Reservoir"), epithets: terms("Blind Fish|Drowned Pillars|Black Water|Crystal Shores|Sunless Tides|Pale Eels|Flooded Tombs|Undersea Echoes|Dripping Vaults|Subterranean Waves|Lost Boats|Cold Springs|Buried Beaches|Cavern Reefs|Deep Currents|Hidden Waterfalls|Mossy Banks|Stalactite Reflections|Underground Rain|Drowned Roads|Blue Darkness|Water Worn Stone|Echoing Tides|Blind Leviathans|Black Pearls|Silted Halls|Fungal Shores|Ancient Cisterns|Lower Rivers|Sunken Crystals|Cave Foam|Endless Drips") },
  styx: { nouns: terms("Black Ford|Dark Ferry|Deadwater|Funeral Reach|Ghost Current|Mourning Bank|Pale Crossing|Shade River|Silent Strand|Stygian Course|Charonian Ferry|Dusky Waters|Grave Current|Last Ford|Obol Reach|Spectral Channel|Tombward Flow|Understream|Wan River|Wraithwater"), epithets: terms("Silent Boatmen|Unburied Dead|Black Reeds|Pale Coins|Last Crossings|Mourning Shades|Forgotten Souls|Funeral Songs|Grey Ferries|Cold Waters|Endless Passage|Dead Kings|Lost Obols|Shade Processions|Final Journeys|Ghostly Oars|Quiet Banks|Underworld Mists|Drowned Memories|Sepulchral Currents|Dim Lanterns|Wandering Spirits|Ebon Tides|Ancient Burials|Tomb Roads|Pallid Water|Last Farewells|River Guardians|Unending Night|Dead Heroes|Black Boats|Silent Shores") },
  cavewall: { nouns: terms("Barrier|Bulwark|Dead End|Face|Fault|Rockfall|Seal|Stonewall|Wall|Blockage|Bastion|Cliff|Closure|Collapse|Impasse|Rampart|Stratum|Terminal|Threshold|Vein"), epithets: terms("Unbroken Stone|Sealed Ways|Ancient Faults|Fallen Roofs|Solid Rock|Buried Doors|Closed Tunnels|Stone Teeth|No Passage|Deep Pressure|Crushed Galleries|Granite Walls|Lost Roads|Silent Barriers|Titanic Pillars|Unmined Veins|Cave Ins|Black Stone|Shut Gates|Lower Strata|Endless Rock|Impassable Depths|Forgotten Exits|Mountain Roots|Collapsed Halls|Hidden Beyond|Dead Tunnels|Carven Seals|Buried Masonry|Final Walls|Cold Granite|Unyielding Earth") },
};

const CUSTOM_VARIANT_THEME: Record<PlaneVariant, string> = {
  temperate: "custom:temperate",
  wild: "custom:wild",
  frozen: "custom:frozen",
  arid: "custom:arid",
  oceanic: "custom:oceanic",
  fungal: "custom:fungal",
  crystal: "custom:crystal",
  volcanic: "custom:volcanic",
  storm: "custom:storm",
  infernal: "custom:infernal",
  void: "custom:void",
};

const APP_REALM_NAMES = [
  "The Underworld",
  "Underworld",
  "The Dreamlands",
  "Dreamlands",
  "The Abyss",
  "Abyss",
  "The Firmament",
  "Firmament",
  "The Cloud Realm",
  "Cloud Realm",
  "The Elemental Expanse",
  "Elemental Expanse",
] as const;

/** Case-, punctuation-, accent-, and leading-article-insensitive comparison. */
export function normalizeProvinceName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the\s+/, "")
    .replace(/\s+/g, " ");
}

function generatedReservedNames(): string[] {
  const names: string[] = [];
  for (const nation of BUILTIN_DOM6_CATALOG.nations) {
    if (!nation.era) continue;
    names.push(nation.name);
    if (nation.subtitle) names.push(nation.subtitle);
  }
  for (const site of BUILTIN_DOM6_CATALOG.sites) {
    if (site.tags?.includes("nation-home-site")) names.push(site.name);
  }
  for (const plane of BUILTIN_DOM6_CATALOG.planes) names.push(plane.name);
  // The pinned tables expose Nexus as poptype 106 and Dreamlands as a nation
  // epithet/site; include those factual labels without importing a map list.
  for (const poptype of BUILTIN_DOM6_CATALOG.poptypes) if (poptype.id === 106) names.push(poptype.name);
  names.push(...APP_REALM_NAMES);
  return [...new Map(names
    .filter(Boolean)
    .map((name) => [normalizeProvinceName(name), name] as const))
    .values()]
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Generated from the bundled, pinned 6.35 nation/home-site/plane tables plus
 * the map maker's own special-realm labels. Ordinary generated provinces are
 * never allowed to normalize-match an entry in this blacklist.
 */
export const RESERVED_CAPITAL_NAMES: readonly string[] = Object.freeze(generatedReservedNames());
export const RESERVED_CAPITAL_NAME_KEYS: ReadonlySet<string> = new Set(RESERVED_CAPITAL_NAMES.map(normalizeProvinceName));

export function isReservedProvinceName(value: string): boolean {
  return RESERVED_CAPITAL_NAME_KEYS.has(normalizeProvinceName(value));
}

function planeThemeKey(plane: Pick<Plane, "kind" | "variant">): string {
  if (plane.kind !== "custom") return plane.kind;
  return CUSTOM_VARIANT_THEME[plane.variant ?? "temperate"];
}

function coastalLandIds(plane: Plane): Set<string> {
  const byId = new Map(plane.provinces.map((province) => [province.id, province]));
  const coastal = new Set<string>();
  for (const edge of plane.edges) {
    const a = byId.get(edge.a);
    const b = byId.get(edge.b);
    if (!a || !b) continue;
    const aWater = isWaterProvince(a);
    const bWater = isWaterProvince(b);
    if (aWater === bWater) continue;
    coastal.add(aWater ? b.id : a.id);
  }
  return coastal;
}

export function provinceNameContext(plane: Plane, province: Province, coastalIds = coastalLandIds(plane)): ProvinceNameContext {
  const flags = effectiveProvinceTerrainFlags(province);
  const coastal = coastalIds.has(province.id) && !flags.has("sea");
  const theme = planeThemeKey(plane);

  if (flags.has("cavewall")) return { planeTheme: theme, terrainThemes: ["cavewall"], coastal };
  if (plane.kind === "underworld" && flags.has("sea")) return { planeTheme: "underworld", terrainThemes: ["styx"], coastal: false };
  if (flags.has("sea") && flags.has("cave")) return { planeTheme: theme, terrainThemes: ["flooded_cave"], coastal: false };
  if (flags.has("sea") && flags.has("forest")) return { planeTheme: theme, terrainThemes: ["kelp"], coastal: false };
  if (flags.has("sea") && flags.has("deep")) return { planeTheme: theme, terrainThemes: ["deep_sea"], coastal: false };
  if (flags.has("sea")) return { planeTheme: theme, terrainThemes: ["sea"], coastal: false };

  if (flags.has("cave")) {
    if (flags.has("mountains") || flags.has("highland")) return { planeTheme: theme, terrainThemes: ["cave_highland"], coastal };
    if (flags.has("swamp")) return { planeTheme: theme, terrainThemes: ["cave_swamp"], coastal };
    if (flags.has("waste")) return { planeTheme: theme, terrainThemes: ["cave_waste"], coastal };
    if (flags.has("forest")) return { planeTheme: theme, terrainThemes: ["cave_forest"], coastal };
    return { planeTheme: theme, terrainThemes: ["cave"], coastal };
  }

  const terrainThemes: string[] = [];
  if (flags.has("mountains")) terrainThemes.push("mountains");
  else if (flags.has("highland")) terrainThemes.push("highland");
  if (flags.has("swamp")) terrainThemes.push("swamp");
  if (flags.has("waste")) terrainThemes.push("waste");
  if (flags.has("forest")) terrainThemes.push("forest");
  if (flags.has("farm")) terrainThemes.push("farm");
  if (flags.has("freshwater")) terrainThemes.push("freshwater");
  if (coastal) terrainThemes.push("coast");
  if (!terrainThemes.length) terrainThemes.push("plains");
  return { planeTheme: theme, terrainThemes, coastal };
}

function namingVocabulary(context: ProvinceNameContext): { modifiers: WordList; nouns: WordList; epithets: WordList; key: string; requiresEpithet: boolean } {
  const planeTheme = PLANE_THEMES[context.planeTheme] ?? PLANE_THEMES.surface!;
  const primary = TERRAIN_THEMES[context.terrainThemes[0]!] ?? { nouns: planeTheme.nouns, epithets: planeTheme.epithets };
  const nouns = context.terrainThemes[0] === "plains" && context.planeTheme !== "surface"
    ? planeTheme.nouns
    : primary.nouns;
  const secondary = context.terrainThemes.length > 1
    ? TERRAIN_THEMES[context.terrainThemes[1]!] ?? primary
    : undefined;
  return {
    modifiers: planeTheme.modifiers,
    nouns,
    epithets: secondary?.epithets ?? planeTheme.epithets,
    key: `${context.planeTheme}:${context.terrainThemes.join("+")}`,
    requiresEpithet: context.terrainThemes.length > 1,
  };
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function permutationStep(size: number, seed: number): number {
  let step = Math.max(1, (seed % size) | 1);
  while (gcd(step, size) !== 1) step = (step + 2) % size || 1;
  return step;
}

function candidateAtRank(vocabulary: ReturnType<typeof namingVocabulary>, seed: string, rank: number): { name: string; numericFallback: boolean } {
  const simpleSize = vocabulary.modifiers.length * vocabulary.nouns.length;
  const complexSize = simpleSize * vocabulary.epithets.length;
  const hash = stableHash(`${seed}:${vocabulary.key}`);
  // Seeded cadence keeps short and compound names mostly article-free, while
  // retaining "The" for one in four candidates in each contextual vocabulary.
  // Articles do not add to the unique-name pool: collision checks ignore them.
  const article = (rank + (hash >>> 16)) % 4 === 0 ? "The " : "";
  if (!vocabulary.requiresEpithet && rank < simpleSize) {
    const offset = hash % simpleSize;
    const step = permutationStep(simpleSize, hash >>> 8);
    const value = (offset + rank * step) % simpleSize;
    const modifier = vocabulary.modifiers[Math.floor(value / vocabulary.nouns.length)]!;
    const noun = vocabulary.nouns[value % vocabulary.nouns.length]!;
    return { name: `${article}${modifier} ${noun}`, numericFallback: false };
  }
  const simpleOffset = vocabulary.requiresEpithet ? 0 : simpleSize;
  if (rank < simpleOffset + complexSize) {
    const complexRank = rank - simpleOffset;
    const offset = stableHash(`${seed}:${vocabulary.key}:epithet`) % complexSize;
    const step = permutationStep(complexSize, hash >>> 12);
    const value = (offset + complexRank * step) % complexSize;
    const pair = value % simpleSize;
    const epithetIndex = Math.floor(value / simpleSize);
    const modifier = vocabulary.modifiers[Math.floor(pair / vocabulary.nouns.length)]!;
    const noun = vocabulary.nouns[pair % vocabulary.nouns.length]!;
    const epithet = vocabulary.epithets[epithetIndex]!;
    return { name: `${article}${modifier} ${noun} of ${epithet}`, numericFallback: false };
  }
  const poolSize = simpleOffset + complexSize;
  const recycled = candidateAtRank(vocabulary, seed, rank % poolSize);
  return { name: `${recycled.name} ${rank - poolSize + 2}`, numericFallback: true };
}

/** Smallest compositional pool among every supported context. */
export const MIN_CONTEXTUAL_NAME_POOL = Math.min(...Object.values(PLANE_THEMES).flatMap((plane) =>
  Object.values(TERRAIN_THEMES).map((terrain) => {
    const simple = plane.modifiers.length * terrain.nouns.length;
    return simple * Math.min(plane.epithets.length, terrain.epithets.length);
  })));

/**
 * Mutates only names explicitly marked generated. Missing provenance is
 * treated as authored so schema-v1 imports cannot silently lose map text.
 */
export function regenerateGeneratedProvinceNames(
  planes: Plane[],
  seed: string,
  reroll = 0,
): ProvinceNamingReport {
  const used = new Set(RESERVED_CAPITAL_NAME_KEYS);
  let generated = 0;
  let authoredPreserved = 0;
  let collisionProbes = 0;
  let numericFallbacks = 0;

  for (const plane of planes) {
    for (const province of plane.provinces) {
      if (province.nameSource === "generated") continue;
      authoredPreserved += 1;
      const key = normalizeProvinceName(province.name);
      if (key) used.add(key);
    }
  }

  const contextRanks = new Map<string, number>();
  for (const plane of planes) {
    const coastal = coastalLandIds(plane);
    const ordered = [...plane.provinces].sort((left, right) => left.index - right.index || left.id.localeCompare(right.id));
    for (const province of ordered) {
      if (province.nameSource !== "generated") continue;
      const vocabulary = namingVocabulary(provinceNameContext(plane, province, coastal));
      const rankKey = vocabulary.key;
      let rank = contextRanks.get(rankKey) ?? 0;
      let result = candidateAtRank(vocabulary, `${seed}:names:${reroll}`, rank);
      let key = normalizeProvinceName(result.name);
      while (!key || used.has(key)) {
        collisionProbes += 1;
        rank += 1;
        result = candidateAtRank(vocabulary, `${seed}:names:${reroll}`, rank);
        key = normalizeProvinceName(result.name);
      }
      contextRanks.set(rankKey, rank + 1);
      province.name = result.name;
      province.nameSource = "generated";
      used.add(key);
      generated += 1;
      if (result.numericFallback) numericFallbacks += 1;
    }
  }

  return {
    generated,
    authoredPreserved,
    reservedCount: RESERVED_CAPITAL_NAMES.length,
    collisionProbes,
    numericFallbacks,
  };
}

/**
 * Explicit destructive migration path for atlases created before name
 * provenance existed. The UI puts this behind a confirmation because it also
 * replaces deliberately authored names; normal rerolls remain preservation-
 * first.
 */
export function regenerateAllProvinceNames(
  planes: Plane[],
  seed: string,
  reroll = 0,
): ProvinceNamingReport {
  for (const plane of planes) {
    for (const province of plane.provinces) province.nameSource = "generated";
  }
  return regenerateGeneratedProvinceNames(planes, seed, reroll);
}
