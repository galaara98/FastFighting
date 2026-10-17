# FastFighting: stats and formulas

How FastFighting decides, number by number, for a GM who wants to check it. Every formula and number here is read
from the code. Search the page for a label ("desire", "run away", "ADHD", "trap luck"): each topic opens with a
`Search:` line of the words a GM would look for, then the formula, its numbers with their defaults and the settings
that change them, and `Code:` (where it lives, to check it). The settings menu shows the short version of each.

## Contents

- **[Minds](#minds)**: [Personality traits](#personality-traits), [Tactical tiers](#tactical-tiers), [Desires and their level](#desires-and-their-level), [How desires are raised each turn](#how-desires-are-raised-each-turn), [What the fight stirs, and how it cools](#what-the-fight-stirs-and-how-it-cools), [Frustration](#frustration), [Pulls from others: style, social, lean](#pulls-from-others-style-social-lean), [What comes to mind](#what-comes-to-mind), [The agenda](#the-agenda), [Desires it can't work on](#desires-it-cant-work-on), [ADHD](#adhd), [Fear](#fear), [Morale stress](#morale-stress), [Morale check: hold, waver, rout](#morale-check-hold-waver-rout), [Wavering](#wavering), [Running away](#running-away), [Standing its ground](#standing-its-ground), [Calling a retreat](#calling-a-retreat), [Rallying](#rallying), [Leaving the fight](#leaving-the-fight), [Being stopped on the way out](#being-stopped-on-the-way-out), [Standing down](#standing-down), [Chain of command](#chain-of-command), [What a leader lends](#what-a-leader-lends), [Following the leader](#following-the-leader), [Scheming](#scheming), [Party's sway](#partys-sway), [Playstyles: how pills combine](#playstyles-how-pills-combine), [Playstyle numbers](#playstyle-numbers), [Tactics answers: wishes and "Let this character decide"](#tactics-answers-wishes-and-let-this-character-decide)
- **[Words and sides](#words-and-sides)**: [Luck rolls at a glance](#luck-rolls-at-a-glance), [Who talks, and how often](#who-talks-and-how-often), [Choosing a pitch](#choosing-a-pitch), [Pitch DC](#pitch-dc), [The persuasion track](#the-persuasion-track), [What a convinced foe does](#what-a-convinced-foe-does), [Switch luck: changing sides](#switch-luck-changing-sides), [Traitor luck: a PC turning traitor](#traitor-luck-a-pc-turning-traitor), [Giving something up](#giving-something-up), [How an encounter opens](#how-an-encounter-opens), [Impatience: what breaks a standoff](#impatience-what-breaks-a-standoff), [Only an argument](#only-an-argument), [Bargaining: offers and expectations](#bargaining-offers-and-expectations), [Haggling and pressing](#haggling-and-pressing), [Paying off a boss](#paying-off-a-boss), [Taking no side: neutral tokens and leans](#taking-no-side-neutral-tokens-and-leans), [Crossed: grievance, truce and turning on a side](#crossed-grievance-truce-and-turning-on-a-side), [Winning over, calming and sending away](#winning-over-calming-and-sending-away), [Meddling: neutrals getting involved](#meddling-neutrals-getting-involved), [Taken for a foe, caught in the blast, spared in a truce](#taken-for-a-foe-caught-in-the-blast-spared-in-a-truce), [Neutral friend groups (reach)](#neutral-friend-groups-reach), [Taunts (goading)](#taunts-goading), [Theft mid-fight](#theft-mid-fight), [Trap avoiders](#trap-avoiders), [Reluctance: consumables and costly spells](#reluctance-consumables-and-costly-spells), [Avoiding killing (mercy)](#avoiding-killing-mercy), [The fallen: tying up and robbing](#the-fallen-tying-up-and-robbing), [Execute luck: finishing off a PC](#execute-luck-finishing-off-a-pc), [Bearing a hold or hurt (ignore troubles)](#bearing-a-hold-or-hurt-ignore-troubles), [The party's vote](#the-partys-vote)
- **[Fighting and the simulation](#fighting-and-the-simulation)**: [The prediction: how many fights it runs](#the-prediction-how-many-fights-it-runs), [Rounds, stalemates and the max-rounds cap](#rounds-stalemates-and-the-max-rounds-cap), [Odds, outcomes and the simulated difficulty](#odds-outcomes-and-the-simulated-difficulty), [The most typical fight (Sample fight)](#the-most-typical-fight-sample-fight), [Swing factors](#swing-factors), [Initiative and turn order](#initiative-and-turn-order), [Dice, degrees of success and advantage](#dice-degrees-of-success-and-advantage), [Expected damage: what an attack is worth](#expected-damage-what-an-attack-is-worth), [Threat: how dangerous a creature looks](#threat-how-dangerous-a-creature-looks), [Choosing whom to attack](#choosing-whom-to-attack), [Choosing an action](#choosing-an-action), [Reluctance: potions, scrolls and costly spells](#reluctance-potions-scrolls-and-costly-spells), [Shields and defensive turns](#shields-and-defensive-turns), [Healing decisions](#healing-decisions), [Buffs and support](#buffs-and-support), [What a condition, bonus or penalty is worth](#what-a-condition-bonus-or-penalty-is-worth), [Control and debuffs](#control-and-debuffs), [Concentration](#concentration), [Movement, reach and getting there](#movement-reach-and-getting-there), [Crowds: getting past creatures and where a move ends](#crowds-getting-past-creatures-and-where-a-move-ends), [Line of sight and cover](#line-of-sight-and-cover), [Senses: what a creature can tell](#senses-what-a-creature-can-tell), [Noticing the fight: bystanders](#noticing-the-fight-bystanders), [Opportunity attacks and getting clear](#opportunity-attacks-and-getting-clear), [Forced movement, falls and dangerous ground](#forced-movement-falls-and-dangerous-ground), [Holds and escapes](#holds-and-escapes), [Harm each turn: conditions, persistent damage, spreading](#harm-each-turn-conditions-persistent-damage-spreading), [Afflictions: poisons, diseases, curses](#afflictions-poisons-diseases-curses), [Summons](#summons), [Luck pools: spending after the roll](#luck-pools-spending-after-the-roll), [Fate: rerolls that keep someone alive](#fate-rerolls-that-keep-someone-alive), [Last-ditch saves and refusing to drop](#last-ditch-saves-and-refusing-to-drop), [Damage, 0 HP and the downed models](#damage-0-hp-and-the-downed-models), [Finishing off a downed PC](#finishing-off-a-downed-pc), [The aftermath](#the-aftermath), [Recharges, cooldowns, legendary actions and counterspells](#recharges-cooldowns-legendary-actions-and-counterspells), [Strain: words that wear a creature down](#strain-words-that-wear-a-creature-down)
- **[Pathfinder 2e](#pathfinder-2e)**: [Checks and degrees of success](#checks-and-degrees-of-success), [Actions, the multiple attack penalty and Strikes](#actions-the-multiple-attack-penalty-and-strikes), [Lore-Collector advantage (Recall Knowledge)](#lore-collector-advantage-recall-knowledge), [Conditions and their penalties](#conditions-and-their-penalties), [Flat checks: hidden, concealed, dazzled](#flat-checks-hidden-concealed-dazzled), [Cover, Hide and Take Cover](#cover-hide-and-take-cover), [Holds and Escape](#holds-and-escape), [Swallow Whole and Engulf](#swallow-whole-and-engulf), [Maneuvers (skill actions)](#maneuvers-skill-actions), [Aid](#aid), [Dying, wounded, doomed and recovery](#dying-wounded-doomed-and-recovery), [Hero Points](#hero-points), [Ferocity](#ferocity), [Persistent damage, bleeding and retching](#persistent-damage-bleeding-and-retching), [Afflictions](#afflictions), [Incapacitation and immunity](#incapacitation-and-immunity), [Weakness, resistance and immunity](#weakness-resistance-and-immunity), [Healing, Battle Medicine and class features](#healing-battle-medicine-and-class-features), [Reactions](#reactions), [Summons](#summons-1), [Doors, falls and moving past others](#doors-falls-and-moving-past-others), [Talking, theft and leadership](#talking-theft-and-leadership), [Personality from the sheet](#personality-from-the-sheet), [Typical numbers and areas](#typical-numbers-and-areas)
- **[D&D 5e](#dd-5e)**: [Rolls, advantage and critical hits](#rolls-advantage-and-critical-hits), [Lore-Collector advantage (Study)](#lore-collector-advantage-study), [Conditions](#conditions), [Cover, Hide, Dodge, Help and Insight](#cover-hide-dodge-help-and-insight), [Grapples, webs, nets and bonds](#grapples-webs-nets-and-bonds), [Swallowed and engulfed](#swallowed-and-engulfed), [Shove and Grapple](#shove-and-grapple), [Pushes, falls and moving past others](#pushes-falls-and-moving-past-others), [Dying and death saves](#dying-and-death-saves), [Inspiration (fate)](#inspiration-fate), [Concentration](#concentration-1), [Undead Fortitude, Relentless Endurance and Regeneration](#undead-fortitude-relentless-endurance-and-regeneration), [Burning and lingering acid](#burning-and-lingering-acid), [Riders on a hit](#riders-on-a-hit), [Reactions](#reactions-1), [Turn, attacks and resources](#turn-attacks-and-resources), [Doors, talking, theft and leadership](#doors-talking-theft-and-leadership), [Personality from the sheet](#personality-from-the-sheet-1), [Typical numbers by challenge rating](#typical-numbers-by-challenge-rating)
- **[DCC](#dcc)**: [Action dice, crits and fumbles](#action-dice-crits-and-fumbles), [Lore-Collector advantage](#lore-collector-advantage), [Conditions and situational modifiers](#conditions-and-situational-modifiers), [Mighty Deeds](#mighty-deeds), [Grapples and holds](#grapples-and-holds), [Tied up stops spells](#tied-up-stops-spells), [Luck, spellburn, Fleeting Luck and Mojo](#luck-spellburn-fleeting-luck-and-mojo), [Spells, Lay on Hands and Turn Unholy](#spells-lay-on-hands-and-turn-unholy), [Spell duels](#spell-duels), [Morale](#morale), [Dying: bleeding out, binding wounds and the body](#dying-bleeding-out-binding-wounds-and-the-body), [Regeneration](#regeneration), [Help, Hide, theft and doors](#help-hide-theft-and-doors), [XCC classes](#xcc-classes), [Talking and leadership](#talking-and-leadership), [Personality from the sheet](#personality-from-the-sheet-2), [Typical numbers by level](#typical-numbers-by-level)
- **[Daggerheart](#daggerheart)**: [The Duality Dice and the adversary's d20](#the-duality-dice-and-the-adversarys-d20), [Lore-Collector advantage (Analyze or Perceive)](#lore-collector-advantage-analyze-or-perceive), [Hope and Experiences](#hope-and-experiences), [Fear and the spotlight](#fear-and-the-spotlight), [Hit Points, thresholds, Armor Slots and Stress](#hit-points-thresholds-armor-slots-and-stress), [Minions, hordes and companions](#minions-hordes-and-companions), [Death moves](#death-moves), [Tending a friend out cold](#tending-a-friend-out-cold), [Conditions and Restrained](#conditions-and-restrained), [Tied up stops spells](#tied-up-stops-spells-1), [Trait moves, Sprint and Hide](#trait-moves-sprint-and-hide), [Knockbacks, falls, collisions and ranges](#knockbacks-falls-collisions-and-ranges), [Summons](#summons-2), [Doors, theft, talking, gold and leadership](#doors-theft-talking-gold-and-leadership), [Personality from the sheet](#personality-from-the-sheet-3), [Typical numbers by level](#typical-numbers-by-level-1)
- **[Ironsworn and Starforged](#ironsworn-and-starforged)**: [Action rolls and progress rolls](#action-rolls-and-progress-rolls), [Lore-Collector advantage (Secure an Advantage)](#lore-collector-advantage-secure-an-advantage), [Foes' progress tracks](#foes-progress-tracks), [Strike and Clash](#strike-and-clash), [End the Fight and Take Decisive Action](#end-the-fight-and-take-decisive-action), [Pay the Price](#pay-the-price), [Momentum and burning it](#momentum-and-burning-it), [Endure Harm and the harm table](#endure-harm-and-the-harm-table), [Endure Stress and the stress table](#endure-stress-and-the-stress-table), [Enter the Fray](#enter-the-fray), [Secure an Advantage, Aid Your Ally and Heal](#secure-an-advantage-aid-your-ally-and-heal), [Face Danger: breaking free, doors and hazards](#face-danger-breaking-free-doors-and-hazards), [Compel and talking](#compel-and-talking), [One track for the encounter](#one-track-for-the-encounter), [Taking a side mid-fight](#taking-a-side-mid-fight), [Provocation](#provocation), [Rules preference](#rules-preference), [Debilities, impacts and other numbers](#debilities-impacts-and-other-numbers), [Leadership and personality](#leadership-and-personality)

## Minds

How a creature thinks: its four traits, what it wants and how badly, its nerve, and whom it listens to. Code paths are
under `scripts/`. A d100 "at or under X" succeeds on 1 to X.

### Personality traits

Search: traits, personality, hidden scores, Tactical, Brave, Selfish, Loyal, Side personality defaults, sideDefaults, side weight, PC baseline, trait fudge, trait bands

Four hidden scores, 0 to 100, behind every choice a creature makes.

Each trait is built in five steps:

1. **Base**: what the system helper reads from the sheet. A player character starts at the PC baseline and its sheet
   moves it, held to 5–95. With nothing to read: 50.
2. **Own** = base + fudge, held to 0–100. The fudge is the planner's +/− (steps of 5) plus the playstyles' trait shifts.
3. **Side blend** = round(own × 0.7 + side trait × 0.3). The side trait is the world's Side personality defaults
   (`sideDefaults`) plus the planner's fudge for that side.
4. **ADHD**: the creature's own ADHD lowers Tactical (see ADHD).
5. **In the fight**: a follower adds its commander's Brave bonus, and its Tactical is at least the commander's tactical
   floor (see What a leader lends). The commander itself gets neither.

| | Tactical | Brave | Selfish | Loyal |
|---|---|---|---|---|
| PC baseline (where helpers start a PC) | 65 | 75 | 25 | 80 |
| Friendly side default | 60 | 70 | 30 | 75 |
| Hostile side default | 45 | 55 | 50 | 50 |
| Neutral side default | 40 | 40 | 60 | 30 |
| Secret side default | 60 | 50 | 50 | 50 |

Bands (a score at or above the floor):

| Floor | Tactical | Brave | Selfish | Loyal |
|---|---|---|---|---|
| 0 | Feral | Craven | Devoted | Treacherous |
| 20 | Instinctive | Skittish | Selfless | Wavering |
| 40 | Competent | Steady | Pragmatic | Dependable |
| 60 | Tactical | Bold | Selfish | Loyal |
| 80 | Mastermind | Fearless | Ruthless | Unshakable |

Example: a goblin whose sheet gives Brave 35, on the hostile side (55): round(24.5 + 16.5) = 41, Steady. A PC at the
baseline Brave 75 on the friendly side (70): 74, Bold; with Wants to Lead as its first playstyle (+10): 81, Fearless.

Code: `constants.js` `PC_BASELINE`, `TRAIT_BANDS`, `traitBand`; `settings.js` `DEFAULT_SIDE_TRAITS`;
`engine/trait-parts.js` `traitsFromParts`; `engine/battle-state.js` `prepareCombatant` (`SIDE_WEIGHT` 0.3), `liveTrait`;
`foundry/battle.js` `fudgedTraits`, `applyCharacterTactics`.

### Tactical tiers

Search: tactical tier, Feral, Instinctive, Competent, Tactical, Mastermind, how smart, plans ahead

A creature's tier is floor(live Tactical ÷ 20), 0 to 4. A commander's tactical floor can raise it.

| Tier (Tactical) | In its mind |
|---|---|
| Feral (0–19) | Attacks whoever just hurt it if within a move, else the nearest. A hit makes it want to hit back by 40. Heals only itself. ADHD ×3. Works the top of its agenda first. |
| Instinctive (20–39) | Attacks close prey, the weakest-looking first (pack hunters pile on). Hit: +25. ADHD ×3. Works the top of its agenda first. |
| Competent (40–59) | Sticks with its foe, else the quickest kill. Hit: +10. ADHD ×2. Works its whole agenda at once. Flanks. |
| Tactical (60–79) | Weighs threat removed per turn invested. Hit: +5. Agenda sorted strongest first, no ADHD jumps. Keeps desires it can't work on yet. Reads the odds (up to +40 morale stress). |
| Mastermind (80–100) | As Tactical, and keeps its side on one focus target. Hit: +3. |

Code: `constants.js` `tacticalTier`; `engine/battle-state.js` `liveTier`, `isFlanked`; `engine/behavior/targeting.js`
`scoreTargets`; `engine/simulator.js` `HIT_URGE`; `engine/behavior/desire.js` `orderAgenda`;
`engine/behavior/hopeless.js` `sinkHopeless`; `engine/behavior/morale.js` `moraleStress`.

### Desires and their level

Search: desire, desires, wants, how badly, Hurt, Heal, Protect, Bolster, Talk to, Keep away from, Tie up, Rob, Be bolstered by, Break free, Free, Be rid of it, Leave the fight, desire layers, Passing, Wants, Determined, Driven, Obsessed

Each desire is a kind and a target ("Hurt the ogre") with a level from 0 to 100. The strongest leads.

level = max(logic, stated, taunt, condition) + lean + style + memory + social − frustration, held to 0–100.

| Layer | Holds | Lasts |
|---|---|---|
| logic | what its tactics conclude (How desires are raised) | worked out each turn |
| stated | the Desires in its Tactics survey; Leave the fight | the fight |
| taunt | going for whoever taunted it, at the taunt's level | while the taunt lasts and the taunter stands |
| condition | what a condition makes it want (keep away from whoever frightened it) | while the condition lasts |
| lean | a neutral's lean toward a side | until the lean changes |
| style | its playstyles' points | each turn |
| memory | what the fight stirred | cools each turn |
| social | its commander's pull, the party's wishes, friends' requests | each turn |
| frustration | what thwarted it (subtracted) | doesn't cool |

Two overrides. In a live battle, a level the GM holds a desire at (Battle Vantage) is its level, whatever the layers say
(0 sets it aside). A creature under someone's control (charmed, dominated) wants what its controller wants and
nothing of its own.

Bands: Passing 0–19, Wants 20–39, Determined 40–59, Driven 60–79, Obsessed 80–100. A desire stated in the survey sits
mid-band: Passing 10, Wants 30, Determined 50 (the default), Driven 70, Obsessed 90.

Code: `engine/behavior/desire.js` `levelOfKey`, `DESIRE_BANDS`, `holdDesire`, `puppetWishes`; `foundry/tactics.js`
`DESIRE_LEVELS`, `statedDesires`.

### How desires are raised each turn

Search: logic, CHOICE_LEVEL, choice level, target pick, runners-up, heal urgency, talk desire, grudge, robbed, fallen foes, finish them, break free, free a friend, be rid of, rage

The logic layer, worked out afresh at the start of each turn:

| Desire | Level |
|---|---|
| Hurt the foe its tactics pick | 45 + 15 × (1 − runner-up's score ÷ best score): 45 for a close call, 60 for a clear choice (`CHOICE_LEVEL` 45) |
| Hurt each runner-up | max(5, 45 × its score ÷ best score) |
| Heal a friend or itself | max(45, 20 + 20 × heal score, urgency). Urgency: down 90; under half HP, 30 + 110 × (0.5 − HP fraction); else 0 |
| Bolster a friend (its 3 best buffs scoring 0.4+) | min(75, 15 + 30 × score); score = the buff's worth per action ÷ its attack's |
| Talk to its best listener | 15 + 60 × talk affinity (0–1). Not with Talking off or "Let my weapons do the talking" |
| Keep away from one who robbed it, until that one attacks it | 50 + (50 − Brave) × 0.3 |
| Protect a friend under attack (answer "Whoever is attacking my allies") | 50 + (Loyal − 50) × 0.3 |
| Finish, tie up or rob each fallen foe (its Foes who fall answer) | 30; 62 with no standing foe in reach |
| Hurt whoever grabs or swallows it | 50 × retaliate |
| Hurt the nearest foe, in a rage | 80 |
| Break free | tied up 85 (45 + fear + rid points if it can still act tied up); grabbed 45; swallowed or engulfed 75; impregnated 30; other holds 55. +20 with no foe beside it, +20 in a hazard, +10 per step of something growing in it, + rid points. 0 when a selfless one bears it |
| Free a held friend | (25 + 0.4 × Loyal + free points + answer + 10 with no foe beside it) × 0.5 if the friend is down. Answer to When an ally is dying: rescue +15, keep fighting 0, get out −5, look after myself −15 |
| Be rid of a burn or bleed | its annoyance + fear + rid points |

fear = (50 − Brave) × 0.5. Heal score: `engine/behavior/healing.js` `healScores`. Talk affinity:
`engine/behavior/talk.js` `talkAffinity`.

Code: `engine/simulator.js` `thinkOver`, `healUrgency`, `GRUDGE`, `WARD`; `engine/behavior/desire.js`
`levelsFromScores`, `conditionWishes`, `holdWishes` (`BREAK_FREE`, `FREE`); `engine/behavior/fallen.js`
`fallenWishes` (`FALLEN_LEVEL`).

### What the fight stirs, and how it cools

Search: memory, grudge, revenge, retaliate, hit back, avenge, vengeance, vengeful, cool, cooling

The memory layer grows when something happens and cools on each of the creature's turns.

| What happens | It wants | By |
|---|---|---|
| A foe hurts it | to hurt that foe | per hit: Feral 40, Instinctive 25, Competent 10, Tactical 5, Mastermind 3; 3 if hit from afar while a foe is beside it; × retaliate |
| A friend it can see falls | to hurt whoever felled it | 15 × Loyal ÷ 60 × avenge |
| One who robbed it attacks it | to hurt that one | 60 × retaliate |
| A neutral is crossed, or a side turns on one | the two to hurt each other | 30 or 40 × retaliate (`engine/behavior/neutral.js`) |
| Its fear passes bearing (see Fear) | to keep away from whoever frightens it | at least 75, while the fear lasts |
| It gives up leaving (see Being stopped) | to hurt or answer whoever stopped it | at least 41 |

Cooling: at the start of each of its turns, every memory desire loses 2 × cool, and goes at 0. Cool is 1, Vengeful 0
(never cools), Lazy 1.5.

Example: an Instinctive wolf hit twice by the same fighter wants it 50 more than its tactics say; five turns later,
40 more.

Code: `engine/simulator.js` `noteHarm` (`HIT_URGE`), `noteFall`, `strikeTarget`; `engine/behavior/desire.js` `want`,
`newTurn`.

### Frustration

Search: frustration, thwarted, gives up, can't reach, locked door, door patience, obstacle

What gets in the way wears a desire down until the creature turns to something else.

Added = amount × (1.3 − Brave ÷ 100) × its frustration multiplier (1; Impatient 2, Relentless 0.4: Playstyle numbers).

| What thwarts it | Amount |
|---|---|
| Its lead target out of reach, each time it picks a target | 8 |
| A parting blow while heading for someone | 6 |
| Giving up on a locked door | 15 to each foe beyond it |
| A blow at the door that doesn't break it | 4 if it did damage, else 8 |
| A failed check at the door | 12 |
| Under 35% HP: each foe two moves or more away, each turn | 5 |

Frustration doesn't cool. Opening the door takes 75% of it away; a desire given up (Desires it can't work on) loses it.

Door patience: it keeps at a door while its plan takes no more turns than max(0.5, urge ÷ 15) × 1.5 if there's nobody
else to fight × doorPatience; urge = max(45, how badly it wants what's beyond).

Example: Brave 30 → ×1.0, an unreachable target costs 8 a look; Brave 80 → ×0.5, 4.

Code: `engine/behavior/desire.js` `thwart`, `relieve`; `engine/behavior/targeting.js`; `engine/simulator.js`
`workTheDoor`; `engine/behavior/doors.js` `patienceFor`.

### Pulls from others: style, social, lean

Search: playstyle points, social, requests, buff request, Be bolstered by, willingness, leaderless, lean, friend group, whim

- **Style**, each turn: its playstyle points (Playstyle numbers) go where they fit. Hurt: the nearest foe, foes 2+
  moves away (far), the weakest-looking, the most dangerous (level × 2 + damage dealt ÷ 5), casters, healers, the foes'
  commander, a foe its damage exploits, one it hasn't sized up, its current target, unstable downed foes. Bind, rob:
  each fallen foe it perceives. Heal: friends down or under 75% HP; mend: itself under 75%. Protect: the
  weakest-looking friend. Aid: the friend dealing the most damage (its commander, for one whose leader multiplier is
  over 1). Talk: its chosen listener. Avoid: the most dangerous foe; its last attacker once it's under 60% HP; the
  nearest foe. Whim: a 30% chance each turn that a random foe gets the points.
- **Social**: its commander's pull (Following the leader) and the party's wishes (Party's sway). A friend's "Be
  bolstered by" desire naming it becomes a wish to bolster that friend at the request's level × willingness, if they
  share a language and neither is mindless. Willingness = 0.5 + (Loyal − 50) ÷ 100 − (Selfish − 50) ÷ 100, +0.25 for a
  helping playstyle (Moralist, People-Pleaser, Martyr, Tank, Enabler, Redeem-Seeker), 0 to 1; under 0.2 it ignores
  the request. A leaderless group wants to heal, protect or bolster each other 6 less.
- **Lean**, for one who takes no side: pull = 50 × 0.25 × min(1.6, Loyal ÷ 60) × (1 − max(0, Selfish − 50) ÷ 100). It
  wants the side it leans to protected (+pull) and less hurt (−pull), and that side's foes hurt (+pull ÷ 2). A neutral
  friend group wants each other protected by 15 × the same two factors.

Code: `engine/behavior/desire.js` `styleWants`, `listen`, `heed`, `willingness` (`UNWILLING` 0.2), `LEADERLESS`;
`engine/behavior/neutral.js` `LEAN`, `LEAN_PULL`, `FELLOW`.

### What comes to mind

Search: lead desire, strongest desire, BLIND_GAP, blind gap, in view, blinding, obsessed, obsession, tunnel vision, thoughts, driven by

What a creature acts on this turn, and what it can't see past.

- **Lead**: the top of its agenda that it can work on, else its strongest such desire.
- **In view**: any desire within 20 of the lead (`BLIND_GAP`), and the 2nd and 3rd on its agenda however weak. A Keep
  away from desire counts only within 20 of its strongest desire.
- **Driven by**: the GM's hold or the survey (stated, when over logic); a taunt (over both); else memory if 10+; else
  social if 10+; else its own logic.
- **Blinding**: a lead driven by stated, taunt or memory. Its own reasoning and others' pull never blind. Blinded, it goes
  straight for that target (no easier opening), heals or bolsters only if such a desire is in view, and with a lead of
  60+ talks only if a talk desire is in view.
- **Obsessed**: a lead of 80+. It stops minding opportunity attacks.
- The story's thought lines show its two strongest desires.

Example: a fighter's tactics want the archer at 55 and the ogre at 45; the ogre's hits add 25 memory: ogre 70, driven
by memory, so blinding. The archer (55) is in view (70 − 20 = 50); bolstering a friend at 40 is not, so it doesn't.

Code: `engine/behavior/desire.js` `mind`, `rankedDesires`, `avoids`, `thoughts`; `engine/behavior/reactions.js` `isWary`;
`engine/behavior/healing.js`; `engine/behavior/support.js`; `engine/simulator.js`.

### The agenda

Search: agenda, to-do, order, what it means to do, top of agenda, second place, climb, fit

The order in which a creature means to work through its desires, kept from turn to turn.

Each turn, as it thinks:

1. Desires it no longer has come off; those it can't work on go to the bottom.
2. A new desire goes where something placed it (top or second), else by its fit (below), else to the bottom. One whose fit
   rose since last turn moves up the same way.
3. Everything below second climbs toward second, past weaker desires only (never past one as strong, nor one placed this
   turn): Obsessed all the way, Driven 3 places, Determined 2, Wants 1, Passing 0.
4. Tactical tier or better: the whole agenda is re-sorted strongest first. The rest keep their order, apart from ADHD
   jumps.

Placed on top: setting out to leave; whatever stopped it on its way (leaving goes second); a taunt; a GM hold above 0; a
fear past bearing.

| Fit 2: on top | Fit 1: second |
|---|---|
| Its playstyle points on it are 25+ | Playstyle points 10+ |
| Hurt a downed foe, for one that finishes the fallen | |
| Tie up or rob a fallen foe, answering Tie them up or Rob them | |
| Talk, answering Always talk | Talk, answering Talk first |
| Heal, answering Heal at all costs | Heal, answering Keep everyone topped up |
| Heal a downed friend, answering Drop everything to save them | Heal a downed friend, any other answer |
| Heal itself under its potion threshold | |
| A protector, and a foe at a friend it can reach this turn | The same foe out of reach this turn; any Protect, for a protector |
| | A striker, and a foe it has just caught sight of |

Protector: style protector, target "Whoever is attacking my allies", or Tank, Martyr, Enabler, Moralist. Striker: style
frontline, skirmisher or ranged, or Brawler, Speed-Runner, Impatient, Cruel.

On its turn, an Instinctive or Feral creature works the top first, then the 2nd and 3rd, and the rest only once the top
can't be done; Competent or better works any of it.

Code: `engine/behavior/desire.js` `orderAgenda`, `agendaFit`, `climb`, `placeDesire`; `engine/simulator.js`
`AGENDA_GROUPS`.

### Desires it can't work on

Search: sunk, hopeless, out of reach, unreachable, gives up, abandoned desire

A desire the creature can't act on now sinks below everything else and can't lead.

| Kind | Can't work on it when |
|---|---|
| Hurt | it can't perceive the target, or nothing it can use reaches it |
| Heal | no healing with uses left, or it can't perceive the friend |
| Bolster | no buff with uses left |
| Talk to | Talking is off, it can't talk, no shared language, or it can't perceive the listener |
| Others | always workable |

Still sunk the next time it thinks its turn over, the desire is given up (removed from every layer but a GM hold and a
controller's wishes), unless the creature is Tactical tier or better: then it stays sunk until it can act. Once it can
act, the desire is back where its level puts it.

Code: `engine/behavior/hopeless.js` `canWorkOn`, `sinkHopeless`.

### ADHD

Search: ADHD, mind jumps, impulse, impulsive, distracted, adhd, ADHD: how often a creature's mind jumps (%), creature ADHD

How often a creature drops what it's doing for the strongest thing it wants, and each creature's own nudge.

**World chance**: ADHD: how often a creature's mind jumps (%) (`adhd`, 0 to 100, default 20). Each turn, for a creature
below Tactical tier whose strongest other workable desire is stronger than the top of its agenda:
chance = ADHD% × 2 if it could do that this turn (× 3 at Instinctive or Feral), × 1 if not; at most 100%. If it
jumps, that desire takes the top. "Could do this turn": for Hurt, it perceives the foe and has an attack with uses
within one move; for anything else, the desire isn't sunk.

**Creature's own** (the planner's ADHD row, steps of 10, or the token's tactics panel; 0 to 100%): Tactical ×
(1 − 0.3 × ADHD% ÷ 100), rounded, so 70% of itself at 100%. Dropping a tier brings the world chance into play.

Example: an Instinctive goblin on its foe at 45 sees one at 55 it could hit now: 20% × 3 = 60% it switches. A PC with
Tactical 64 and ADHD 50% has 54: Competent, so its mind now jumps 40% of the time for something doable now.

Code: `engine/behavior/desire.js` `orderAgenda`, `doableNow`; `engine/battle-state.js` `prepareCombatant`
(`ADHD_TACTICAL` 0.3); `constants.js` `ADHD`.

### Fear

Search: fear, frightened, fleeing, turned, scared, terror, fear steps, fright, fear builds

How a fear condition shapes what a creature wants, how it builds and lapses, and when it turns into running.

**Fear steps**: frightened N counts N; fleeing or turned counts 2; any other fear condition the system names counts its
value (1 if simply on). The creature's fear is its worst. Where the system counts fear in steps (PF2e's frightened 2),
that's the fear. Where a fear is only on or off, it builds: +1 for each new fear effect (or one laid on again), −1 for
each that lapses, 0 once none is left.

**While the condition lasts** (never itself a reason to run): frightened by a foe, keep away from it at
min(65, 20 + 15 × N) + (50 − Brave) × 0.3; sent fleeing or turned, keep away at 80. A system helper may say what its
conditions make a creature want instead.

**On its nerve**: + 4 × steps × clamp(1.5 − Brave ÷ 100, 0.5, 1.5) morale stress.

**Past bearing**: steps ≥ 2 for Brave 0–29, 3 for Brave 30–69, 4 for Brave 70+. Then the creature wants, of itself, to
keep away from each standing foe whose effect frightens it: at least 75 (memory), on top of its agenda, gone once the
fear falls below. 75 is enough to run (Running away).

Example (PF2e): a Brave 50 orc frightened 2 by a cleric wants away from it at 50 and takes 8 stress, but holds. At
frightened 3 its fear is past bearing: away at 75, and with the cleric within 30 ft, it runs.

Code: `engine/behavior/desire.js` `conditionWishes`, `fearNow`, `fearBuilt`, `fearOn`, `fearToRun` (`FRIGHT`,
`FLEE_FROM` 80, `RUN_FROM` 75); `engine/behavior/morale.js` `moraleStress` (`FRIGHT_STRESS` 4).

### Morale stress

Search: morale, stress, nerve, shaken, losses, fallen leader, panic, friends running, odds, Morale and routing

How shaken a creature is, checked against Brave at the start of each of its turns.

| Source | Stress |
|---|---|
| Friends on its side not standing | 40 × fallen ÷ all its friends |
| Its own HP | under 25%: +45; under 50%: +25 |
| The head of its group (boss or leader) not standing | boss 35, leader 25; 18 or 13 if a lieutenant now commands |
| Its master (a companion's) | down: +(100 − Loyal) × 0.6; standing: −Loyal × 0.2 |
| Each group mate seen running (fled this round or last, or fleeing or turned) | 12; one in its chain of command 20 × (1 + its flighty) |
| The running total above | × 1.3 with nobody able to lead; × clamp(1 − 0.15 × command weight, 0.4, 1) under a steady commander; at most 35 (45.5 leaderless) |
| Rallied this round or last | −20 × the rally's strength (1 to 3) |
| Afraid | +4 × fear steps × clamp(1.5 − Brave ÷ 100, 0.5, 1.5) |
| Each standing one who robbed it and hasn't attacked it | +15 |
| Tactical tier or better: bad odds | +clamp(25 × (foes' threat ÷ friends' threat − 1), 0, 40) |
| Then, for selfishness | × (0.8 + Selfish ÷ 250): 0.8 to 1.2 |

Command weight = (Leader's influence ÷ 50) × Boss's influence under a boss, 0 to 4. A commander is steady while it
isn't wavering or running; a creature that commands itself gets no calming.

Code: `engine/behavior/morale.js` `moraleStress` (`ODDS` 40, `PANIC` 12, `PANIC_HEAD` 20, `PANIC_MAX` 35,
`STEADY` 20, `LEADERLESS` 1.3), `commandWeight`, `running`.

### Morale check: hold, waver, rout

Search: morale check, morale roll, rout, routing, waver, breaks and flees, fearless, When to retreat, Can rout, retreat answer

At the start of each of its turns, in order:

1. **Its When to retreat answer**, if it has one, shapes the roll; it doesn't replace it. Every PC or player-owned
   character has one (answered or calculated); any other creature only from the GM or a playstyle. When I'm badly
   hurt: rout under 25% HP (the system may change this: Daggerheart 34%, Ironsworn 1%). When the battle turns against
   us: rout once half or more of its side (itself counted) is down or out and standing foes outnumber standing friends.
   Short of that, and for Fight to the end, it goes on to the steps below like anyone; Fight to the end then stands its
   ground against a rout (Standing its ground).
2. **Morale off** (world setting Morale and routing, `morale`, per battle in the planner; or the planner's Can rout for
   its side): hold.
3. **A system's own morale rule** (DCC's Will saves) decides, where it has one.
4. **Fearless**, or Brave 95+: hold.
5. **The roll**, only when stress has risen 10 or more since its last roll (from 0). Resolve = Brave × 0.75. Stress at
   or under resolve: hold. Otherwise a chance of (stress − resolve) ÷ 80, at most 85%. Failing it: hold. Making it:
   rout if stress > Brave, else waver.

Example: a goblin with Brave 55 (resolve 41), half its side down (+20) and at 40% HP (+25): stress 45, a 5% chance to
waver. Its leader falls (+25): stress 70, a 36% chance, and 70 > 55, so it routs.

Code: `engine/behavior/morale.js` `checkMorale`; `engine/simulator.js` (turn start).

### Wavering

Search: wavering, wavers, shaken, -1 to attack, thinking of running

A shaken creature: −1 to its attack rolls, 2 easier to talk round, and shown as thinking of running. Set by a waver
result, or by a rout it didn't act on. It stays until a rally clears it (commander: clamp(0.5 × command weight, 0.2,
0.9); anyone else: 30%) or the creature changes side.

Code: `engine/battle-state.js` `attackRoll`; `engine/behavior/talk.js` (DC −2); `engine/behavior/morale.js` `rallies`.

### Running away

Search: run away, runs, flee, flees, fleeing, rout, retreat, dread, breaks and flees, retreats as an ally falls, retreats after being revived

What sends a creature running of its own accord:

| Trigger | When |
|---|---|
| Rout | its morale check |
| Dread | its lead desire is Keep away from at 70+ (conditions' wishes left out) and that foe is within 30 ft, or there's no map |
| After I'm revived: Retreat | it's on the ground after being downed |
| When an ally is dying: Get out of here | a friend on its side is down |

Then it may stand its ground (next topic). If not, it calls a retreat, and flees. On a map with edges and no standoff,
it sets out to leave (Leaving the fight); otherwise it takes any parting blows and is gone (fled). Being talked into
fleeing: Standing down. Spells and rules that force fleeing (fleeing, turned) play out as the system says.

Code: `engine/simulator.js` `runs`, `flee`.

### Standing its ground

Search: stand ground, holds its ground, doesn't like to flee, Fight to the end, standGround, Doesn't like to flee: how often it stays (%), boss runs

Whether a creature that would run stays anyway.

- **A boss** runs only 5% of the time × (1 + 3 × flighty), at most 50%. A first-pick Chicken boss: 20%.
- **Anyone else** stays with chance Doesn't like to flee (%) (`standGround`, 50 to 90, default 90) × its wish: Fight to
  the end 1, When the battle turns against us 0.5, When I'm badly hurt 0. Only an answer given carries a wish; "Let this
  character decide" carries none, except that a calculated or playstyle Fight to the end counts as 1.
- The same roll makes one talked into fleeing surrender where it stands instead.

Example, at the default: Fight to the end stays 90% of the time; When the battle turns against us, 45%.

Code: `engine/behavior/morale.js` `standsGround` (`BOSS_RUNS` 0.05); `engine/tactics.js` `TACTIC_WISHES`.

### Calling a retreat

Search: retreat call, calls the retreat, fall back, retreat refused, retreat urged, leads the retreat, earshot

One who means to run tries to take its group (its side, or its neutral friend group) along. Earshot: 60 ft (no map:
everyone).

- No call when it's controlled, or when it isn't the commander and can't talk. A commander out of earshot, or a PC
  commander, isn't asked: it runs alone.
- **The commander decides.** One who commands calls the retreat itself. Asked, the commander agrees with chance
  clamp((0.2 + shaken + word) × 0.5 if rallied × 0.2 for a boss, 1%, 85%). shaken = (its stress − its Brave × 0.75) ÷
  100; word = 0.15 if the caller is in the chain of command + 0.2 × the caller's talk affinity. Refusing, it orders
  the caller to hold, which the caller does as readily as it follows its commander.
- **Each group mate** falls back with chance clamp((follow chance + shaken) × (1 + the commander's flighty) × 0.6 if
  rallied, 0, 95%). Follow chance: Following the leader; 0.65 with nobody commanding. shaken = clamp((its stress −
  Brave × 0.75) ÷ 100, −0.3, 0.4). Then it may stand its ground. Never PCs, the fearless, Brave 95+, or Fight to the
  end.

Code: `engine/behavior/morale.js` `callRetreat` (`BOSS_AGREES` 0.2, `LEADERLESS_FOLLOW` 0.65, `EARSHOT` 60).

### Rallying

Search: rally, rallies, hold!, steadied, steady

Seeing a group mate run, or one within earshot waver, a creature may spend an action (the system's basic action)
holding the rest together.

- **Who**: one that can talk, isn't wavering and isn't controlled; its group's commander, one with a rally playstyle
  (Wants to Lead, Martyr), or one with Brave 65+ and Loyal 55+.
- **Chance**: commander, clamp((0.6 + keen ÷ 2) × command weight, 0, 95%). Anyone else, clamp(0.1 + max(0, Brave − 65)
  ÷ 100 + max(0, Loyal − 55) ÷ 150 + 0.2 × talk affinity + keen, 5%, 60%). Keen: its rally behavior (Wants to Lead
  0.25, Martyr 0.2, by pill place).
- **Strength**: commander, clamp(1.5 × command weight, 1, 3); anyone else, 1. No second rally in a round unless stronger.
- **Effect**, on everyone within 60 ft, this round and next: stress −20 × strength; half as likely to agree to a
  retreat (commander), 0.6 × as likely to answer a call; a wavering one recovers (commander clamp(0.5 × command weight,
  0.2, 0.9), anyone else 30%).

Example: a leader at the usual influence (weight 1) rallies 60% of the time: −30 stress, half the wavering recover. A
boss (weight 2): 95%, −60 stress, 90% recover.

Code: `engine/behavior/morale.js` `rallies`, `steadied`, `commandWeight`.

### Leaving the fight

Search: leave the fight, leaving, off the map, way off, exit, map edge, fled, two whole turns, Leave the fight desire

A creature that runs on a map makes for the way off rather than vanishing.

- **Setting out**: Leave the fight at 100 (stated), on top of its agenda. Its quarrel (hurt, tie up, rob, keep away from)
  with whoever talked it into going (that side), or with all its foes, is laid down. Its friends see it running.
- **Each turn**: up off the ground, loose of any hold except ropes, then along the scene's exit path (else straight to
  the nearest edge) as fast as it moves, taking parting blows on the way.
- **Gone** (fled): at the edge; or after two whole turns of its own in a row given to going (`LEAVING_TURNS` 2), at the
  edge or not, with a way off or not. The turn it set out in doesn't count; being stopped starts the count over.
- Without positions or map edges, or in a standoff: gone at once. Still on its way when the fight ends: gone.

Code: `engine/behavior/leaving.js` `startLeaving`, `wayOff`, `goAlong`, `mayLeave`; `engine/simulator.js`
`leavingTurn`, `LEAVING_TURNS`.

### Being stopped on the way out

Search: committed to leaving, leaveResolve, Committed to leaving: how often it keeps going (%), stopped, interrupted, commitment, turns to face

Every attack at a leaving creature, and every word to it, may stop it.

It keeps going on a d100 at or under round(Committed to leaving (%) (`leaveResolve`, 0 to 100, default 79) ×
commitment), where commitment = 1 − min(0.3, pull):

| Pull | Amount |
|---|---|
| When to retreat | badly hurt 0, battle turns 0.1, Fight to the end 0.3, none 0.05 |
| Spoken to: its talking answer | weapons 0, when it could work 0.05, Talk first 0.1, Always talk 0.2; none 0.05 |
| Struck: its bravery | 0.1 × max(0, Brave − 50) ÷ 50 |
| Struck: each pill | Vengeful 0.25, Relentless 0.2, Brawler 0.15, Tank 0.15, Cruel 0.1, Martyr 0.1, Wants to Lead 0.1, Instigator 0.05, Redeem-Seeker 0.05 |
| Spoken to: each pill | Diplomat 0.2, Peacekeeper 0.2, People-Pleaser 0.15, Redeem-Seeker 0.1, Moralist 0.1, Mercenary 0.1, Instigator 0.05, Wants to Lead 0.05 |

A pill's pull is × its place's weight (1, 0.75, 0.55, 0.4).

Stopped, its wish to go falls by round(15 × (1 + (1 − commitment) ÷ 0.3)): 15 to 30. What stopped it goes on top (at
that wish + 1), going second; after its next turn it's on its way again. Below 40 it forgets leaving: back in the
fight, wanting the one who stopped it at 41 or more.

Example: Brave 70, Brawler first, struck: pull 0.04 + 0.15 = 0.19, commitment 0.81. It keeps going on 64 or less;
each stop costs 25 (100 → 75 → 50 → 25), so the third stop ends its leaving. At commitment 1: 79 or less, 15 a stop,
the fifth stop ends it.

Code: `engine/behavior/leaving.js` `commitment`, `confronted`, `backOnItsWay` (`PULLS`, `RETREAT_PULL`, `TALK_PULL`,
`MOST_PULL` 0.3, `STOPPED_BY` 15, `FORGET` 40).

### Standing down

Search: stand down, stands down, stood down, truce, surrender, talked out of the fight, pays up, concede

How a foe talked out of the fight leaves it. Standing down: out of the conflict, nobody's prisoner.

For an NPC talked down, the first that applies:

1. Talked round by a Peacekeeper (at its peacekeeping chance), and not a boss: stands down.
2. A boss: in a standoff, paid to go (its group with it); in a fight, surrenders under 25% HP, else pays up and fights
   on.
3. Changes sides: 60% for one that started neutral; else clamp(0.03 + (Selfish − 50) ÷ 500 + (50 − Loyal) ÷ 500, 0,
   12%), +0.5 when scheming (at most 70%). It goes through only on a d100 under Luck: an enemy changing sides
   (`switchLuck`, +20 when scheming); else it's talked into something below.
4. Pays up: clamp(0.12 + 0.15 if threatened + 0.1 under half HP − (Selfish − 50) ÷ 400, 3%, 45%).
5. In a standoff, unless threatened: stands down.
6. Flees: unhurt with Selfish 55+, or half the time when under half HP with Brave under 40; either unless it stands its
   ground.
7. Surrenders.

When the encounter is only an argument (How encounters open), fleeing and surrendering become standing down. A PC
only pays up, or flees when it has nothing to give; threatened, it flees with chance clamp(0.5 − (Brave − 50) ÷ 100,
10%, 80%) unless it stands its ground.

A commander talked down takes its group: each mate other than a PC follows with chance clamp(0.4 + (100 − Brave) ÷
250 + 0.1 × the talkers' progress on it, 0, 90%). It stands down if the commander stood down, paid up or changed
sides, else surrenders.

Code: `engine/behavior/talk.js` `outcomeFor`, `resolveTalk`.

### Chain of command

Search: leader, boss, lieutenant, 1st Lieutenant, 2nd Lieutenant, commander, chain of command, who leads, leaderless, Leadership, roles, bossiness

Each group (a side, or a neutral friend group) may have a boss or a leader, then up to two lieutenants.

- **Commands now**: the first in the chain who is standing, in the fight, not controlled, and able to see, hear and speak
  (not incapacitated, unconscious, paralyzed, stunned, confused, fleeing, blinded, deafened, silenced or petrified). A
  lieutenant who steps up leads as a leader, never a boss. Nobody able: leaderless.
- **The automatic pick** (made once, when the plan is new; the planner's role pills override it):
  - Outside the party: the highest score = 2 × the system's leader ranking (−10 if unranked) + bossiness + rarity (0,
    0.5, 1, 1.5 from common to unique). A boss if 2+ levels above every other member. One lieutenant in a group of 5+.
    A group of one has nobody.
  - Bossiness = Σ pill × place weight (1.5, 1, 0.8, 0.6) + (Brave − 50) ÷ 25 + (Tactical − 50) ÷ 50. Pills: Wants to
    Lead 4, Instigator 1.5, Cruel 1, Brawler, Relentless, Skeptic, Vengeful, Redeem-Seeker 0.5; Wildcard, Fragile −0.5;
    Mercenary −1; Enabler, Lazy −1.5; People-Pleaser, Wallflower, Chicken −2.
  - The party: the roles the GM gave its members in earlier fights; else a leader only if exactly one member Wants to
    Lead. Never a boss.
- **Off**: world setting Leadership (`leadership`, per battle in the planner), or a tab set to No leaders.
- Heading a group adds 0.15 to its talk affinity (at most 1), if it talks at all.

Code: `engine/battle-state.js` `command`, `canCommand` (`CANT_COMMAND`), `chainOf`, `headsUp`; `foundry/battle.js`
`commandChains`; `foundry/command-pick.js` `rankForCommand`, `bossiness` (`BOSSY`), `autoLieutenants`, `partyRoles`.

### What a leader lends

Search: leadership bonus, bravery bonus, tactical floor, attack bonus, AC bonus, Leadership fudge

While it commands, its group gets its leadership numbers: the system helper's, from its leader ranking, or the
defaults below for a commander the system doesn't rank. The planner's Leadership fudge adjusts them per side.

| Number | Range | Applies to | Unranked commander |
|---|---|---|---|
| Brave | −50 to 50 | added to followers' Brave | +10 |
| Tactical floor | 0 to 100 | followers' Tactical is at least this | 40 |
| Attack | −5 to 5 | followers' attack rolls | 0 |
| AC | −5 to 5 | the AC of everyone in the group, the commander too | 0 |

Its fall: +25 morale stress (a boss +35), about half if a lieutenant steps up; with nobody able to lead, its group is 2
easier to talk round.

Code: `engine/battle-state.js` `leadershipOf`, `liveTrait`, `attackRoll`, `currentAc`; `foundry/battle.js`
`PICKED_BONUS`.

### Following the leader

Search: follow, follows the leader, Leader's influence, leaderInfluence, Boss's influence, bossInfluence, LEADER_SWAY, contrarian, takes its lead

How much a commander's wishes sway its followers.

The commander's top wish: the strongest of its last 5 desires that the follower can act on (healing, talking, a buff or
an attack, as the kind needs).

1. **Steady pull**, every turn: +0.15 × loyalty × ear × boss × the wish's level (social layer). Leader's influence
   doesn't scale it.
2. **Following outright**: each turn, chance = min(95%, raw), raw = 0.5 × (Leader's influence ÷ 50) × loyalty × ear ×
   boss. Following, it wants that wish at least adopt × its level, adopt = min(1, 0.6 + 0.4 × raw), and its playstyle
   leans min(0.6, 0.6 × raw) of the way toward the commander's for the turn (desire points and behaviors blended).

- loyalty = clamp(Loyal ÷ 60, 0, 1.6). boss = Boss's influence (`bossInfluence`, 1.25 to 3, default 2) under a boss,
  else 1. ear = its playstyles' leader multiplier: People-Pleaser 2, Enabler 1.3, Skeptic 0.5, Wants to Lead 0.4,
  Wildcard 0.3.
- Leader's influence (`leaderInfluence`, 0 to 100 in steps of 5, default 50): 0, nobody follows outright; 100, twice as
  readily.
- No following while scheming. A contrarian (Instigator or Wildcard, decided once a fight at 0.5 × place weight) never
  follows or grants its commander's requests; it pulls −0.15 × the wish's level instead.

| Follower | Follows | Adopts at least | Leans | Steady pull |
|---|---|---|---|---|
| Loyal 60, under a leader | 50% | 80% | 30% | 15% |
| Loyal 80, under a leader | 67% | 87% | 40% | 20% |
| Loyal 60, under a boss | 95% | 100% | 60% | 30% |
| Loyal 60, People-Pleaser | 95% | 100% | 60% | 30% |
| Loyal 60, Wants to Lead | 20% | 68% | 12% | 6% |

Example: a boss wants the wizard at 70; a Loyal 60 goblin's own reckoning puts the wizard at 35. The steady pull adds
21 (56). Following (95% of turns), it wants the wizard at 70.

Code: `engine/behavior/desire.js` `followChance`, `follow`, `listen`, `blendStyle`, `isContrarian` (`LEADER_SWAY` 0.15,
`FOLLOW`).

### Scheming

Search: scheming, schemes, ambition, traitor, treacherous, Wants to Lead, brooding, turn traitor, traitorLuck

One with Wants to Lead who doesn't command its group may scheme against whoever does.

- Each turn, chance = 0.25 × its place weight (× 1.8 with roleplay; at most 10% staying true). It schemes only with a
  treacherous pill (Cruel, Wildcard, Mercenary, Instigator); otherwise it lets the thought go.
- Scheming, this turn: it won't heal, bolster, guard, free, follow or answer anyone in its chain of command. Talking it
  round is 4 easier; its chance to change sides gets +0.5 (at most 70%) and the switch luck +20. A PC changes sides only
  on a d100 under Luck check: a player character turning traitor (`traitorLuck`, default 9).
- Changing sides drops Wants to Lead for the rest of the fight.

Code: `engine/behavior/desire.js` `scheme` (`TREACHEROUS`); `engine/battle-state.js` `refusesToHelp`, `dropAmbition`;
`engine/behavior/talk.js` `outcomeFor`, `resolveTalk`.

### Party's sway

Search: party, party votes, Party tab, majority, Party's sway (%), partySway

The party's votes (the survey's Party tab, majority rules) sway every character on the friendly side. Party's sway (%)
(`partySway`, 1 to 20, default 3):

- **Answers**: in that share of fights, a question a character left on "Let this character decide" takes the party's
  answer (talking, resources, when to retreat, foes who fall).
- **Desires**: each wish adds that many points each turn. Who to pursue: hurt the nearest, weakest, most dangerous,
  casters and healers, or their leader. Foes who fall: hurt each unstable downed foe (finish), or tie up, or rob. Care:
  heal friends down or under 75% (if it can heal), or protect the weakest-looking friend; either way, free held friends
  at half. Each for themselves: that many less for healing, protecting, bolstering or freeing others.
- **Spare them**: the character's avoid-killing wish is at least the sway.

Code: `engine/behavior/desire.js` `partyWants` (`PARTY_POINTS` 100); `engine/playstyles.js` `sampleRunTactics`;
`foundry/party.js` `PARTY_TACTICS`, `partyWishes`; `foundry/battle.js` `applyPartyWishes`.

### Playstyles: how pills combine

Search: playstyles, pills, roleplay, stay true, Stay mostly true to my calculated tactical level, Roleplaying is very important to me, both boxes, pill order

Up to four, in order of importance; each counts by its place: 1, 0.75, 0.55, 0.4.

| Part | Combined | Roleplay | Staying true |
|---|---|---|---|
| Trait shifts | Σ shift × place, ±60 at most | × 2 | ±10 at most |
| Desire points | Σ points × place | × 1.5 | × 0.5 |
| Multipliers | Π (1 + (m − 1) × place) | (m − 1) × 1.5 | (m − 1) × 0.5 |
| Behaviors | the highest pill's chance × place, at most 1 | × 1.8 | at most 10% each (initiative: +1) |
| Answers left to "Let this character decide" | each pill votes with its place; the heaviest is the suggestion; where pills disagree, each fight draws one by weight | | any answer but the calculated one only in 10% of fights |

Both boxes: roleplay sets desire points and multipliers (× 1.5) and doubles trait shifts; staying true still caps traits,
behaviors and answers. Trait shifts land on the trait's fudge, before the side blend.

Example: Martyr then Tank: Brave +20 + 20 × 0.75 = +35; protect points 25 + 20 × 0.75 = 40; retaliate
1 + (0.7 − 1) × 0.75 = 0.775.

Code: `engine/playstyles.js` `combinePlaystyles`, `combineDesires`, `answerChances`, `sampleRunTactics`
(`ORDER_WEIGHTS`, `STAY_TRUE_CAP` 0.1).

### Playstyle numbers

Search: Chicken, Cruel, Moralist, People-Pleaser, Fragile, Impatient, Brawler, Skeptic, Speed-Runner, Wants to Lead, Instigator, Peacekeeper, Diplomat, Wallflower, Martyr, Tank, Mercenary, Enabler, Redeem-Seeker, Lore-Collector, Puzzle-Maniac, Wildcard, Thief, Vengeful, Relentless, Lazy, Un-Mundane

Each pill at first place. Desire points are added to the matching desires each turn (Pulls from others); a multiplier
of 1 changes nothing.

| Playstyle | Traits | Desire points | Multipliers | Behaviors (base chance) |
|---|---|---|---|---|
| Chicken | Brave −30, Selfish +10 | avoid dangerous +35, rid +15 | retaliate 0.5, frustration 1.5 | lowProfile 0.3, flighty 1, trapWary 0.5, tauntProof 0.35 |
| Cruel | Selfish +20, Loyal −5 | hurt weakest +15, hurt downed +25, rob +10 | retaliate 1.3 | finishDowned 0.4, hinders 0.25, shoves 0.4 |
| Moralist | Selfish −15, Loyal +10 | hurt downed −100, heal +10, protect +10, aid +5, bind +15, rob −30, free +15 | | spareDowned 1, helps 1 |
| People-Pleaser | Selfish −20, Loyal +15 | aid +10, talk +10 | leader 2 | followFocus 0.5, helps 1 |
| Fragile | | avoid attacker +30, mend +25, rid +15 | frustration 1.3 | lowProfile 0.2, flighty 0.6 |
| Impatient | Tactical −10 | hurt nearest +15, bind −15, rob −10, rid +10 | frustration 2, doorPatience 0.5 | rush 0.5 |
| Brawler | Brave +15, Tactical −5 | hurt nearest +20, aid −10, talk −40, bind −10, rid −10 | retaliate 1.5 | meleeBias 0.3, taunt 0.4, shoves 0.5 |
| Skeptic | Tactical +10 | talk −15 | frustration 0.8, leader 0.5 | wary 1, trapWary 0.75, tauntProof 0.6 |
| Speed-Runner | Tactical +5, Brave +5 | hurt weakest +20, bind −15, rob −15 | frustration 1.3 | rush 0.4 |
| Wants to Lead | Brave +10, Loyal +10, Tactical +5 | hurt dangerous +10, protect +10, aid +10, talk +5, bind +10, free +15 | leader 0.4 | hinders 0.15, ambition 0.25, rally 0.25 |
| Instigator | Brave +10, Selfish +5 | hurt dangerous +15, hurt leader +15 | retaliate 1.2; contrarian 0.5 | drawAggro 0.35, initiative +2, hinders 1, taunt 0.75, shoves 0.3 |
| Peacekeeper | Selfish −10, Brave +5 | hurt downed −100, protect +10, talk +20, bind +20, rob −20, free +10 | | peacekeeping 1, spareDowned 1, tauntProof 0.5 |
| Diplomat | Selfish −10 | hurt downed −50, talk +30, bind +15 | | parleyFirst 0.6, spareDowned 0.5, tauntProof 0.35 |
| Wallflower | Brave −10 | hurt nearest −10, avoid nearest +15 | | lowProfile 0.45, hinders 0.25, flighty 0.3, trapWary 0.35, tauntProof 0.3 |
| Martyr | Brave +20, Selfish −30, Loyal +20 | avoid dangerous −50, avoid attacker −50, heal +15, protect +25, aid +5, rob −10, free +25, rid −25 | avenge 2 | drawAggro 0.3, helps 1, rally 0.2, taunt 0.55 |
| Tank | Brave +20, Selfish −20, Loyal +10 | hurt dangerous +10, avoid dangerous −40, avoid attacker −40, protect +20, free +10, rid −15 | retaliate 0.7, frustration 0.7 | taunt 1, drawAggro 0.35, helps 1 |
| Mercenary | Selfish +30, Loyal −20 | hurt weakest +10, aid −10, bind +10, rob +20 | avenge 0.3, frustration 1.3 | flighty 0.6 |
| Enabler | Selfish −15, Loyal +10 | heal +25, protect +15, aid +20, free +15 | leader 1.3 | followFocus 0.3, helps 1 |
| Redeem-Seeker | Brave +15, Selfish −20 | hurt dangerous +20, protect +10, bind +10, rob −15, free +10 | frustration 0.6 | drawAggro 0.15, helps 1, taunt 0.3 |
| Lore-Collector | Tactical +5 | hurt unstudied +10, bind +10 | frustration 0.8 | study 0.5, observe 0.85, share 0.9, trapWary 0.6 |
| Puzzle-Maniac | Tactical +15 | hurt weakness +20, hurt casters +10 | frustration 0.7, doorPatience 2 | exploitWeakness 0.5, hinders 0.3, trapWary 0.9, tauntProof 0.4 |
| Wildcard | | whim +25 | leader 0.3; contrarian 0.5 | random 0.25 |
| Thief | Selfish +10 | hurt weakest +5, rob +30 | doorPatience 1.5 | steal 1, trapWary 1 |
| Vengeful | Brave +5, Selfish +5 | rid −5 | retaliate 2, avenge 2.5, cool 0 | |
| Relentless | Brave +10 | hurt current +15, rid −15 | frustration 0.4, doorPatience 1.5 | wary 0.5, tauntProof 0.75 |
| Lazy | Tactical −5, Brave −5 | hurt nearest +15, hurt far −20, heal −10, protect −10, aid −10, bind −15, free −10, rid −10 | cool 1.5, frustration 1.6, doorPatience 0.4 | flighty 0.4, tauntProof 0.25, slacks 0.15 |
| Un-Mundane | | hurt weakness +10 | | |

Behaviors in this area: **flighty** (a fleeing commander panics its group × (1 + flighty) and takes more along; a boss
runs × (1 + 3 × flighty)); **rally** (Rallying); **ambition** (Scheming); **contrarian** (Following the leader);
**helps** (+0.25 willingness); **followFocus** (a chance to go for the foe most of its side is on); **slacks** (with no
foe within 5 ft and HP at half or more, a chance each turn to do nothing). Others: **lowProfile** (an attacker picks
someone else nearby; Stealth for initiative where the system rolls it), **drawAggro** (draws attacks aimed near it),
**rush** (skips setting up, raising a shield or getting clear safely), **meleeBias**, **exploitWeakness** (those
actions worth × (1 + chance)), **hinders** (control actions × (1 + 1.5 × chance)), **shoves**, **random** (a random
target), **finishDowned**, **spareDowned**, **parleyFirst**, **peacekeeping**, **study**, **observe**, **share**,
**steal**, **wary**, **trapWary**, **taunt**, **tauntProof** (`engine/behavior/targeting.js`, `talk.js`, `traps.js`,
`goad.js`, `effects.js`, `engine/simulator.js`).

Code: `engine/playstyles.js` `PLAYSTYLES`.

### Tactics answers: wishes and "Let this character decide"

Search: tactics answers, survey, wishes, Let this character decide, Always talk unless I am currently being hurt, Spare them: I avoid killing, Fight to the end, avoidKilling, Avoids killing: how often it holds back (%), calculated tactics, suggested answers

Three answers carry a wish, 0 to 1, only when actually given ("Let this character decide" carries none):

| Question | Wish by answer | What it does |
|---|---|---|
| Talking instead of fighting | Always talk 1, Talk first 0.66, Talk when it could work 0.33, weapons 0 | that chance each turn to give the whole turn to talking (not while being hurt, nor staying true) |
| Foes who fall | Spare them 1, Tie them up 0.66, Leave them be 0.33, Rob them 0.33, Finish them 0 | holds back from a kill (knocks out instead, leaves the fallen be, spares them after) with chance Avoids killing (%) (`avoidKilling`, 50 to 90, default 90) × max(wish, this fight's answer: Spare 1, Tie 0.66); decided once a round |
| When to retreat | Fight to the end 1, When the battle turns against us 0.5, When I'm badly hurt 0 | Standing its ground |

Example, at the defaults: Spare them holds back 90% of the time, Tie them up 59%, Leave them be or Rob them 30%.

"Let this character decide" works answers out from the sheet's Tactical (T), Brave (B), Selfish (S) and Loyal (L),
before fudges, playstyle shifts and the side blend. A system helper's own calculated answers, where it stored them,
replace these; the playstyles' suggestions override both. First match wins:

| Question | Calculated answer |
|---|---|
| Fighting style | Its best attack a spell: caster. Ranged: ranged. Sneak-attack damage: skirmisher. A shield with L 40+, B 35+, S under 65: protector. B under 35: ranged if it has a ranged attack, else skirmisher. Else front line |
| Who to pursue first | Instinctive or Feral: closest. Protector style, or L 90+ and S 15 or less: whoever attacks my allies. Competent, or S 70+: the weakest. Mastermind: spellcasters and healers. Else: the most dangerous |
| Foes who fall | Instinctive or Feral: leave them be. S 80+ and L under 40: finish. S 70+: rob. S 15 or less and L 70+: spare. T 75+ and S under 40: tie up. Else leave them be |
| When to retreat | B 70+: Fight to the end. S under 70 and (L 70+ and B 50+, or T 70+): when the battle turns. Else when badly hurt |
| When an ally is dying | Rescue: a healer with L 50+, S under 65, B 35+; anyone else L 75+ and B 60+. B under 35: get out. S 70+ and L under 50: look after myself. Else keep fighting |
| Healing others (healers) | L 90+ and S 10 or less: at all costs. L 75+ and S 30 or less: keep everyone topped up. S 60+ or L under 40: only when dying. Else heal those hurting |
| After I'm revived | B under 40, or S 70+ and B under 60: retreat. Has healing, T 60+ and B under 80: heal myself first. Else rejoin |
| Drinking my own potions | B under 40 or S 70+: as soon as hurt. B 80+ and S under 40: below a quarter. Else below half |
| Spell slots, focus and limited abilities | B 70+ and T under 50: spend freely. T 70+ or S 65+: save them. Else when clearly better |
| Consumables | S 70+: don't like to. S 55+ or T 75+: only when it counts. B 75+ and T under 50, or L 85+ and S 20 or less: freely. Else when they're the right tool |
| Talking instead of fighting | talk affinity, + (40 − B) ÷ 100 if B under 40: 0.75+ talk first; 0.3+ when it could work; else weapons |
| Shield or defending (with a shield) | B under 45, or a protector with L 75+ and T 60+: every turn. B 80+ and T under 50: don't bother. Else with spare actions |
| Others nearby | B 70+ and (S 55+ or T under 45): hunt them down. T 60+, L 60+, B under 70: run for help. Else stay |

For player characters, the world's Default PC healing (`pcHealAggro`) and Default PC response to a dying ally
(`pcAllyDying`) replace the calculated answer unless set to let each character decide.

Code: `engine/tactics.js` `TACTIC_WISHES`, `suggestTactics`, `suggestTalk`; `engine/battle-state.js` `holdsBack`
(`TAKING_ALIVE`); `engine/behavior/talk.js` `talkActionsThisTurn`; `foundry/battle.js` `applyCharacterTactics`.

## Words and sides

Talking, standoffs, bargains, those who take no side, taunts, theft, traps, reluctance, mercy and the fallen. Every
setting named here is a world default (Configure Settings) that the Battle Planner can override per battle, except
Neutral friend groups: reach. Traits (Tactical, Brave, Selfish, Loyal) are 0 to 100. A pill's share of a playstyle
behavior is its value × its place (1, 0.75, 0.55, 0.4 for the first to fourth pick), × 1.8 with "roleplaying is very
important to me", at most 1 (at most 0.1 when staying mostly true).

### Luck rolls at a glance

Search: luck, hidden d100, luck check, PC luck, secret roll, switch luck, traitor luck, concede luck, theft luck, execute luck, trap luck, taunt luck, ignore troubles

Each is a d100 (1 to 100), and passes at or under its number.

| Roll | Setting (menu name, key) | Default | Range | Goes through on | At the default |
|---|---|---|---|---|---|
| An enemy changes sides | Luck: an enemy changing sides (`switchLuck`) | 69 | 0–100 | at or under it (+20 if scheming, max 100); 100: always | 69% |
| A PC turns traitor | Luck check: a player character turning traitor (`traitorLuck`) | 9 | 0–100 | at or under it | 9% |
| A PC loses an item it was talked out of | PC luck: handing over an item (`concedeLuck`) | 39 | 0–100 | at or under it | 39% |
| A thief takes from a PC | PC luck: being robbed (`theftLuck`) | 29 | 0–100 | at or under it | 29% |
| A creature finishes off a PC at 0 HP | PC luck: being finished off (`executeLuck`) | 39 | 0–100 | at or under it | 39% |
| A trap avoider spots a hazard | Trap avoiders: spotting a trap (%) (`trapLuck`) | 59 | 0–100 | at or under it × watchfulness | Thief 59% |
| A playstyle's taunt takes hold | Playstyle taunts: taking hold (%) (`tauntLuck`) | 42 | 0–100 | at or under it × taunt share | Tank 42% |
| A selfless creature bears a hold or hurt | Selfless creatures bear what holds or hurts them (%) (`ignoreTroubles`) | 29 | 0–100 | at or under it × (100 − Selfish)% × (100 − Tactical)% | 29% at Selfish 0, Tactical 0 |

Code: `constants.js` (CONCEDE_LUCK, THEFT_LUCK, EXECUTE_LUCK, TRAP_LUCK, IGNORE_TROUBLES, TAUNT_LUCK, SWITCH_LUCK,
TRAITOR_LUCK); each roll is under its own topic below.

### Who talks, and how often

Search: talk affinity, talker, talking, Talking (`talking`), words, quip, Talking instead of fighting, Always talk unless I am currently being hurt, Talk first, Talk when it could work, Let my weapons do the talking

Decides how readily a creature spends actions on words outside a standoff.

The **Talking** setting (`talking`, on) switches all of it. Off, nobody talks and no standoff opens (except "Only an
argument").

**Talk affinity**, 0 to 1, set once per fight:

- 0 with no language, mindless, or no pitch skill.
- a = 0.35 + 0.08 × (best pitch modifier − typical skill for its level). Typical skill: the system's; core
  fallback ⌈level ÷ 2⌉ + 2.
- Diplomat +0.45, Peacekeeper +0.3, People-Pleaser +0.2, Instigator or Cruel +0.1; Brawler, Impatient or Speed-Runner
  −0.25 (once); Tactical under 20 −0.3.
- Answer Talk first: at least 0.8. (Here and below, Talk first includes Always.) Roleplay with Diplomat or
  People-Pleaser: +0.15.
- Talk wish w, from a stated Talking answer: Always 1, Talk first 0.66, Talk when it could work 0.33, Let my weapons
  do the talking 0 (Let this character decide: none). a = max(a + 0.4 × w, 0.85 × w); staying true, a + 0.1 × w.
- Clamped 0–1. Heading its group (boss or leader): +0.15, at most 1.

**Low battle-worth**: its best typical offense is under half the field's median.

**Each turn** (talk.js talkActionsThisTurn), in order:

1. No talk if the answer is Let my weapons do the talking, affinity is 0 (unless Talk first), or no pitch is worth
   making.
2. Not staying true and not hurt since its last turn: with chance w it spends the whole turn talking (Always: every
   turn; Talk first: 66%; Talk when it could work: 33%).
3. A *talker* (affinity ≥ 0.75, Talk first, a Diplomat, or a whole-turn talker) may make up to 2 pitches when it is
   low battle-worth or its pitch has P ≥ 0.5; anyone else 1.
4. A talker's first turn, or Talk first with P ≥ 0.2: up to that cap.
5. Otherwise one pitch with chance min(0.95, affinity × (0.2 + P) × 1.5 if low battle-worth × talk damping); a
   low battle-worth creature with P ≥ 0.35 makes up to the cap.

P is the pitch's chance of success. Talk damping is 1 ÷ the Magic and specialties weight (A little more often 1.5,
Much more often 3, Whenever it can 10) while it still has a specialty that doesn't help it talk; else 1. Each pitch
costs the system's talk cost, else one basic action.

Example: affinity 0.5, P = 0.4: 0.5 × 0.6 = a 30% chance of one pitch this turn.

Code: `engine/behavior/talk.js` `talkAffinity`, `talkActionsThisTurn`; `engine/battle-state.js` `prepareBattle`,
`headsUp`; `engine/behavior/specialty.js` `talkDamping`.

### Choosing a pitch

Search: pitch, persuade, intimidate, deceive, threaten, bluff, Diplomacy, Persuasion, Intimidation, Deception, Compel, Insight, Will DC, best pitch, who to talk to, Ignore languages (`ignoreLanguages`)

Decides whom a creature talks to and which of the three pitches it makes.

| System | Persuade | Intimidate | Deceive | Resisted by |
|---|---|---|---|---|
| PF2e | Diplomacy | Intimidation | Deception | Will DC (Deceive: Perception DC) |
| 5e | Persuasion | Intimidation | Deception | passive Insight |
| DCC | Personality | best of Personality, Strength | Personality | 10 + Will (Deceive: 10 + best of Will, Int) |
| Daggerheart | Presence (adversaries: best Experience, +2 if Social) | same | same | PCs 12 + max(0, Presence); adversaries Difficulty |
| Ironsworn | Compel +heart | Compel +iron | Compel +shadow | PCs 12; foes 12 + 2 × rank (they Compel at rank − 1) |

Without a resistance, the DC is the system's typical DC for the level (core fallback 10 + level).

**Which pitch**: the one with the highest P = P(success) + P(critical success), less half its P(critical failure) for
a bluff. The modifier is the skill + the system's check modifiers + 1 once a Lore-Collector has sized the target up
(or its boost, while that holds). Only threats work on a PC with nothing to hand over. No threats when winning
someone over or asking a fighter to let a quarrel be, and none from a Peacekeeper (share ≥ 0.5).

**Who can be talked to**: standing, seen (not an unrevealed ambusher), not mindless, with a language it shares with
the talker (Ignore languages, `ignoreLanguages`, off: any language on both sides will do), and not offended by this
talker. A PC listens unless its answer is Let my weapons do the talking. A pitch is skipped if P ≤ 0.05 − 0.04 × w (5%
for no wish, 1% for Always).

**Score** = P × value ÷ steps still needed, × 1.25 for the one its "Who to pursue first" answer picks. The best score
wins. c = 2.5 for a boss commanding its group, 1.5 for a commanding leader, else 0; h = 1 + HP ÷ max HP.

| Aim | Value |
|---|---|
| Talk it out of the fight, or into leaving | (1 + c) × h |
| Win over someone taking no side | 0.8 × h (× 0.5 if low battle-worth) |
| Send away someone taking no side | 0.9 × h |
| Calm someone confronting the talker's side | 1.2 × h |
| Talk a fighter into letting a quarrel be | 1.3 × h |
| Have the talker's quarrel made good (amends) | 1.5 |
| Squeeze for money | 1.2 |
| Haggle | 1.6 + c |
| Press for what it expects | 2 + c |

A boss is never talked into leaving; in a standoff, it is talked down only when someone on the talker's side would pay
it.

Code: `engine/behavior/talk.js` `bestPitch`, `choosePitch`, `swayable`, `aimOf`, `pursued`;
`engine/behavior/standoff.js` `shareLanguage`.

### Pitch DC

Search: talk DC, persuasion DC, resist, grudge, rebuffed, harder to talk round, easier to persuade, outnumbered, Skeptic, Peacekeeper

The DC is the base above plus every line that applies.

| Circumstance | DC |
|---|---|
| The talker has hurt it | +5 + round(10 × min(1, harm ÷ its max HP)) |
| Each rebuff from this talker (failure 1, critical failure 2) | +3 each |
| Each of its allies this talker has hurt | +1 each |
| Below 25% HP / below 50% | −4 / −2 |
| Wavering | −2 |
| Its leaders all down, or none able to lead | −2 |
| Loyalty and greed | + round((Loyal − 50) ÷ 25) − round((Selfish − 50) ÷ 25) |
| Scheming against its own leaders | −4 |
| The talker is a Peacekeeper | − round(2 × its share) |
| It's a Skeptic and the talker isn't of its group | + round(4 × its share) |
| Haggling or pressing | + holding out (see Haggling and pressing) |
| Pressed for safe passage, or to leave | + round((Brave − 50) ÷ 20) |
| Being won over | + round(betrayed wish ÷ 10) − round(fulfilled wish ÷ 10) |
| Being sent away | + round(strongest care for someone still standing ÷ 10) + round((Brave − 50) ÷ 20) |
| Outnumbered (more foes standing than friends) | −3 for threats, −2 otherwise |
| Threats | + round((Brave − 50) ÷ 20) |
| Stands aside (takes no side, or came as a Neutral token) | −4 to persuade, −2 otherwise |

Example: DC 18, Loyal 70, Selfish 50, Brave 55, at 40% HP, already hit by the talker for 30% of its max HP,
outnumbered. Shared: +8 (harm) − 2 (HP) + 1 (Loyal) = +7. Persuade 18 + 7 − 2 = 23; threaten 18 + 7 − 3 + 0 = 22.

Code: `engine/behavior/talk.js` `talkDC`, `talkDCShared`.

### The persuasion track

Search: steps to convince, sway, persuasion track, progress, gullible, convinced, critical failure, offended, won't listen, insulted, strain

Decides how many successful pitches it takes.

| Pitch result | Track | Also |
|---|---|---|
| Critical success | +2 | |
| Success | +1 | |
| Failure | 0 | 1 rebuff (+3 DC from this talker) |
| Critical failure | −1 (not below 0) | 2 rebuffs; it never listens to this talker again; someone taking no side takes offense |

The track belongs to the talker's side: every talker on that side fills the same track on that creature. Rebuffs and
offense belong to the one talker. Only a success that brings the track to the steps convinces it.

**Steps**: the system's own number if it gives one (Ironsworn, by rank 1–5: 2, 3, 6, 12, 24). Otherwise 1 if gullible
or its resolve is −5 or less (resolve: its will against a typical creature of its level, from the system). Otherwise
3, then:

| Condition | Steps |
|---|---|
| Resolve ≥ 3 / ≤ −3 | +1 / −1 |
| Loyal ≥ 70; Brave ≥ 80; fearless | +1 each |
| Selfish ≥ 70; stands aside | −1 each |
| Player character | +2 |
| Scheming against its leaders | −2 |
| Skeptic (share ≥ 0.5) and the talker isn't of its group | +1 |
| Asked to let a quarrel be, or haggled with | −1 |
| Won over: joining fulfils a wish ≥ 40 / betrays one ≥ 40 / ≥ 70 | −1 / +1 / +2 |
| Below half HP, else outnumbered | −1 |

Clamped to 2–6 (a PC 2–8). Example: a default hostile (Loyal 50, Brave 55, Selfish 50) takes 3, or 2 once
outnumbered; a PC at the usual traits (Loyal 80) takes 6.

A system may also drain a pool on a lost exchange (talker on a failed pitch, target on a success: 1, or 2 on a
critical; worn down when it runs dry) or add its own price or gain (Ironsworn's Compel).

Code: `engine/behavior/talk.js` `stepsToConvince`, `resolveTalk`; `engine/behavior/strain.js` `strain`.

### What a convinced foe does

Search: sway outcome, talked down, surrender, surrendered, flee, fled, stand down, stood down, gave something up, conceded, back off, yields, switched sides, stood aside

Decides how an enemy talked out of the fight leaves it. Checked in order:

1. **Peacekeeper talker**: with chance = its peacekeeping share, a truce: it stands down (not a boss or a PC).
2. **Boss**: in a standoff it is paid to go (see Paying off a boss); in a fight it surrenders below 25% HP, else gives
   something up and fights on.
3. **Player character**: scheming against its leader, it changes sides (traitor luck). With nothing to hand over it
   runs. Threatened, it runs with chance clamp(0.5 − (Brave − 50) ÷ 100, 0.1, 0.8), unless it stands its ground.
   Otherwise it gives something up.
4. **Anyone else**:
   - changes sides with chance 0.6 if it stands aside, else clamp(0.03 + (Selfish − 50) ÷ 500 + (50 − Loyal) ÷ 500,
     0, 0.12); scheming, +0.5 and up to 0.7. Then the switch luck.
   - gives something up with chance clamp(0.12 + 0.15 if threatened + 0.10 if below half HP − (Selfish − 50) ÷ 400,
     0.03, 0.45);
   - in a standoff, persuaded or bluffed: stands down;
   - above half HP and Selfish ≥ 55: runs;
   - below half HP and Brave < 40: runs half the time;
   - otherwise surrenders.

One that stands its ground (Doesn't like to flee, `standGround`: see Morale) doesn't run: it surrenders instead (a PC
gives something up).

Example: a typical hostile (Selfish 50, Loyal 50, unhurt) threatened mid-fight: changes sides 3% × 69% ≈ 2%; else gives
something up 27%; else surrenders.

Other aims: won over, it joins the talker's side for good; sent away or talked into leaving, it leaves; calmed, the
quarrel is over; asked to let a quarrel be, it does (until hurt again); squeezed, it pays; made to make amends, it
hands something over if it can, else apologizes.

- **In a standoff**, a foe that gives something up or runs settles the whole encounter for the talker's side:
  everyone walks away.
- **Mid-fight, giving something up**: it stays in, its track resets, it won't listen to that talker again, and it
  wants to keep away from the taker (desire 50 + (50 − Brave) × 0.3) until the taker attacks it; then it wants to hit
  the taker (60 × its retaliation).
- **Running mid-fight**, it tries to take its group with it (Morale: retreats).
- **A convinced commander**: each follower in its group (not PCs) follows with chance clamp(0.4 + (100 − Brave) ÷ 250
  + 0.1 × the talker's side's progress on that follower, 0, 0.9). It stands down if the commander stood down, gave
  something up or stood aside; else it surrenders.

Code: `engine/behavior/talk.js` `outcomeFor`, `applyOutcome`, `concede`, `resolveTalk`.

### Switch luck: changing sides

Search: switch luck, switchLuck, Luck: an enemy changing sides, changing sides, turncoat, defect, stands aside, stood aside

Decides whether an enemy talked into changing sides goes through with it.

- d100 at or under switchLuck (default 69, range 0–100); +20 for one scheming against its own leaders, at most 100. 100:
  always; 0: never.
- Through with it, it stands aside: it takes no side, leaning toward its old side with strength clamp((Loyal − 30) ÷ 2,
  0, 35). From there anyone can win it over (no luck roll).
- Otherwise its outcome is drawn again without the change of sides.
- Charm, dominate and the like, and winning over those who take no side, ignore this roll.

Example, per convinced foe: Selfish 50, Loyal 50: 3% × 69% ≈ 2%. Selfish 80, Loyal 20: 12% × 69% ≈ 8%. Scheming: 70% ×
89% ≈ 62%. A Neutral token the GM put on a side: 60% × 69% ≈ 41%.

Code: `engine/behavior/talk.js` `resolveTalk`, `outcomeFor`; `engine/behavior/neutral.js` `standAside`.

### Traitor luck: a PC turning traitor

Search: traitor luck, traitorLuck, Luck check: a player character turning traitor, scheming, treacherous, Wants to Lead, betrayal

Decides whether a scheming PC talked down changes sides.

- Scheming: it has Wants to Lead and a treacherous pill (Cruel, Wildcard, Mercenary, Instigator), and doesn't command its
  group. Each turn it schemes with chance its ambition (0.25 as a first pick, × place, × 1.8 with roleplay).
- Talked down while scheming, it always tries to change sides: d100 at or under traitorLuck (default 9, range 0–100): 9%. 0:
  never.
- Failed, it does what any PC does (runs, or gives something up).

Code: `engine/behavior/talk.js` `outcomeFor`, `resolveTalk`; `engine/behavior/desire.js` `scheme`.

### Giving something up

Search: concede, concession, give something up, hand over, pay up, money, item, concede luck, concedeLuck, PC luck: handing over an item, lies and runs, reclaim, goods back

Decides what a creature hands over.

1. What the receiving side expects, if it has it; else what it offered (standoffs only; see Bargaining).
2. Else money: d10% of what it has left (at least 1).
3. Else a random item it carries but doesn't wield or wear. A PC loses it only on a d100 at or under concedeLuck
   (default 39, range 0–100); above, it keeps it.
4. Else (not a PC) something it wields.
5. Else ground on its own track (Ironsworn foes).
6. Else nothing: a creature (not a PC) swears it has nothing and runs (only an argument: it stands down).

Whatever a winner took goes back at the end if the taker ended the fight dead, down, surrendered, stood down, beaten or
tied up, or held by the owner's side. Ground given stays given.

Code: `engine/behavior/talk.js` `concession`, `concede`; `engine/behavior/bargain.js` `owed`, `luckFor`;
`engine/simulator.js` `reclaimGoods`.

### How an encounter opens

Search: opening, How encounters open (`opening`), standoff, talk first, Talk if they'd rather, Always talk first, Straight to battle, Only an argument: no fighting, parley

Decides whether a fight starts as a standoff: nobody attacks or advances; talkers pitch, the rest hold.

| How encounters open (`opening`) | Standoff? |
|---|---|
| Talk if they'd rather (`auto`, default) | Yes when every side's voice would rather talk, or at least 75% of everyone present would. Never after an ambush (a surprise side), or with fewer than two sides present. |
| Always talk first (`talk`) | Yes, when Talking is on |
| Straight to battle (`fight`) | No |
| Only an argument: no fighting (`argument`) | Always (see Only an argument) |

- A side's voice: its commander if present, else a majority of its members (more than half).
- Present: standing and seen; those who take no side and hazards don't count.
- **Would rather talk**: can talk; answer Always or Talk first; or none of Let my weapons do the talking, and affinity ≥
  0.6 or a Diplomat.

On a standoff turn, a creature first states what it offers or expects (Bargaining); one who can't abide violence tries
to calm any quarrel; a Lore-Collector may watch. Otherwise it pitches: the whole turn with chance w (not staying
true); 2 if it would rather talk; 1 if its affinity is above 0; else none. Hazards wait out a standoff, and legendary
actions wait too.

Code: `engine/behavior/standoff.js` `opensWithTalk`, `prefersTalk`, `standoffPitches`; `engine/simulator.js`
`standoffTurn`.

### Impatience: what breaks a standoff

Search: impatience, impatient, standoff breaks, break the standoff, insulted, annoyed, unmet, beast, last word, charismatic leader, blood, patience

Decides when someone in a standoff loses patience and attacks. Checked at the start of each turn of anyone on a side:

1. **Insulted**: a fresh critical failure aimed at it by the other side: 70% to break it. One by someone taking no
   side: 70% (× 0.75 in an argument) it starts a quarrel with that one instead, and may blame the side it seems with.
2. **Annoyed**: it blamed the other side for harm or an insult from someone leaning their way: it breaks it.
3. **Impatience**: a roll with chance p.

p starts at 0.05, or 0.35 if it can't follow the talk: it can't talk (no language, mindless, unable to speak), or it
shares no language with anyone present on another side who can talk (with languages set aside, any language will
do). Then:

| Factor | × or + |
|---|---|
| Would rather talk, and follows the talk | × 0.3 |
| Let my weapons do the talking | × 4 |
| Brave | × (1 + (Brave − 50) ÷ 100) |
| Selfish | × (1 + (Selfish − 50) ÷ 150) |
| Feral (Tactical under 20) | × 2 |
| Each pill, regardless of place | Impatient × 2.5, Cruel × 2, Instigator × 2, Brawler × 1.8, Speed-Runner × 1.5, Moralist × 0.6, Chicken × 0.5, People-Pleaser × 0.5, Diplomat × 0.3, Peacekeeper × 0.3 |
| A Peacekeeper present (strongest share s) | × (1 − 0.5 × s) |
| Waiting on what it expects | × (1 + 0.25 × min(4, turns unmet)) |
| Each round of talk after the first (a truce: after the round it began) | + 0.03 |
| Rebuffs it has suffered | + 0.04 each |
| Blows in a quarrel beside the standoff | + 0.04 each, at most + 0.2 |
| Tactical 60+ on a side losing the talk / not losing | × 1.5 / × 0.25 |
| Not losing: half-persuaded | × max(0.2, 1 − 0.25 × its highest track) |
| Its commander would rather talk | × 0.2 (boss) / × 0.4 (leader) |
| A companion whose master would rather talk | × 0.3 |

Capped at 0.85. A side is losing the talk when the other sides' progress on its members exceeds its own on theirs by
more than 1. Breaking it after waiting on an expectation reads "unmet"; a creature that can't follow the talk, "beast".

Example: a default hostile (Brave 55, Selfish 50, Tactical 45) in round 3 of talk begun in round 1, rebuffed once,
its leader keen to talk: 0.05 × 1.05 = 0.0525, + 0.06 + 0.04 = 0.1525, × 0.4 ≈ 6%.

- **Last word**: before it breaks, each side's charismatic leader (not a PC, able to talk, best pitch ≥ 2 over typical
  skill) may get one more turn of pitches at the PCs, once per side, with chance min(0.85, 0.35 + 0.1 × that edge).
- **Blood**: any blow between the standoff's sides ends it at once.

Code: `engine/behavior/standoff.js` `impatience`, `breaksStandoff`, `losingTalk`, `charismaticLeader`;
`engine/simulator.js` `lastWord`, `endStandoff`, `bloodInStandoff`.

### Only an argument

Search: argument, Only an argument: no fighting, talks collapsed, collapse, no fighting

Decides what talk does when the GM rules out blows (How encounters open, `argument`).

- Always a standoff. Nobody runs or yields: talked round, a creature backs down (stands down) instead.
- Made to pay, it pays to end the argument and stays where it is (a deal); a boss paid off drops it.
- What would break a standoff (insults, impatience, blame) collapses the talks 75% of the time; a quarrel's insult
  starts one 0.7 × 0.75 ≈ 53% of the time. A blow, or a quarrel coming to blows, collapses them. Everyone goes their
  own way; deals already struck stand.

Code: `engine/behavior/standoff.js` `breaksStandoff` (ARGUMENT_BREAKS 0.75); `engine/simulator.js` `collapse`;
`engine/behavior/talk.js` `arguing`.

### Bargaining: offers and expectations

Search: bargain, offer, expect, Do you offer something to end this argument?, Do you expect something to end this argument?, promise, no harm, passage, leave, deal, money, motives

Decides deals struck without a roll in a standoff or argument. A deal ends the encounter.

- **Offer**: money, one of its items, or a promise (we won't harm you, we let you pass, we leave).
- **Expect**: at least so much money; something of a kind (category, material, rarity, minimum value; an unvalued item
  only if it says so); or a promise (don't harm us, let us pass, leave).

Left to "Let this character decide":

| | Rule |
|---|---|
| Offer | Brave < 40: to leave. Else Selfish ≤ 30 and Loyal ≥ 60: no harm. Else with money, Selfish ≤ 45 and Tactical ≥ 60: a tenth of its money (in its main coin). |
| Expect | Selfish ≥ 65 with money: 10 × level of its main coin (where that coin is worth 100+ of the smallest), else max(1, ⌈level ÷ 2⌉). Else Brave < 40: no harm. |

On its standoff turn, before talking:

1. **Asking**: anyone across who would meet it hands it over: its offer if that meets it; a promise if willing (no
   harm: Brave < 85 or willing to pay; passage: Brave < 60 or willing to pay; leaving: Brave < 40, or Selfish ≥ 60 and
   Brave < 60); money or the cheapest matching item, if willing to pay. A PC hands over goods only if it offered them.
2. **Offering**: someone across who expects what it offers takes it. If nobody there expects anything, their voice
   (commander, else the first) takes it with chance clamp(p, 0.03, 0.6): a promise 0.15 + (60 − Brave) ÷ 200 + 0.1
   for no harm; goods 0.15 + (Selfish − 50) ÷ 150 + 0.05 for money.
3. Unmet, it is irritated (+1 turn unmet), which feeds impatience.

**Willing to pay**: its first pill with a say decides: yes for Peacekeeper, Diplomat, People-Pleaser, Moralist,
Enabler, Chicken, Lazy, Fragile, Wallflower; no for Brawler, Instigator, Cruel, Vengeful, Relentless, Mercenary,
Thief, Redeem-Seeker. Without one: yes if it can't abide violence, else if Selfish < 50 and (it would rather talk, or
Brave < 60).

A no-harm promise ends it as a truce (nobody wins); any other deal is a win for the side that got what it wanted.

Code: `engine/behavior/bargain.js` `bargain`, `meets`, `answerFrom`, `takesUnasked`, `strike`;
`engine/behavior/talk.js` `willingToPay`; `foundry/motives.js` `suggestMotives`.

### Haggling and pressing

Search: haggle, haggled, press, pressed, come down, holds out, talked down the price

Decides what talk does about an unmet expectation. These are pitches like any other, with the DC + holding out.

- **Haggle** (it asked and nothing met it): one step fewer. A success that doesn't yet convince calms it (−1 turn
  unmet); a failure irritates it (+1). Convinced, it comes down: money halves (dropped below 2); a thing first drops
  material and rarity, then halves its minimum value, then accepts an unvalued thing, then is dropped; leave becomes
  passage, passage becomes no harm, no harm is dropped. Then the talker, or anyone on its side who would, meets the new
  price and the deal is struck.
- **Press** (the talker expects something the target could hand over): convinced, the target hands it over. A failure
  irritates the talker.
- A PC made to hand over one of its things it didn't offer keeps it unless the concede luck goes against it.

**Holding out** = round((Selfish − 50) ÷ 12.5 + the sum of pill weights × place): Mercenary +3, Thief +2, Cruel,
Vengeful, Relentless, Impatient +1 each; Peacekeeper −3, Diplomat −2, People-Pleaser −2, Moralist, Lazy, Chicken,
Enabler −1 each.

Example: a first-pick Mercenary with Selfish 70: round(1.6 + 3) = +5 to the DC.

Code: `engine/behavior/bargain.js` `holdsOut`, `comeDown`, `haggled`, `pressed`, `bargainAim`.

### Paying off a boss

Search: bribe, bribed, pay off the boss, boss leaves

Decides how a boss is talked down in a standoff.

- Who pays: whoever on the talker's side is willing to pay and has the most money.
- What: what the boss's side expects, if the payer has it; else what the payer offered; else 11–30% of its money (10 +
  d20 percent); else a carried item.
- The boss and its whole group (not PCs) stand down; the standoff is settled for the talker's side. In an argument,
  it's a deal and everyone stays.

Code: `engine/behavior/talk.js` `bribeFrom`, `bribe`, `applyOutcome`.

### Taking no side: neutral tokens and leans

Search: neutral, Neutral tokens (`neutralDefault`), takes no side, lean, leans toward the party, leans toward the enemy, nearest side, underdog, Left out of it, Fights everyone, bystander, third party

Decides how Neutral-disposition tokens take part.

| Neutral tokens (`neutralDefault`) | Effect |
|---|---|
| Takes no side (until crossed) (default) | On the field, nobody's foe, leaning nowhere |
| Leans toward the party / the enemy | Takes no side, wants that side safe |
| Leans toward the nearest side | The side nearest it at the start |
| Leans toward the underdog | Whichever side has the smallest share of its HP left, each round |
| Left out of it | Not in the fight |
| Fights everyone | A side of its own, hostile to all |

Neutral-side traits by default: Tactical 40, Brave 40, Selfish 60, Loyal 30.

**A lean** has strength 50. Its pull = strength × min(1.6, Loyal ÷ 60) × (1 − max(0, Selfish − 50) ÷ 100). A quarter
of the pull goes to keeping each member of the leaned-to side safe, as much comes off hurting them, and an eighth goes
to hurting their foes. The whole pull is its regard for that side (taking their harm personally, liking the thought
of joining). Its friend group: 15 × the same two factors to keeping each fellow safe.

Example: Loyal 30, Selfish 60: regard 50 × 0.5 × 0.9 = 22.5; it wants each member safe at 5.6.

A lean wears down by care × weight ÷ 2 each time the leaned-to side harms someone it cares about, and ends at once if
that side hurts it. Below 25 it no longer makes it look like one of that side.

Code: `engine/behavior/neutral.js` `leanPull`, `leanRegard`, `leanSide`, `refreshLeans`; `foundry/battle.js`
`resolveLeans`; `settings.js` DEFAULT_SIDE_TRAITS.

### Crossed: grievance, truce and turning on a side

Search: grievance, crossed, offended, turns on, truce, confront, robbed, insulted, amends, kin, call to arms

Decides when someone taking no side joins the fight, and against whom.

- **Hurt, robbed, or insulted** by a botched pitch: offended at once.
- **Watching**: each time it sees someone harm a creature it wants safe (or heal or bolster one it wants hurt at 40+),
  the doer's side gains grievance care × weight (weight about 0.5 for a scratch, 2 for a crippling blow, 3 for a fall;
  care: its regard or its wish for that creature). At 100 it is offended.
- **Offended**: a creature that would rather talk, who can make itself understood to the offender, confronts it first
  (a truce in mid-fight) unless the offense was an insult. Anyone else turns on that side and fights it.
- **During a truce**: each turn, with no one of that side left to talk to, the quarrel lapses; else with chance its
  impatience (counted from the truce's round) it turns on them; else it pitches at that side for amends. A fresh
  offense from that side turns it on them. Their side can calm it (a pitch).
- **Kin**: a group's commander taking no side takes up a group member's quarrel each turn with chance 0.2 + 0.5 ×
  Loyal ÷ 100; a commander's call to arms gets the same chance once.

Code: `engine/behavior/neutral.js` `crossed`, `offend`, `turnOn`, `truceWith`, `truceBreaks`, `settleTruce`;
`engine/simulator.js` `neutralTurn`, `kinsQuarrel`, `callToArms`.

### Winning over, calming and sending away

Search: recruit, win over, join, joins the party, calm, talked round, dismiss, send away, appeal, peace, can't abide violence, Peacekeeper, keep the peace

Decides how talkers deal with those who take no side.

- **Win over**: joins the talker's side for good, no luck roll. Never by a side it has seen cross it; never a PC.
  Steps and DC move with appeal: the strongest wish joining would fulfil (keeping that side's members safe, hurting
  their foes, its lean's regard) or betray. Only a talker with Tactical 60+ knows to try; anyone else tries when it
  wants to talk to it (20+), or when it always tries words first and takes it for a foe.
- **Calm**: someone confronting the talker's side; success ends the confrontation.
- **Send away**: wanted by one with a wish to avoid killing (an answer to Foes who fall other than Finish them)
  toward an enemy talked aside. A peacemaker (its group's commander, or one who would rather talk), a Peacekeeper,
  Diplomat, Moralist, People-Pleaser, Chicken, Wallflower, Fragile or Lazy sends it away; anyone else tries to win it
  over. Wish to talk to it: top + 5 for a peacemaker, top − 5 for others; a peacemaker also wants any other neutral it
  sees at top − 10; clamped 10–100. Top = max(40, its strongest reckoned wish) × its avoid-killing wish.
- **Can't abide violence** (answer Spare them: I avoid killing; answer Always talk, not staying true; or a
  Peacekeeper, Diplomat, Moralist or People-Pleaser pill): seeing a fight, it pitches at whoever is fighting. In a
  standoff: let the quarrel be (one step fewer); in a fight: leave.
- **Peacekeeper**: its pitches −2 DC × share; never threatens; a success is a truce (stand down) with chance its share;
  everyone in a standoff with it loses patience up to half as fast.

Code: `engine/behavior/talk.js` `pitchTargets`, `aimOf`; `engine/behavior/neutral.js` `appeal`, `peaceDesires`,
`dislikesViolence`; `engine/simulator.js` `keepsPeace`.

### Meddling: neutrals getting involved

Search: meddle, meddling, get involved, extort, squeeze, shakedown, aloof, keeps out of it

Decides whether someone leaning toward a side speaks up against that side's enemies. Decided once (again if its lean,
or standoff and fight, changes).

- odds = the leaned-to side's standing HP ÷ (its HP + its enemies'), counting temporary HP and stamina.
- fond = clamp(lean ÷ 50, 0, 1.5); winning = clamp((odds − 0.35) ÷ 0.4, 0, 1).
- p = (0.08 + 0.6 × fond × winning) × (1 + (Brave − 50) ÷ 100) × (1 + (Selfish − 50) ÷ 200), × 1.3 if it would rather
  talk; clamped 0.02–0.85.
- Involved, it squeezes them for money with chance clamp(0.1 + (Selfish − 50) ÷ 50, 0.05, 0.85); else it talks them
  out of the fight. Squeezed and convinced, they pay (as giving something up) and it keeps out of it.

Example: lean 50, odds 0.6, Brave 40, Selfish 60: (0.08 + 0.6 × 0.625) × 0.9 × 1.05 ≈ 43%; extort 30%.

Code: `engine/behavior/neutral.js` `meddling`; `engine/behavior/talk.js` `applyOutcome` ("paid").

### Taken for a foe, caught in the blast, spared in a truce

Search: seems foe, mistaken for an enemy, caught in area, careless, area spell, spared for truce, holds off

- **Taken for a foe**: yes if it wants to hurt it at 20+. Tactical 60+: never otherwise. Else yes if the neutral leans
  (25+) toward its enemies, or, for a feral creature, if it's within 10 ft.
- **Caught in an area**: each neutral adjacent to or within 10 ft of an area's targets is caught with chance clamp(0.8 −
  Tactical ÷ 100, 0.05, 0.75).
- **Spared in a truce**: while a neutral confronts a side, that side's members with Tactical 60+ don't hurt it or
  anyone it wants safe at 20+, unless the talk is going against them (nobody can talk to it, or its impatience ≥ 0.4).
- **Blame**: in a standoff, harm (15%) or an insult (35%) from a neutral leaning (25+) toward the other side makes a
  creature blame that side; × 0.4 for Tactical 60+.

Code: `engine/behavior/neutral.js` `seemsFoe`, `caughtInArea`, `sparedForTruce`, `losingTruce`, `annoyedBy`.

### Neutral friend groups (reach)

Search: neutral reach, neutralReach, Neutral friend groups: reach (squares), friend group, 1 2 3 pills, groups

Decides the groups the planner proposes for neutrals when it opens (a world setting, not per plan).

1. The neutral nearest the map's top-left corner (ties: higher, then further left) starts group 1, with every neutral
   of its kind (same stat block, type or name).
2. Any neutral within reach squares of a member joins; then within reach of those; three steps out at most.
3. Group 2 forms the same way from the rest; everyone left is group 3.

Squares are counted edge to edge, diagonals as 1, adjacent as 1. Default 3, range 1–20. The GM can move anyone with
the 1 2 3 pills.

Code: `engine/groups.js` `proposeGroups`, `squaresApart`; `foundry/battle.js`.

### Taunts (goading)

Search: taunt, goad, taunt luck, tauntLuck, Playstyle taunts: taking hold (%), Tank, mockery, taunt-proof, shrugs off

Decides when a taunting playstyle draws a foe onto itself.

- **Taunt share**: Tank 1, Instigator 0.75, Martyr 0.55, Brawler 0.4, Redeem-Seeker 0.3, × place (and roleplay).
- An action (the system's taunt cost; else its talk cost) at one foe within 30 ft that has a mind (not mindless). Needs
  Talking on and a voice, not a shared language.
- Roll: its better of Intimidation and Deception against the foe's resistance to that kind, as any pitch.
- Success, then a d100 at or under round(tauntLuck × share) (default 42, range 0–100; 0: never).
- It may shrug it off as it lands: chance its taunt-proofing (Relentless 0.75, Skeptic 0.6, Peacekeeper 0.5,
  Puzzle-Maniac 0.4, Diplomat 0.35, Chicken 0.35, Wallflower 0.3, Lazy 0.25, × place; at most 0.9). This applies to
  any taunt, the system's too.
- Taken hold, the foe wants to go for the taunter at 65 (driven; 80 on a critical success) until the end of its next
  turn. Stronger wishes of its own can still win.

| Taunter (first pick) | Needs at or under |
|---|---|
| Tank | 42 |
| Instigator | 32 |
| Martyr | 23 |
| Brawler | 17 |
| Redeem-Seeker | 13 |

A Tank picked second has share 0.75: 32. A game system's own taunts (skills, powers, spells) follow its rules, not
this roll.

Code: `engine/behavior/goad.js` `goadAction`, `goadPitch`, `goadLuck`; `engine/simulator.js` (control roll);
`engine/behavior/effects.js` `tauntProof`, TAUNT; `engine/playstyles.js`.

### Theft mid-fight

Search: theft, steal, thief, Thief, pickpocket, rob, robbed, theft luck, theftLuck, PC luck: being robbed, feint

Decides when a creature robs someone instead of hitting them.

- Who: a Thief pill, or theft skill edge ≥ 3, where edge = skill − typical skill for its level (− (20 − die) ÷ 2 for
  a smaller die than a d20).
- When it's safe: its side is winning (more of them standing than of its foes, or its foes have lost at least 25
  percentage points more of their number), or it's hidden and either the mark has no standing ally within 30 ft or
  nobody else is within one average move of either of them.
- Chance per turn, once: min(0.5, 0.08 + 0.25 for a Thief + 0.02 × max(0, edge) + max(0, Selfish − 50) ÷ 400).
- Mark: within 5 ft, the richest, with money or a carried item: a foe, a bystander, or someone taking no side.
- In the open, it first feints with a weapon: an attack that must hit and does no damage. The feint costs the system's
  feint cost, else the weapon's.
- Then its stealing skill against the mark's DC (PF2e: Perception DC, −5 in combat; 5e: passive Perception; DCC: 10 +
  best of Reflex, Int; Daggerheart: 12 + max(0, Instinct), adversaries Difficulty; else typical).
- Failed: noticed. The victim wants the thief; the thief is revealed; someone taking no side is offended.
- Against a PC, a success also needs a d100 at or under theftLuck (default 29, range 0–100).
- Takes: d10% of the money, else a random carried item. It comes back if the thief ends the fight beaten.

Example: a Thief (edge 0, Selfish 60) on a winning side: 0.08 + 0.25 + 0.025 ≈ 36% a turn.

Code: `engine/behavior/theft.js` `stealChance`, `theftTarget`, `theftPlan`, `attemptTheft`.

### Trap avoiders

Search: trap, hazard, trap luck, trapLuck, Trap avoiders: spotting a trap (%), spot a trap, watchful, go around, keep clear

Decides who spots hazards and keeps clear of them. Only with Positioning and terrain on.

- **Watchfulness**: Thief 1, Puzzle-Maniac 0.9, Skeptic 0.75, Lore-Collector 0.6, Chicken 0.5, Wallflower 0.35, ×
  place (and roleplay), at most 1.
- At the start of the fight, for each hazard that would strike it: a d100 at or under round(trapLuck × watchfulness)
  (default 59, range 0–100; 0: never) spots it.
- Anyone a hazard goes for, hit or miss, knows it from then on.
- Too near: within the hazard's longest reach (at least 5 ft; a ranged one's up to 30 ft) of its edge.
- Moving, it turns its move aside (20°, 45°, 70°, 90° either way, whichever ends nearest its goal); with no way
  around, it stops short.
- After something in the reach: it goes in if it wants it at 60+ (driven); at 40–59 with chance (level − 40) ÷ 20;
  below 40 never. Decided once a round per target.
- Starting its turn in reach with no foe adjacent, it steps straight out: min(its move, reach − distance + 5 ft).

| Avoider (first pick) | Needs at or under |
|---|---|
| Thief | 59 |
| Puzzle-Maniac | 53 |
| Skeptic | 44 |
| Lore-Collector | 35 |
| Chicken | 30 |
| Wallflower | 21 |

Code: `engine/behavior/traps.js` `spotTraps`, `learnTrap`, `dangerOf`, `keepClear`, `wantsBadly`, `stepOut`.

### Reluctance: consumables and costly spells

Search: reluctance, consumables, Consumables, I don't like to use consumables, Only when it really counts, When they're the right tool, Consumables are here to get used, potions, scrolls, bombs, costly spells, spell slots, avoid costly spells

Decides how willing a creature is to use up an item or a spell that costs something.

| Consumables answer | Willingness |
|---|---|
| I don't like to use consumables | 0.1 |
| Only when it really counts | 0.4 |
| When they're the right tool (default) | 1 |
| Consumables are here to get used | 1.3 |

- A costly spell (a ranked spell with a resource or limited uses) with "I don't like to use spells that cost
  something" ticked: 0.1. Cantrips and anything free: 1.
- Below 1, raised to at least 0.9 when a friend is dying and not stable or it is below 25% HP, and to at least 0.6 for a
  helper (helps: Moralist, People-Pleaser, Martyr, Tank, Enabler, Redeem-Seeker) with a friend below 50% HP.
- Attacks: an option's worth × willingness. Healing and buffs: used with chance = willingness, decided once a round per
  kind of cost.

Code: `engine/behavior/reluctance.js` `willingness`, `bringsItself`, CONSUMABLE_WILL; `engine/behavior/targeting.js`.

### Avoiding killing (mercy)

Search: mercy, avoid killing, avoidKilling, Avoids killing: how often it holds back (%), Spare them: I avoid killing, knock out, nonlethal, spare the fallen, pull a blow

Decides when a killing blow knocks out instead, and who is spared after the fight.

- Strength s, from the answer given to Foes who fall: Spare them 1, Tie them up 0.66, Leave them be 0.33, Rob them
  0.33, Finish them 0. A pill's suggested Spare or Tie counts as 1 or 0.66; the party's vote to spare raises s to at
  least its sway.
- Holds back with chance avoidKilling ÷ 100 × s (default 90, range 50–90): 90% for Spare them, ≈59% for Tie them up,
  ≈30% for Leave or Rob.
- Each blow that would kill: if it holds back, the foe is knocked out (down at 0, stable). A pill that spares the downed
  (Moralist 1, Peacekeeper 1, Diplomat 0.5) also pulls a killing blow where the system allows (5e melee, PF2e
  nonlethal, DCC subdual), with chance its share.
- Choosing whom to strike, decided once a round: holding back, it skips finishing the downed.
- After the fight, decided once: it spares the fallen if it holds back, answered Spare them, or has a spare pill share ≥
  0.5. It finishes them if it answered Finish them, or has Cruel's finishing streak without a sparing one or an answer.
  Else it leaves them to fate. One sparer saves a fallen foe from every finisher.

Code: `engine/battle-state.js` `holdsBack`, `holdsBackThisRound`; `engine/simulator.js` `pullsBlow`, `mercyOf`,
`dealWithTheFallen`; `engine/tactics.js` TACTIC_WISHES.

### The fallen: tying up and robbing

Search: tie up, tied up, bound, prisoner, Tie them up, rob the fallen, Rob them, loot, Foes who fall, free a friend, untie

Decides who ties up or robs a downed foe, mid-fight and after.

- Wish per fallen foe it can tell is there (answer Finish, Tie or Rob): 30; 62 when no standing foe is beside it (5
  ft). With no map every foe counts as beside it, so it waits for the fight to end. Pills keen on it (10+) do it after
  a fight with no answer of their own.
- Mid-fight it acts only when that wish leads, at a foe it can reach within one move this turn. Each costs the
  system's bind or loot cost, else one basic action, beside the foe.
- **Tied up**: out of the fight for good. Coming to, it is a prisoner (Tied up), not a fighter; its dying goes on. A
  captor tends it after the fight.
- **Robbed**, once per robber: the whole purse (d10% where its side pools money), else a random carried item, else (not
  a PC) what it wields. A PC's things go only on a d100 at or under theftLuck (default 29).
- After the fight: for each fallen foe, finishers act (unless someone spares it; a PC only on the execute luck); then a
  captor ties it up (and it counts as spared); then a robber robs it.

Code: `engine/behavior/fallen.js` `fallenWishes`, `decideFallen`, `bind`, `rob`, `stayBound`; `engine/simulator.js`
`dealWithTheFallen`.

### Execute luck: finishing off a PC

Search: execute luck, executeLuck, PC luck: being finished off, coup de grace, finish off, killing blow on a downed PC

Decides whether a creature (not a PC) that wants to kill a PC down at 0 HP goes ahead.

- Each time, once a round per creature and PC: a d100 at or under executeLuck (default 39, range 0–100).
- Above: it turns away, and everything it wanted of that PC goes to the next foe it would pick, in its usual order.
- After the fight, a finisher makes the same roll.

Code: `engine/simulator.js` `executionCheck`, `moveDesires`.

### Bearing a hold or hurt (ignore troubles)

Search: ignore troubles, ignoreTroubles, Selfless creatures bear what holds or hurts them (%), bear it, carry on, prone, grabbed, burning, bleeding, break free

Decides whether a selfless creature skips trying to be rid of what holds or hurts it this turn.

- chance = ignoreTroubles × (100 − Selfish) ÷ 100 × (100 − Tactical) ÷ 100 (default 29, range 0–100; 0: nobody).
- A d100 of its own at or under that, once a turn; the fight's other dice are untouched.
- Never when persistent harm (a burn, a bleed) would drop it this round.
- Bearing it, it doesn't try to break a hold, stand up from prone, or remedy a condition.

Example: Selfish 30, Tactical 60: 29 × 0.7 × 0.4 ≈ 8. A PC at the usual traits (Selfish 25, Tactical 65): ≈ 7.6.

Code: `engine/behavior/holds.js` `bears`; `engine/behavior/desire.js` `holdWishes`; `engine/simulator.js` (standing up).

### The party's vote

Search: party survey, Party tab, vote, majority, Lock-in, party's leader breaks ties, Party's sway (`partySway`)

Decides the party's answers, which sway the friendly side.

- Each player logged in, with a character in the fight, gets one vote per question; GMs don't vote.
- The most-voted answer wins. A tie goes to the answer the party leader's player voted for, if it is one of the tied;
  else there is no answer.
- Questions: who to go after first, talk first, foes who fall, looking after each other, spells and potions, when to
  pull out.
- Party's sway (`partySway`, default 3, range 1–20): each fight, for each question a character left to "Let this
  character decide", it uses the party's answer with that percent chance. The party's targets, fallen and care add
  sway × 100 (3 by default) to each member's matching wishes; Each for themselves takes as much off heal, guard and
  bolster wishes. A vote to spare sets the avoid-killing wish to at least 0.03.

Code: `foundry/party.js` `majority`, `partyWishes`; `foundry/battle.js` `applyPartyWishes`;
`engine/behavior/desire.js` `partyWants`; `engine/playstyles.js` `sampleRunTactics`.

## Fighting and the simulation

How a single fight plays out, and how the Battle Planner turns thousands of them into odds. Paths below are under
`scripts/` in the core repo. "Band" means a creature's Tactical band: Feral 0–19, Instinctive 20–39, Competent 40–59,
Tactical 60–79, Mastermind 80–100 (live value, so a leader's tactical floor counts).

### The prediction: how many fights it runs

Search: prediction time, Prediction time (seconds), predictionTime, Seconds, how many fights, runs, simulations, rough odds, slow, big battle, MAX_RUNS, FIGHT_MS_PER_PAIR, seed, random

Decides how many simulated fights the planner runs before it shows the odds.

- It runs fight after fight until the time is up, finishes the fight under way, and starts no more. At least 1 fight,
  at most 20 000 (`MAX_RUNS`).
- Time: **Prediction time (seconds)** (`predictionTime`), default 6, range 4–20. The planner's **Seconds** slider
  overrides it for one battle.
- Every 25 ms it lets the browser redraw; each pause counts against the time only up to 20 ms, so a background tab
  doesn't eat the budget.
- Estimated time per fight with n creatures: 0.5 + 0.031 × n² ms (`FIGHT_MS_PER_PAIR` = 0.031, measured on fights of
  five or six rounds). Estimated fights = min(20 000, floor(seconds × 1000 ÷ that)).
- Fewer than 100 fights (`ROUGH_RUNS`): the planner warns that the odds will be rough (about ±5% or worse). Before a
  run it uses the estimate, after a run the real count.

Estimated fights (a fast machine fits more):

| Creatures | 4 s | 6 s | 10 s | 20 s |
|---|---|---|---|---|
| 8 | 1 610 | 2 415 | 4 025 | 8 051 |
| 16 | 474 | 711 | 1 185 | 2 370 |
| 32 | 124 | 186 | 310 | 620 |
| 64 | 31 | 47 | 78 | 156 |
| 100 | 12 | 19 | 32 | 64 |
| Warning from | 36 | 44 | 57 | 81 |

- **Seed**: blank picks a random one; a whole number repeats the same batch. Fight i gets its own seed derived from it,
  so any fight replays exactly.

Code: `engine/run-budget.js` `budgetMs`, `fightMs`, `expectedRuns`; `engine/simulator.js` `runBatch`;
`apps/battle-planner.js` `#runsNote`; `foundry/battle.js` `simulate`.

### Rounds, stalemates and the max-rounds cap

Search: max rounds, Max rounds, maxRounds, stalemate, how long it lasts, rounds, duration, median, p10, p90, histogram, surprise round, round 0, battle over

Decides when a fight stops.

- The fight ends when no two enemy sides still have someone in it, checked after every action and every turn. In it:
  standing and in the fight, noticed and joining next round, or down but regenerating and not tied up. Not in it:
  anything untargetable (Spiritual Weapon), anyone taking no side, anyone leaving the map. A hunter with prey left, or
  a neutral who turned on a side still standing, keeps it going.
- **Max rounds** (`maxRounds`), default 12, range 4–12 (also a planner slider). Still going after that: a
  stalemate, with no winner. Plans saved with other values are clamped to 4–12.
- Surprise (Initiative "Party surprises" or "Enemy surprises"): that side takes turns in a round 0 before round 1.
- A fight's length is the round it ended in (a stalemate: max rounds). The planner shows the median and the 10th–90th
  percentile (entry round(p × (n − 1)) of the sorted lengths) and a bar per round.

Code: `engine/simulator.js` `runOne`, `battleOver`, `keepsSideIn`; `engine/aggregate.js` `percentile`;
`constants.js` `MAX_ROUNDS`.

### Odds, outcomes and the simulated difficulty

Search: odds, win chance, Party wins, A PC dies, A PC goes down, Stalemate, No one left, Simulated difficulty, trivial, low, moderate, severe, extreme, Most dangerous, Most at risk, First to fall, HP left

Each figure is the share of simulated fights in which it happened.

| Figure | A fight counts when |
|---|---|
| A side wins | it is among the sides still in the fight at the end (a standoff settled by a deal: the side it was settled for) |
| Stalemate | it reached max rounds |
| No one left | it ended with no side left (an argument whose talks collapsed counts here too) |
| A PC dies | any player character ends it dead |
| A PC goes down | any player character dropped to 0 at some point |
| Foe talked down | anyone was swayed |
| Settled with words | it ended with no blow struck and the talks didn't collapse |

Per combatant: share of fights it ends standing, down, dead, fled, surrendered and so on; share it was downed; mean
HP left (as a fraction); mean damage dealt and healing done; share it fell first; mean resources spent. Summoned
creatures are left out.

- **Most dangerous**: the 3 non-party combatants with the highest mean damage dealt.
- **Most at risk**: the 3 party members most often downed.

Simulated difficulty, from the party's win chance W and the chance any PC dies D:

| Label | W at least | and D under |
|---|---|---|
| Trivial | 99% | 0.5% |
| Low | 95% | 2% |
| Moderate | 85% | 6% |
| Severe | 65% | 15% |
| Extreme | anything else | |

Code: `engine/aggregate.js` `createAggregator`; `apps/battle-planner.js` `simulatedDifficulty`, `#resultsContext`.

### The most typical fight (Sample fight)

Search: sample fight, Most typical fight, typical fight, representative fight, replay, seed

Decides which fight the Sample fight tab tells.

- Fights are grouped by outcome (which sides won, or stalemate, no one left, talks collapsed). In the most common
  group, sorted by length, the middle one (entry floor(count ÷ 2)) is replayed from its seed with the full log.
- Do it For Real Now plays a new fight, not this one.

Code: `engine/aggregate.js` `finish`; `foundry/battle.js` `typicalFight`; `engine/simulator.js` `replay`.

### Swing factors

Search: swing factors, Compute swing factors, what moves the odds, Without, impact, SWING_RUNS

Shows how much each combatant and each option moves the party's win chance.

- Tests: the battle without each of up to 12 combatants (highest level first, then highest max HP), and with
  Leadership, Morale, and Terrain & positioning each turned off (only those that are on).
- Each test runs up to 300 fights (`SWING_RUNS`) in 3 × prediction time ÷ number of tests, seed 99.
- Each shows the party's win chance in the test minus the main run's, largest change first.

Example: 6 seconds and 10 tests give each test 1.8 seconds.

Code: `foundry/battle.js` `swingFactors`; `engine/run-budget.js` `swingShareMs`.

### Initiative and turn order

Search: initiative, Initiative, surpriseDefault, turn order, Combat tracker, Stealth for hidden, Roll normally, Party surprises, Enemy surprises, ambush

Decides who acts when.

- Each creature rolls its die (a d20, or its own: DCC's d16 for a two-handed weapon) + its initiative modifier,
  +2 for a Mastermind, + the Instigator playstyle's bonus (2, less for a later pill), + a tie-breaker under 0.01.
- **Initiative** (`surpriseDefault`): Combat tracker (default) keeps a tracker's rolled order, from whoever's turn it
  is; anyone not in it rolls and goes after. Stealth for hidden: sides with a hidden token roll Stealth. Roll normally.
  The planner adds Party surprises and Enemy surprises (a round 0 for that side).
- Where the system says so (PF2e Avoid Notice), a low-profile creature uses its Stealth if that's higher.
- A simple hazard goes first. Summoned creatures act right after their summoner.

Code: `engine/simulator.js` `rollInitiative`, `beginRun`; `foundry/battle.js` `buildBattleSpec`.

### Dice, degrees of success and advantage

Search: dice, d20, degree of success, critical hit, crit, critical failure, natural 20, natural 1, advantage, disadvantage, Bless, Bane, stacking bonuses, save for half, resistance, weakness, immunity, generic rules, odds of hitting

Decides what a roll means. The fight rolls real dice; the creatures weigh exact odds.

- Every roll has four degrees: critical failure, failure, success, critical success. The game system's helper decides
  which a roll reaches; for weighing, every natural on the die is tried with every die that rides along.
- Advantage keeps the higher of two dice, disadvantage the lower. Chance the kept die shows n on an f-sided die:
  advantage (2n − 1) ÷ f², disadvantage (2(f − n) + 1) ÷ f². Any advantage and any disadvantage cancel.
- Dice that ride along (Bless +1d4, Bane −1d4) are rolled and added to the modifier.
- Bonuses of one kind don't add up: the best bonus and the worst penalty count.

The generic rules (a system with no FastFighting helper):

| Rule | Generic |
|---|---|
| Attack | hits on total ≥ AC; a natural 20 is a critical hit whatever the total; a natural 1 misses |
| Saves and checks | success on total ≥ DC; no criticals |
| Critical damage | every die and flat bonus doubled |
| Save for half | success halves the damage (none, if the effect isn't "basic") |
| Resistance, weakness, immunity | half (rounded down), double, none |
| Persistent damage | at the end of each of its turns; ends on a d20 of 11 or more |
| Turn | one action and a full move (its fastest speed; 30 ft by default) |
| At 0 HP | down and stable (no dying); dead under Down = dead, or for a creature that dies at 0 |
| Typical numbers | AC 10 + level; saves and skills ceil(level ÷ 2) + 2; DC 10 + level |
| Not in the generic rules | opportunity attacks, concentration, flanking or prone penalties, first aid |

Worked example: +5 against AC 15 on a d20: miss 45%, hit 50%, critical 5%. With advantage 20.25%, 70%, 9.75%. With
disadvantage 69.75%, 30%, 0.25%.

Code: `engine/probability.js` `degreeDistribution`, `naturalChance`, `rollCheck`, `regrade`;
`adapters/generic/rules.js`; `engine/mods.js` `combineMods`, `netAdvantage`; `engine/dice.js` `doubled`;
`engine/battle-state.js` `typical`.

### Expected damage: what an attack is worth

Search: expected damage, EV, damage per action, value of an attack, area attack, multiattack, persistent damage estimate, rider, sneak attack, deed die, crit table, finishing move

Decides how much one use of an attack is worth to the creature weighing it.

- Attack roll: P(hit) × (mean damage + extra) + P(critical) × (critical mean + critical extra), times targets.
- Save: the sum over degrees of P(degree) × what that degree lets through × (mean + extra), times targets.
- Automatic: (mean + extra) × targets.
- Mean damage is after the target's resistances. Persistent damage counts 2.5 × its mean.
- Extra: bonus damage whose condition holds now (sneak attack on an exposed foe), flat damage bonuses, its marks on
  the target. A deed die adds (faces + 1) ÷ 2 to the damage and rides along on the roll.
- Riders on a hit: an affliction 0.5 × 2 × its first stage's mean damage (plus what its conditions are worth); prone or
  a grab +1.5; a push or pull +1.5; a save-on-hit rider 0.6 × its damage, +0.75 if it lays conditions.
- An area catches min(its targets (default 2), standing foes).
- A multiattack is the sum of its strikes, each at its multiple attack penalty. A DCC spell check: × its success
  chance. A finishing move: P(hit) × everything the foe has left.
- A crit table adds, on a crit, the mean of its rows: their damage, +2 for a lasting effect, +15 for a row that kills.

Worked example: +5 against AC 15, 1d8 + 3 (mean 7.5, crit 15): 0.5 × 7.5 + 0.05 × 15 = 4.5.

Code: `engine/behavior/evaluate.js` `expectedDamage`, `meanDamageVs`, `effectMean`, `areaTargets`;
`engine/behavior/riders.js` `critExtraMean`.

### Threat: how dangerous a creature looks

Search: threat, dangerous, damage per round, DPR, incoming damage, fight left, TYPICAL_ROUNDS

Decides how much a creature is expected to deal each round, which targeting, buffs and debuffs all measure against.

- Threat of u against a foe: its best action repeated as many times as its turn allows (an action with limited uses,
  once), plus its best bonus-action attack. Worked out once per pair per round.
- Limited uses (slots, charges): × min(1, uses left ÷ 3). An ability that recharges: × 1 when ready, × 0.4 when not.
- Incoming (what t can expect to take in a round): min(T, T ÷ its standing friends × 1.5 if a foe is beside it),
  where T = the sum of its standing foes' threat against it.
- Rounds an effect is reckoned to matter: min(its rounds, rounds left), where rounds left = ceil(the foes' HP, temp HP
  and stamina ÷ the side's damage per round), from 1 to 3.

Code: `engine/behavior/evaluate.js` `threatOf`; `engine/behavior/effects.js` `incoming`, `fightLeft`, `usefulRounds`.

### Choosing whom to attack

Search: target, targeting, who it attacks, focus fire, Who to pursue first, nearest, weakest, most dangerous, spellcasters and healers, protect allies, feral, instinctive, competent, tactical, mastermind, pack tactics, sticks with its foe, quickest kill, value of a kill, retaliate, avenge

Decides which foe a creature goes for this turn.

The checks, in order:

1. A foe who took something from it and then attacked it: that one.
2. Cruel (base 40%): a dying foe it can tell is dying, within 1 move. Not while it spares the fallen or holds back.
3. Wildcard (base 25%): any standing foe in reach.
4. People-Pleaser (base 50%), Enabler (30%): the foe most of its friends are after.
5. Every reachable foe is scored (below). The scores become desires to hurt: the best at 45 + 15 × (1 − second ÷ best),
   the rest at max(5, 45 × score ÷ best). The strongest desire then decides: a foe it wants to hurt and can reach, or,
   set on protecting a friend, the foe after that friend. Otherwise the top score.
6. A target with a low-profile playstyle may slip it (another foe within one more move); a foe with a draw-attention
   playstyle (Instigator, Tank 35%) may pull it.
7. A downed PC: the execution luck check (below).

Scores by band ("moves": move actions needed; "near": 1 ÷ (1 + moves − fewest moves to any foe)):

| Band | Score |
|---|---|
| Feral | near, +2 for whoever hurt it last if within 1 move |
| Instinctive | foes within one move of the nearest: 1 + share of HP missing; others 0.2 × near. With pack tactics: 1 + packmates beside it |
| Competent | its current foe: 10; others 1 ÷ (1 + turns to kill) |
| Tactical | (threat + 1) × 1.5 for a healer × 1.25 for a caster ÷ max(0.25, turns to kill) |
| Mastermind | as Tactical, and the side's focus target (within 2 moves) scores 1 000 000 |

- Turns to kill = HP it seems to have ÷ damage per round + moves ÷ moves per turn. Damage per round = its best option's
  expected damage × max(1, floor(actions per turn ÷ the option's cost)), at least 0.1. Moves per turn: 2 where moving
  costs feet (5e: a move and a Dash), else its actions per turn.
- HP it seems to have: the real HP if it can tell (Senses), else full HP.

**Who to pursue first** (a tactics answer) replaces the band's score:

| Answer | Score |
|---|---|
| Whoever is closest | near |
| Finish off the weakest | foes within one move of the closest: 2 − share of HP left; others 0.1 × near |
| The most dangerous foe | as Tactical |
| Spellcasters and healers first | as Tactical, × 2.5 for a caster or healer |
| Whoever is attacking my allies | 2 + near for a foe after a friend; else near |

Adjustments:

- A friend under a charm or domination (Instinctive and up): × max(0.1, 0.5 − Loyal ÷ 250). Someone taking no side who
  only seems a foe: × 0.6.
- Tactical and up with Selfish 60+, not sparing the fallen: dying foes count too, at 0.5 × (3 for a PC) ÷ (1 + moves).
- A downed foe that regenerates: Instinctive and up, if it has the damage type that stops it.
- Wary of opportunity attacks (see below) and in a foe's reach: only foes it can hit without moving.
- Below 35% HP: its desire for each foe 2 or more moves away wears down by 5 × (1.3 − Brave ÷ 100). Can't reach the
  foe it wanted: by 8 × the same.
- Hit by a foe: each blow adds 40, 25, 10, 5 or 3 by band (Feral first) to its desire for that foe, times its
  playstyle's retaliation; 3 if it was hit from afar while trading blows with someone beside it. A friend falls: each
  friend who can tell adds 15 × Loyal ÷ 60 for the one who did it, times its playstyle's vengeance.
- An option only some foes allow (a behir swallows only the one it holds): that foe instead, if it's worth 1.25 × its
  best against its pick.

Code: `engine/behavior/targeting.js` `pickTarget`, `scoreTargets`, `valueOfKill`, `quickestKill`,
`redirectForAttention`, `opening`; `engine/behavior/desire.js` `levelsFromScores`; `engine/simulator.js` `noteHarm`,
`noteFall`.

### Choosing an action

Search: action choice, which attack, best option, weapon or spell, Fighting style, Front line, Skirmisher, Ranged, Caster, Protector, preferred action, Spell slots focus and limited abilities, resourceUse, Save them for emergencies, Spend freely, Magic and specialties, specialty, turn order of a turn

Decides what a creature does with its turn, and with which attack.

- A turn is up to 8 steps: heal, call creatures, bolster, deal with a fallen foe, then attack. A creature that acts on
  impulse (Instinctive or less) works first on the kind of thing it most wants (then its second and third); Competent
  and up take them in the order that makes sense.
- Each attack option against the target: per action = expected damage ÷ max(0.1, cost + moves). Cost counts a main
  action as 1, a bonus action 0.5, movement 0.1; drawing a weapon adds a quarter of its cost. Moves count the actions
  spent walking (PF2e: one per Stride; 5e: a Dash for each speed beyond the move left).
- Weighted = per action × the factors below; the highest wins.

| Factor | Multiplier |
|---|---|
| Fighting style: Front line | melee × 1.2 |
| Ranged | ranged × 1.3, others × 0.7; won't walk into melee while it has a shot |
| Caster | spells (saves, spell attacks, automatic) × 1.3 |
| Skirmisher, Protector | melee × 1.1 |
| Its preferred action | × 1.35 |
| Walking off while a foe's opportunity strike waits (wary) | × 0.3 |
| Brawler (base 0.3) | melee × (1 + it) |
| Puzzle-Maniac (base 0.5) | a damage type the foe is weak to × (1 + it) |
| Spoiling playstyles (hinders) | control × (1 + 1.5 × hinders) |
| A downed foe regenerating | the damage type that stops it × 3, anything else × 0.05 |
| **Magic and specialties** | a specialty × 1 (No preference), 1.5 (A little more), 3 (Much more), 10 (Whenever it can) |
| Consumables, costly spells | × willingness (Reluctance) |

- **Spell slots, focus and limited abilities** (`resourceUse`): a limited option must reach the best free option's per
  action × 1.6 (Save them for emergencies; 1.15 below half HP or with a friend down), × 1.05 (Use them when they are
  clearly better), or anything (Spend freely).
- Options that fit the rest of the turn win over ones that don't.
- Feral with spells: half the time any option it can afford, otherwise the highest expected damage.
- Wildcard (base 25%): any option.
- An area attack hits its target and others picked at random among the standing foes, up to its count (2 by default).
  A multiattack whose target drops turns to the weakest foe in reach.

Code: `engine/behavior/targeting.js` `bestOptionVs`; `engine/tactics.js` `styleWeight`;
`engine/behavior/specialty.js` `SPECIALTY_WEIGHT`; `engine/turn.js` `costUnits`, `unitsForMoves`;
`engine/simulator.js` `playFromHere`, `executeOffense`.

### Reluctance: potions, scrolls and costly spells

Search: reluctance, reluctant, Consumables, potions, scrolls, bombs, I don't like to use consumables, Only when it really counts, Consumables are here to get used, spells that cost something, avoidCostlySpells, willingness

Decides how readily a creature uses up what it can't get back.

| What | Willingness |
|---|---|
| Consumables: I don't like to use consumables | 0.1 |
| Only when it really counts | 0.4 |
| When they're the right tool | 1 |
| Consumables are here to get used | 1.3 |
| A spell with a slot or uses, with "I don't like to use spells that cost something" | 0.1 |

- Raised to 0.9 when a friend is dying or it is below 25% HP; to 0.6 for a helper playstyle (Moralist, Martyr, Tank,
  Enabler, People-Pleaser, Redeem-Seeker) while a friend is below half HP.
- An attack's weight is multiplied by it. A heal or buff under 1 is a yes-or-no at that chance, decided once a round
  for each kind of cost.

Code: `engine/behavior/reluctance.js` `willingness`, `bringsItself`, `CONSUMABLE_WILL`.

### Shields and defensive turns

Search: shield, Raise a Shield, Shield Block, Shield or defending, Every turn, With spare actions, Don't bother, Dodge, defend

Decides when a creature raises its shield instead of attacking.

- Worth of a raised shield until its next turn: incoming × 0.085 × the shield's bonus (2 by default), + min(the block's
  mean, incoming ÷ 2) × 0.8 if it has a shield block reaction ready.
- It raises it (affordable, not "Don't bother", not rushing this turn) when:

| Case | Who |
|---|---|
| "Every turn" | with its last action |
| Skirmisher style, after 2 attacks | shield, or a step |
| It can't afford the attack | Instinctive and up |
| Its last action | Competent and up, if the shield is worth more than the attack |
| After 2 attacks | Competent and up, if this attack is worth under 0.3 × its first (0.65 × with a block ready) |

- Impatient (base 50%) and Speed-Runner (40%) rush some turns and skip it. Dodge-like actions are weighed as buffs.

Code: `engine/simulator.js` `shieldWorth`, `playFromHere`.

### Healing decisions

Search: healing, heal, healer, Default PC healing, pcHealAggro, Healing (planner), Conservative, Balanced, Aggressive, At all costs, Default PC response to a dying ally, pcAllyDying, Rescue them, Keep fighting, Protect self, Drinking my own potions, potion threshold, heal urgency, first aid

Decides whom a creature heals, when, and with what.

How freely it heals: a PC (or anyone given an answer) by its healing answer, else its side's planner setting.
"Let this character decide" goes by class, features and nature, unless **Default PC healing** (`pcHealAggro`, default
"Let each character decide") names one, which then stands in for it. Other creatures by band: Feral and Instinctive
Conservative, Competent Balanced, Tactical and up Aggressive.

| Healing | Heals below |
|---|---|
| Conservative | 25% HP |
| Balanced | 45% |
| Aggressive | 60% |
| At all costs | 80% |

Score for each friend (or itself):

- Down: 3 (Rescue them) or 1.2 (Keep fighting); +1 at dying 2 or more.
- Below its threshold: 1 − share of HP left.
- Itself, below its **Drinking my own potions** answer (25, 50 or 75% HP): at least 1 − share of HP left.
- Itself, revived, answer "heal myself": +1 below 75% HP.
- × (1 + Selfish ÷ 50) for itself; × (1 − Selfish ÷ 200), at least 0.2, for others.
- It heals nobody else when its answer to a dying ally (**Default PC response to a dying ally**, `pcAllyDying`) is
  Protect self or Retreat (unanswered: Protect self at Selfish 70+, else Rescue them), nor a friend it can't tell is
  hurt. Feral healers heal only themselves.

The desire to heal a friend: max(45, 20 + 20 × score, urgency); urgency is 90 for one down, round(30 + 110 × (0.5 −
share of HP left)) below half, else 0.

Which heal: mean healing (and what it lays, such as regeneration) ÷ (cost + actions to get there), × the specialty
factor. A friend who's down: 1 + mean ÷ 100 (the cheapest way up wins). First aid: 0.5. For one down or At all costs,
the best; otherwise an unlimited heal first; Conservative won't spend a limited one on the merely hurt. A heal that
needs a check heals × 0, 0, 1 or 2 by degree.

Worked example: a Balanced healer (Selfish 30), a friend at 40% HP: score (1 − 0.4) × (1 − 30 ÷ 200) = 0.51; desire
max(45, 30.2, 41) = 45.

Code: `engine/behavior/healing.js` `healAggroOf`, `healScores`, `decideHeal`, `rescueOption`;
`engine/simulator.js` `healUrgency`, `executeHeal`.

### Buffs and support

Search: buff, bless, haste, aid, help, bolster, support, guard, setup, worth casting, helper playstyle, area buff, aura

Decides when a creature bolsters a friend (or itself) instead of attacking.

- Score = (spell check chance × the buff's worth summed over its recipients − what switching concentration costs) ÷
  max(0.25, cost) × how well its band sees it: 0.5, 0.6, 0.9, 1.05, 1.15 (Feral first). A limited buff ÷ 1.6
  (Save them; 1.15 in trouble), 1.05 (Balanced), 1 (Spend freely). Feral creatures only buff themselves.
- It casts the best buff whose score beats its baseline: its best damage per action against any standing foe (× 0.8
  for a helper playstyle). Set on helping one friend (a desire of 60+ not of its own reckoning, such as a friend's
  request): baseline 0, and only buffs that reach that friend.
- × 1.5 for a buff that reaches the friend it's set on; × (1 + the strengths of the playstyles it leans on); a guard
  (Dodge) × 1.5 with shield "Every turn", never with "Don't bother". Rushing, it skips set-ups and guards.
- Recipients rank by worth × (1 + its desire to aid them ÷ 50).
- Its desire to aid a friend: score = worth per action ÷ max(0.5, baseline); at 0.4 or more, a desire of min(75, 15 +
  30 × score), for its 3 best.

Code: `engine/behavior/support.js` `buffOptions`, `decideBuff`, `recipients`, `aidScores`, `offenseBaseline`.

### What a condition, bonus or penalty is worth

Search: outcome worth, debuff value, buff value, condition weight, d20 point, advantage worth, prone, incapacitated, controlled, temp HP worth, mark, Hunter's Mark, taunt worth, resistance worth

Decides how the creatures weigh any effect, in damage-like points: worth per round × rounds it matters (at most 3).
"Out" is the bearer's damage per round, "incoming" what it takes.

| Effect | Worth per round |
|---|---|
| ±1 to attacks | out × 0.085 |
| Advantage on attacks | out × 0.35 |
| ±1 damage | hits per round: 0.6 × min(3, its attacks) |
| ±1 action | out × change ÷ its actions per turn (at most ±out) |
| ±1 ft speed | out × 0.004 |
| ±1 AC; attacks against it with advantage | incoming × 0.085; incoming × 0.35 |
| ±1 to saves; advantage on saves | incoming × 0.25 × 0.085; incoming × 0.25 × 0.35 |
| ±1 to checks | max(1, out) × share of its turn spent on checks (talking 0.8, first aid 0.4) × 0.085 |
| A condition with no numbers | out × weight: incapacitated or controlled 1, immobilized 0.25, prone 0.15, any other 0.08 per point (the system may say) |
| Prone, as bonuses and penalties | half |
| Controlled (charmed, dominated) | −2 × out |
| Ends when it takes damage | × 0.6 |
| A mark (Hunter's Mark) | its mean × the marker's hits per round × 0.8 |
| Temporary HP | once: min(new − current, incoming × rounds) |
| Lent resistance | incoming × share it covers × 0.5 (physical types up to 0.7, others 0.15 each, at most 0.9) |
| Fast healing, regeneration | min(gain × rounds, HP missing + incoming × rounds) |
| A taunt | (1 − its shrug-off chance) × clamp(0.5 + (taunt − its current lead desire) ÷ 30, 0, 1) × the blows its friend is spared; a plain taunt counts 65 |

- Good for one roll ("uses"): one round, and only that share of its attacks or of the attacks on it.
- On dice other than a d20, a point is worth what the system says (`rollPoint`).

Code: `engine/behavior/effects.js` `outcomeWorth`, `modsPerRound`, `conditionWeight`, `tauntGain`.

### Control and debuffs

Search: control, crowd control, debuff, Trip, Grapple, Demoralize, Hold Person, hold, charm, immunity, immune, incapacitation, taunt, goad, spoiler, hinders

Decides what a control action (one that lays conditions or penalties) is worth.

- Worth = max(0, spell check chance × targets × value × (1 − known immunity) − what switching concentration costs).
- Value = the sum over degrees of P(degree) × the outcome's worth against the target (or, a botch landing on the user,
  its worth to the user), + its damage as a save or a hit would deal it.
- Known immunity: Competent and up always see it, Instinctive half the time, Feral never (and waste the spell).
- Worth 0: a once-per-target action already tried on it; one it's holding on another standing foe; one already on the
  target from it (Instinctive and up).
- A playstyle taunt's success also needs its luck: P(success) × Taunt luck ÷ 100.
- Effects that hold weaker on much stronger targets (PF2e incapacitation) shift the degree as the system says.

Code: `engine/behavior/control.js` `controlValue`, `controlRoll`, `isImmune`; `engine/simulator.js` `executeControl`.

### Concentration

Search: concentration, concentrating, lose concentration, broken concentration, Constitution save, dropping a spell, switching spells

Decides when a creature's concentration breaks, and whether it gives one up for another.

- One at a time: starting another ends the first, and everything it held.
- It breaks when the creature goes down or leaves, gets a condition the system lists, or fails a save when hurt: the
  system's save (Constitution by default) against the system's DC, by default max(10, floor(damage ÷ 2)). The generic
  rules have no concentration.
- A concentration spell everyone shrugged off holds nothing, and ends.
- Switching costs 0.6 × the worth of what it holds (its best expected damage or worth while held).
- Creatures it summoned under concentration vanish when it ends.

Code: `engine/simulator.js` `testConcentration`; `engine/behavior/effects.js` `beginConcentration`,
`endConcentration`, `concentrationCost`, `noteConcentration`.

### Movement, reach and getting there

Search: movement, move, speed, reach, approach, terrain, difficult terrain, terrain cost, walls, way round, through a wall, doors, flying, climbing, burrowing, swimming, elevation, Positioning and terrain, positioning, Terrain & positioning, Ignores terrain, move actions, Dash, Stride, theater of the mind

Decides how many moves a creature needs to reach a foe, and how it moves.

With **Positioning and terrain** (`positioning`, default on; planner "Terrain & positioning"):

- For each pair, each speed it has (walk, fly, swim, climb, burrow): terrain multiplier = Foundry's movement cost ÷
  distance (regions included). It uses the mode with the lowest distance × multiplier ÷ speed. "Ignores terrain" on a
  token: × 1.
- Walls in the way: climbers go over, burrowers under. Others go round: × max(1, squares round ÷ squares straight)
  (square grids; on others × 1.5). A shut ordinary door costs 2 squares and is opened, forced or picked in the fight.
  No way round: a creature slower than 4 squares (20 ft) can't; a faster one counts the wall's square as 4 ×:
  × (distance + 3 squares) ÷ distance.
- Melee is possible if it flies or the height difference is within its reach.
- Moves needed, melee: ceil(gap × multiplier ÷ speed) − the action's charge moves, where gap = feet to the nearest free
  spot within reach + feet round creatures in the way. Ranged: none if in range (max range, else 3 × increment) with a
  line of sight; else enough to reach the nearest spot that has both, looked for within 2 moves.
- Distance is edge to edge: max(5, centre distance − (size A + size B) ÷ 2 + 5).
- A move costs, PF2e-style, an action per Stride; 5e-style, feet of movement, then the action for a Dash.
- Turned off (theater of the mind): everyone is in reach, nobody draws opportunity strikes, and there's no cover,
  sense range or falling; a shove only takes the foe out of reach.

Code: `foundry/terrain.js` `computeApproach`, `terrainMultiplier`; `foundry/pathing.js` `WallGrid`
(`THROUGH_WALL` 4, `DOOR_STEPS` 2); `engine/battle-state.js` `movesNeeded`, `moveToward`, `edgeDistance`;
`engine/turn.js` `payForMove`.

### Crowds: getting past creatures and where a move ends

Search: occupied space, move through, tumble through, blocked by a creature, crowd, free spot, can't reach

Decides how creatures get past one another.

- Nobody's move ends in another's space, unless the system allows it.
- Passing a friend or anyone down: free. A standing foe: around it, its width in feet more. The system may say
  difficult (its width more) or a tumble (a roll; failed, the move stops short).
- A melee move ends straight in, or, if that spot is taken, on the nearest free spot within reach (on its 5-ft grid).
  A foe with every spot round it taken can't be reached, except from farther off (a reach weapon).

Code: `engine/behavior/space.js` `inTheWay`, `passOf`, `spotWithin`; `engine/battle-state.js` `passing`.

### Line of sight and cover

Search: line of sight, LOS, cover, half cover, three-quarters cover, total cover, behind a wall, limited walls, one-way walls, doors block sight, COVER_POINTS

Decides who can see whom, and what cover adds.

- Sight lines run from a creature's centre to the target's centre and four corners (0.5 ft inside). Walls that block
  sight do, as Foundry has them: a one-way wall lets sight through from its open side, it takes two limited walls, and
  a shut door blocks.
- Cover by blocked lines: 0 none, 1–2 some, 3–4 most, 5 total (it can't see the target).
- Where the system has no cover rules (generic included): most or total cover adds 2 (`COVER_POINTS`) to AC against
  that attacker and to saves against what it set off (as many of the system's points, on other dice).
- Walls are read within 300 ft of the fight. "Near cover" (within 7.5 ft + half its size of a wall) is for the story
  only.

Code: `engine/behavior/space.js` `blockedPoints`, `coverFrom`, `lineOfSight`, `sightBlocked`;
`engine/battle-state.js` `coverDefault`; `foundry/terrain.js` `computeWalls`, `environmentAt`.

### Senses: what a creature can tell

Search: senses, perceive, can it tell, darkvision, low light, darkness, blindsight, tremorsense, hearing, smell, scent, radar, blinded, deafened, apparent HP, crisis

Decides whether a creature can tell how another is doing (hurt, dying), for targeting, healing, revenge and rescue.

| Sense | Ordinary reach | Needs |
|---|---|---|
| Sight | 1 000 ft; in darkness (scene 0.7+) max(30 ft, its dark sight) | not blinded; a line of sight |
| Hearing | 60 ft (or the system's) | not deafened; passes walls |
| Smell | none | no wall between |
| Feel (blindsight, tremorsense) | none | passes walls |
| Radar | none | passes walls |

- Always: itself, anyone beside it, and everyone when there are no positions.
- In a crisis (a friend dying, a fallen friend to avenge, fate or luck for a friend): twice the range, and sight needs
  no line of sight (smell still stops at walls).
- A foe it can't tell about looks unhurt.

Code: `engine/behavior/senses.js` `perceives`, `senseReach`, `apparentHealth`.

### Noticing the fight: bystanders

Search: bystanders, Bystanders can join, bystanders, notice the fight, Perception, hear the fight, join next round, call for help, reinforcements, kin, leader's people

Decides when a token on the map but not in the encounter notices the fight.

- On each of its turns: a Perception check against the easiest cue from anyone in the fight (or who fell this round or
  last):

| Cue | DC |
|---|---|
| Sight (up to 240 ft, within its sight) | 5 |
| Radar | 5 |
| Feel | 8 |
| Smell | 10 |
| Sound (within 300 ft, if it hears) | round(8 + feet ÷ 15 + 6 per wall between) |
| No map data | 10 |

- A leader whose own people are fighting: +5 to the check, and a DC 12 cue even out of sight and earshot.
- Noticed, it joins next round; attacked, at once. Someone fleeing within 40 ft alerts it. A creature running for help
  calls a friend once within 30 ft.

Code: `engine/simulator.js` `lookAround`, `cueFrom`, `notice`, `NOTICE_DC`, `KIN_BONUS`, `KIN_DC`;
`foundry/terrain.js` `computeAwareness` (`HEAR`).

### Opportunity attacks and getting clear

Search: opportunity attack, attack of opportunity, Reactive Strike, free swing, Disengage, Step, wary, reaction, leaving reach

Decides who strikes as a creature walks away, and when it plays safe.

- Only where the system has them, with positioning on. Each foe whose reach it leaves (not the one it's walking to)
  strikes, if it has a reaction left; reactions come back at the start of its turn (1 a round by default). PF2e's also
  answer a shot or a manipulate action in reach, and standing up.
- Wary of them: Tactical and up always, Competent half the time (decided once a round), the rest never; an obsessed
  creature never; the "roleplaying is very important" box halves it.
- A wary creature takes the safe way out (Disengage, Step) if it can afford it and still do what it's moving for. A
  safe way that costs no main action is used by anything Instinctive and up (half the time when played for the story).
  A creature rushing this turn never stops for it.
- Struck on its way to something: its desire for it wears down by 6 × (1.3 − Brave ÷ 100).

Code: `engine/behavior/reactions.js` `threats`, `isWary`, `takesSafeWay`; `engine/simulator.js` `leaveReach`,
`provoke`.

### Forced movement, falls and dangerous ground

Search: shove, push, pull, knockback, forced movement, fall, falling damage, ledge, pit, cliff, ground height, FastFighting: ground height, hazardous terrain, collision, slam into a wall, put somewhere

Decides where a shoved creature ends up, what it finds there, and what a shove is worth.

- It moves in 5-ft steps along the nearest of 8 directions (away; pulled, toward, stopping beside). A wall (a cell's
  blocked side) or a standing creature stops it; the system may deal collision damage. "Pushed to N feet": until that
  far off.
- A drop of 10 ft or more, if it doesn't fly: it falls. Damage: the system's, else 1d6 bludgeoning per 10 ft (at most
  20d6), and it lands prone unless the system says not.
- Then: the harm of the ground it lands on, and any hazard whose reach it's in goes off at it, once.
- "Put anywhere": the spot that would hurt it most, within the doer's reach (5 ft + half its size) plus the move.
- The ground is read in 5-ft cells within 25 ft of each creature. Height: the highest region over the cell with
  **FastFighting: ground height** (in scene units) set, else 0. Difficult: a region that slows walking. Hazardous: one
  the system says harms, or one that runs a script or macro.
- Worth of a shove to the doer: 0.5 with no map; else (0.5 + harm there × how well it sees) × its damage scale ×
  (1 + its shove playstyle: Brawler 0.5, Cruel 0.4, Instigator 0.3). Harm there: a fall's mean + 2; each hazard 0.6 ×
  its best blow; a harmful cell its mean (4 if only marked hazardous); difficult ground +1.5. Seeing it: Competent and
  up 1, Instinctive 0.5, Feral 0.2.

Code: `engine/behavior/forced.js` `forcedPath`, `fallDamage`, `forcedWorth` (`FALL_FROM` 10);
`engine/simulator.js` `forceMove`; `foundry/terrain.js` `computeGround`, `regionGround`.

### Holds and escapes

Search: grab, grapple, grabbed, restrained, held, escape, escape DC, break free, tied up, bound, bonds, prisoner, free a friend, untie, swallowed, engulfed, web, net, Selfless creatures bear what holds or hurts them, ignoreTroubles, bear it

Decides how a held creature gets loose, and when it doesn't try.

- A try: the system's own way; else its escape check against the hold's DC; else a chance: a grab 50%, bonds 35%,
  anything else 40%.
- FastFighting's bonds: DC = the system's typical DC + 2 (generic: 12 + level). A hazard's hold: its escape DC or a
  typical DC, and a friend beside it may try.
- A grab with nothing to go on: it tries early in every turn (one action, 50%). Any other hold: when getting loose is
  what it most wants.
- How badly it wants loose: grabbed 45, other holds 55, swallowed or engulfed 75, a parasite 30 + 10 × its value; +20
  with no foe beside it, +20 in a hazard's hold, + its playstyle's. Tied up: 85; if it can still fight or talk from
  its bonds, 45 + fear + its playstyle's. Fear = (50 − Brave) × 0.5.
- Freeing a friend: (25 + 0.4 × Loyal + its playstyle's + its dying-ally answer: Rescue them 15, Keep fighting 0,
  Retreat −5, Protect self −15; +10 with no foe beside it) × 0.5 if the friend is down. Untying needs no roll.
- Frozen solid: an escape try at the end of each turn. A holder that falls lets go.

**Selfless creatures bear what holds or hurts them** (`ignoreTroubles`), default 29, range 0–100. Each turn, on a d100
of its own: at or under setting × (100 − Selfish)% × (100 − Tactical)%, it bears it: this turn it doesn't stand up
from prone or try to be rid of a hold or a burn. Never when its persistent damage would drop it this round. 0: nobody
bears anything.

Worked example: Selfish 25, Tactical 65: 29 × 0.75 × 0.35 = 7.6, so 7% of turns.

Code: `engine/behavior/holds.js` `holdsOf`, `tryHold`, `bears`, `bondsDC`, `ESCAPE_CHANCE`;
`engine/behavior/desire.js` `holdWishes` (`BREAK_FREE`, `FREE`); `engine/simulator.js` `breakFree`, `attemptEscape`.

### Harm each turn: conditions, persistent damage, spreading

Search: persistent damage, burning, on fire, bleeding, bleed, acid, corroding, radiation, irradiated, overheated, swallowed, engulfed, gullet, parasite, impregnated, suffocating, choking, infectious, spread, drop and roll, remedy, repeat save, shake off

Decides what hurts a creature each turn and how it gets rid of it.

- A system's persistent damage: rolled at the end of each of its turns, then the system's check ends it (generic: a
  d20 of 11 or more). An action buys one more check; it wants that at min(85, 30 + 150 × damage ÷ max HP) + fear.
- An effect with a repeat save (Hold Person): a save at the end of each of its turns ends it.
- The core's own conditions, where the system says nothing of them (at the end of its turn, unless the system says the
  start):

| Condition | Harm each turn | Its own try (an action) | Wants rid at |
|---|---|---|---|
| Burning v | v d6 fire | 50%; a friend beside it puts it out | 60 |
| Bleeding v | v d4 | 40%; a friend's first aid; any healing ends it | 45 |
| Corroding v | v d6 acid | 50% | 50 |
| Overheated v | 1d6 fire at 2 | 100% | 40 |
| Irradiated v | v d4 radiation | | |
| Swallowed, engulfed | (1 + floor(holder's level ÷ 4)) d6 acid | a hold, at the holder's escape DC | |
| Suffocating | rises 1 a turn to 3; the turn after, it falls | 75% if it can move | 90 |
| Impregnated | rises 1 a turn to 6; the turn after, it bursts and the host falls | a friend cuts it out by first aid, typical DC + 5; a failure makes it worse | |

  "Wants rid at" is the desire before fear and playstyle are added.
- Infectious v: at the end of its turn, each creature beside it saves (the better of Fortitude and Constitution)
  against the typical DC + 2 × (v − 1), or catches it at 1.

Code: `engine/simulator.js` `conditionUpkeep`, `conditionHarm`, `startHarm`, `endOfTurn`;
`engine/conditions.js` `PROFILES`; `engine/behavior/troubles.js` `harmParts`, `troubleRemedies`;
`engine/behavior/holds.js` `remediesOf`, `REMEDY`.

### Afflictions: poisons, diseases, curses

Search: affliction, poison, venom, disease, curse, hex, stage, onset, virulent, Contagion, exposure, save against poison

Decides how a poison or disease takes hold and runs its course.

- Exposure: its save (none: it takes hold). By default a failure gives it its first stage, a success nothing. One tied
  to the action's own save takes hold as that save went.
- Already afflicted: a disease or curse takes no more hold; a poison's new dose worsens it a stage, without lasting
  longer. Immunity to one of its traits stops it.
- After its onset, the first stage takes hold. Each stage lasts its duration (1 round by default), then a save: a
  failure worsens it a stage, a success eases it one; at stage 0 it's gone. The system may say otherwise.
- Virulent: a critical success eases it a stage; plain successes need two in a row.
- Counted (5e Contagion): a save at the end of each turn; 3 successes cure it, 3 failures settle it for the fight.
- Its maximum duration ends it.
- Weighing it: 0.5 × 2 × its first stage's damage, plus what its stage's conditions are worth (reckoned over 10 rounds,
  so at most the 3 that matter).

Code: `engine/simulator.js` `exposeToAffliction`, `applyAfflictionStage`, `endOfTurn`;
`engine/behavior/afflictions.js` `stepOf`, `stageMove`; `engine/behavior/evaluate.js` `afflictionWorth`.

### Summons

Search: summon, summoning, conjure, Spiritual Weapon, Summon Animal, call creatures, sustain, summoned creatures

Decides when a creature calls creatures to fight beside it, and where they appear.

- Worth = for each creature, its offense power × its actions per turn × rounds, + 0.3 × its max HP (if it can be
  attacked); − sustain cost × the summoner's damage per action × rounds × 0.8. Rounds = min(the summoning's rounds (10
  by default), rounds left, 3). × the specialty factor.
- Offense power = mean damage × chance × targets ÷ cost; chance 1 for automatic, 0.6 for a save, else
  clamp((21 − (10 + level − bonus)) ÷ 20, 0.05, 0.95) + 0.05.
- It calls the best summoning worth more than 2 × its damage per action × max(0.5, the summoning's cost). Never one
  already here; never a Feral creature (an environment's always may).
- They appear within its range (30 ft by default) and its sight: melee ones in the nearest free space within 15 ft of
  the foe it's after, others beside the summoner (within min(range, 30 ft)).
- They act right after the summoner, never flee, and go when their rounds end, when the summoner's concentration on
  them ends, or (PF2e) when it doesn't sustain them: idle that round, or gone. They're left out of the results.

Code: `engine/behavior/summons.js` `decideSummon`, `worthOf`, `appearAt`, `summonState`;
`engine/tactics.js` `typicalValue`.

### Luck pools: spending after the roll

Search: luck, burn Luck, boost, spend after the roll, DCC Luck, halfling luck, thief's luck die, Fleeting Luck, shared pool, stakes

Decides when a creature spends points from a pool to turn a failed roll into a success (DCC burning Luck).

- Only on a failure, and only if enough points can make it. Its own pool first, then a friend's that can be spent on
  others (within its range, if it has one, and who can tell what's happening).
- Points needed = ceil(shortfall ÷ what a point adds: its value, or a die's mean).
- Most it spends: everything when the stakes are 0.85+; otherwise min(what's left above its keep, 4 for a pool that
  comes back, else 2).
- Chance it spends: min(0.95, stakes × (1.2 for a pool that comes back, else 0.8) × 0.5 Save them / 1 Balanced / 1.5
  Spend freely); for a friend's roll × (1 − Selfish ÷ 100), between 0.05 and 0.95. It spends a point at a time until
  it's enough.
- In a live battle, a player's pool is the player's.

| Roll | Stakes |
|---|---|
| Attack | 0.15; +0.35 if the target's HP is at most the attack's mean damage; +0.25 if a friend is dying |
| Save against harm | 0.2 (0.7 if it would lay conditions); with damage at least 0.25 + 0.5 × damage ÷ HP, 0.95 if it would drop the saver |
| Save against a control action; the user's control roll | 0.7; 0.3 |
| Save against a hit's rider | 0.6 |
| Spell check | 0.9 healing a friend who's down; else 0.5 |
| Save against a reaction's blast | 0.3 |

Worked example: a fighter misses by 2 with a pool that doesn't come back (1 per point), Balanced, an ordinary swing:
2 points, chance 0.15 × 0.8 = 12%.

Code: `engine/behavior/luck.js` `boost`, `payers`; `engine/simulator.js` `attackStakes`, `saveStakes`.

### Fate: rerolls that keep someone alive

Search: fate, hero points, Heroic Inspiration, reroll, Heroic Recovery, save a life, death reroll

Decides when hero points (or the like) are spent to undo a death.

- When a blow, a save or a recovery check would leave a creature dead, the moment is taken back and played again, if
  someone spends a point: up to 3 times.
- Who spends: the victim, if it has any; else a standing friend on its side with some, who can tell (crisis senses),
  each with chance (1 − Selfish ÷ 100), between 0.05 and 0.95.
- The victim spending, where the system has a sure way out (PF2e Heroic Recovery): all its points, and it lives.
- A healing check that fails on a dying friend: a healer with a point rerolls once (always for itself; for another at
  the chance above).

Code: `engine/simulator.js` `fateful`, `fateSpender`, `executeHeal`.

### Last-ditch saves and refusing to drop

Search: Legendary Resistance, stand firm, Undead Fortitude, Relentless Endurance, Orc Ferocity, stay up, hold on, Death Burst, death throes

- Stand firm (5e Legendary Resistance): a failed save with stakes of 0.6 or more, while it has uses: a success
  instead, one use spent. Stakes as in Luck pools; a save against a control action is 0.7.
- Hold on (5e Undead Fortitude): a blow that would drop it calls for a save against 5 + the damage; made, it stays at 1
  HP. Not against a critical hit or the damage types its rule names, if it says so.
- Stay up (Relentless Endurance, Orc Ferocity): a reaction sets it at its HP (1), more wounded.
- Death throes (Death Burst): falling, it bursts at everyone within range (5 ft by default), a save for half.

Code: `engine/simulator.js` `standFirm`, `holdsOn`, `clingsOn`, `deathThroes`.

### Damage, 0 HP and the downed models

Search: 0 HP, dying, downed, Downed characters, downedModel, Simulate dying and healing, Down = out of the fight, Down = dead, Dies at 0 HP, diesAtZero, knocked out, unconscious, stable, recovery check, death saves, temporary HP, stamina, regeneration, troll, fast healing

Decides what damage does and what 0 HP means.

- Damage takes temporary HP first, then stamina, then HP. At 0 the system decides (`onDropped`).
- **Downed characters** (`downedModel`; planner "Downed"):

| Choice | Meaning |
|---|---|
| Simulate dying and healing (default) | the system's dying rules: a recovery check at the start of each of its turns, blows on the dying as the system says, revival by healing |
| Down = out of the fight | down stays down; further blows do nothing |
| Down = dead | as the system says for that (generic: dead) |

- Dies at 0 HP: non-player creatures by default; the planner's token row sets it.
- A creature that avoids killing (its answer to "Foes who fall") holds back on a killing blow as often as the Avoids
  killing setting says: knocked out (down, stable) instead. One that spares the fallen pulls the blow where the system
  allows.
- Regeneration and fast healing at the start of its turn. Regeneration stops for a turn after damage of its stopping
  types; while it works the creature can't die and still keeps its side in the fight.

Code: `engine/simulator.js` `dealDamage`, `regenerate`, `knockOut`, `playFromHere`;
`adapters/generic/rules.js` `onDropped`.

### Finishing off a downed PC

Search: execute, finish off, coup de grace, kill a downed PC, PC luck: being finished off, executeLuck, mercy

Decides whether a creature kills a player character lying at 0 HP.

- **PC luck: being finished off** (`executeLuck`), default 39, range 0–100. Each time a creature that isn't a PC goes
  for a PC who's down: a hidden d100 at or under it, it goes ahead; otherwise its desire to hurt that PC moves to its
  next choice. Once a round for each creature and PC. The same check guards the aftermath.

Code: `engine/simulator.js` `executionCheck`, `moveDesires`.

### The aftermath

Search: aftermath, After the fight, Tend the fallen and tell it, Tend the fallen quietly, Stop at the last blow, after the battle, bleeding out, first aid after, prisoners, spare or finish, mercy, goods returned

Decides what happens between the last blow and Do it For Real Now writing the fight to the sheets.

- **After the fight** (`aftermath`): Tend the fallen and tell it (default); Tend the fallen quietly (the same, but the
  story ends at the last blow); Stop at the last blow (nothing happens). It works only with Simulate dying and healing.
- Who won is decided at the last blow.
- The fallen foes: if any victor spares them, they're spared. Else a victor who finishes the fallen (its answer
  "Finish them", or Cruel with no answer) kills, with up to 4 of its everyday blows (no slots, uses or potions); a PC
  only past the execution luck check.
- Sparing: unless its answer is "Finish them": its answer "Spare them", holding back (Avoids killing), or a playstyle
  that spares the fallen at 0.5 or more (Moralist, Peacekeeper, Diplomat).
- Those still alive are tied up by a victor who takes prisoners (and spared), and robbed by one who robs.
- Then, for up to 100 rounds (about ten minutes) while anyone is dying: each victor in initiative order tends a dying
  friend (the most dying first; a spared foe only with free help), free healing first, then first aid, then spells and
  potions; then everyone dying makes its recovery check (fate applies).
- What a creature was talked into giving up comes back if the taker ended dead, down, surrendered, stood down, beaten,
  tied up, or under the owner's side's control.

Code: `engine/simulator.js` `aftermath`, `dealWithTheFallen`, `mercyOf`, `reclaimGoods`
(`AFTERMATH_ROUNDS` 100); `engine/behavior/healing.js` `rescueOption`.

### Recharges, cooldowns, legendary actions and counterspells

Search: recharge, Recharge 5-6, cooldown, can't use again for 1d4 rounds, legendary actions, counterspell, spell duel

- Recharge: at the start of its turn, a die (d6 by default) at or above its number (6 by default; "Recharge 5–6": 5).
- Cooldown: n × d(4 by default) rounds from the round it was used.
- Legendary actions: after each other creature's turn, the option with the most expected damage per point against a
  foe it can reach without moving. Not while it can't act or a standoff holds; the pool comes back on its turn.
- Counterspell: a foe who sees a spell with a rank: rank at or under its counter's level, it fails; above, a check
  against 10 + rank; or (5e 2024) the caster's save.

Code: `engine/simulator.js` `rechargeActions`, `legendaryMoment`, `counterspelled`.

### Strain: words that wear a creature down

Search: strain, composure, stress from talking, losing an argument, worn down

- Where the system says so: losing an exchange of words costs a pool 1 point (2 on a critical); the talker pays when
  its pitch fails, the listener when it gets through. Run dry, it gets the system's worn-down effect.

Code: `engine/behavior/strain.js` `strainOf`, `strain`.

## Pathfinder 2e

Repo: FastFighting-PF2e. Paths below are under its `scripts/`; "core" means FastFighting's `scripts/engine/`.

### Checks and degrees of success

Search: degree of success, critical, natural 20, natural 1, basic save, saving throw, check, d20, fortune, misfortune

What it decides: how a d20 roll turns into one of PF2e's four degrees.

- Total ≥ DC + 10: critical success; ≥ DC: success; ≤ DC − 10: critical failure; else failure. A natural 20 raises the degree one step, a natural 1 lowers it one.
- Fortune (advantage): the higher of two d20s; misfortune: the lower.
- Damage a save lets through: basic save ×2 / ×1 / ×½ / ×0 (critical failure → critical success); a non-basic save ×2 / ×1 / 0 / 0.
- A critical hit doubles all damage. A hit deals at least 1 damage before resistances.
- A check against a defense (Trip against Reflex, Feint against Perception) uses DC = 10 + that modifier (a save's with the target's own penalties).

Code: `rules.js` `degreeOfSuccess`, `roll`, `saveMultiplier`, `critical`, `minimumDamage`; core `battle-state.js` `defenseDc`.

### Actions, the multiple attack penalty and Strikes

Search: three actions, MAP, multiple attack penalty, agile, reload, draw, range increment, minion, Step, Reactive Strike, attack of opportunity

What it decides: what a turn holds and what each Strike costs.

- 3 actions a turn; a minion (a summoned creature) 2.
- Multiple attack penalty: 0 / −5 / −10; agile 0 / −4 / −8. A ranger's Hunter's Edge (Flurry): 0 / −3 / −6, agile 0 / −2 / −4.
- A Strike costs 1 action plus its reload value; drawing an unready weapon (a character's) 1 more.
- Range: −2 for each range increment past the first; maximum range is the weapon's, else 6 increments.
- Melee underwater without a swim speed: −2.
- Reactive Strike: only creatures with it (Attack of Opportunity before the remaster), once a round, not while incapacitated, paralyzed or stunned. A Step (1 action) leaves reach safely.
- A taunt costs 1 action; Administer First Aid 2.

Code: `rules.js` `turn`, `attackPenalty`, `modifiers.attack`, `opportunity`, `disengage`; `adapter.js` `#strikes`; `class-actions.js` `classActions`.

### Lore-Collector advantage (Recall Knowledge)

Search: Lore-Collector, Lore-Collector advantage, loreBoost, Recall Knowledge, size up, sizing up, study a foe, boost

What it decides: how much a successful Recall Knowledge improves a Lore-Collector's rolls against that kind of foe.

- The check: its best of Arcana, Crafting, Medicine, Nature, Occultism, Religion, Society or any Lore, against the foe's level + 15. Mindless creatures don't try. Stupefied, frightened, sickened and fascinated count against it.
- On a success, for the rest of this turn, each of its rolls against a foe of that sort (the same stat block) gets the smallest bonus, 1 to 30, that makes it succeed at least min(boost × its chance, 95%, its chance at +30).
- **Lore-Collector advantage** (`fast-fighting-pf2e.loreBoost`): 1.25× to 3× in steps of 0.05, default 2×.
- Why 2×: Recall Knowledge costs one action of three, and the payoff covers the rest of that same turn, so it needs less than the one-action systems' boosts.
- Example: a Strike at +7 against AC 22 succeeds 30% of the time; at 2× it aims for 60% and gets +6.

Code: `lore.js` `LORE_BOOST`; `adapter.js` `#recallKnowledge`; core `battle-state.js` `boostBonus`, `simulator.js` `sizesUp`.

### Conditions and their penalties

Search: frightened, sickened, clumsy, enfeebled, stupefied, drained, encumbered, fascinated, off-guard, flat-footed, prone, slowed, stunned, quickened, paralyzed, fleeing, status penalty

What it decides: what each PF2e condition does to rolls and actions.

Status penalties don't stack: a roll takes the worst that applies to it. Frightened and sickened apply to every roll and DC; the others by what the roll is based on.

| Condition | In the rolls |
| --- | --- |
| frightened n, sickened n | −n to every check and DC (attacks, AC, saves, skills, spell DCs) |
| clumsy n (encumbered: clumsy 1) | −n to AC, Reflex, ranged attacks, Thievery, Hide, Tumble Through |
| enfeebled n | −n to melee attacks and the Athletics maneuvers |
| stupefied n | −n to Will, spell attacks, talking, Medicine, Recall Knowledge, Demoralize, Feint; the caster's spell DCs n lower; casting a spell takes a flat check, d20 ≥ 5 + n, or the spell is lost |
| drained n | −n to Fortitude; it loses level × n Hit Points (level at least 1), and its maximum as much |
| fascinated | −2 to skill checks |
| off-guard (also grabbed, restrained, prone, paralyzed, unconscious, flanked) | −2 AC |
| prone | −2 to its attacks; standing costs an action |
| slowed n / stunned n | n actions fewer; inside a gullet, slowed 1 |
| quickened | 1 action more |
| paralyzed, fleeing | no actions (fleeing spends them all getting away) |

- A penalty already on the sheet when its numbers were read (a fight resumed, a live battle) isn't counted twice: the rolls count only what changed since.
- Frightened is only a penalty: it doesn't keep a creature away from what frightened it. Fleeing makes it want to keep away at desire level 90 (obsessed). PF2e's fear steps (frightened 2) are its own; the core builds no hidden fear on top.
- The AI weighs a condition as a share of the creature's fighting lost each round: slowed n/3, stunned min(1, n/3), paralyzed 1, fleeing 0.8, frightened or sickened 0.08n, clumsy 0.04n, enfeebled 0.05n, off-guard 0.08.

Code: `rules.js` `STATUS_ON`, `statusPenalty`, `conditionMods`, `conditionWeight`, `conditionWishes`, `modifiers`, `disrupted`, `drain`.

### Flat checks: hidden, concealed, dazzled

Search: flat check, hidden, concealed, dazzled, DC 11, DC 5, precise sense, miss chance

What it decides: whether an attack that would hit actually affects its target.

- Once an attack would hit, a d20 flat check: DC 11 against a hidden target, DC 5 against a concealed one, DC 5 for a dazzled attacker without a precise sense besides sight. A failure turns the hit into a miss.
- A targeted spell's save against such a creature: the caster makes the same flat check; on a failure the spell passes it by (as a critical success). Area effects take no flat check.
- A hidden attacker's target is off-guard to it; the attacker is seen once its attack is done.

Code: `rules.js` `flatCheck`, `adjustRoll`, `afterAttack`.

### Cover, Hide and Take Cover

Search: cover, standard cover, greater cover, Take Cover, Hide, Stealth, Avoid Notice, behind walls

What it decides: what walls and the hiding actions add to defense.

- Cover from walls: some of the target hidden, standard cover +2 to AC and Reflex; most or all, greater cover +4.
- Take Cover (1 action, with standard cover from a foe, or prone): standard becomes greater; prone, greater against ranged attacks. It ends when the creature moves from its space, attacks or falls unconscious.
- Hide (1 action, concealed or with cover from every foe that sees it): Stealth against the foes' best Perception DC (10 + Perception). Hidden, attacks at it need the DC 11 flat check; any check of its own ends it (not a save), and an attack ends it once done.
- A low-profile creature rolls Stealth for initiative when that's better (Avoid Notice).

Code: `rules.js` `coverBonus`, `coverTaken`, `takingCover`, `usable`, `afterRoll`; `adapter.js` `coverActions`.

### Holds and Escape

Search: Escape, escape DC, grabbed, restrained, grapple, bonds, tied up, break free, Web, Tangle Vine, held

What it decides: how hard each hold is to break, and with what.

- Escape: 1 action, the best of the creature's unarmed attack modifiers, Acrobatics and Athletics, less frightened or sickened. A critical failure bars another Escape that turn. A friend can't Escape for it.

| Hold | Escape DC |
| --- | --- |
| A creature's Grapple, Grab or Swallow Whole | the grabber's Athletics DC (10 + Athletics) |
| Grabbed or restrained on the sheet, holder unknown | the GM Core DC for its own level |
| FastFighting's bonds | Thievery DC of whoever tied them; else the GM Core DC for the prisoner's level. A friend unties them: 1 action, no roll |
| A spell or ability whose text says Escape breaks it | the "Escape DC" its text gives, else the spell or ability DC |

- GM Core DCs by level 0 to 25: 14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40, 42, 44, 46, 48, 50; 2 more a level past 25.
- Breaking free of a grab also ends the off-guard and immobilized it brought.
- Tied up is restrained: no action with the attack trait, whatever its hands.

Code: `holds.js` `LEVEL_DCS`, `levelDC`, `escapeOf`, `sheetHold`; `rules.js` `escapeFrom`, `bondsDC`, `escapeCost`, `breakFree`, `tiedBars`.

### Swallow Whole and Engulf

Search: Swallow Whole, Engulf, swallowed, engulfed, Rupture, gullet, cut free, corpse

What it decides: what happens inside a creature, and how to get out.

- Swallow Whole: Athletics against the Reflex DC of a creature it has grabbed, of the listed size or smaller. Once it holds one of the largest listed size, it can't swallow another.
- Engulf (2 actions): a Reflex save against the listed DC for each creature of its size or smaller in a path of twice its Speed.
- Inside: the listed damage at once and at the end of each of its turns, slowed 1, and it attacks only its holder (off-guard to it) with unarmed attacks or light weapons (light Bulk or less).
- Out: Escape against the swallower's Athletics DC (an engulfer's listed Escape DC), or one blow from inside dealing piercing or slashing damage of the Rupture value or more. A try at cutting free is a Strike against the holder's AC − 2, doubled on a critical hit; it's made in place of an Escape when likelier. The blow's damage hurts the holder either way.
- A dead engulfer lets go. A dead swallower's corpse must be cut open: 3 actions by a friend beside it with a piercing or slashing blow; a dead gullet deals no more damage.

Code: `gullet.js` `gulletAction`, `chanceAtLeast`, `cuttingStrike`, `full`; `rules.js` `cutFree`, `ruptured`, `conditionHarm`, `letGo`, `untieCost`.

### Maneuvers (skill actions)

Search: Trip, Grapple, Disarm, Shove, Reposition, Feint, Demoralize, Bon Mot, maneuver, Athletics, Deception, Intimidation, Knockdown, Push, Pull

What it decides: each skill action's DC and its result by degree.

All 1 action. The Athletics ones are attacks: a free hand, a target at most one size larger, and only for the trained (as is Feint). Demoralize needs no training, works within 30 feet, and once a fight on each foe.

| Maneuver | Against | Crit. failure | Success | Crit. success |
| --- | --- | --- | --- | --- |
| Trip | Reflex DC | you fall prone | prone | prone and 1d6 bludgeoning |
| Grapple | Fortitude DC | the foe grabs you | grabbed, 1 round | restrained, 1 round |
| Disarm (a foe with a weapon in hand) | Reflex DC | you're off-guard, 1 round | −2 to its attacks, 1 round | it drops the weapon: −2 to attacks and 1 action lost, 1 round |
| Shove | Fortitude DC | you fall prone | pushed 5 ft | pushed 10 ft |
| Reposition | Fortitude DC | it moves you 5 ft | moved 5 ft | moved 10 ft |
| Feint (melee reach) | Perception DC | — | off-guard to you this turn | off-guard to you through your next turn |
| Demoralize | Will DC | — | frightened 1 | frightened 2 |
| Bon Mot (with the feat) | Will DC | you take −2 to saves and checks | −2 to saves and checks, 10 rounds | −3 |

- A creature's Knockdown or Trip on a hit: prone; Grab: grabbed; Push or Pull: moved as far as its slug or English name lists ("Push 10 feet"), else 5 feet, with no Shove roll.

Code: `maneuvers.js` `skillManeuvers`, `strikeMove`; `adapter.js` `attackEffects`, `#skillActions`.

### Aid

Search: Aid, Prepare to Aid, help a friend, aided, hindered

What it decides: what helping a friend's next roll gives.

- 1 action (Prepare to Aid), a check against DC 15 with its best Strike, Diplomacy, Medicine, Intimidation or Deception. Within 30 feet of the friend; aiding a Strike takes standing beside the foe.
- Success: +1 to the friend's next attack or check at whoever it's set on. Critical success: +2, +3 at master, +4 at legendary (its best skill rank). Critical failure: −1.
- Only a creature with a language aids.

Code: `edges.js` `AID_DC`, `aidAction`.

### Dying, wounded, doomed and recovery

Search: dying, wounded, doomed, recovery check, Diehard, Toughness, Administer First Aid, stabilize, unconscious, death

What it decides: when a character dies and how it comes back.

- Knocked to 0 HP: dying 1 + wounded (2 + wounded on a critical hit). Hit while down: dying +1 (+2 on a critical). Creatures that aren't characters die at 0.
- Dies at dying 4 − doomed; Diehard makes it 5 (read from the sheet).
- Recovery check at the start of its turn: a flat check against 10 + dying (9 + dying with Toughness, from the sheet). Critical success −2 dying, success −1, failure +1, critical failure +2. At 0 it's stable, unconscious, wounded +1.
- Healed while down: up, prone, wounded +1.
- Administer First Aid (2 actions, trained in Medicine): Medicine against 15 + dying. A success stabilizes (wounded +1); a critical failure adds 1 dying.

Code: `rules.js` `onDropped`, `dyingLimit`, `recoveryCheck`, `onHealed`, `firstAidDC`, `firstAid`; `adapter.js` `dyingOf`.

### Hero Points

Search: Hero Points, Heroic Recovery, reroll, fate, keep from dying

What it decides: how Hero Points keep someone alive.

- A character's Hero Points are its fate. When a blow, a save or a recovery check would kill it, the core takes the roll back and spends fate, up to 3 times.
- Its own points: Heroic Recovery, all of them, stable at 0 HP with no dying (wounded doesn't rise).
- A friend's point: one point for a reroll. The friend must sense it happen; the chance it spends is 1 − Selfish ÷ 100 (5% to 95%).
- A healer with Hero Points rerolls a failed heal check on a dying friend, by the same chance (always for itself).

Code: `adapter.js` `toCombatantSpec` (resources.fate); `rules.js` `avertDeath`; core `simulator.js` `fateful`, `fateSpender`.

### Ferocity

Search: Ferocity, Orc Ferocity, Undying Ferocity, stay up at 1 HP

What it decides: when a creature stays up as it would fall.

- With its reaction to spend and able to react: stays at 1 HP, wounded +1.
- A creature's Ferocity: until it is wounded 3. Orc Ferocity: as often as its frequency has left. Undying Ferocity: also temporary HP equal to its level.

Code: `rules.js` `holdsOn`; `adapter.js` `ferocityOf`.

### Persistent damage, bleeding and retching

Search: persistent damage, flat check DC 15, assisted recovery, drop and roll, bleed, Administer First Aid, sickened, retch

What it decides: how lingering harm ends.

- At the end of its turn it takes the damage, then a DC 15 flat check ends each instance.
- Assisted recovery (2 actions) buys another flat check: fire DC 10 (dropping and rolling, prone after); bleed or acid DC 15; nothing else helps.
- A friend trained in Medicine stops a bleed with Administer First Aid (2 actions): Medicine against the GM Core DC for the bleed's source's level; a success allows a DC 10 flat check at once.
- Sickened: retch, 1 action, a Fortitude save against the DC of what sickened it (the action's save DC, else its source's best save DC, an affliction's DC, else the GM Core DC for the source's level). Success: sickened −1; critical success −2. A sickened creature drinks no potion or elixir.

Code: `rules.js` `persistentFlatCheck`, `persistentRemedy`, `stopBleeding`, `retch`; `remedies.js` `ASSISTED`, `APPROPRIATE_DC`, `sickDC`, `bleedDC`.

### Afflictions

Search: poison, disease, curse, affliction, stage, onset, virulent, injury poison

What it decides: how an affliction's stage moves.

- The first save sets the stage: failure stage 1, critical failure stage 2. Later saves: critical failure +2, failure +1, success −1, critical success −2.
- A spell's affliction (Goblin Pox, spider venom) takes hold by the spell's own save, with no second roll.
- An injury poison is applied first (its activation, 2 actions unless it says), then rides the creature's best piercing or slashing Strike, a dose a use.

Code: `rules.js` `afflictionStep`; `afflictions.js` `parseAffliction`, `spellAffliction`; `adapter.js` `poisonedStrike`, `activationOf`.

### Incapacitation and immunity

Search: incapacitation, immune, immunity, mindless, mental, Evasion, Juggernaut, Resolve

What it decides: when a target is immune or shifts its result.

- Incapacitation: a target whose level is more than twice the spell's rank treats its result as one degree better.
- Immune to an effect by its traits (fear effects, death effects, mental for the mindless) or to every condition it would lay; too big (over the action's size) or with nothing in hand to disarm.
- Evasion (Reflex), Juggernaut (Fortitude), Resolve (Will): a success on that save counts as a critical success.

Code: `rules.js` `controlShift`, `isImmune`; `adapter.js` `toCombatantSpec` (saveUpgrades).

### Weakness, resistance and immunity

Search: weakness, resistance, IWR, physical, energy, all-damage, hardness

What it decides: how much of each damage type gets through.

- Per type: immunity stops it; otherwise damage + the largest matching weakness − the largest matching resistance, at least 0. "physical" covers bludgeoning, piercing, slashing and bleed; "energy" acid, cold, electricity, fire, sonic, force, vitality and void; "all-damage" everything.

Code: `rules.js` `applyIwr`.

### Healing, Battle Medicine and class features

Search: Heal spell, Battle Medicine, Sneak Attack, Vicious Swing, Power Attack, Double Slice, Sudden Charge, Flurry of Blows, Hunter's Edge, Exploit Vulnerability, Force Barrage, Elemental Blast

What it decides: the numbers FastFighting adds to class features it reads by slug.

- Heal: one action is a touch; two actions reach 30 feet and add 8 × rank to the healing.
- Battle Medicine (1 action, a touch, once per target): 2d8 against DC 15; expert DC 20 +10, master DC 30 +30, legendary DC 40 +50.
- Sneak Attack, where the damage formula doesn't show it: 1d6, 2d6 from level 5, 3d6 from 11, 4d6 from 17.
- Vicious Swing (Power Attack): 2 actions, counts as 2 attacks, 1 more weapon die (2 from level 10, 3 from 18).
- Double Slice: 2 actions, one Strike with each weapon at the same penalty. Sudden Charge: 2 actions, two Strides then a Strike. Flurry of Blows: 1 action, two unarmed Strikes, once a turn.
- Hunter's Edge, Precision: 1d8 precision on the first hit each turn (2d8 from 11, 3d8 from 19).
- Exploit Vulnerability: 1 action within 60 feet; the thaumaturge's hits on that foe deal 2 + ½ level (rounded down) more, 10 rounds.
- Force Barrage counts its two-action casting (two missiles). Elemental Blast: one action in melee or at range, two actions at range.

Code: `adapter.js` `#spells`, `#feats`, `#sneakAttackDice`, `#marks`, `#elementalBlasts`; `class-actions.js` `classActions`.

### Reactions

Search: Shield Block, Reactive Shield, Nimble Dodge, Retributive Strike, Glimpse of Redemption, Liberating Step, Intercept Attack, champion reaction

What it decides: what each answering reaction does (one reaction a round).

| Reaction | Effect |
| --- | --- |
| Shield Block | the raised shield's Hardness off a physical hit |
| Reactive Shield | the shield's AC bonus against a melee hit, perhaps a miss |
| Nimble Dodge | +2 AC against one attack |
| Champion's reaction | a friend within 15 ft takes 2 + level less; Retributive Strike also strikes the attacker in reach |
| Intercept Attack | takes a physical blow meant for an ally within 10 ft |

Code: `adapter.js` `#reactions`.

### Summons

Search: summon, Summon Animal, Summon Undead, minion, Sustain

What it decides: what a summon spell calls.

- A creature with the spell's trait, never unique, of the highest level its rank allows, from the installed bestiaries (Monster Core first).
- Highest level by rank 1 to 10: −1, 1, 2, 3, 5, 7, 9, 11, 13, 15.
- A minion with 2 actions; its summoner must Sustain it (1 action) each turn or lose it; it lasts the spell's duration, else 10 rounds.

Code: `adapter.js` `SUMMON_LEVEL`, `SUMMON_TRAITS`, `#summon`, `creatureFor`.

### Doors, falls and moving past others

Search: door, Force Open, Pick a Lock, hardness, fall damage, Tumble Through, swarm, Tiny

What it decides: the map's numbers.

- A door: AC 10, 20 HP, Hardness 5 off every blow; Force Open (1 action, Athletics) or Pick a Lock (2 actions, trained in Thievery, a PC with thieves' tools) at DC 20; opening it is 1 action.
- A fall of more than 5 feet: bludgeoning damage of half the distance in feet; prone after.
- Past a friend or a fallen creature: freely. Past a standing foe: Tumble Through (Acrobatics against its Reflex DC) for one trained in Acrobatics whose 10 on the die would do it; otherwise around. A Tiny creature or a swarm passes and may end its move in another's space.

Code: `rules.js` `door`, `doorCosts`, `doorDamage`, `fallDamage`, `passThrough`, `tumbleThrough`, `endIn`.

### Talking, theft and leadership

Search: Diplomacy, Intimidation, Deception, Will DC, Perception DC, Steal, Thievery, leader, Commander, Warfare Lore

What it decides: the DCs for words and theft, and who leads.

- Persuade (Diplomacy) and threaten (Intimidation) against Will DC; bluff (Deception) and Steal against Perception DC; level + 15 where the sheet has no DC. Steal in combat: −5 to Thievery, trained only.
- Resolve: its Will − round(1.15 × level + 5).
- Leader score: best of Diplomacy, Intimidation and Warfare Lore − (level + 4); a Commander +4, and +1 a tactic (at most 4); a rallying ability +3.

| Leader score | Brave | Tactical floor | Commander also |
| --- | --- | --- | --- |
| 6 or more | +20 | 60 | +1 attack, +1 AC |
| 3 to 5 | +15 | 50 | +1 attack |
| 0 to 2 | +10 | 40 | — |
| below 0 | +5 | — | — |

Code: `adapter.js` `#social`; `rules.js` `modifiers.steal`; `leadership.js` `rankLeaders`, `leaderBonus`.

### Personality from the sheet

Search: personality, traits, Tactical, Brave, Selfish, Loyal, mindless, animal, undead, construct, Will

What it decides: the four hidden traits FastFighting starts a PF2e creature with.

- A creature: Tactical 38 + 8 × Int + 2 × Wis (10 to 95); an animal or beast 18 + 3 × Wis + 2 × max(0, Int + 4) (5 to 45); mindless 5. Brave 55 + 5 × (Will − round(1.15 × level + 5)), −15 for an animal (10 to 90); mindless or construct 100, undead 90, a minion at least 70. Selfish 40, or the highest its traits give (demon 85, daemon 80, fiend 70, dragon 70 ... construct 5; a minion 10). Loyal 50; a minion or familiar 85, summoned 90, mindless 80; kin traits move it (devil +12, demon −15).
- A player character starts at the usual hero (Tactical 65, Brave 75, Selfish 25, Loyal 80) and moves: Tactical (Int − 1) × 4, (Wis − 1) × 2, (level − 5) × 0.5, expert Perception or better (rank − 1) × 2; Brave (Will − (level + 5)) × 3, (Con − 1) × 1.5; class, ancestry, background, holy or unholy, feats' rules and skills by their tables; not in a party, Loyal −10. Kept within 5 to 95.

Code: `traits.js` `derivePf2eTraits`, `pcParts`, `CLASS_LEANS`, `BACKGROUND_LEANS`, `SELFISH_BY_TRAIT`, `LOYAL_BY_TRAIT`, `ruleLeans`.

### Typical numbers and areas

Search: typical AC, typical DC, by level, area, burst, cone, line, emanation, targets

What it decides: the numbers used where a sheet says nothing.

- By level: AC 15 + level, save level + 5, skill level + 4, DC level + 15.
- Foes caught by an area: "up to n creatures" n; a line 3 at 60 feet or more, else 2; a cone 3 at 30 feet or more, else 2; an emanation 3 at 20 feet or more, else 2; a burst 4 at 20 feet or more, 3 at 10, else 2.

Code: `rules.js` `typical`; `adapter.js` `areaTargets`.

## D&D 5e

Repo: FastFighting-DnD5e. It follows the world's dnd5e **Rules version** (2014 "legacy" or 2024 "modern") where the two differ.

### Rolls, advantage and critical hits

Search: d20 test, advantage, disadvantage, critical hit, natural 20, natural 1, save for half, exhaustion

What it decides: how a 5e roll lands.

- Two results: meet the DC or not. An attack hits on a natural 20 (a critical) and misses on a natural 1.
- Advantage and disadvantage cancel: any of one and none of the other decides.
- A critical hit rolls the damage dice twice; modifiers aren't doubled.
- A successful save halves the damage, or stops it where the effect says.
- Exhaustion: −2 per level on every d20 test, under either rules version.

Code: `rules.js` `degreeOfSuccess`, `net`, `critical`, `saveMultiplier`, `tired`.

### Lore-Collector advantage (Study)

Search: Lore-Collector, Lore-Collector advantage, loreBoost, Study, size up, Arcana, History, Investigation, Nature, Religion, boost

What it decides: how much a successful Study improves a Lore-Collector's rolls against that kind of foe.

- The check: its best of Arcana, History, Investigation, Nature and Religion, against 10 + the foe's proficiency bonus. Mindless creatures don't try. It takes the turn's action.
- On a success, through its next turn, each roll against a foe of that sort gets the smallest bonus, 1 to 30, that makes it succeed at least min(boost × its chance, 95%, its chance at +30).
- **Lore-Collector advantage** (`fast-fighting-dnd5e.loreBoost`): 1.25× to 3× in steps of 0.05, default 2.5×.
- Why 2.5×: Study takes the whole turn and works a little over half the time (+3 against DC 13: 55%), so the payoff must be large. Past about 1.75×, a roll that already succeeds 54% of the time or more hits the 95% cap; only long shots gain more.
- Example: +3 against AC 18 hits 30%; at 2.5× it aims for 75% and gets +9.

Code: `lore.js` `LORE_BOOST`; `edges.js` `studyCheck`, `STUDY_SKILLS`; core `battle-state.js` `boostBonus`.

### Conditions

Search: prone, poisoned, frightened, restrained, blinded, paralyzed, stunned, unconscious, incapacitated, petrified, grappled, charmed, invisible, Hiding, exhaustion, slowed

What it decides: what each condition does to rolls.

| Condition | Effect |
| --- | --- |
| paralyzed, stunned, unconscious, incapacitated, restrained, blinded, petrified (target) | attacks against it have advantage |
| poisoned, frightened, restrained, blinded, prone (attacker) | its attacks have disadvantage |
| prone (target) | advantage for a melee attack within 5 ft; disadvantage otherwise |
| paralyzed, stunned, unconscious, incapacitated, petrified | fails Strength and Dexterity saves |
| paralyzed, stunned, unconscious, petrified | no actions |
| restrained | disadvantage on Dexterity saves |
| poisoned, frightened | disadvantage on checks |
| slowed | its action only, no bonus action; no reaction |
| swallowed | blinded and restrained; engulfed: restrained |

- Frightened is on or off; it can't move closer to its source, so it keeps away at desire level 60, however bold.
- Grappled is the core's grab; Charmed (or Dominate) is the core's controlled: it fights for its caster.
- The AI weighs a condition as a share of its fighting lost each round: paralyzed, stunned, unconscious, petrified 1; swallowed 0.55; restrained 0.4; engulfed 0.4; blinded 0.35; charmed 0.3; slowed 0.3; frightened 0.25; poisoned 0.2.

Code: `rules.js` `HELPLESS`, `HAMPERED`, `modifiers`, `conditionWishes`, `conditionWeight`; `conditions.js` `READ`.

### Cover, Hide, Dodge, Help and Insight

Search: half cover, three-quarters cover, Hide, Stealth DC 15, invisible, Dodge, Help, Insight, Reckless Attack, Action Surge

What it decides: the everyday edges.

- Cover from walls: half +2, three-quarters +5, to AC and Dexterity saves.
- Hide (an action; a bonus action with Cunning Action): Stealth against DC 15, never with a foe beside it. Hidden for up to 10 rounds, until it attacks: its first attack has advantage, and attacks at it disadvantage (both hidden, or hidden and Poisoned, cancel out). The attack ends hiding once rolled, so a Multiattack's later strikes are plain. A token the GM hid on the map gets no advantage this way.
- Dodge (an action): attacks against it at disadvantage until its next turn.
- Help (an action): advantage on a friend's next attack or check at the foe it's set on, with that foe beside the helper.
- Insight before talking (an action, proficient, with a language): DC 15; advantage on its next words to that one, for 2 rounds.
- Reckless Attack: no action, advantage on its attacks and against it until its next turn. Action Surge: 1 more action this turn.

Code: `rules.js` `coverBonus`, `modifiers.attack`, `usable`, `afterRoll`; `adapter.js` `#actions`; `edges.js` `INSIGHT_DC`, `helpAction`, `insightAction`.

### Grapples, webs, nets and bonds

Search: grapple, escape DC, grappled, restrained, web, net, bonds, rope, break free, Athletics, Acrobatics

What it decides: how hard each hold is to break. Every try, and freeing a friend, is an action; poisoned or frightened gives disadvantage, exhaustion −2 a level.

| Hold | Check and DC |
| --- | --- |
| A grapple | better of Athletics and Acrobatics against the escape DC its words give; else 2024: 8 + grappler's Str + proficiency; 2014: 10 + grappler's Athletics. A friend can't break it |
| Grappled on the sheet, grappler unknown | the hardest escape DC among standing foes within reach; none: 10 + its proficiency |
| Webs, grasping plants, a net | the Strength or Dexterity check their words name, against the DC they give or the spell's save DC; a friend beside it may try where the words allow (a net: DC 10) |
| FastFighting's bonds (rope) | 2024: Acrobatics DC 15 to slip, or Athletics DC 20 to burst (whichever is likelier); 2014: Strength DC 17. A friend unties them, no roll |

Code: `holds.js` `ROPE`, `HOLD_COST`, `escapeWords`, `grabEscapeDC`, `escapeFrom`, `bondsDC`, `breakFree`; `adapter.js` `#escapeDC`, `#escapeWork`.

### Swallowed and engulfed

Search: swallow, engulf, purple worm, gelatinous cube, regurgitate, spit up, gullet, ooze

What it decides: what happens inside a creature, and how it ends.

- Inside: blinded and restrained in a gullet, restrained in an ooze; the holder's listed damage at the start of each of the held creature's turns (a purple worm's 6d6 acid).
- A gullet has no action out. When those inside deal the listed damage to it in one turn (30 for a purple worm), it saves against the listed DC at once; a failure brings them all up, prone. Its death lets them out, prone.
- An ooze: an action and its listed check (a cube's DC 12 Strength); a friend beside it may pull it out where the creature has an Ooze Cube.

Code: `inside.js` `insideHolds`, `spitUp`, `outOfCorpse`; `adapter.js` `#inside`, `#takeIn`.

### Shove and Grapple

Search: Shove, push 5 feet, knock prone, Grapple, Unarmed Strike, maneuver

What it decides: the DC and result of a character's or humanoid's Shove and Grapple.

- An action; the target saves with its better of Strength and Dexterity against 8 + the attacker's Strength + proficiency, at most one size larger. A failed save: pushed 5 feet, or knocked prone (two options, the AI picks); Grapple: grappled, and it takes a free hand.

Code: `adapter.js` `#actions`.

### Pushes, falls and moving past others

Search: forced movement, Thunderwave, Gust of Wind, Repelling Blast, Push mastery, fall damage, difficult terrain, Halfling Nimbleness

What it decides: how far things move, and what a fall costs.

| Source | Push |
| --- | --- |
| Thunderwave | 10 ft on a failed save |
| Gust of Wind | 15 ft |
| Thunderous Smite | 10 ft and prone |
| Repelling Blast | 10 ft on each beam that hits |
| Whirlwind (Strength save) | 20 ft and prone |
| Repulsion Breath | as its words say, else 30 ft |
| Cold Gale | 30 ft |
| Hammer Throw (on a hit) | 15 ft |
| Forceful Hand | 5 ft + 5 per caster's spellcasting modifier |
| Deadly Leap (on a successful save) | 5 ft out of the way |
| Push mastery | 10 ft, Large or smaller |

- A fall: 1d6 bludgeoning per 10 feet, at most 20d6; prone only if it took damage.
- Through an ally's space, a downed or incapacitated creature's, a Tiny one's, or one two or more sizes off, as difficult terrain; around anyone else. Halfling Nimbleness: through any larger creature too.
- Standing up costs half its speed.

Code: `adapter.js` `FORCED_MOVES`, `PUSH_MASTERY`, `forcedMoveOf`; `rules.js` `fallDamage`, `fallProne`, `passThrough`, `standCost`.

### Dying and death saves

Search: death saves, death saving throw, massive damage, instant death, stabilize, Medicine DC 10, unconscious, 0 HP

What it decides: when a character dies.

- At 0 HP a character falls prone and unconscious. Creatures that aren't characters die at 0. Damage past 0 of at least its maximum HP kills outright.
- Death save at the start of its turn: d20 ≥ 10 a success; a natural 1 two failures; a natural 20 back up at 1 HP. Three successes: stable. Three failures: dead.
- Damage while down: one failure, two on a critical hit; it ends stability.
- Stabilize: Medicine against DC 10, an action, by a character or a humanoid.
- Healed: up, prone, death saves reset.

Code: `rules.js` `onDropped`, `recoveryCheck`, `firstAidDC`, `firstAid`, `onHealed`.

### Inspiration (fate)

Search: Inspiration, Heroic Inspiration, reroll, fate, keep from dying

What it decides: how Inspiration keeps someone alive.

- A character with Inspiration (Heroic Inspiration under 2024 rules) has 1 fate. When a blow, a save or a death save would kill someone, the core takes the roll back and spends it: its own first, else a friend's who senses it, with chance 1 − Selfish ÷ 100 (5% to 95%). Up to 3 rerolls.

Code: `adapter.js` `toCombatantSpec` (resources.fate); core `simulator.js` `fateful`.

### Concentration

Search: concentration, Constitution save, DC 10, half the damage

What it decides: when a concentration spell ends.

- One concentration spell at a time. Damage calls for a Constitution save against max(10, ½ damage rounded down), at most 30. Incapacitated, paralyzed, stunned, unconscious or petrified ends it.

Code: `rules.js` `concentration`.

### Undead Fortitude, Relentless Endurance and Regeneration

Search: Undead Fortitude, Relentless Endurance, Regeneration, troll, Regenerate, hold on at 1 HP

What it decides: when a creature stays up or mends itself.

- Undead Fortitude: a Constitution save against 5 + the damage taken, to stay at 1 HP; never against radiant or a critical hit (as its words say).
- Relentless Endurance: 1 HP instead of 0, no roll, once a long rest; not when the blow kills it outright.
- Regeneration: the hit points its words name at the start of its turn, stopped by the damage types they name (acid or fire for a troll). Regenerate: 1 HP a turn.

Code: `adapter.js` `holdOnFrom`, `regenerationFrom`, `lastingHealingFrom`, `#mending`; `rules.js` `adjustRoll`.

### Burning and lingering acid

Search: Burning, on fire, alchemist's fire, douse, put out, Acid Arrow, corroding

What it decides: harm that lasts.

- Burning: 1d4 fire at the start of each of its turns, or what the source says (a 2014 fire elemental's 1d10). Putting it out (an action): 2024, drop prone, no roll; 2014, a DC 10 Dexterity check. A friend beside it can beat the flames out.
- Acid Arrow's acid at the end of the target's next turn is the core's corroding; nothing scrapes it off.

Code: `rules.js` `conditionHarm`, `conditionProfile`, `remedies`, `douse`; `adapter.js` `#burns`, `#lingering`.

### Riders on a hit

Search: Divine Smite, smite, Eldritch Smite, Stunning Strike, Battle Master, superiority die, Precision Attack, Sneak Attack, Radiant Strikes, Hunter's Mark, Hex

What it decides: what a creature can add to a hit, and for what.

- Smites, Stunning Strike and Battle Master maneuvers are offered when a hit lands; the creature decides whether the hit is worth the slot, Focus or superiority die. A higher slot adds its damage per level.
- 2014 Divine Smite: any slot, 2d8 + 1d8 per slot level above 1st, up to 5d8; a bigger version against fiends and undead.
- Precision Attack: the superiority die on a close miss (d8; d10 at 10th; d12 at 18th, from the sheet).
- Sneak Attack: once a turn, a finesse or ranged weapon, with advantage or an ally beside the target; the sheet's dice, else ⌈level ÷ 2⌉d6.
- Radiant Strikes (Improved Divine Smite): 1d8 radiant on every melee weapon hit.

Code: `riders.js` `ON_HIT`, `ridersFrom`; `adapter.js` `#onHit`, `#hitCost`, `#superiorityDie`, `#sneakAttack`.

### Reactions

Search: opportunity attack, Disengage, Shield spell, Uncanny Dodge, Hellish Rebuke, Counterspell, Parry, Riposte, Deflect Attacks, Protection, Death Burst

What it decides: what each reaction does (one a round; none while slowed).

| Reaction | Effect |
| --- | --- |
| Opportunity attack | anyone with a melee attack, at a foe leaving its reach; Disengage avoids it (a bonus action with Cunning Action or Nimble Escape) |
| Shield (or any reaction spell raising AC) | its AC bonus, +5 for Shield, from the cheapest slot that works |
| Uncanny Dodge | halves a hit |
| Deflect Attacks / Missiles | 1d10 + Dex + level off a physical hit |
| Parry | a superiority die + Dex off a melee hit; Riposte strikes back at a melee miss |
| Hellish Rebuke | its save and damage, more per slot level, within 60 ft |
| Counterspell | 2024: the caster's Constitution save against its DC; 2014: a spell of the slot's level or lower fails, a higher one on a spellcasting check |
| Protection style (with a shield) | +5 AC for a friend within 5 ft (its disadvantage) |
| Death Burst | as it dies, a save for everyone within its area |

Code: `adapter.js` `#reactions`; `rules.js` `reactions`, `opportunity`, `disengage`.

### Turn, attacks and resources

Search: action, bonus action, spell slot, Extra Attack, Multiattack, two-weapon fighting, off hand, Martial Arts, Flurry of Blows, Recharge, legendary actions, Legendary Resistance

What it decides: what a turn holds.

- An action, a bonus action, its speed, and one spell slot a turn. Dash trades the action for another move.
- Extra Attack: 2 attacks (Thirsting Blade too); "two extra attacks" 3; "three extra attacks" 4. From two classes it doesn't add up.
- Off-hand light weapon: a bonus action, without its ability modifier unless it has the Two-Weapon Fighting style. Flurry of Blows: 2 unarmed strikes (3 with Heightened Focus) for a point of Focus.
- Recharge 5–6: rolls a d6 at the start of its turn; back on that number or more.
- Legendary actions spend the pool by their cost ("Costs 2 Actions"). Legendary Resistance turns a failed save that matters into a success.
- Save DC where the sheet gives none: 8 + proficiency + 3.

Code: `rules.js` `turn`, `costOf`; `adapter.js` `#actions`, `#bonusStrikes`, `rechargeOf`, `legendaryCost`.

### Doors, talking, theft and leadership

Search: door, thieves' tools, Persuasion, Intimidation, Deception, passive Insight, Sleight of Hand, passive Perception, leader

What it decides: the map's and the standoff's numbers.

- A door: AC 15, 18 HP; forced (Athletics) or picked (thieves' tools) at DC 15, an action each; opening is free.
- Persuade, threaten and bluff against passive Insight; steal (Sleight of Hand) against passive Perception, for anyone but a beast or a creature of Intelligence 3 or less.
- Resolve: its Wisdom save − (proficiency + 1).
- Leader score: best of Persuasion and Intimidation − (proficiency + 2); a commanding feature (Leadership, Rallying Cry) +3. 6 or more: Brave +20, Tactical floor 60; 3 to 5: +15, 50; 0 to 2: +10, 40; below 0: +5.

Code: `rules.js` `door`, `doorCosts`; `adapter.js` `toCombatantSpec` (social, theft); `leadership.js` `rankLeaders`, `leaderBonus`.

### Personality from the sheet

Search: personality, Tactical, Brave, Selfish, Loyal, beast, mindless, alignment, loyalty score

What it decides: the four hidden traits FastFighting starts a 5e creature with.

- A creature: Tactical 35 + 8 × Int modifier + 2 × Wis (5 to 95); a beast 15 + 3 × Wis (5 to 35); mindless (Int 3 or less, not a beast, monstrosity or dragon) at most 10; Pack Tactics at least 25. Brave 50 + 5 × (Wis save − (3 + ⌊CR ÷ 4⌋)) (10 to 90); mindless undead or construct 100, construct 95, beast at most 45. Selfish 50 (fiend 75, celestial 20, beast 55). Loyal 50 (a servant 85, a mindless construct or undead 90). Alignment: good Selfish −10, evil +12, lawful Loyal +8, chaotic −8 (half for a character). A loyalty score: (score − 10) × 1.2 Loyal (−12 to +12).
- A player character starts at the usual hero (65, 75, 25, 80): Tactical (Int mod − 1) × 3, (Wis mod − 1) × 2, (level − 5) × 0.5; Brave (Wis save − (1 + ⌊proficiency ÷ 2⌋)) × 2 (−10 to +10), (Con mod − 2) × 1.5; classes by share of levels, subclass, background, skills and features by their tables; exhaustion Brave −2 a level (to −8); not in the party, Loyal −10. Characters stay within 5 to 95, others 0 to 100.

Code: `traits.js` `deriveDnd5eTraits`, `pcParts`, `sharedParts`, `CLASS_LEANS`, `ALIGNMENT_LEANS`, `LOYAL_BY_KIND`.

### Typical numbers by challenge rating

Search: proficiency bonus, typical AC, typical DC, CR, areas

What it decides: the numbers used where a sheet says nothing.

- Proficiency: 2 + ⌊(level or CR − 1) ÷ 4⌋ (CR 1–4: 2, 5–8: 3, 9–12: 4 ...).
- Typical AC 12 + proficiency, save proficiency + 1, skill proficiency + 2, DC 10 + proficiency.
- Ongoing damage with no save of its own ends on a d20 of 11 or more.
- Foes in an area: the count it names; a line 3 at 60 feet or more, else 2; a cone 3 at 30 or more, else 2; anything else 4 at 20 or more, 3 at 10, else 2.

Code: `rules.js` `proficiency`, `typical`, `persistentFlatCheck`; `adapter.js` `areaTargets`.

## DCC

Repo: FastFighting-DCC. It works in XCC worlds too. With the DCC or XCC core book installed it reads the book's tables; without them it uses rough built-in versions, marked as guesses.

### Action dice, crits and fumbles

Search: action die, d24, d16, d14, dice chain, crit range, crit table, crit die, fumble, natural 1, two-weapon fighting, initiative die

What it decides: how a DCC attack and check land.

- One action per action die (a giant's d24 then d16; a high-level character's second die). Each action rolls its die.
- An attack: a natural at or under its fumble range misses (and a player character rolls the fumble table); the top face always hits; a hit whose natural is in the crit range crits. The crit range scales to the die: 19–20 on a d20 is 23–24 on a d24. A stat line's "crit on 21+" is read on the die it names.
- A crit rolls the crit die + Luck modifier on the crit table (the attacker's); a monster's crit on a player character takes that character's Luck modifier off. A row's extra damage goes on top of the blow; a row that says double or triple damage multiplies the whole blow by 2 or 3. Without a book: the crit die as extra damage.
- A fumble: the fumble die (from its armor) − Luck modifier on the fumble table.
- A check or save: a natural 1 fails, the top face of a d20 or bigger succeeds; else the DC. A hit deals at least 1.
- Initiative: a d20, a d16 with a two-handed weapon in hand, or a weapon's own.
- Two weapons (primary and off hand): one action, each on the die the system stepped down; a hand with no crits can't crit, one that crits on its highest face only does so there.

Code: `rules.js` `degreeOfSuccess`, `actionDie`, `turn`; `adapter.js` `#weaponAction`, `#crit`, `#fumble`, `initiativeDie`; `text.js` `critOnFor`, `damageMultiple`; the core's `engine/simulator.js` (a row's `multiply`).

### Lore-Collector advantage

Search: Lore-Collector, Lore-Collector advantage, loreBoost, Intelligence check, size up, boost

What it decides: how much sizing a foe up improves a Lore-Collector's rolls against that kind of foe.

- The check: Intelligence modifier against DC 10 (55% at +0). Not for the mindless or constructs. With one action die it takes the turn.
- On a success, through its next turn (the rest of this turn with a second action die), each roll against a foe of that sort gets the smallest bonus, 1 to 30, that makes it succeed at least min(boost × its chance, 95%, its chance at +30).
- **Lore-Collector advantage** (`fast-fighting-dcc.loreBoost`): 1.25× to 3× in steps of 0.05, default 2.25×.
- Why 2.25×: the check takes the whole turn, but deed dice and Luck already swing a fight hard, so it's below 5e's 2.5×. Past about 1.75×, ordinary attacks (54% or better) hit the 95% cap; only long shots gain more.
- Example: +2 against AC 16 hits 35%; at 2.25× it aims for 79% and gets +9.

Code: `lore.js` `LORE_BOOST`; `adapter.js` `toCombatantSpec` (sizeUp); core `battle-state.js` `boostBonus`.

### Conditions and situational modifiers

Search: prone, blinded, frightened, slowed, disarmed, hidden, stunned, charge, firing into melee, cover, long range, backstab

What it decides: what conditions and positions do to rolls.

| Condition or situation | Effect |
| --- | --- |
| prone | −4 to its attacks; +2 to a melee attack at it |
| blinded | −4 to its attacks, −2 AC |
| frightened | −2 to its attacks and saves |
| slowed | −2 to its attacks and AC |
| disarmed | −4 to its weapons' blows (not claws or fangs) |
| hidden | +4 AC; its next attack catches the foe unready (a thief's backstab); ends when it attacks |
| stunned | loses its next action; a melee attack at it +2 |
| incapacitated (asleep, paralyzed, out cold) | no actions; a melee attack at it +2 |
| charge (melee after moving half its speed) | +2 to hit, −2 AC until its next turn |
| cover (walls hide any of the target) | −2 to hit, melee or missile; nothing for saves |
| firing into a melee | −1; half its misses go to a random friend in that melee, attacked again |
| beyond range increment | −2; beyond twice it, −4 |

- Open to a backstab: prone, flanked, incapacitated, blinded, stunned, or caught by a hidden attacker. A thief's backstab adds the weapon's backstab damage and half its class backstab bonus as damage.
- Withdrawing from a melee gives every engaged foe a free attack; there's no limit a round.

Code: `rules.js` `conditionMods`, `conditionsOn`, `modifiers`, `charging`, `strayShot`, `COVER_PENALTY`, `reactions`; `adapter.js` `#weaponAction` (backstab).

### Mighty Deeds

Search: Mighty Deed, deed die, deeds of arms, trip, blinding attack, disarm, pushback, defensive maneuver, rallying maneuver, warrior, dwarf

What it decides: what a deed does at each deed-die roll.

- Anyone whose attack bonus is a die rolls it with every attack, adding it to the roll and the damage. The deed lands on a hit with 3 or more on the deed die.
- The world's deed tables when a book has them; else the built-in tiers. Pushback always uses the built-in distances.

| Deed | 3+ | 5+ | 7+ |
| --- | --- | --- | --- |
| Trip (melee) | prone, 1 round | prone and −2 to attacks, 2 rounds | — |
| Blinding attack | −2 to attacks, 1 round | blinded, 2 rounds | blinded, 5 rounds |
| Disarm (a foe with a weapon in hand) | 4+: disarmed, 1 round | 6+: disarmed, 3 rounds | — |
| Pushback (melee) | 5 ft | 10 ft | — |
| Defensive maneuver | +1 AC, 1 round | +2 AC | +3 AC |
| Rally (friends nearby) | +1 to next attack, within 10 ft | +2, within 20 ft | +2 to attacks and saves, within 30 ft |

- A book's rally row: its bonus to friends' morale checks, a second check for one whose group has broke, within 10 ft × max(1, ⌊deed ÷ 3⌋).

Code: `deeds.js` `builtIn`, `deedsFrom`, `tierFrom`, `rallyTier`.

### Grapples and holds

Search: grapple, opposed roll, grip, pinned, break free, escape DC, size, Restrained, web, net, bonds, tied up

What it decides: grapple rolls and how hard holds are to break.

- Grapple (an action): attack bonus + the better of Strength and Agility (a monster: its best melee attack bonus + Hit Dice), against 10 + the defender's grapple. Won: pinned in the grip.
- Breaking a grip: the same roll on its first action die, against 10 + the grabber's grapple.
- Size, by the tokens' sizes, to the bigger one: twice the other's size +4, three times +8, four times +16, doubling on.
- Bonds, Restrained (a web, a net, ropes) and XCC's Grappled with no grabber known: DC 15. A friend beside a Restrained creature can tear it loose with the same roll.

Code: `rules.js` `sizeEdge`, `defenseDc`, `breakFree`, `ESCAPE_DC`, `SHEET_HOLDS`, `bondsDC`; `adapter.js` `toCombatantSpec` (grapple, escapeWork, escapeDC); `moves.js` `grappleAction`.

### Tied up stops spells

Search: Tied up stops spells, tiedStopsSpells, tied up, bound, cast while tied, free hands

What it decides: whether a tied-up creature can cast.

- **Tied up stops spells** (`fast-fighting-dcc.tiedStopsSpells`), on by default. On: no spells while tied up. Off: it can cast, and may cast instead of struggling free.

Code: `tied.js` `registerTiedStopsSpells`, `tiedStopsSpells`.

### Luck, spellburn, Fleeting Luck and Mojo

Search: Luck, burn Luck, luck die, halfling, spellburn, Fleeting Luck, Mojo, enableFleetingLuck

What it decides: when a character spends points to make a roll good.

| Pool | Each point | Notes |
| --- | --- | --- |
| Fleeting Luck (world setting on) or Mojo (XCC) | +1 | spent first; at most 20 counted |
| Luck | +1; a thief rolls its luck die (d3 by default); a halfling +2 | keeps min(6, Luck) back unless a life is at stake; a halfling gives +1 a point to a friend within 30 ft |
| Spellburn (wizards, elves) | +1 on spell checks | pool: each of Strength, Agility and Stamina above 8 |

- It spends only on a roll that falls short. Chance: stakes (0 to 1, the core's) × 1.2 for a pool that comes back (Fleeting Luck, a thief's or halfling's Luck) or × 0.8, × ½ conserving or × 1.5 all out, at most 95%; on a friend's roll also × (1 − Selfish ÷ 100). At most 4 points a roll (2 for a pool that doesn't come back) unless the stakes are 0.85 or more.
- Fleeting Luck: a character's natural 20 on a d20 earns its pool a point; a natural 1 on a d14 or bigger empties every pool.
- Live battles write spellburn from Strength, then Stamina, then Agility, none below 3.

Code: `adapter.js` `toCombatantSpec` (boosts), `fleetingOf`, `FLEETING_MAX`; `rules.js` `afterRoll`; core `behavior/luck.js` `boost`; `commit.js` (spellburn).

### Spells, Lay on Hands and Turn Unholy

Search: spell check, spell lost, disapproval, cleric, wizard, Lay on Hands, Turn Unholy, results table

What it decides: what a spell check does.

- A spell check rolls the action die; the spell's results table says what each total does. A save's DC is the check's total.
- A wizard or elf loses the spell for the day on a failure. A cleric: a natural at or under its disapproval range fails, and each failure widens the range by 1. Monsters lose nothing.
- Lay on Hands: so many of the target's hit dice, from the table's middle (adjacent alignment) column; built in: 12–15 1 die, 16–19 2, 20+ 3.
- Turn Unholy: un-dead, demons and devils up to so many Hit Dice cower 3 rounds, up to 3 targets within 30 ft; built in: 12–17 1 HD, 18–23 2, 24+ 4.

Code: `spells.js` `spellAction`, `layOnHandsAction`, `turnUnholyAction`; core `behavior/casting.js`.

### Spell duels

Search: spell duel, counterspell, Dispel Magic, Fire Resistance, Magic Shield, Invoke Patron

What it decides: when a caster answers a foe's spell.

- A foe's caster yet to act this round answers a spell that worked with one that counters it: the same spell, Dispel Magic, Fire Resistance against a fire spell, Magic Shield against Magic Missile, Invoke Patron against Invoke Patron (none lost for the day).
- The checks are compared: higher, the spell is undone; a tie, neither stands; lower or failed, it goes on. Answering costs its next action.

Code: `rules.js` `duel`, `counters`.

### Morale

Search: morale, morale check, DC 11, Will, flee, rout, retainer, Personality, rally

What it decides: when a group of creatures breaks.

- Player characters make no DCC morale check (the core's own rules for them stand). A group checks when its first falls and when half of it is down; a creature alone, at half its hit points.
- Whichever of the group acts next rolls for all: d20 + Will (+ the employer's Personality modifier for a retainer: the party leader's, else the best character's) + a rally's morale bonus, against DC 11. Under: the whole group flees.
- A rally's second check lets one whose group broke stay. The mindless and the fearless never break.

Code: `rules.js` `morale`, `moraleCheck`, `MORALE_DC`, `employerOf`, `rallyOf`.

### Dying: bleeding out, binding wounds and the body

Search: bleeding out, dying, 0 HP, Stamina loss, roll the body, Luck check, groggy, binding wounds, first aid, Too Cute to Die

What it decides: when a character dies, and when it isn't dead after all.

- Monsters and 0-level characters die at 0 HP. Anyone else bleeds out for as many rounds as its level; healed in time, it loses a point of Stamina for good.
- Binding a friend's wound (homebrew: an action beside it, once): a d20 against 21 − its Luck, the same odds as d20 ≤ Luck. Made, it stops bleeding, still out, a point of Stamina gone.
- After the fight, friends who hold the field roll the body: d20 ≤ Luck finds it alive at 1 HP, groggy, a point of Strength, Agility or Stamina (1d3) gone for good. An XCC Dungeon Hottie may pass a failed roll for a point of Luck, once a level.

Code: `rules.js` `onDropped`, `recoveryCheck`, `onHealed`, `firstAidDC`, `canFirstAid`, `firstAid`, `recoverBody`.

### Regeneration

Search: regenerate, regeneration, troll, heal per round, fast healing

What it decides: how a monster mends itself.

- Its stat line's "regenerates 1d6 hp per round" (the average each round) or "heal 2 hp per round". Harm it doesn't regenerate from stops it for a turn.
- At 0 HP a regenerating monster is dead, unless its words say it regenerates even the round it's killed: then it rolls the dice once; if it was taken below 0 by less than that, it can get up again.

Code: `text.js` `mendingIn`; `rules.js` `lastBurst`; `adapter.js` `#mending`.

### Help, Hide, theft and doors

Search: Help, Hide, Hide in Shadows, Sneak and Hide, untrained d10, Pick Pockets, Pick Lock, force a door, infravision

What it decides: the everyday rolls.

- Help (homebrew): an action, the foe beside the helper; +2 to the friend's next attack or check (a step up the dice chain).
- Hide: a thief's Hide in Shadows (a halfling's Sneak and Hide) + Agility on the d20; anyone else Agility on a d10; against 10 + the sharpest foe's perception (its better of Intelligence and Personality). Not with a foe beside it. Hidden up to 10 rounds, until it attacks.
- Theft: a thief's Pick Pockets + Agility; another character Agility on a d10.
- A door: AC 15, about 15 HP; Strength against DC 15 to force it; a thief's Pick Lock + Agility (another character Agility on a d10) to pick it; an action each.
- Infravision: the stat line's, else a dwarf's or elf's 60 ft, a halfling's 30.
- A fall: 1d6 per 10 feet, no limit, prone.

Code: `moves.js` `helpAction`, `hideAction`; `adapter.js` `toCombatantSpec` (theft, doorWork), `#infravision`; `rules.js` `door`, `fallDamage`.

### XCC classes

Search: XCC, Brawler, Jammer, Disrespect, Gnome, Draw Agro, Athlete, wrestling, Dungeon Hottie, Not in the Face, Acrobat, acrobatics, Toughness

What it decides: the XCC classes' own numbers.

| Class | Numbers |
| --- | --- |
| Brawler | unarmed: two attacks on a d16 each, a crit on 16, no fumble alone; armed: a free d14 unarmed attack a round. To hit and damage: attack bonus + Strength + Luck (when it helps), on its unarmed die (1d3 by default). No crits in armor with a check penalty of −4 or worse. Toughness off every melee blow |
| Jammer, Disrespect | its foe saves Will against round(10.5 + Personality + level + Luck); failed: −2 per dice-chain step to attacks, checks and damage, for level + Personality rounds |
| Gnome, Draw Agro | within 60 ft, Will against round(10.5 + Personality + level + Luck when it helps); failed: the foe wants the gnome (desire 80) for a round, or takes −2 (−4 from 5th level) on rolls at anyone else; each attack it draws earns a Mojo point |
| Athlete, wrestling | 1d4 + Strength, its training die rolled like a deed die, its own crit range; a hit grabs; not with a shield |
| Dungeon Hottie, Not in the Face | a round spent defending: its bonus to AC until its next turn |
| Acrobat, Half-Elf | getting clear of a melee: half its move and a check, 15 for one foe, 20 for several; missed, the free attacks come |

- The mindless ignore Disrespect and Draw Agro.

Code: `adapter.js` `brawlerFists`, `disrespect`, `drawAgro`, `wrestling`, `notInTheFace`, `toughnessOf`; `rules.js` `disengage`.

### Talking and leadership

Search: Personality, persuade, intimidate, deceive, Will, leader, title, cleric

What it decides: the DCs for words, and who leads.

- Persuade and deceive with Personality; intimidate with the better of Personality and Strength. Against 10 + Will (deceive: 10 + the better of Will and Intelligence); theft against 10 + the better of Reflex and Intelligence.
- Resolve: Will − (⌊level ÷ 2⌋ + 1).
- Leader score: Personality modifier + ⌊level ÷ 3⌋; a title in its name (king, thane, captain ...) +3; a cleric +1. 5 or more: Brave +20, Tactical floor 55; 3 to 4: +15, 45; 1 to 2: +10, 35; 0 or less: +5.

Code: `adapter.js` `toCombatantSpec` (social); `leadership.js` `rankDccLeaders`, `leaderBonus`.

### Personality from the sheet

Search: personality, funnel, 0-level, Tactical, Brave, Selfish, Loyal, birth augur, alignment, beast, mindless

What it decides: the four hidden traits FastFighting starts a DCC creature with.

- A monster: Tactical 40 (an Intelligence score: 35 + 8 × its modifier; a beast 20; mindless 5; a caster or a clever-sounding name 60). Brave 50 + 5 × (Will − (⌊HD ÷ 2⌋ + 1)) (10 to 90); un-dead or mindless 100; a beast at most 45. Selfish 50 (chaotic 60, lawful 35); Loyal 50 (lawful 60, chaotic 40). Immune to fear +10 Brave; demon or devil +8 Selfish.
- A player character starts at the usual hero (65, 75, 25, 80). A 0-level: Tactical −20, Brave −25, Selfish +10, Loyal −25 (about 45, 50, 35, 55). Otherwise Tactical + (level − 3), Brave + (level − 3) ÷ 2. Abilities per modifier point: Int Tactical +3, Agility Tactical +1, Strength Brave +1, Stamina Brave +1.5, Luck Brave +1.5, Personality Loyal +2. Will against the usual for its level, Brave × 3. Hit points: Brave (HP − usual) ÷ usual × 8, −4 to +4, where usual = 2.5 + Sta + level × ((die + 1) ÷ 2 + Sta). Lawful Selfish −6, Loyal +5; chaotic Selfish +12, Loyal −8 (× 1.5 for a cleric). Birth augur: its Luck modifier × 1.5 on the trait its sign governs. In no party: Loyal −8. Characters stay within 5 to 95, others 0 to 100.

Code: `traits.js` `deriveDccTraits`, `pcParts`, `ZERO`, `USUAL_WILL`, `usualHp`, `ABILITY_LEANS`, `CLASS_LEANS`, `augurLean`.

### Typical numbers by level

Search: typical AC, typical DC, hit dice, level

What it decides: the numbers used where a sheet says nothing.

- AC 11 + ⌊level ÷ 2⌋; save and skill ⌊level ÷ 2⌋ + 1; DC 10 + level. A monster's level is its Hit Dice.
- Persistent harm ends on a d20 of 11 or more.

Code: `rules.js` `typical`, `persistentFlatCheck`.

## Daggerheart

Repo: FastFighting-Daggerheart. It follows the system's settings: Range Measurement, Massive Damage, the Defeated automation, the GM's Fear and the world's currency.

### The Duality Dice and the adversary's d20

Search: Duality Dice, Hope die, Fear die, d12, critical, with Hope, with Fear, reaction roll, advantage d6, adversary d20, critical threshold

What it decides: how each roll lands.

- A character (and its companion) rolls two d12s, Hope and Fear, + modifier against the Difficulty; advantage +d6, disadvantage −d6. Matching dice: a critical success whatever the total. Otherwise, the total meets the Difficulty or not.
- With Hope (Hope die higher): +1 Hope (to its maximum). With Fear: the GM +1 Fear (at most 12). A critical: +1 Hope and 1 Stress cleared, and critical damage on an attack. A roll that fails, or goes with Fear, hands the spotlight to the GM.
- A reaction roll brings neither, and its critical is only a success. Against something taking hold of the body (a spreading sickness) it uses Strength.
- An adversary rolls a d20 + modifier (advantage: the better of two). A natural at or over its critical threshold (20 unless the sheet says) always succeeds, as a critical.
- Critical damage: the damage rolled plus the most its dice could show.
- A Duality point counts as 0.1 of a success (a d20 point 0.085), so the core's flat condition penalties shrink by 0.085 ÷ 0.1: a core −1 becomes −0.85.

Code: `dice.js` `dualityChances`, `rollDuality`, `rollD20`; `rules.js` `roll`, `settle`, `critical`, `rollPoint`, `toughSave`.

### Lore-Collector advantage (Analyze or Perceive)

Search: Lore-Collector, Lore-Collector advantage, loreBoost, Analyze, Perceive, Knowledge, Instinct, size up, boost

What it decides: how much sizing a foe up improves a Lore-Collector's next roll against it.

- The check: the better of Knowledge (Analyze) and Instinct (Perceive) against the foe's Difficulty (12 where none), the spotlight's action. A success makes its next roll against that sort of foe, through its next turn, get the smallest bonus, 1 to 30, that makes it succeed at least min(boost × its chance, 95%, its chance at +30). One roll only.
- **Lore-Collector advantage** (`fast-fighting-daggerheart.loreBoost`): 1.25× to 3× in steps of 0.05, default 2.4×.
- Why 2.4×: a Lore-Collector's best trait, +2, against Difficulty 12 succeeds 77.8% (72.2% against 13), and a failure also hands the GM the spotlight. To repay the action, the one boosted roll must be about 1 + 1.1 ÷ 0.78 ≈ 2.4 times as likely to succeed (the 1.1: the action, plus a little for that spotlight).
- Example: +0 against Difficulty 17 succeeds 30.6%; at 2.4× it aims for 73% and gets +7 (77.8%).

Code: `lore.js` `LORE_BOOST`; `adapter.js` `#character` (sizeUp); `rules.js` `sizeUpDC`.

### Hope and Experiences

Search: Hope, Hope feature, Experience, spend Hope, Help an Ally, Resources answer

What it decides: when a character spends Hope.

- Before rolling, it spends a Hope on its best Experience when one fits (a 60% chance) and the bonus raises its chance of success by at least 20 points (Resources: conserve), 12 (balanced) or 6 (nova).
- Unless nova, a character with a 3-Hope feature keeps 3 Hope back, except on a roll under 35% likely to work.
- The AI weighs a Hope at 0.3 Hit Points, only as far as it has room.
- Help an Ally: a Hope, no spotlight of its own, once a turn, within Close: a d6 on the friend's next action roll.

Code: `rules.js` `experienceFor`, `HOPE_SPENDING`, `FITS`, `HOPE_WORTH`, `resourceWorth`; `actions.js` `helpAnAlly`; `adapter.js` `#character` (hopeReserve).

### Fear and the spotlight

Search: Fear, GM's Fear, spotlight, GM turn, Spending Fear, Sparing, Steady, Free, Relentless, initiative

What it decides: who acts, and how freely the GM spends Fear.

- No initiative: each character takes the spotlight in turn. After one whose roll failed or went with Fear, a GM turn: the adversary that has waited longest acts, and each Fear spent brings one more. The party's other friends act at the end of the round.
- The planner's Daggerheart row: **Fear** (0 to 12; it starts at the world's Fear, else one for each character) and **Spending Fear**:

| Spending | One more adversary for a Fear |
| --- | --- |
| Sparing | once, only while the GM holds more than 4 |
| Steady (default) | once, while the GM holds more than 1 |
| Free | as often as there's Fear |

- A Solo with Relentless (X) can take the spotlight X times in a GM turn. Fear features and summonings draw on the pool.

Code: `rules.js` `FEAR_MAX`, `FEAR_SPENDING`, `gmTurn`, `roundTurns`, `initRun`, `nextSpotlight`; `adapter.js` `plannerSettings`.

### Hit Points, thresholds, Armor Slots and Stress

Search: Hit Points, damage thresholds, Major, Severe, Massive Damage, Armor Slot, Stress, Stress damage, resistance, direct damage

What it decides: how damage becomes Hit Points marked.

- Per type: immunity ignores it; resistance halves (rounded down); reduction comes off.
- Then by the thresholds: under Major 1 HP, Major 2, Severe 3; twice Severe 4 with the **Massive Damage** rule. A feature's severity reduction takes steps off; immunity to Minor ignores a 1-HP hit.
- A character marks an Armor Slot to take one step off, by its **Shields** answer: always (any hit), sparingly (Major or worse), never (only Severe). Unanswered: Major or worse, or any hit while it has more than half its slots. Direct damage: no Armor Slot.
- Stress damage marks Stress; Stress it can't mark becomes Hit Points.
- The AI weighs a Stress cleared at 0.25 Hit Points, 1.5 times that with no Stress left to mark.

Code: `rules.js` `applyIwr`, `marksFor`, `marksArmor`, `STRESS_WORTH`; `adapter.js` `harmOf`.

### Minions, hordes and companions

Search: Minion, Minion (X), Horde, Leader, Solo, companion, Beastbound

What it decides: adversary types' own numbers.

- A Minion falls to any damage. Minion (X): each X damage fells another of its kind on its side (summoned ones too).
- A Horde hits for its lesser damage once it has marked half its Hit Points (the sheet's horde HP).
- A companion attacks with its partner's Spellcast and Proficiency and rolls its partner's Duality Dice (Hope to the partner, Fear to the GM). Any damage marks one Stress; at its last it's out of the fight. It acts at the end of the round.

Code: `rules.js` `kinUp`, `onDropped`, `usable`, `applyIwr`; `adapter.js` `#adversary`, `#companion`.

### Death moves

Search: death move, Avoid Death, Risk It All, Blaze of Glory, scar, last Hit Point, out cold

What it decides: what happens when a character marks its last Hit Point.

- Its playstyles choose: Martyr or Redeem-Seeker Blaze of Glory; Wildcard, Impatient, Brawler, Speed-Runner, Instigator, Vengeful or Relentless Risk It All; Chicken, Fragile, Lazy, Mercenary, Diplomat, Peacekeeper, Skeptic or Wallflower Avoid Death. Otherwise Brave 80 or more, or never retreating, Risks It All; the rest Avoid Death.
- Avoid Death: out cold; a d12 (the Hope die) at or under its level leaves a scar.
- Risk It All: the Duality Dice. Hope higher: it clears that many Hit Points and fights on. Fear higher (45.8%): it dies. Matching (8.3%): every Hit Point and Stress cleared.
- Blaze of Glory: one last action, a critical success, then it dies.
- Struck while out cold (homebrew): the Duality Dice; Fear higher, it dies; otherwise it hangs on.
- An adversary whose last Hit Point is marked is defeated; one who would kill, kills it.

Code: `rules.js` `onDropped`, `deathMoveOf`, `DEATH_LEANS`.

### Tending a friend out cold

Search: tend, first aid, out cold, Instinct, Knowledge, Difficulty 12

What it decides: how a friend helps one who Avoided Death.

- Homebrew: the better of Instinct and Knowledge against Difficulty 12. A success keeps it safe from a finishing blow; a critical also clears a Hit Point and gets it up.

Code: `rules.js` `firstAidDC`, `firstAid`.

### Conditions and Restrained

Search: Vulnerable, Hidden, Restrained, condition, break free, escape, Difficulty, bonds

What it decides: what the three conditions do, and how holds break.

- Vulnerable: rolls against it with advantage. Hidden: with disadvantage; it ends when it attacks. Restrained: it can't move, but can act.
- Effects an action lays last 2 rounds.

| Hold | Break it |
| --- | --- |
| Restrained by an adversary | a character: the better of Strength and Agility against that adversary's Difficulty; a friend beside it: Strength or Finesse |
| Restrained from the sheet, or by a character | against the typical Difficulty for its level: 11 + ⌈level ÷ 3⌉ (12 at levels 1–3) |
| A character's Grapple grip | 12 + its Strength (at least 12) |
| An adversary's grip | its Difficulty |
| FastFighting's bonds (homebrew) | typical Difficulty + 2 (14 at levels 1–3); an adversary a d20 + its attack modifier; a friend unties them, no roll |

- Each try is the spotlight's action and brings Hope or Fear like any action roll. An adversary clears a hold when the GM spotlights it, spending that spotlight, with no roll.

Code: `rules.js` `modifiers.attack`, `escapeFrom`, `bondsDC`, `breakFree`, `typical`; `actions.js` `CONDITION_KEYS`, `traitMoves`.

### Tied up stops spells

Search: Tied up stops spells, tiedStopsSpells, tied up, cast while tied, free hands

What it decides: whether a tied-up creature can cast.

- **Tied up stops spells** (`fast-fighting-daggerheart.tiedStopsSpells`), on by default. On: no spells until it's free. Off: it can cast. A weapon needs as many hands as its burden; a natural attack none, a fist one.

Code: `tied-up.js` `registerTiedStopsSpells`, `tiedStopsSpells`.

### Trait moves, Sprint and Hide

Search: Grapple, Maneuver, Shove, Hide, Sprint, trait move, Strength, Agility, Finesse

What it decides: each move's roll and result.

| Move | Roll | Success | Critical |
| --- | --- | --- | --- |
| Grapple | Strength against the foe's Difficulty | held (the core's grab) | held, and Restrained (2 rounds at most) |
| Maneuver | Agility against Difficulty | Vulnerable until it next acts | the same |
| Shove (homebrew) | Strength against Difficulty | out of Melee to Very Close (10 ft) | to Close (25 ft) |
| Hide | Finesse against 12 | Hidden, 2 rounds, until it attacks | the same |

- Sprint (one in a hurry, no foe within Close): a character rolls Agility against 12 as its action; made, up to Far (60 ft), missed, its usual move. An adversary moves up to Very Far (120 ft).

Code: `actions.js` `traitMoves`; `rules.js` `startTurn`, `turn`.

### Knockbacks, falls, collisions and ranges

Search: knockback, fall damage, collision, Very Close, Close, Far, Very Far, Range Measurement, Ground Slam, Bear

What it decides: forced movement and its damage.

- Ranges: Melee 5 ft, Very Close 15, Close 30, Far 60, Very Far 120, or the **Range Measurement** rule's. Foes an area takes in: Melee 1, Very Close 2, Close 3, Far 4, Very Far 5.
- A fall: Very Close 1d10 + 3 physical, Close 1d20 + 5, Far or more 1d100 + 15. Nobody lands prone.
- An adversary's knockback stopped short: 1d20 + 5 direct physical; whoever it hits takes nothing.
- Known SRD features by compendium id: knocked back to a band push as far as that band lies past the feature's reach (from Melee where it reaches that far); pulls bring the foe in from the feature's reach. The Bear's Overwhelming Force: to Very Close, only on a hit that marks Hit Points.

Code: `rules.js` `fallDamage`, `collisionDamage`; `actions.js` `RANGES`, `AREA_TARGETS`, `FEATURE_MOVES`, `featureMove`, `attackMove`; `adapter.js` `ranges`.

### Summons

Search: summon, summoning, @partySize, The Hunt Is On, Grow Saplings

What it decides: how many creatures a summoning calls, and its cost.

- Its count formula's average (`@partySize` is the party's size; with no party, the player characters), at most 8 of one creature.
- SRD summonings whose data leaves out their Fear cost: The Hunt Is On 2, Open the Gates of Death 1, Grow Saplings 1, Difilers Abound 2, Stormheart 1, Into the Spider's Web 1.

Code: `actions.js` `summonCount`, `SUMMON_MOST`, `SUMMON_FEAR`, `toSummonSpec`.

### Doors, theft, talking, gold and leadership

Search: door, Smash, Tinker, theft, steal, Presence, Difficulty, gold, handful, leader

What it decides: the map's and the standoff's numbers.

- A door: Smash (Strength) or Tinker (Finesse) against 12, or break it down (12 damage); an action each.
- A character talks with Presence; resists words at 12 + its Presence (at least 12) and theft at 12 + its Instinct. Theft: Finesse.
- An adversary talks with its best Experience (+2 if a Social adversary) and resists anything at its Difficulty; a beast doesn't talk.
- An adversary's gold (homebrew): a handful a tier, twice that for a Leader or a Solo; none for a beast or a Minion.
- Leader score: a character's Presence (at least 0); an adversary's 3 (Leader) or 2 (Solo) + (tier − 1). 4 or more: Brave +20, Tactical floor 55; 3: +15, 45; 2: +10, 35; less: +5.

Code: `rules.js` `door`; `adapter.js` `#character`, `#adversary`, `adversaryGold`; `traits.js` `rankDaggerheartLeaders`, `leaderBonus`.

### Personality from the sheet

Search: personality, Tactical, Brave, Selfish, Loyal, adversary type, tier, beast, domains

What it decides: the four hidden traits FastFighting starts a Daggerheart creature with.

| Adversary type | Tactical | Brave | Selfish | Loyal |
| --- | --- | --- | --- | --- |
| Bruiser | 35 | 70 | 50 | 55 |
| Horde | 30 | 60 | 50 | 60 |
| Leader | 65 | 65 | 45 | 60 |
| Minion | 25 | 40 | 50 | 55 |
| Ranged | 55 | 40 | 55 | 50 |
| Skulk | 60 | 45 | 60 | 45 |
| Social | 55 | 35 | 55 | 50 |
| Solo (fearless) | 55 | 85 | 55 | 50 |
| Standard | 45 | 50 | 50 | 55 |
| Support | 60 | 40 | 45 | 60 |

- Brave +5 a tier past the first; a beast (motives of feeding or hunting, with no mind in them) Tactical −15. Immune to physical or magical damage Brave +4, resistant +2.
- A companion 35, 55, 25, 85; an NPC 50, 30, 50, 50.
- A character starts at the usual hero (65, 75, 25, 80) and moves: each trait against its class's suggested spread (Knowledge Tactical +3, Instinct Tactical +2, Strength Brave +2.5, Presence Brave +1.5, Loyal +2, Selfish −1, Agility Brave +1, Finesse Selfish +2, per point); level − 3 Tactical; its domains at half weight; subclass, ancestry and community by their tables; scars Brave −3 each (3 at most); Stress slots (n − 6) × 1.5 Brave (−6 to +6); not in the party, Loyal −10. Characters stay within 5 to 95, others 0 to 100.

Code: `traits.js` `TYPES`, `COMPANION`, `BYSTANDER`, `TRAIT_LEANS`, `DOMAIN_LEANS`, `pcParts`, `deriveDaggerheartTraits`.

### Typical numbers by level

Search: typical Difficulty, tier, level, retreat

What it decides: the numbers used where a sheet says nothing.

- AC and DC 11 + ⌈level ÷ 3⌉; save and skill 1. An adversary's level by tier: 1, 3, 6, 9.
- "Retreat when hurt": with about a third of its Hit Points left (0.34).

Code: `rules.js` `typical`, `retreatAt`; `adapter.js` `TIER_LEVEL`.

## Ironsworn and Starforged

Repo: FastFighting-Ironsworn. It plays Ironsworn ("classic"), Starforged and Sundered Isles; the character's sheet says which.

### Action rolls and progress rolls

Search: action roll, action score, challenge dice, strong hit, weak hit, miss, match, progress roll, adds, d6, d10

What it decides: how a move lands.

- A d6 + stat + adds, at most 10, against two d10s: beats both, a strong hit; one, a weak hit; neither, a miss; a miss on matching dice is dire.
- A progress roll uses the progress score (whole boxes, 0 to 10) instead; momentum can't change it.
- A FastFighting DC becomes adds: round((10 − DC) ÷ 3). DC 10: 0; 13: −1; 16: −2; 19: −3; 22: −4.
- Hit chances by stat: +1 54.8%, +2 66.8%, +3 76.8%, +4 84.8% (strong hits 15.2%, 23.2%, 33.2%, 45.2%).
- An action-roll point counts as 0.25 of a success (a d20 point 0.085), so the core's flat condition penalties shrink by 0.085 ÷ 0.25: a core −1 becomes −0.34.

Code: `moves.js` `grade`, `scoreChances`, `chances`; `rules.js` `actionRoll`, `addsFor`, `rollPoint`.

### Lore-Collector advantage (Secure an Advantage)

Search: Lore-Collector, Lore-Collector advantage, loreBoost, Secure an Advantage, wits, size up, boost

What it decides: how much sizing a foe up improves a Lore-Collector's next attack or Compel.

- Secure an Advantage, +wits (DC 10, no adds). A hit makes its next attack or Compel, at anyone, get the smallest add, 1 to 30, that makes it succeed at least min(boost × its chance, 95%, its chance at +30). A miss pays the price (−1 momentum, the upper hand lost).
- **Lore-Collector advantage** (`fast-fighting-ironsworn.loreBoost`): 1.25× to 3× in steps of 0.05, default 2.35×.
- Why 2.35×: +3 wits hits 77% of the time, and a miss costs a point of momentum, worth a fifth of a move. To repay the move, the boosted roll must be 1 + (1 + 0.23 × 0.2) ÷ 0.77 ≈ 2.36 times as likely.
- The 95% cap: a Strike gets all it can by about 1.5× at +2 iron (66.8% → 95%, +5 adds) or 1.75× at +1 (54.8% → 95%, +6). The rest of the range helps Compel a hardier foe (heart +2 against a formidable foe: 28.3% → 66.8%, +3 adds).

Code: `lore.js` `LORE_BOOST`; `build.js` `loreSizeUp`.

### Foes' progress tracks

Search: progress track, rank, troublesome, dangerous, formidable, extreme, epic, ticks, boxes, harm, beaten

What it decides: how hard a foe is to beat.

- A foe's hit points are the 40 ticks of its track left (10 boxes); ticks already marked count. Harm marks progress at its rank:

| Rank | Ticks a harm | So |
| --- | --- | --- |
| 1 Troublesome | 12 | 3 boxes |
| 2 Dangerous | 8 | 2 boxes |
| 3 Formidable | 4 | 1 box |
| 4 Extreme | 2 | 2 ticks |
| 5 Epic | 1 | 1 tick |

- A full track beats the foe: it leaves the fight, the table decides how; a Cruel character kills it.
- A foe's harm, what it costs a character who pays the price, is its rank. Against anyone who isn't a character (a companion, a hired hand) it attacks at rank + 2 for rank harm. A save there avoids harm only on a strong hit.
- Example: a dangerous foe takes a deadly weapon's weak Strike, 2 harm: 16 ticks, 4 boxes.

Code: `moves.js` `TICKS`, `TRACK`; `build.js` `foeNumbers`; `rules.js` `applyIwr`, `onDropped`, `saveMultiplier`.

### Strike and Clash

Search: Strike, Clash, initiative, in control, bad spot, deadly weapons, Characters fight with deadly weapons, deadlyWeapons, harm, at range, edge, iron

What it decides: what an attack does.

- With the initiative (Starforged: in control) a character Strikes; without, it Clashes. +iron up close, +edge at range (60 ft, at most 120). It fights at range with a ranged asset (Archer, Slinger, Sniper, Gunner, Gunslinger, Musketeer, Pistoleer) or more edge than iron.

| Move | Weak hit | Strong hit |
| --- | --- | --- |
| Ironsworn Strike | 1 harm (2 deadly); loses the initiative | 2 harm (3 deadly); keeps it |
| Ironsworn Clash | 1 harm (2 deadly), pays the price, no initiative | 2 harm (3 deadly), takes the initiative |
| Starforged Strike | progress twice; in a bad spot | progress twice; in control |
| Starforged Clash | progress once, pays the price | progress twice; in control |

- **Characters fight with deadly weapons** (`fast-fighting-ironsworn.deadlyWeapons`), on by default: Ironsworn's Strike and Clash +1 harm. Off: a simple weapon or bare hands.

Code: `moves.js` `CLASSIC`, `STARFORGED`; `build.js` `characterMoves`; `rules.js` `usable`, `afterRoll`, `backlash`; `adapter.js` `#character`.

### End the Fight and Take Decisive Action

Search: End the Fight, Take Decisive Action, progress roll, objective, finish

What it decides: when a character ends a foe's part in the fight.

- A progress roll, in control, once the track has 5 boxes (each foe's own) or 7 (the encounter's); one in a hurry (Impatient, Speed-Runner) 2 boxes sooner.
- A hit ends that foe's part in the fight (the encounter's: the objective achieved). A weak hit also costs 2 momentum. A miss loses the initiative and pays the price, the foe's harm + 1; on the encounter's track it loses the objective, and the fight.

Code: `rules.js` `usable`, `afterRoll`, `backlash`, `progressScore`; `build.js` `characterMoves`.

### Pay the Price

Search: Pay the Price, price, miss, harm's way, horror, stress

What it decides: what a miss costs.

- A miss, or a weak Clash: the foe's harm (its rank), +1 on a dire miss, +1 more on a missed End the Fight.
- A horror's price is stress, not harm.
- A friend may be put in harm's way instead, if in the thick of it: one whose taunt the foe is under; else one who draws attacks or guards, as likely as max(its drawAggro, min(0.5, protect ÷ 50)); else, when the one who missed keeps a low profile (by that chance), a friend beside it who doesn't.

Code: `rules.js` `backlash`, `harmsWay`.

### Momentum and burning it

Search: momentum, burn momentum, reset, momentum max, Resources answer

What it decides: when a character burns momentum.

- Momentum runs from −6 to its maximum (10, or the sheet's); it resets to the sheet's reset (2), 1 lower for a wound marked in this fight.
- Burning sets the action score to the momentum, after the dice: only when that gives a better result and momentum is above the reset; never on a progress roll.

| Resources answer | Turn a miss into a hit | Turn a weak hit into a strong one |
| --- | --- | --- |
| Conserve | stakes 0.3 or more | never |
| Balanced | stakes 0.1 or more | momentum 6+, or stakes 0.5+ |
| All out | always | momentum 4+, or stakes 0.3+ |

- The AI weighs a point of momentum at 0.2 × ticks per harm × its Strike's average harm.

Code: `moves.js` `MOMENTUM`, `burnGrade`; `rules.js` `adjustRoll`, `resetOf`, `resourceWorth`.

### Endure Harm and the harm table

Search: Endure Harm, health, wounded, harm table, Face Death, mortal, dying, out cold, reeling

What it decides: what harm does to a character.

- After any harm, a roll with the better of health and iron.

| Result | Ironsworn | Starforged |
| --- | --- | --- |
| Strong hit | +1 health for 1 momentum (health above 0, momentum stays above the reset), else +1 momentum | +1 health if not wounded, else +1 momentum |
| Weak hit | presses on | 1 momentum for +1 health, if not wounded |
| Miss | −1 momentum | −1 health, or −2 momentum when health is 1 or less |

- At 0 health a character fights on; harm past it comes off momentum. A miss there marks it wounded; already wounded, a d100 on the harm table: 1–10 mortal (Face Death, +heart: a strong hit back but down, a weak hit down and deathbound, a miss dead); 11–20 dying; 21–35 out cold; 36–50 reeling (−1 momentum); 51–100 still standing.

Code: `rules.js` `afterHarm`, `onDropped`; `moves.js` `harmTable`, `CLASSIC.endure`, `STARFORGED.endure`.

### Endure Stress and the stress table

Search: Endure Stress, spirit, shaken, stress table, Face Desolation, ally down

What it decides: what stress does to a character.

- Stress comes off spirit (past 0, off momentum); then a roll with the better of spirit and heart, played as Endure Harm on spirit.
- At 0 spirit a miss marks it shaken; already shaken, a d100: 1–10 Face Desolation (+heart; a miss gives up the fight, as one who fled); 11–50 falters (−1 momentum); 51–100 perseveres.
- An ally going down costs 1 stress (2 when it's killed) to each character on its side who can see it (walls short of total cover) or is within 12 squares (60 ft, edge to edge). With Terrain & positioning off, every character on its side.

Code: `rules.js` `endureStress`, `onFall`, `witnessesFall`; `moves.js` `stressTable`.

### Enter the Fray

Search: Enter the Fray, ambush, initiative, first move, combat position

What it decides: who starts with the initiative.

- Each character's first move, unless its sheet shows a combat position. +shadow when its side springs an ambush, +wits when ambushed; otherwise Ironsworn's +heart, Starforged's best of +edge, +heart and +iron; one keeping a low profile may use +shadow.
- Strong hit: the initiative and +2 momentum. Weak hit: the initiative. Miss: a bad spot (Ironsworn: −1 momentum).

Code: `rules.js` `enterTheFray`; `moves.js` `fray`.

### Secure an Advantage, Aid Your Ally and Heal

Search: Secure an Advantage, Gain Ground, Aid Your Ally, Heal, upper hand, +1 on the next move

What it decides: what the moves for the upper hand give.

- In control, with its best stat. A miss pays the price: −1 momentum, the upper hand lost.

| Move | Weak hit | Strong hit |
| --- | --- | --- |
| Ironsworn Secure an Advantage | +1 momentum | +1 on the next move |
| Starforged Gain Ground | +1 on the next move | +1 on the next move, +2 momentum |
| Aid Your Ally (within 120 ft) | the same, for the friend | the same; both in control |

- Heal (in control, +wits, a friend or itself): a hit gives +2 health; a weak hit costs 1 momentum; a miss pays the price.

Code: `build.js` `advantageMoves`, `healMove`; `rules.js` `onOutcome`, `afterRoll`, `usable`.

### Face Danger: breaking free, doors and hazards

Search: Face Danger, break free, tied up, untie, locked door, door harm, Ironsworn only: harm to break down a locked door, doorHarm, hazard, trap

What it decides: getting past trouble.

- Face Danger: a strong hit gets through, +1 momentum; a weak hit gets through, −1 momentum; a miss doesn't, −1 momentum and the upper hand lost. Momentum is burned only to turn a miss into a hit.
- Breaking free: the better of +edge and +iron (iron breaks ties for a grab, edge for bonds). Untying a friend takes no roll, unless a foe is beside the one untying. Foes don't roll; the core's chance decides.
- A locked door: +iron to force it, the better of +shadow and +wits to pick it, or hacking at it. **Ironsworn only: harm to break down a locked door** (`fast-fighting-ironsworn.doorHarm`): 1 to 3, default 3 (a deadly weapon's two hits, or one strong hit). With one track for the encounter (Starforged), one hit always does it. A door's own numbers on its wall come first: hit points as harm, and each 3 of a DC over 10 an add off the roll.
- A hazard: those it reaches Face Danger, +edge: any hit gets clear (a weak hit −1 momentum), a miss takes its harm.

Code: `rules.js` `faceDanger`, `breakFree`, `tryDoor`, `initRun`, `door`; `conflict.js` `DOOR_HARM`, `doorHarmOf`, `doorsFor`; `build.js` `doorWork`.

### Compel and talking

Search: Compel, persuade, threaten, bluff, heart, iron, shadow, talk, Supply, demand

What it decides: the numbers for words.

- A character Compels by heart (persuade), iron (threaten) or shadow (bluff), against DC 12 + 2 × the foe's rank: adds −1, −2, −3, −3, −4 for ranks 1 to 5. Only people and the Firstborn can be talked to.
- Strong hit: +1 momentum. A miss: 1 stress; a dire miss also a demand, a point of Supply to the one it was talking to.
- A foe talks at its rank − 1; a character resists at DC 12 (−1 add).
- Resolve: a character's heart − 2; a foe's rank − 2.

Code: `adapter.js` `#character`, `#foe` (social); `rules.js` `afterTalk`.

### One track for the encounter

Search: encounter track, objective, Conflict, Track, Rank, Kept on, Starforged, Take Decisive Action

What it decides: how the planner's **Conflict** row tracks the fight.

- **Track**: One for the encounter (default when any character plays Starforged or Sundered Isles) or Each foe's own (default otherwise).
- **Rank** (one track): by default the most dangerous foe's. It sets the ticks each mark fills (as the table above) and the Compel successes that talk a foe round: 2, 3, 6, 12, 24 for ranks 1 to 5.
- **Kept on**: the character whose sheet keeps the track, by default the party's leader.
- Every Strike and Clash marks it at the encounter's rank, and so does each success in words (a strong hit twice).

Code: `conflict.js` `STEPS`, `TRACK_MODES`, `defaultMode`, `defaultRank`, `joinEncounter`; `adapter.js` `#conflict`, `plannerSettings`.

### Taking a side mid-fight

Search: allegiance, side change, won over, turns on the party, joins

What it decides: what a side change means in a conflict, once each way.

- Joining the party, the first to: a mark of progress on the encounter's track (never the last), or with each foe's own track +1 momentum for each character.
- Turning on the party: it joins the encounter's track. The first time, a whole neutral team (two or more) or a leader among them raises the encounter's rank a step (never to Epic); anyone else, or no step left, costs each character 1 stress.

Code: `rules.js` `onAllegiance`, `settleJoins`.

### Provocation

Search: taunt, provoke, Face Danger heart, rises to it

What it decides: what a taunting foe does.

- A foe doesn't roll: as often as its taunt takes hold (the Taunting setting × its share), the character it would draw Faces Danger, +heart. A miss: it wants to go for that foe, unless it shrugs taunts off.

Code: `rules.js` `provoke`.

### Rules preference

Search: Rules preference, rulesPreference, ruleset, Ironsworn, Starforged, Sundered Isles, shared move

What it decides: which ruleset's version of a shared move a character makes.

- **Rules preference** (`fast-fighting-ironsworn.rulesPreference`): Follow character sheets (default), Prefer Ironsworn, Prefer Starforged, Prefer Sundered Isles. A preferred ruleset counts only where the world has it on, and only for moves of the same name (Strike, Clash, Endure Harm, Enter the Fray ...); End the Fight and Take Decisive Action, and the words for the upper hand, stay the character's own. Of the combat moves, Sundered Isles has only Enter the Fray.

Code: `moves.js` `movesFor`, `OWN_MOVES`; `adapter.js` `#ruleset`.

### Debilities, impacts and other numbers

Search: debility, impact, wounded, shaken, fall, persistent, initiative, retreat

What it decides: the rest of the numbers.

- Debilities and impacts are conditions under the system's ids; only wounded and shaken change a move. The rest stay on the sheet, which counts them against momentum.
- A fall: 1 harm per 10 feet, at most 3; nobody lies prone. A core condition's harm each turn (fire, a gullet's acid): 1 harm. Lasting harm ends on a d10 of 6 or more.
- Initiative: a character's wits; a foe's rank − 2. Standing costs 15 feet. "Retreat when hurt": at 0 health.

Code: `rules.js` `DEBILITIES`, `fallDamage`, `conditionHarm`, `persistentFlatCheck`, `standCost`, `retreatAt`.

### Leadership and personality

Search: leader, heart, rank, title, personality, Tactical, Brave, Selfish, Loyal, nature, people, beast, horror, machine

What it decides: who leads, and a creature's starting traits.

- Leader score: a character's heart; a foe's rank − 1; a title (chief, captain, warlord, elder, king ...) +2. 4 or more: Brave +20, Tactical floor 55; 3: +15, 45; 2: +10, 35; less: +5.

| Foe's nature | Tactical | Brave | Selfish | Loyal |
| --- | --- | --- | --- | --- |
| people | 50 | 50 | 50 | 55 |
| Firstborn | 60 | 60 | 45 | 60 |
| animal | 20 | 45 | 65 | 50 |
| beast | 25 | 65 | 60 | 40 |
| horror (fearless) | 30 | 90 | 70 | 30 |
| machine (fearless) | 45 | 90 | 40 | 80 |

- Brave +5 per rank step from Dangerous; its kind's leanings (a raider Selfish +10, Brave +6, Loyal +5); a pack or swarm Loyal and Brave +5.
- A character starts at the usual hero (65, 75, 25, 80) and moves by each stat's distance from 1.8 (wits Tactical +5; heart Brave +4, Selfish −3, Loyal +5; iron Brave +3, Tactical −1.5; shadow Selfish +4, Loyal −2, Tactical +1.5, Brave −1; edge Tactical +1, Brave −1, per point); assets, debilities, bonds, vows and legacies by their tables. Characters stay within 5 to 95, others 0 to 100.

Code: `leadership.js` `rankIronswornLeaders`, `leaderBonus`; `traits.js` `deriveIronswornTraits`, `pcParts`, `FOE_LEANS`, `STAT_LEANS`, `ASSET_LEANS`.
