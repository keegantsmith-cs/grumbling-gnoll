// Choices offered in the character sheet's dropdowns. These are names only (no rules text).
// Anything not listed can still be typed in with "Other (type your own)".
import type { RulesVersion } from "./character.ts";

export const ALIGNMENTS = [
  "Lawful Good", "Neutral Good", "Chaotic Good",
  "Lawful Neutral", "True Neutral", "Chaotic Neutral",
  "Lawful Evil", "Neutral Evil", "Chaotic Evil",
  "Unaligned",
];

const SPECIES_2014 = [
  "Dragonborn", "Hill Dwarf", "Mountain Dwarf", "High Elf", "Wood Elf", "Drow (Dark Elf)", "Forest Gnome", "Rock Gnome",
  "Half-Elf", "Half-Orc", "Lightfoot Halfling", "Stout Halfling", "Human", "Variant Human", "Tiefling",
  "Aarakocra", "Aasimar", "Bugbear", "Firbolg", "Genasi", "Gith", "Goblin", "Goliath", "Hobgoblin", "Kenku", "Kobold",
  "Lizardfolk", "Orc", "Satyr", "Tabaxi", "Tortle", "Triton", "Warforged", "Yuan-ti",
];
const SPECIES_2024 = [
  "Aasimar", "Dragonborn", "Dwarf", "Elf (Drow)", "Elf (High Elf)", "Elf (Wood Elf)", "Gnome (Forest)", "Gnome (Rock)",
  "Goliath", "Halfling", "Human", "Orc", "Tiefling (Abyssal)", "Tiefling (Chthonic)", "Tiefling (Infernal)",
];

const BACKGROUNDS_2014 = [
  "Acolyte", "Charlatan", "Criminal", "Entertainer", "Folk Hero", "Guild Artisan", "Hermit", "Noble", "Outlander",
  "Sage", "Sailor", "Soldier", "Urchin", "Haunted One", "City Watch", "Far Traveler", "Clan Crafter",
];
const BACKGROUNDS_2024 = [
  "Acolyte", "Artisan", "Charlatan", "Criminal", "Entertainer", "Farmer", "Guard", "Guide", "Hermit", "Merchant",
  "Noble", "Sage", "Sailor", "Scribe", "Soldier", "Wayfarer",
];

export const speciesFor = (r: RulesVersion) => (r === "2024" ? SPECIES_2024 : SPECIES_2014);
export const backgroundsFor = (r: RulesVersion) => (r === "2024" ? BACKGROUNDS_2024 : BACKGROUNDS_2014);

export const EXTRA_CLASSES = ["Artificer", "Blood Hunter"];

const SUBCLASSES_2014: Record<string, string[]> = {
  Artificer: ["Alchemist", "Armorer", "Artillerist", "Battle Smith"],
  Barbarian: ["Path of the Berserker", "Path of the Totem Warrior", "Path of the Ancestral Guardian", "Path of the Storm Herald", "Path of the Zealot", "Path of the Beast", "Path of Wild Magic"],
  Bard: ["College of Lore", "College of Valor", "College of Glamour", "College of Swords", "College of Whispers", "College of Creation", "College of Eloquence"],
  Cleric: ["Knowledge Domain", "Life Domain", "Light Domain", "Nature Domain", "Tempest Domain", "Trickery Domain", "War Domain", "Forge Domain", "Grave Domain", "Order Domain", "Peace Domain", "Twilight Domain"],
  Druid: ["Circle of the Land", "Circle of the Moon", "Circle of Dreams", "Circle of the Shepherd", "Circle of Spores", "Circle of Stars", "Circle of Wildfire"],
  Fighter: ["Champion", "Battle Master", "Eldritch Knight", "Arcane Archer", "Cavalier", "Samurai", "Psi Warrior", "Rune Knight", "Echo Knight"],
  Monk: ["Way of the Open Hand", "Way of Shadow", "Way of the Four Elements", "Way of the Drunken Master", "Way of the Kensei", "Way of the Sun Soul", "Way of Mercy", "Way of the Astral Self"],
  Paladin: ["Oath of Devotion", "Oath of the Ancients", "Oath of Vengeance", "Oath of Conquest", "Oath of Redemption", "Oath of Glory", "Oath of the Watchers", "Oathbreaker"],
  Ranger: ["Hunter", "Beast Master", "Gloom Stalker", "Horizon Walker", "Monster Slayer", "Fey Wanderer", "Swarmkeeper", "Drakewarden"],
  Rogue: ["Thief", "Assassin", "Arcane Trickster", "Inquisitive", "Mastermind", "Scout", "Swashbuckler", "Phantom", "Soulknife"],
  Sorcerer: ["Draconic Bloodline", "Wild Magic", "Divine Soul", "Shadow Magic", "Storm Sorcery", "Aberrant Mind", "Clockwork Soul"],
  Warlock: ["The Archfey", "The Fiend", "The Great Old One", "The Celestial", "The Hexblade", "The Fathomless", "The Genie", "The Undead"],
  Wizard: ["School of Abjuration", "School of Conjuration", "School of Divination", "School of Enchantment", "School of Evocation", "School of Illusion", "School of Necromancy", "School of Transmutation", "Bladesinging", "War Magic", "Order of Scribes", "Chronurgy Magic", "Graviturgy Magic"],
};
const SUBCLASSES_2024: Record<string, string[]> = {
  Barbarian: ["Path of the Berserker", "Path of the Wild Heart", "Path of the World Tree", "Path of the Zealot"],
  Bard: ["College of Dance", "College of Glamour", "College of Lore", "College of Valor"],
  Cleric: ["Life Domain", "Light Domain", "Trickery Domain", "War Domain"],
  Druid: ["Circle of the Land", "Circle of the Moon", "Circle of the Sea", "Circle of the Stars"],
  Fighter: ["Battle Master", "Champion", "Eldritch Knight", "Psi Warrior"],
  Monk: ["Warrior of Mercy", "Warrior of Shadow", "Warrior of the Elements", "Warrior of the Open Hand"],
  Paladin: ["Oath of Devotion", "Oath of Glory", "Oath of the Ancients", "Oath of Vengeance"],
  Ranger: ["Beast Master", "Fey Wanderer", "Gloom Stalker", "Hunter"],
  Rogue: ["Arcane Trickster", "Assassin", "Soulknife", "Thief"],
  Sorcerer: ["Aberrant Sorcery", "Clockwork Sorcery", "Draconic Sorcery", "Wild Magic Sorcery"],
  Warlock: ["Archfey Patron", "Celestial Patron", "Fiend Patron", "Great Old One Patron"],
  Wizard: ["Abjurer", "Diviner", "Evoker", "Illusionist"],
};

export function subclassesFor(r: RulesVersion, className: string): string[] {
  const table = r === "2024" ? SUBCLASSES_2024 : SUBCLASSES_2014;
  return table[className] ?? (r === "2024" ? SUBCLASSES_2014[className] ?? [] : []);
}

/** Subclasses that cast spells even though the base class doesn't. */
export const SUBCLASS_CASTER: Record<string, "third"> = {
  "Eldritch Knight": "third",
  "Arcane Trickster": "third",
};
