# FastFighting Core

A [Foundry VTT](https://foundryvtt.com) module that resolves a battle, or a tense standoff, from the encounter on the scene, fairly and quickly, so the table can move on. It simulates the encounter thousands of times, round by round, with real dice math, and shows the odds. Then it tells the story of one fight drawn at random, and **Make it So** commits that fight to the tokens.

- **Foundry:** v14
- **System support comes from helper modules.** See [systems.md](systems.md):
  - [FastFighting PF2e](https://github.com/galaara98/FastFighting-PF2e) for Pathfinder Second Edition
  - [FastFighting D&D 5e](https://github.com/galaara98/FastFighting-DnD5e) for Dungeons & Dragons Fifth Edition
- **Without a helper** for your world's system, FastFighting stays inactive. Its settings are greyed out, and the settings window and Combat Tracker point you to systems.md. An experimental generic d20 adapter can be switched on instead.

## Installation

In Foundry, go to **Add-on Modules → Install Module** and paste this manifest URL, then install your system's helper (see [systems.md](systems.md)):

```
https://github.com/galaara98/FastFighting/releases/latest/download/module.json
```

## Using it

**The encounter starts it.** Add combatants to an encounter in the Combat Tracker. Once it has at least two tokens, a **Battle Planner** button appears at the top of the tracker; it's GM only. <kbd>Shift</kbd>+<kbd>B</kbd> opens the planner too. It picks up an encounter already under way from whoever's turn it is, keeping wounds, dying and conditions.

**Bystanders.** Every token on the map that isn't in the encounter is a bystander. A bystander does nothing unless something draws it in:
- it sees or hears the fight (walls muffle sound);
- an ally runs to it calling for help;
- a hunter goes after it;
- someone fleeing runs into it.

Once it notices, it decides from its personality whether to join, watch, or slip away.

**The planner** needs at least 1000×600 and uses any extra space you give it.

- **Toolbar:**
  - runs, maximum rounds and seed;
  - how downed creatures are handled;
  - **After the fight** (see below);
  - **Opening:** talk if they'd rather, always talk first, or straight to battle;
  - initiative source;
  - toggles for positioning, morale, leadership, talking, bystanders and hidden tokens;
  - **Run** (with **Stop** while it runs), refresh, and **Undo**.
- **Left: the sides.** There's a tab per side: Friendly, Hostile, Neutral, Secret.
  - **Side settings:**
    - group personality, healing aggressiveness, and whether the side can rout;
    - its leader and the leadership bonus;
    - for Neutral and Secret, an allegiance: stays out, joins the party, joins the enemy, joins the nearest side, joins the underdog, or fights everyone.
  - **Each token row:**
    - HP, AC and its personality traits;
    - how it would reach the nearest enemy (mode, moves and terrain);
    - side override and include toggle.
  - **Expanding a row** gives stat fudges, *ignores terrain* and *dies at 0 HP*, plus that character's tactics and playstyles.
- **Right: the results.**
  - **Overview:** win odds, PC death and downed odds, foes talked down, fights settled with words, length, the simulated difficulty next to the system's own rating, the most dangerous foes and most-at-risk allies.
  - **Combatants:** per token, standing, down, dead, fled, surrendered, stood down and switched odds, HP left, damage, healing, and chance to fall first.
  - **Swing factors:** what moves the party's odds most.
  - **Resources:** spell slots, focus points and consumables spent.
  - **Sample fight:** the story of a fight.

## A fair ruling

**Make it So commits a fight drawn at random from the simulated ones.** A 70% win is a loss three times in ten, as it should be. The Sample fight tab labels where the fight came from: *Fair draw*, *Most typical*, or *Chosen by filter* (a party victory, a defeat, a PC dies, a close call). The typical fight and the filtered ones are there to preview.

**After the fight.** When the last foe falls, the survivors tend their dying. They use free help first (first aid, medicine feats), then spells and potions. Anyone left untended lives or dies by the system's rules for dying, so nobody is committed half-dead. Choose one of:
- tend the fallen and tell it;
- tend them quietly, with the story ending at the last blow;
- stop at the last blow and play the rest out yourself.

**Make it So:**
- posts the story to chat;
- moves each token to where the fight left it (snapped to the grid, never stacked, never through a wall);
- writes the outcome onto the tokens through the system's helper: HP, dying, conditions, death, resources spent, loot, the fled and the surrendered.

A confirmation lists every change first. **Undo** reverses it all, chat messages included, and keeps the last five.

## Talking

A fight can be talked down at any point, and some encounters never come to blows.

**Standoffs.** An encounter opens as a standoff when every side's voice would rather talk, or when almost everyone would. A side's voice is its leader, or most of its members if it has none. Nobody attacks while it lasts. It ends one of two ways:
- **Words win.** The persuaded stand down, or a threat makes them yield or run. If someone gives something up or runs, the whole conflict is settled.
- **Someone gets upset.** That could be an insulting pitch, failed pitches piling up, rounds dragging on, a beast that can't follow the talk, or an impatient temper. From that turn on, it's a battle.

A leader who wants to talk holds their side back. Before it breaks, a charismatic NPC leader may take one last turn to press the party.

**Pitches.** Persuade, intimidate or deceive, using whatever skills the system maps to each, against the system's DC for resisting. The target has to share a language with the talker.
- **The persuasion track:** most need 2–6 successes; the very gullible fold at once.
- **Grudges:** hurting someone or failing to convince them makes them harder to sway. An insult (a critical failure) means they won't listen again.
- **Outcomes:** surrender, flee, stand down, switch sides (rare unless neutral), or **give something up**.

**Giving something up:**
- **What:** 1–10% of their money, or an item they carry but don't wield or wear.
- **A PC** hands over an item only on a hidden luck check (39 or less by default).
- **An NPC** with nothing spare gives up what it's wielding; with nothing at all, it lies and runs.
- **Who gets it:** the talker.
- **In a standoff** it settles everything.
- **Mid-fight** the giver fights on. They're bitter: they won't listen to the taker again, and they fear the taker until it attacks them. Then the taker becomes their target of choice.
- **Taken back:** if the taker ends the fight beaten, the goods go back to their owner.

**PCs decide their own fate.** Words can only make a PC pay up or run, and it takes two more successes than usual. A PC with nothing to give can only be scared off. A PC whose answer is "Let my weapons do the talking" won't listen at all.

**Make it So hands goods over.** Each thing a PC loses gets its own GM-only chat card, with an Undo for just that hand-over.

## Theft

Theft mid-fight is rare; most who want your things take them from your body afterwards.
- **Who:** only a **Thief** (a playstyle) or someone with the system's stealing skill well above typical for their level.
- **When:** only when it's safe. Either their side is clearly winning, or they're hidden and their mark is alone. Alone means no friends within 30 ft, or the two of them more than one ordinary move from everyone else.
- **Openly:** the thief feints with its weapon first (it must hit, for no damage), then makes the system's stealing test.
- **Against a PC:** it also needs a hidden luck check (29 or less by default). The story never mentions it.
- **Getting caught** reveals the thief and makes it the victim's target.
- **Taken back:** stolen goods return if the thief is beaten.

## What else the simulation models

- **Rules:** whatever the system's helper provides, such as the turn's actions, degrees of success, attack penalties, advantage, criticals, resistances and dying.
- **Afflictions:** stage by stage, with onset.
- **Persistent damage.**
- **Riders:** knockdown, grab, sneak attack, and pack attack or Pack Tactics.
- **Crowd control:** spells that slow, frighten, trip, immobilize, paralyze or put foes to sleep, by degree of success, for their duration.
  - They're valued by the damage they prevent.
  - The system's tags decide immunity (mental, fear, sleep and others), and some systems let strong targets resist better (PF2e incapacitation).
  - Thinking creatures don't waste them on the immune. Feral casters cast at random, or whatever does the most right now.
- **Healing:** spells, potions and first aid.
- **Personality: Tactical, Brave, Selfish, Loyal,** from 0 to 100 with named bands. They come from creature data and blend with the side's personality.
  - *Feral:* the closest foe, or whoever hurt it last.
  - *Instinctive:* wounded prey; pack hunters gang up.
  - *Competent:* focus fire and flanking.
  - *Tactical:* healers and casters first, and reads the odds.
  - *Mastermind:* a side-wide focus, an ambush edge, and the ruthless finish off the downed.
- **Morale:** losses, wounds, a fallen leader or master, and bad odds, all against Brave. Combatants hold, waver or rout.
- **Leadership:** the best social or warfare skill, plus commanding features.
- **Terrain and movement:** travel cost per movement mode from Foundry's region terrain, so rubble doesn't slow a flyer. Walls block sight. A high flyer can't be hit in melee by a ground-bound creature.

## Prepare Players

**Prepare Players** opens a survey on each player's screen, with one tab per token they control. Every question starts on *"Let ⟨character⟩ decide: …"*, showing what the character would probably do:
- favorite attack, fighting style and first target;
- spending limited resources, healing others and drinking potions;
- what to do when an ally is dying, and after being revived;
- when to retreat, shield use and talking;
- **others nearby:** stay with the fight, run for help when it goes badly, or hunt down enemies about;
- notes for the GM.

Answers save as they're made, and two players sharing a token see each other's changes live. The planner shows each player's status, with a button to (re)open their survey.

**Playstyles:** up to four pills per character, PC or NPC. Scaredy-Cat, Cruel, Moralist, People-Pleaser, Fragile, Impatient, Brawler, Skeptic, Speed-Runner, Leader, Instigator, Diplomat, Wallflower, Martyr, Mercenary, Enabler, Redeem-Seeker, Lore-Collector, Puzzle-Maniac, Wildcard and Thief. They shift traits, change the defaults, and switch on quirks.

Three checkboxes go with the pills:
- **Stay mostly true to my calculated tactical level:** playstyles and answers move the calculated strategy by about 10% at most.
- **Roleplaying is very important to me:** playstyles weigh heavily.
- **This character always prefers talking to fighting:** talks whole turns at a time, even without much skill, and votes to open with a standoff. With "stay true", it's only a small nudge.

Every derived number has **fudge up / fudge down / remove fudge** buttons.

## The story

The fight is told in one of three styles:
- **Roleplay:** prose. It narrates cover, terrain, climbing, flying and burrowing, and relationships: an enemy leader, a grudge, vengeance, a talking nemesis, a protector, a rival.
- **Standard:** what each character did and how they ended.
- **Statistician:** every roll.

Creatures that never joined the fight aren't listed, and hidden ones are never named. Every Roleplay sentence comes from a roll table, and you can install them as editable RollTables under **Settings → FastFighting → Story tables**.

## Settings

All settings are defaults that the planner can override per battle:
- **Simulation:** runs and maximum rounds; hidden tokens and other levels; bystanders.
- **Unaligned sides:** Neutral and Secret allegiance.
- **Dying and healing:** the downed model, after the fight, and PC healing and dying defaults.
- **Modifiers:** leadership, morale, positioning, talking, how encounters open, and the initiative source.
- **PC luck checks** (sliders):
  - handing over an item, default 39;
  - being robbed, default 29.
- **Story:** style and delivery.
- **Make it So:** loot, corpse and fled handling.
- **Defaults:** side personalities, and data paths for the generic adapter.

## For system and module developers

FastFighting is split into a pure simulation engine (`scripts/engine/`), system **helpers**, and the Foundry UI. The core owns only its own ideas: personality, morale, leadership, positioning, standoffs, the story, and how creatures leave a fight. Every game rule comes from the helper. FastFighting PF2e and FastFighting D&D 5e are reference implementations of two very different systems.

```js
Hooks.once("fastFighting.init", api => {
  if ( (api.version ?? 1) < 3 ) return; // the helper interface this is written against
  class MySystemAdapter extends api.SystemAdapter {
    get label() { return "My System"; }
    get rules() { return myRules; }
    canHandle(actor) { ... }
    async toCombatantSpec(tokenDoc) { ... }          // see CombatantSpec in scripts/engine/battle-state.js
    deriveTraits(actor) { ... }
    detectLeaders(specs) { ... }
    difficultyCrossCheck(friendly, hostile) { ... }  // {label: trivial|low|moderate|severe|extreme, xp}
    describeRegionBehavior(behavior) { ... }         // system region behaviors -> {types, difficult, hazardous}
    resourceLabel(key, spec) { ... }
    describeOutcome(spec, final) { ... }
    async commitOutcome(tokenDoc, spec, final, options) { ... }      // returns an undo record
    async commitConcession(giverDoc, receiverDoc, concession) { ... } // returns undo records
  }
  api.registerAdapter("my-system", MySystemAdapter, { priority: 10 });
});
```

Declare your system in `module.json` (`relationships.systems`) so Foundry only offers the helper in worlds of that system; the core also ignores adapters registered for another system.

**The rules object** is pure and is called thousands of times:
- **The turn:** `turn(u)` gives the budget (`{actions: 3}` or `{action: 1, bonus: 1, move: 30}`).
  - `mainPool` names the pool a plain-number cost uses.
  - `movement` is `"actions"` (each move costs an action) or `"feet"` (spend movement, then Dash).
  - `costOf(action)`, `basicAction`, `talkCost`, `stealCost`, `feintCost`, `firstAidCost`, `shieldCost` and `standCost(u)` set what things cost.
- **Rolls:**
  - `degreeOfSuccess(natural, total, dc, kind)` returns 0–3, where `kind` is attack, save or check;
  - `roll(rng, mod, dc, {advantage, kind})`;
  - `attackPenalty(action, attacksMade)`;
  - `saveMultiplier(degree, save)`, `afflictionStep(degree, phase)`, `critical(parts)` and `healCheckMultiplier(degree)`;
  - `minimumDamage`.
- **Situations:** `modifiers.attack`, `defense`, `save`, `check`, `steal`, `exposed` and `actionsLost`. The engine passes the facts (prone, grabbed, flanked, distance, allies adjacent, engaged, conditions); the rules return bonuses and advantage.
- **Damage and dying:**
  - `applyIwr(iwr, byType)`;
  - `onDropped(unit, {crit, model, amount, overflow})`, `onHealed(unit, amount)` and `recoveryCheck(unit, rng)`;
  - `firstAidDC(unit)`, `firstAid(unit, degree)` and `persistentFlatCheck(rng)`.
- **Crowd control:** `isImmune(target, action)`, `controlShift(ctx)` and `conditionWeight(key, value)`.
- **What's typical for a level:** `typical.ac`, `save`, `skill` and `dc`.
- **Per-fight state:** `initUnit(u)` and `capture(u)`.
- **The story:** `storyDamageType(type)` maps your damage types onto the story's imagery.

Helpers import shared pieces from `scripts/core-api.js`, such as `SystemAdapter`, `parseFormula`, `parseTypedFormula`, `rollD20`, `TALK_KINDS` and `CORE_API_VERSION`.

**Other API** on `game.modules.get("fast-fighting").api`:
- `registerModifier` and `registerTraitRule`;
- `engine` (`runBatch`, `replay`, `findSample`), `dice` and `constants`;
- `openPlanner()`.

**Hooks:**
- `fastFighting.init(api)`;
- `fastFighting.preSimulate`, `fastFighting.postSimulate`;
- `fastFighting.preMakeItSo`, `fastFighting.makeItSo`.

## Development

- Junction or symlink this folder into Foundry's data folder as `Data/modules/fast-fighting`.
- `npm install`, then `npm test` (Vitest) for the engine, story and parser tests.
- **Releasing:** push a `vX.Y.Z` tag. The release workflow runs the tests, sets the version and builds `module.zip`.
