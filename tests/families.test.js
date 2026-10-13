import { describe, expect, test } from "vitest";
import { readFileSync } from "fs";
import { damageFamily, nameFamily, refines, storyTypeFor, NAMED_FAMILIES } from "../scripts/story/families.js";
import { DAMAGE_TYPES } from "../scripts/story/blocks.js";

// The word lists as the language file has them (family -> words).
const words = JSON.parse(readFileSync(new URL("../languages/en.json", import.meta.url), "utf8")).FASTFIGHTING.StoryWords;
const lists = Object.fromEntries(Object.entries(words).map(([k, v]) => [k, v.split(",").map(w => w.trim().toLowerCase()).filter(Boolean)]));
const attack = (name, ...types) => ({ name, damage: types.map(type => ({ type })) });

describe("how an attack looks in the story", () => {
  test("of several kinds of harm, magic shows over the blow that carries it, then a blast, then gunfire", () => {
    expect(damageFamily(["slashing", "void"])).toBe("void");
    expect(damageFamily(["piercing", "explosive"])).toBe("explosive");
    expect(damageFamily(["piercing", "ballistic"])).toBe("ballistic");
    expect(damageFamily(["piercing"])).toBe("piercing");
    expect(damageFamily(["lightning"], t => ({ lightning: "electricity" })[t] ?? t)).toBe("electricity");
    expect(damageFamily(["something new"])).toBe("untyped");
    expect(damageFamily([])).toBe("untyped");
  });

  test("a name tells more than a plain blow, or a beam its system counts as fire", () => {
    expect(storyTypeFor(attack("Laser Pistol", "fire"), lists)).toBe("laser");
    expect(storyTypeFor(attack("Plasma Rifle", "fire", "electricity"), lists)).toBe("plasma");
    expect(storyTypeFor(attack("Hunting Rifle", "piercing"), lists)).toBe("ballistic");
    expect(storyTypeFor(attack("Frag Grenade", "piercing"), lists)).toBe("explosive");
    expect(storyTypeFor(attack("Wind Blade", "slashing"), lists)).toBe("wind");
    expect(storyTypeFor(attack("Thorn Whip", "piercing"), lists)).toBe("plant");
    expect(storyTypeFor(attack("Death Grip", "force"), lists)).toBe("void");
  });

  test("but never over damage that has a look of its own", () => {
    expect(storyTypeFor(attack("Life Drain", "void"), lists)).toBe(null);
    expect(storyTypeFor(attack("Wind of Frost", "cold"), lists)).toBe(null);
    expect(storyTypeFor(attack("Flaming Longsword", "slashing", "fire"), lists)).toBe(null); // (its damage says fire already)
    expect(refines("wind", "electricity")).toBe(false);
    expect(refines("laser", "fire")).toBe(true);
  });

  test("its helper's word stands, and a name that says nothing leaves it to the damage", () => {
    expect(storyTypeFor({ ...attack("Rifle", "fire"), storyType: "laser" }, lists)).toBe("laser");
    expect(storyTypeFor(attack("Longsword", "slashing"), lists)).toBe(null);
    expect(nameFamily("Firewood Club", lists)).toBe(null); // (whole words only)
  });

  test("every family a name can tell is one the story has, with words to find it by", () => {
    for ( const f of NAMED_FAMILIES ) {
      expect(DAMAGE_TYPES).toContain(f);
      expect(lists[f]?.length, f).toBeGreaterThan(0);
    }
  });
});
