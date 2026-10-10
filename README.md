# FastFighting

A [Foundry VTT](https://foundryvtt.com) module that estimates how a battle will go, using the tokens on the scene. It simulates the fight thousands of times, round by round, with real dice math. Results show win odds, how long the fight lasts, who is likely to fall, and what swings the outcome. The GM can then commit one simulated fight to the tokens with **Make it So**.

- **Foundry:** v14
- **Built-in support:** Pathfinder 2e (8.6+), plus a generic d20 fallback for other systems
- **Other systems:** helper modules can add support through the API below

## Installation

In Foundry, go to **Add-on Modules → Install Module** and paste this manifest URL:

```
https://github.com/galaara98/FastFighting/releases/latest/download/module.json
```

## Using it

As GM, open the **Battle Planner** in one of three ways:
- the swords button in the Token controls
- the Token HUD
- <kbd>Shift</kbd>+<kbd>B</kbd>

The planner needs at least 1000×600 and uses any extra space you give it.

**Left side: the battle.** There's one tab per side: Friendly, Hostile, Neutral, Secret (Foundry token dispositions).

- **Side settings:**
  - group personality
  - healing aggressiveness
  - whether the side can rout
  - its leader and the leadership bonus
  - for Neutral and Secret: **allegiance** (stays out, joins the party, joins the enemy, joins the nearest side, joins the underdog, or fights everyone)
- **Each token row:**
  - HP and AC
  - how it would reach the nearest enemy (movement mode, move actions, terrain multiplier)
  - its four personality traits
  - side override and include toggle
- **Expanding a row** gives stat fudges (AC, HP, attack/DC, damage), *ignores terrain*, and *dies at 0 HP*. For player-controlled tokens it also shows that character's **tactics** (see Prepare Players below).

**Prepare Players.** The button at the top of the planner opens a **Prepare for Battle** survey on every player's screen. It has one spreadsheet-style tab per token they control on the battle map. Each tab asks:
- favorite weapon or attack
- fighting style (front line, skirmisher, ranged, caster, protector)
- who to attack first
- how freely to spend spell slots and limited abilities
- healing others
- when to drink potions
- what to do when an ally is dying, and after being revived
- when to retreat
- shield use
- notes for the GM

Every question starts on *"Let ⟨character⟩ decide: …"*, which shows what that character would probably do. Answers save as they're made. Two players who control the same token see each other's changes live.

Next to each player, the GM sees a status: *Not asked*, *Waiting to log in*, *Entering…*, *Closed, not finished*, or *Ready*. Each player has a button to open or re-open their survey. A player asked while offline gets the survey when they log in.

If you never press Prepare Players, the same questions are in each player-controlled token's expanded row in the planner, for you to fill in.

**Playstyles.** Each character, PC or NPC, can carry up to four playstyle pills:
- Scaredy-Cat, Cruel, Moralist, People-Pleaser, Fragile, Impatient, Brawler
- Skeptic, Speed-Runner, Leader, Instigator, Diplomat, Wallflower
- Martyr, Mercenary, Enabler, Redeem-Seeker, Lore-Collector, Puzzle-Maniac, Wildcard

They shift personality traits and change what "Let them decide" means; the survey shows which playstyle drove each default. They also switch on simulated quirks:
- Cruel finishes off the fallen; Moralists never do.
- Diplomats open by talking.
- Lore-Collectors study a foe first, then hit it harder.
- Instigators and Martyrs draw attacks; Wallflowers slip notice.
- People-Pleasers attack what the group attacks.
- Puzzle-Maniacs exploit weaknesses.
- Wildcards surprise.

The first-picked playstyle wins when two disagree. Players pick theirs in the survey; the GM picks NPCs' in the planner.

Two checkboxes go with the pills:
- **Stay mostly true to my calculated tactical level** caps the survey's influence at about 10%. Trait shifts are limited to ±10, and any answer or quirk that differs from the calculated strategy only appears in about 1 in 10 simulated fights.
- **Roleplaying is very important to me** weighs playstyles heavily. Trait shifts double, and quirks happen far more often.

Every derived number has **fudge up / fudge down / remove fudge** buttons. A fudged value is outlined, and the tooltip shows the system-derived base and the reason for it.

**Right side: results.**

| Tab | What it shows |
| --- | --- |
| Overview | Win/stalemate bar, party win chance, chance a PC dies or goes down, round histogram, simulated difficulty next to the system's own rating (PF2e XP budget), most dangerous foes and most-at-risk allies |
| Combatants | Per token: standing / down / dead / fled odds, HP left, damage dealt, healing done, chance to fall first |
| Swing factors | Re-runs without each combatant and each modifier to show what moves the party's odds most |
| Resources | Average spell slots, focus points and consumables spent |
| Sample fight | A representative fight, round by round. Roll others, optionally filtered ("a party defeat", "a PC dies", "a close call"). **Make it So** commits that exact fight. **Undo** reverts it. |
| Share | Player chat card at an accuracy from **Statistician** (exact numbers) to **Roleplayer** (one line of atmosphere); the default is **Storyteller** |

## What the simulation models

- **Rules:** PF2e degrees of success, the multiple attack penalty, 3-action turns, and immunities, weaknesses and resistances.
- **Damage:** persistent damage, and afflictions (poisons, diseases) stage by stage.
- **Riders:** knockdown and grab; sneak attack and pack attack against off-guard targets; flanking.
- **Dying:** dying, wounded and recovery checks.
- **Healing:** healing spells, potions and Battle Medicine.
- **Personality: Tactical, Brave, Selfish, Loyal** (0–100, named bands). They come from creature data: intelligence, mindless, animal, undead, minion, Will save and more. Each blends with the group personality of its side.
  - **Tactical bands** drive targeting:
    - *Feral*: closest foe or whoever hurt it last
    - *Instinctive*: wounded prey; pack hunters gang up
    - *Competent*: focus fire and flanking
    - *Tactical*: healers and casters first, reads the odds
    - *Mastermind*: side-wide focus, ambush edge; ruthless ones finish off the downed
  - **Morale:** losses, wounds, a fallen leader or master, and bad odds against Brave. Combatants hold, waver or rout.
  - **Leadership:** best Diplomacy, Intimidation or Warfare Lore, the PF2e Commander class and its tactics, and rallying abilities. A standing leader raises the side's bravery and tactics floor, and can add attack or AC bonuses.
- **Terrain and movement types:**
  - Travel cost is measured per movement mode with Foundry's region terrain. A band of rubble that doubles walking cost does nothing to a flyer.
  - Each creature approaches using its best mode (walk, fly, swim, burrow).
  - Walls block line of sight. Ranged attackers get free rounds.
  - A flyer above a ground-bound creature's reach can't be hit in melee by it.
  - PF2e environment regions (such as aquatic) are read for each token.
- **Initiative:** from the combat tracker when one exists, Stealth for hidden or Secret ambushers, or a surprise round for either side.
- **Talking:** a fight can be de-escalated at any point.
  - **The pitch:** a character may spend actions talking to an enemy who shares a language with them, using Diplomacy, Intimidation or Deception against the enemy's Will or Perception DC.
  - **The persuasion track:** each success moves the enemy along it. Most foes need 2–6 successes; only the very gullible fold at once. Being wounded, outnumbered, or neutral makes a foe easier to sway. Only a successful pitch closes the deal.
  - **Grudges:** anyone the talker has hurt, failed to convince before, or whose friends they hurt is much harder to sway. A critical failure means that foe won't listen to them again.
  - **Outcomes:** the convinced foe surrenders, flees, or switches sides (likely for Neutrals, rare otherwise). A convinced leader can take their followers with them.
  - **Who talks:**
    - Talkers (strong social skills, the Diplomat / Leader / People-Pleaser playstyles, or a "Talk first" answer) always get to start on their first turn.
    - Characters who aren't very battle-worthy may spend two actions talking instead of attacking.
    - Anyone else may make one quip a turn when it looks promising.
  - **Can't be swayed:** mindless creatures, foes with no shared language, and hidden ambushers that haven't attacked yet. PCs aren't swayed either; their players decide.
  - Make it So marks surrendered foes with a "Surrendered" effect and flips the disposition (and PF2e alliance) of those who switched sides.

## Make it So

Make it So writes the chosen sample fight onto the tokens:
- HP and temp HP
- dying, wounded and unconscious; lingering conditions such as clumsy or enfeebled
- persistent damage, and afflictions as effects at their stage
- death (dead marker, combatant defeated)
- spell slots, focus points and consumables spent
- fled tokens hidden
- loot: slain creatures' gear stays on the lootable corpse, or drops into a "Remains of …" loot pile

A confirmation lists every change first. **Undo** restores everything, including conditions PF2e added on its own.

## Settings

All settings are defaults that the planner can override per battle:
- runs and maximum rounds
- hidden tokens and other scene levels
- default Neutral/Secret allegiance
- downed model (simulate dying / down = out / down = dead)
- default PC healing and dying response
- leadership, morale and positioning toggles
- initiative source
- report accuracy and delivery
- Make it So loot, corpse and fled handling
- side personality defaults
- data paths for the generic adapter

**PF2e note:** PF2e ties token disposition to the actor's *alliance*. To make a creature Neutral, set its alliance to Neutral on the actor sheet.

## For system and module developers

FastFighting is split into three layers:
- a pure simulation engine with no Foundry dependencies (`scripts/engine/`)
- system **adapters**
- the Foundry UI

To support another system, publish a helper module:

```js
Hooks.once("fastFighting.init", api => {
  class MySystemAdapter extends api.SystemAdapter {
    get label() { return "My System"; }
    get rules() { return myRules; }            // pure object, see scripts/adapters/pf2e/rules.js
    canHandle(actor) { return actor.type === "character" || actor.type === "monster"; }
    async toCombatantSpec(tokenDoc) { /* see CombatantSpec in scripts/engine/battle-state.js */ }
    deriveTraits(actor) { return { traits: { tactical, brave, selfish, loyal }, flags: {}, reasons: {} }; }
    detectLeaders(specs) { return [{ id, score, reason, bonus: { brave, tacticalFloor, attack, ac } }]; }
    difficultyCrossCheck(friendly, hostile) { return { label: "moderate", xp: 80 }; }
    describeOutcome(spec, final) { return ["HP 20 → 4"]; }
    async commitOutcome(tokenDoc, spec, final, options) { /* return an undo record */ }
  }
  api.registerAdapter("my-system", MySystemAdapter, { priority: 10 });
});
```

Adapter priority decides which one is used, highest first. A helper with priority above 0 replaces the built-in PF2e adapter. The generic fallback is registered for `"*"` at priority −100.

**Rules object (pure).** The engine calls these thousands of times:
- `actionsPerTurn`
- `degreeOfSuccess(natural, total, dc)` returning 0–3
- `roll(rng, mod, dc)`
- `attackPenalty(action, attacksMade)`
- `basicSaveMultiplier(degree)`
- `applyIwr(iwr, byType)`
- `onDropped(unit, {crit, model})`
- `onHealed(unit, amount)`
- `recoveryCheck(unit, rng)` (optional)
- `persistentFlatCheck(rng)`

**Other API** on `game.modules.get("fast-fighting").api`:
- `registerModifier({id, label, apply(spec, context)})`: change the BattleSpec before each run
- `registerTraitRule({id, test(actor, spec), apply(traits, spec)})`: adjust derived personality
- `engine`: `runBatch`, `runBatchSync`, `replay`, `findSample`
- `dice`, `constants`
- `openPlanner()`

**Hooks:**
- `fastFighting.init(api)`
- `fastFighting.preSimulate(spec, context)` and `fastFighting.postSimulate(results, context)`
- `fastFighting.prepareReport(report, context)`
- `fastFighting.preMakeItSo(plan)` and `fastFighting.makeItSo(undoRecords)`

## Development

- Symlink or junction this folder into your Foundry data folder as `Data/modules/fast-fighting`.
- Run `npm install` then `npm test` for the engine and parser unit tests (Vitest).
- **Releasing:** bump `version` in `module.json`, commit, and push a `vX.Y.Z` tag. The release workflow builds `module.zip`.
