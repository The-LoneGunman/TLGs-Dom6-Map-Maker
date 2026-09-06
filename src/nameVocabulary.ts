// Original place names, grouped by physical context so a landmark cannot drift
// into an unrelated terrain pool. Nation capitals remain reserved by naming.ts.
const names = (value: string): readonly string[] => value.split("|");

export const DISTINCTIVE_TERRAIN_NAMES: Readonly<Record<string, readonly string[]>> = {
  plains: names("Harrowind|Oathward Downs|Edran Vale|Larkwarden|Bronzehoof Reach|Caerwyn Fields|Merrowden|Veylan Wold|Sundrift Lea|Orswick|Kestrel's Rest|Halvern March|Sevenfold Meadow|Dunvar Plain|Avenrath|Rookrun"),
  farm: names("Ryehaven|Hearthbarley|Aldercroft|Millwarden|Tansy Grange|Bramblewick|Golden Bushel|Oatmere Steading|Saffronholt|Ploughman's Promise|Ciderwake|Rowan's Tithe|Quernfield|Copper Sheaf|Honeyfurrow|Edris Orchard"),
  forest: names("Thornvigil|Briarwatch|Alderwake|Wrenhollow|Hazelwarden|Yew's Covenant|Orrowood|Foxbell Grove|Brackenveil|Hartwhisper|Lethren Holt|Mossantler|Ashroot Weald|Rookbough|Elmbound Sanctuary|Nine Stags"),
  swamp: names("Reedveil|Mirewake|Heron's Vigil|Sedgewhisper|Peatwarden|Willow's Wake|Bogbell|Drowned Causeway|Fenmother's Rest|Murkwick|Rushlight Mere|Eelmarsh|Tallowfen|Siltman's Folly|Black Heron Carr|Hollow Reed"),
  waste: names("Glasswind Erg|Saltgrave|Vulture's Testament|Iraveth Sands|Red Scorpion Waste|Kharun's Cairn|Sunken Caravan|Duneshard|Thirstwatch|Broken Astrolabe|Sereward|Ossaren Barrens|Saltglass Expanse|Copper Mirage|Caravan's Cairn|Veyr's Exile"),
  highland: names("Cairnwarden|Heatherwake|Torveth Brae|Ramshorn Upland|Kestrelscar|Orlan's Seat|Brackenstair|Auldren Fells|Hindwatch Ridge|Copper Cairns|Windharrow|Speargrass Heights|Hearthless Tor|Edravel Plateau|Greyhorn Rise|Tarnward"),
  mountains: names("Oathbreaker Peak|Kharad's Teeth|Anvilcrown|Vulturehorn|Eagle's Judgment|Ironpilgrim Range|Halvorn Massif|Cloudsplitter|Widow's Ascent|Rimeclaw|Orsund Pinnacle|Skyhammer Spine|Giantcairn|Needlewarden|Frostwrought Summit|Thunderscar"),
  coast: names("Gullwake|Lanternhook|Bellwarden Cape|Sailor's Reckoning|Driftcrown|Edran's Landing|Oysterwatch|Tideglass Haven|Anchor's Rest|Whistling Bight|Rookbeacon|Whitebone Strand|Brineward Cove|Merrow's Lantern|Wreckwarden Shore|Storm's Berth"),
  sea: names("Nine Sails|Whale's Vigil|Averune Sound|Sapphire Confluence|Sailbreaker Strait|Orlen's Passage|Sunderwake|Mariner's Promise|Brineglass Reach|Cormorant Road|Pearlwind Sea|Tide of Lanterns|Kethran Gulf|Dolphin's Circuit|Foamwarden|Bellbuoy Waters"),
  deep_sea: names("Leviathan's Grave|Nacreless Trench|Vhal's Descent|Soundless Mile|Drowned Firmament|Whalebone Cathedral|Midnight Sounding|Orphaned Anchor|Blind Lantern Deep|Mournswell|Ossuarine Basin|Sable Pressure|Last Bell Trench|Coldvent Crown|Sunkings' Rest|Abyssal Reliquary"),
  kelp: names("Frondwarden|Seahart Grove|Nacrewood|Eelwoven Garden|Otter's Refuge|Holdfast Court|Swaying Lanterns|Wrackweald|Greenwater Cloister|Sargassum Vigil|Kelpglass|Tangle of Pearls|Turtle's Bower|Saltleaf Hall|Anemone's Rest|Whalewhisper Wood"),
  freshwater: names("Troutwarden|Alderwell|Iveran Ford|Heron's Mirror|Rillhaven|Miller's Crossing|Reedglass Lake|Seven Pebbles|Swanwake|Edris Spring|Otterbell Brook|Willowrun|Kingfisher's Cup|Rainward Loch|Stonecup Falls|Oathwater"),
  cave: names("Bellroot Vault|Lanternless Delve|Orveth Grotto|Pilgrim's Echo|Wormwarden|Druven's Descent|Tallowdeep|Whispering Chisel|Mossbell Gallery|Carven Promise|Thirteen Pillars|Hollow Anvil|Blind Miner's Rest|Echowick|Rootvein Hall|Stoneward Maze"),
  cave_forest: names("Glowcap Covenant|Mycelyr|Sporewarden|Rootlantern Grove|Pale Mycelium Court|Lichenbell|Mothroot Hollow|Blind Gardener's Rest|Underbloom|Mossmantle Vault|Ivory Puffball|Softspore Weald|Fungal Reliquary|Ambercap Garden|Rootwhisper Hall|Luminous Rot"),
  cave_swamp: names("Sumpwarden|Dripbell Fen|Blind Eel's Rest|Murkroot Hall|Tallowmire|Siltveil Grotto|Drowned Delver|Reedless Marsh|Black Seepage Court|Mosslung Pool|Wetstone Vigil|Underfen Lantern|Sodden Stair|Fungal Sluice|Sunless Sedge|Mudwoven Vault"),
  cave_waste: names("Saltvein Silence|Ashdelver's Rest|Cinderless Vault|Drylung Gallery|Barren Chisel|Sootwarden|Forgotten Kiln|Hollow Salt|Dustroot Chasm|Parched Oracle|Embergrave Delve|Scoria Testament|Deadlamp Grotto|Wormless Deep|Charred Pillar Hall|Serebone Cavern"),
  cave_highland: names("Stalagmite Vigil|Quartzwarden|Buried Crown Ridge|Delver's Ascent|Deepstone Eyrie|Rootmassif|Pillarbreak Heights|Cavern Colossus|Granite Stair|Orveth's Summit|Undermountain Seat|Gemspine|Vaultcrown Tor|Chthonic Escarpment|Blind Eagle Crag|Echohorn"),
  flooded_cave: names("Drowned Lantern Hall|Blind Sailor's Reach|Underwake|Sunless Anchorage|Pillar Reef|Mosspearl Cistern|Grotto of Lost Oars|Floodwarden Vault|Blue Delver's Grave|Stonekeel Basin|Cavern Undertow|Silted Colonnade|Echoing Reservoir|Black Oar Lake|Submerged Bellhouse|Deepwater Undercroft"),
  styx: names("Candlewake Ferry|Obol's End|Widow's Oar|Last Toll Crossing|Mourner's Passage|Coinless Ford|Shadeboat Reach|Black Lantern Ferry|Ferryman's Due|Unremembered Bank|Ashen Oarlock|River of Unsaid Names|Gravesilt Channel|Funeral Wake|Silent Passenger|Wraithkeel Waters"),
  cavewall: names("Delver's Refusal|Unopened Vein|Blind Chisel Wall|Rootsealed Gate|Last Pickaxe|Stone's Denial|Buried Portcullis|Hammerbreak|Collapsed Testament|End of Lanterns|Mute Granite|Unyielding Fault|Pillarfall Seal|Shutstone|Immovable Stratum|Road Without Passage"),
};

export const DISTINCTIVE_REALM_NAMES: Readonly<Record<string, readonly string[]>> = {
  cave: names("Druven's Lantern|Hollowminster|Deepdelver's Vigil|Mothless Gallery|Rootcairn|Stonechoir Refuge|Worm's Calendar|Echobound Hall|Tallowmantle|Old Chisel Court|Basalt Testament|Buried Campanile|Orveth's Refuge|Sootbell Undercroft|Blind Cartographer|Underward"),
  cavern: names("Thousandfold Geode|Prismwarden|Amethyst Colonnade|Gemdelver's Crown|Quartzminster|Opal Canticle|Resonant Basilica|Seven Facets|Crystal Testament|Druven's Rotunda|Glittering Causeway|Buried Constellarium|Argent Choirhall|Diamond Pilgrim|Vault of Unlit Suns|Obsidian Organ"),
  cloud: names("Ninewind Stair|Skylark Court|Dawnspire|Vesper's Aerie|Rainwarden|Sunfeather Roost|Halcyon Shelf|Cloudweaver's Rest|Golden Updraft|Thunderlark|Pearl Nimbus|Windborne Campanile|Kitekeeper's Height|Silverwing Pavilion|Morning's Cradle|Tempest Diadem"),
  air: names("Veyr's Confluence|Bellwind Reach|Unmoored Horizon|Storm's Compass|Galeweft|Zephyr's Circuit|Whistling Meridian|Sky Without Shores|Racing Firmament|Featherless Flight|Thunder's Interval|Windscribe's Passage|Aether Current|Blue Exhalation|Circling Silence|Cloudless Gyre"),
  underworld: names("Mournveil|Ossuary of Uncrowned Kings|Candleless Court|Vesper Ossuary|Ashen Testament|Tombwarden's Rest|Shadewrit|Wraithminster|Unspoken Eulogy|Bonepilgrim Hall|Sepulcher of Lost Oaths|Funeral Constellation|Hollow Laurels|Gravebell Precinct|Obolkeeper's Vault|Dustbound Procession"),
  hell: names("Cindervow|Brass Testament|Ashen Indictment|Emberwarden|Ninth Brand|Scourgeforge|Pyre of Broken Oaths|Iron Confession|Coalhearted Court|Brimstone Covenant|Charred Benediction|Furnace of Unpaid Debts|Vhal's Crucible|Redchain Bastion|Sootcrowned Tribunal|Kiln of Fallen Banners"),
  abyss: names("Nhal's Interval|Orphaned Meridian|Zerochime|Hush Between Worlds|Unwritten Descent|Absence of Dawn|Fracture Without Echo|Starless Parenthesis|Last Unmaking|Blind Eternity's Edge|Nowhere's Threshold|Unmoored Equation|Null Testament|Vanished Constellation|Unbeing's Vestibule|Horizon Without End"),
  dream: names("Larkglass|Somnivar|Mothqueen's Orchard|Velvet Paradox|Thornsleep|Court of Unfinished Songs|Foxglove Masque|Moon's Rehearsal|Reveriewick|Wishing Antler|Glasswing Promenade|Slumberweald|Apple of Yesterday|Crown of Waking Moths|Whisperwoven Bower|Lanterns Before Dawn"),
  elemental: names("Orun's Crucible|Morrowforge|Fourfold Testament|Worldroot Axis|Confluence of Embers|Stormstone Covenant|Rainwrought Bastion|First Matter|Quintessence Ward|Titan's Measure|Firewater Concourse|Clay of Unborn Mountains|Primal Bellows|Aetherkiln|Stone's Awakening|Unshaped Diadem"),
  "custom:frozen": names("Rimewarden|Frostbell Reach|Icebound Testament|Winter's Hush|Hoarminster|Snowpilgrim's Rest|Glassfrost Crown|Tundra Lantern|White Antler Vigil|Coldstar Haven|Rimewoven Court|Glacial Canticle|Winterveil|Icicle Diadem|Boreal Threshold|Last Thaw"),
  "custom:arid": names("Saltwarden|Miragekeeper's Rest|Saffron Dust|Kharun's Expanse|Suncleft|Drywind Covenant|Copper Horizon|Thirsting Pillar|Ochre Testament|Bleached Diadem|Sandglass Ward|Red Dune Vigil|Empty Cistern Court|Caravan's Memory|Parched Meridian|Vulture's Compass"),
  "custom:oceanic": names("Pearlwarden|Whalewake|Tideminster|Mariner's Diadem|Brinewoven Court|Saltglass Haven|Nacre Covenant|Ninefold Tide|Compass of Coral|Stormpetrel's Rest|Foamlight Reach|Seafoam Testament|Driftanchor|Sapphire Wake|Gullward|Ocean's Cradle"),
  "custom:volcanic": names("Emberwrought|Basalt Diadem|Caldera Testament|Ashfall Crown|Obsidian Covenant|Firevein|Scoriawarden|Cinderbell Expanse|Magma's Measure|Redvent Court|Sulfur Pilgrim|Blackglass Foundry|Lavawoven Ward|Smoking Meridian|Eruption's Memory|Worldfire Crucible"),
};

const REALM_ALIASES: Readonly<Record<string, string>> = {
  "custom:wild": "dream", "custom:fungal": "cave", "custom:crystal": "cavern",
  "custom:storm": "air", "custom:infernal": "hell", "custom:void": "abyss",
};

export function distinctiveRealmNames(theme: string): readonly string[] | undefined {
  return DISTINCTIVE_REALM_NAMES[REALM_ALIASES[theme] ?? theme];
}
