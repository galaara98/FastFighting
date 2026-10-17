# FastFighting Core

> **AI use:** This module used AI in its creation.
> - **Programming:** I am a skilled programmer by profession, but AI was used heavily as a co-pilot.
> - **Strings:** ALL initial strings were proposed by a LLM to get the concepts out, ALL strings were  tracked to make sure they were re-written (for simple or ttrpg/game specific phrases, approved by) a native speaker.

A [Foundry VTT](https://foundryvtt.com) module that resolves a battle, or a tense standoff, from the encounter on the scene, so the table can move on. It simulates the encounter thousands of times, round by round, with real dice math, and shows the odds. It tells the story of the most typical fight, and **Do it For Real Now** plays the fight for real on the Combat Tracker, a turn at a time: FastFighting runs the creatures, the players run their characters.

## Requirements and installation

- **Foundry:** v14.
- **A helper module for your game system.** The core holds no game rules; the helper supplies them. See [systems.md](systems.md):
  - [FastFighting PF2e](https://github.com/galaara98/FastFighting-PF2e) for Pathfinder Second Edition
  - [FastFighting D&D 5e](https://github.com/galaara98/FastFighting-DnD5e) for Dungeons & Dragons Fifth Edition
  - [FastFighting DCC](https://github.com/galaara98/FastFighting-DCC) for Dungeon Crawl Classics (and Xcrawl Classics)
  - [FastFighting Ironsworn](https://github.com/galaara98/FastFighting-Ironsworn) for Ironsworn and Starforged
  - [FastFighting Daggerheart](https://github.com/galaara98/FastFighting-Daggerheart) for Daggerheart
- **Without a helper** for your world's system, FastFighting stays inactive: its settings are greyed out, and the settings window and the Combat Tracker point you to systems.md. **Use the experimental generic adapter** switches on a generic d20 adapter instead.

In Foundry, go to **Add-on Modules → Install Module**, paste this manifest URL, then install your system's helper:

```
https://github.com/galaara98/FastFighting/releases/latest/download/module.json
```

## The Battle Planner

GMs get buttons at the top of the Combat Tracker: **Planner**, **Survey** (see [Prepare Players](#prepare-players)) and, while a live battle runs on that encounter, **Vantage** (see [Live battles](#do-it-for-real-now-live-battles)). The planner needs at least two tokens in the encounter; <kbd>Shift</kbd>+<kbd>B</kbd> opens it too. It picks up an encounter already under way from whoever's turn it is, keeping wounds, dying and conditions.

**One plan per encounter.** The planner follows the encounter the tracker shows and keeps your choices (sides, groups, roles, fudges, options) with that encounter until it ends. Combatants who join and tokens that come or go are taken in, and your choices stand. A new encounter starts from what you set up on the scene before it began; a fresh one puts every hostile token in one group. **Clear** (the eraser beside Refresh) resets the plan to the defaults, after asking. With no encounter, the plan belongs to the scene.

**Pausing.** The fight is read off the map, so opening the planner pauses the game. Closing it un-pauses, unless the game was paused before or you un-paused it meanwhile. Do it For Real Now and Rewind This Encounter keep the game paused while they write to the map. A pause stops only players: the GM's changes and token movement go on.

The window needs at least 1000×600 and uses any extra space.

**Toolbar**
- **Seconds** (how long the prediction runs), **Max rounds** and **Seed**.
- **Downed**, **After the fight** (see [After the fight](#after-the-fight)), **Opening** (see [Talking](#talking)) and **Initiative**.
- Toggles: Terrain & positioning, Morale, Leadership, Talking, Ignore languages, Bystanders, Hidden tokens, and, with a helper that plays live battles, Players run their characters.
- **Run** (**Stop** while it runs), Refresh, Clear and **Rewind This Encounter**.
- A helper may add a row for its system's encounter settings (FastFighting Ironsworn: how the encounter is tracked, its rank, and whose sheet keeps the track). The plan keeps them.

**Left: the sides**, a tab each for Friendly, Hostile, Neutral and Secret.
- Side settings: group personality, healing aggressiveness, **Can rout**, leaders (Auto or No leaders) and the leadership bonus. Neutral adds a lean (see [Taking no side](#taking-no-side)).
- Each token row: HP, AC and personality traits; how it reaches the nearest enemy (mode, moves, terrain); a side override and an include toggle; group pills **1 2 3** for Hostile and Neutral tokens; for a Secret token, pills for hostile groups **1 2 3** and neutral teams **1 2 3**; and command pills **B L 1 2** (see [Leaders and bosses](#leaders-and-bosses)).
- Expanding a row shows stat fudges (**Fudge up**, **Fudge down** and **Remove fudge** on every derived number), **Ignores terrain**, **Dies at 0 HP**, and the character's tactics and playstyles.

**Right: the results**
- **Overview:** win odds, PC death and downed odds, foes talked down, fights settled with words, length, the simulated difficulty beside the system's own rating, the most dangerous foes and the allies most at risk.
- **Combatants:** each token's odds of standing, down, dead, fled, surrendered, stood down and switched sides; HP left, damage, healing, and its chance to fall first.
- **Swing factors:** runs the fight again without each combatant and option, to show what moves the party's odds most.
- **Resources:** spell slots, focus points and consumables spent.
- **Sample fight:** the story of the most typical fight (the most common outcome, of the usual length). It's a sample, not the ruling: Do it For Real Now plays a new fight with rolls nobody has seen, so a 70% win is a loss three times in ten.

A big battle gets fewer fights in the time given, and the planner warns when they're too few for sure odds. Reopened on a battle that hasn't changed, the planner shows its last run again; runs are kept in the GM's browser, never in the world, where players could read the odds.

## Who takes part

Tokens in the encounter know about the conflict from the start. Every other token on the map is a bystander: on each of its turns it checks whether it notices the fight and, once it does, acts from the next round. It notices when it sees or hears a combatant (against the system's Perception or the like; walls muffle sound), when an ally runs to it for help, when someone fleeing runs into it, or when someone attacks it (then it joins at once). With no encounter on the scene, everyone on the map is in it. The **Bystanders** and **Hidden tokens** toggles and the **Include other scene levels** setting decide who else counts.

A token's disposition sets its side; the planner can move any token to another side or leave it out.
- **Friendly** fights for the party.
- **Hostile** fights for its hostile group (group 1 unless you move it). Each group fights the others as well as the party.
- **Neutral** takes no side but weighs what it wants: its lean, its friend group, its tactics. It may take offense, confront someone or be won over.
- **Secret** stays hidden until it acts and fights with the team you put it on: a hostile group (group 1 by default) or a neutral team, which takes no side as a Neutral does.

Personality decides the rest: a coward may still run, a talker may try words first.

## Prepare Players

**Prepare Players** (the tracker's **Survey** button) opens a survey on each player's screen, a tab per token they control. Every question starts on *"Let ⟨character⟩ decide: …"*, which shows what the character would probably do. The questions:
- favorite weapon or attack, fighting style, and who to pursue first;
- spell slots, focus and limited abilities; magic and specialties; consumables; healing others; drinking its own potions;
- when an ally is dying, and after being revived;
- when to retreat, shield or defending, and talking instead of fighting;
- others nearby: stay with the fight, run for help when it goes badly, or hunt down enemies nearby;
- up to three desires (see [Desires](#desires));
- what it offers and expects to end an argument (see [Talking](#talking));
- for live battles, its reactions and rerolls.

**Magic and specialties** appears only for a character with something special: magic, anything with uses or a resource of its own (not gear), or whatever its helper marks as a class's or creature's own. It sets how often the character reaches for these over what anyone could do (a plain blow, the everyday moves, talking): No preference, A little more often, Much more often (three times as likely) or Whenever it can. Its fighting style still decides where it stands.

Answers save as they're made, and two players sharing a token see each other's changes live. The planner shows each player's status, with a button to (re)open their survey. Surveys go only to players, never to a GM or assistant GM, even one who controls tokens.

**The Party tab** (the survey's last) asks six questions for the whole friendly side: who to go after first, whether to talk first, what to do with foes who fall, how to look after each other, how freely to spend spells, focus and potions, and when to pull out. Each player has one vote, shown to everyone as a dot in the player's color with their initial. A player votes until they swipe **Lock-in** (the tab turns green) or close the survey (orange: not locked in); the tab then stays read-only until the GM sends a new survey, which starts a new vote. Only logged-in players with a character in the fight count. The most-voted answer is the party's; the party leader's player breaks a tie, and a tie the leader doesn't settle counts as no answer. The party's answers add **Party's sway** (1% to 20%, default 3%) to what each friendly creature wants, and in that share of fights replace "Let this character decide" on talking, spending and pulling out.

**Asking about one character.** Each friendly row in the planner has a quill. The green one asks that character's players: their survey opens on it, with the Party tab to look at, not vote on. The orange one opens that character's survey for every GM logged in, to answer for a player who's away.

**My tactics.** A player who controls a token on the map, or owns a character, gets a **My tactics** button in the Encounters tab that opens the same survey at any time. It has a tab for each of their tokens on the map and for each of their characters with no token there. A linked token shares its actor's answers; an unlinked token keeps its own and stands in for its actor while on the map.

**The token's FastFighting tab (GM).** Every token's window, and the Prototype Token window, has a FastFighting tab with the same playstyles and questions (not desires: only the survey knows who a character perceives) and a **Hazard** mark: As the game system has it, Not a hazard, Simple: fires once, or Complex: acts every round. A token on the map edits its own answers (a linked one's are its actor's); the Prototype Token edits the actor's, where each new token starts.

**Set up by itself.** The first time FastFighting sees a character (in the planner, its token's tab or a survey), it picks up to four playstyles from its numbers and actions, what its helper reads (class, ancestry, kind of creature, alignment, gear, role), and words in its biography ([keywords/en.json](keywords/en.json)). It never picks two that pull against each other, such as a Chicken and a Martyr, and a plain creature may get none. After that the playstyles are the table's. **Reset answers** sets every answer back to "Let this character decide" and picks the playstyles again. "Let this character decide" stands for answers the helper works out from the character (class, features, spells, gear, alignment), or the core from its hidden scores where the helper says nothing. They're worked out again when the character changes; answers someone chose stay.

**What the GM sees.** GMs and assistant GMs see a character's hidden scores (Tactical, Brave, Selfish, Loyal) above its questions, and, in orange under each question, what "Let this character decide" chooses and why. Players see only "Let this character decide".

### Playstyles

Up to four pills per character, PC or NPC, in order of importance: the first counts in full, the others 75%, 55% and 40%. Unpicking one moves the later ones up. Where pills disagree on a tactic, each simulated fight goes with one of them, the first most often. Pills shift traits, change the defaults, switch on quirks and steer desires:

| Pill | What it does |
| --- | --- |
| Brawler | the nearest foe; hits back hard; doesn't talk; jeers now and then (a taunt) |
| Chicken | keeps away from the most dangerous foe; gives up easily; hits back half-heartedly; hard to taunt; leading, takes its group with it when it runs; trap avoider |
| Cruel | the weakest, and the fallen; hits back hard; likes leaving a foe hampered |
| Diplomat | talks; spares the fallen; hard to taunt; can't abide violence |
| Enabler | heals, guards and bolsters friends; backs the leader |
| Fragile | once hurt, keeps away from whoever hurts it and heals itself; setbacks wear it down; its flight takes others along |
| Impatient | the nearest foe; setbacks wear it down twice as fast; little patience for locks; in a hurry: won't stop to get clear of a foe, raise a shield or set anything up |
| Instigator | locks foes down, harasses and debuffs them more than anyone; the most dangerous foe and the enemy leader; may defy its own leader; taunts |
| Lazy | the nearest foe, no long walks; sometimes ignores a taunt; little help to anyone; gives up fast; holds no grudge; its flight takes others along |
| Lore-Collector | sizes up a new foe before acting against it, then rolls much better against every foe of that sort (each helper's **Lore-Collector advantage** setting, 1.25× to 3×; 2.5× without one); may share what it learned; trap avoider |
| Martyr | guards the weakest friend; fears nothing; avenges the fallen twice as hard; rallies; taunts foes off its friends |
| Mercenary | easy pickings; barely avenges anyone; gives up when it gets hard; its flight takes others along; never pays a boss off |
| Moralist | never strikes the fallen and pulls killing blows where the system allows; heals friends, guards the weakest; can't abide violence |
| Peacekeeper | hard to taunt; a standoff with it loses patience half as fast; calms quarrels; foes it talks round stand down; trusted (up to 2 easier) and never threatens; spares the fallen; can't abide violence |
| People-Pleaser | wants what its leader wants; likes to talk and to bolster friends; can't abide violence |
| Puzzle-Maniac | weaknesses, casters, clever lock-downs, its own specialties, and locked doors (twice the patience); hard to taunt; trap avoider |
| Redeem-Seeker | the biggest threat; won't give up; now and then dares a foe to come at it |
| Relentless | sticks with its foe (the hardest of all to taunt); shrugs off setbacks; keeps at doors; a little wary of outsiders' words |
| Skeptic | hard to taunt; half swayed by its leader; slow to talk; outsiders need one more success, against up to 4 more DC, to talk it round; trap avoider |
| Speed-Runner | the quickest kills; in a hurry, as an Impatient one is |
| Tank | stands in front: taunts foes off its friends, draws attacks, guards the weakest, fears nothing, never retreats, keeps its shield up, minds getting hit half as much |
| Thief | robs when it's safe; a lock is an invitation; trap avoider |
| Un-Mundane | its magic and specialties over plain blows and talk ("Much more often"), spending freely; foes its powers find a weak spot in |
| Vengeful | hits back twice as hard; avenges fallen friends; its grudges never cool |
| Wallflower | keeps its distance; often ignores a taunt; hampers foes from afar; listens to the crowd less; its flight takes a few along; trap avoider |
| Wants to Lead | the biggest threat; looks after, bolsters and rallies its people; half ignores its commander; may scheme if not chosen to lead |
| Wildcard | something random catches its eye; nobody's voice counts for much; may defy its leader |

Checkboxes beside the pills:
- **Stay mostly true to my calculated tactical level:** playstyles and answers move the calculated strategy by about 10% at most.
- **Roleplaying is very important to me:** playstyles weigh double, and their quirks show much more often.
- **I don't like to use spells that cost something:** spells that use slots, focus or daily uses are about a tenth as likely, until a life is at stake. Cantrips are free. The Consumables answer **I don't like to use consumables** does the same for potions, scrolls and bombs.

Three answers carry a wish, as strongly as the answer leans that way:

| Question | The wish | Answers, from all of it to none |
|---|---|---|
| Talking instead of fighting | talks whole turns at a time, even without much skill, and votes to open with a standoff; not while it's being hurt | Always talk unless I am currently being hurt (100%), Talk first: try to end it with words (66%), Talk when it could work (33%), Let my weapons do the talking (0%) |
| Foes who fall | avoids killing (see [After the fight](#after-the-fight)) | Spare them: I avoid killing (100%), Tie them up (66%), Leave them be, Rob them (33%), Finish them (0%) |
| When to retreat | doesn't like to flee (see [Morale and leaving](#morale-and-leaving)) | Fight to the end (100%), When the battle turns against us (50%), When I'm badly hurt (0%) |

## Do it For Real Now: live battles

**Do it For Real Now** closes the planner and plays the fight on the Combat Tracker, a turn at a time. It needs a helper that plays live battles; with an older helper the button is greyed out and says to update it.

- **The start:** everyone in the encounter goes on the tracker, initiative is rolled for whoever hasn't rolled (a player keeps their roll), the encounter starts, and the chat tells the opening. The **Battle Vantage** opens for the GMs.
- **FastFighting's turns** (the creatures', and a character's when FastFighting plays it): it decides and rolls the turn as the simulation would, writes it onto the sheets through the helper (hit points, conditions, dying, resources spent, the fled and the surrendered, buffs and debuffs as the spell's own effect), moves tokens around walls, opens doors, and tells the turn in the chat. Then it waits for **Next Turn** (on the card, in the Battle Vantage, or the tracker's own). **Play to the end** goes on without waiting.
- **A player's turn:** the player plays it with the system's own sheet and cards. When the turn ends, FastFighting reads the roll cards (through the helper) and the sheet changes, and takes them in as if it had seen them: grudges, fear, morale, who was talked round. Anything it isn't sure of goes to the GMs first, to keep, drop or set right; then it tells the turn.
- **Players run their characters** (a planner toggle, on by default). Off, FastFighting plays every turn. In the Battle Vantage, **FastFighting plays their turns** takes over one character for a player who has to leave; clear it to hand the character back.
- **Reactions:** each character's FastFighting tab lists its reactions with **Always use it**, **Ask me** or **Never use it**. Asked, the player answers on their screen (the GM answers when they're away or don't answer in time). An NPC's reactions during a player's turn are the GMs' to allow, unless **Ask me about NPC reactions** is off in the Battle Vantage; then its tactics decide.
- **Rerolls:** where the system has a reroll to spend (PF2e Hero Points, 5e Inspiration), each character says whether FastFighting may spend it to save its own life or a teammate's.
- **Bystanders** who notice the fight join the tracker and take their turns. **Summons** appear as tokens beside their summoner.
- **Spotlight systems** (Daggerheart, Ironsworn) have no initiative: the Battle Vantage gives the spotlight to whoever FastFighting would pick next, or to whoever the GM picks.
- **The end:** the chat says which side won. **Settle the aftermath** has FastFighting deal with what's left (the dying bleed out or hold on, the beaten are dealt with, goods go back to their owners). The encounter stays open for the GM to end.

### The Battle Vantage

The GMs' window for a live battle: the round, whose turn it is, and each creature's mind.
- **Map of minds:** every creature on the map as a node, laid out as its token stands; drag, pan and zoom. Each desire, and each condition from someone, is an arrow between two creatures (wants to hurt, wants to talk round and how, afraid of, grabbed by, holds a grudge, won't listen to). What a creature has on its own (prone, hasn't noticed the fight, thinking of running) floats round it. A goal about a thing points at it: the door it wants through, the trap it keeps clear of. Every line and symbol has an intensity; the GM can raise it, lower it or set it aside at 0, and what the GM sets holds until it's handed back. A character its player runs shows no desires.
- **Focus:** click a creature, or select its single token on the map, to see what it wants, what's on it, who wants something of it, and the conditions and table rolls to put on it. The line under the pointer glows: Delete removes it, − and + lower and raise it, Tab and Shift+Tab step through the creature's lines (all in **Configure Controls**). + on the creature itself, or its **Add** button, adds one.
- **What happened at the table:** what FastFighting couldn't see (talked round by a Diplomacy roll, wanting to hurt someone, shaken, fleeing, surrendering), applied as the simulation would have.
- **Conditions:** each with its value, its source, its duration, and whether the sheet shows it or FastFighting keeps it. The GM can put on any condition the core or the system knows, change a value, or take one off, including those toward someone (afraid of, grabbed by, goaded by, controlled by, tied up by, off guard to, and a power's mark). What the sheets can show goes on the sheet; the rest FastFighting keeps with the battle. Rewind takes a GM's change back with the turn it came after. Conditions drive behavior, not only numbers: frightened by someone, a creature keeps away from them (frightened 2 or worse, it won't go for them; fleeing from them, it runs); grabbed, it's set on whoever holds it; charmed, it never attacks its charmer.
- **Moving a creature** to another team works out again what it wants, and everyone's wishes toward it. A token on the map that isn't in the battle can be brought in.

### Rewind

**Rewind**, on each turn's card and in the Battle Vantage, is the tracker's Previous Turn, and the battle follows the tracker back however it goes (its own Previous Turn and Previous Round too). Each turn after the one it goes back to is taken back, last first: what it wrote on the sheets, its cards, its moves, and the minds as they were. A turn FastFighting played stands as it ended, and Next Turn plays the next one again with fresh dice; a player's turn is theirs again, and all its cards are read again when it ends. At the battle's first turn, Rewind takes that turn back and waits for **Play it**. The last 12 turns rewind this way; further back, the tracker is put back where it was. **Rewind This Encounter** takes the whole battle back to before it began. The battle is saved as it's played (in a journal entry only GMs can see), so a reload or a GM leaving loses nothing: the next GM picks it up where it was.

**Fights from before live battles.** Older versions played the whole fight at once. Those fights can still be rewound from the GM's summary card or the planner, and one that was cut short shows in the planner, to be rewound before anything else is done for real on that scene.

## After the fight

When the last foe falls, the survivors tend their dying before the dying make their next roll: free help first (first aid, medicine feats), then spells and potions. Anyone left untended lives or dies by the system's rules for dying. **After the fight** picks how much of this happens: **Tend the fallen and tell it**, **Tend the fallen quietly** (the story ends at the last blow), or **Stop at the last blow** (you play the rest out).

**Fallen foes** are dealt with by each victor's answer to **Foes who fall** (its own, or its party's), then its playstyles:
- **Spare them: I avoid killing** (also Moralists, and Diplomats most of the time): it stops others from finishing them and gives free first aid if it can. Its killing blows knock out instead, and it never strikes the fallen. **Avoids killing: how often it holds back (%)** sets how often (90 by default, 50 to 90; less for answers that lean less that way).
- **Finish them** (also the Cruel, with no other answer): it finishes them off.
- **Tie them up:** it pulls killing blows most of the time and ties up the fallen with whatever's to hand. Prisoners are out of the fight even if healed, and tended after it. Mid-fight it ties someone up when no foe stands within its reach (without a map, after the fight). A prisoner struggles against its bonds, and friends may untie it. In a live battle the sheet shows it with the system's restrained status; the results show how often each creature ends up **Tied up**.
- **Rob them:** it takes a fallen foe's purse, else something it carries or held, during the fight or after; a player character's things only on its luck check. The robber gives it back if it ends the fight beaten.
- **Leave them be:** left to the dice.

**Fallen PCs.** Each time a creature wants to finish off a player character at 0 HP, it rolls d100 against **PC luck: being finished off** (39 by default): at or under, it goes ahead; over, it turns to the next foe. A character with **fate** to spend (PF2e Hero Points, 5e Heroic Inspiration) uses it when someone would die: the killing blow, save or recovery check is rolled again, or, for its own death where the system has a sure way out, that (PF2e Heroic Recovery). It always spends for itself; for a friend, the more selfish it is, the less likely.

## How creatures decide

The simulation and the live battle use the same decisions. [CODING_README.md](CODING_README.md#engine-behavior-in-detail) has the full detail.

### Personality

Four traits from 0 to 100, with named bands: **Tactical**, **Brave**, **Selfish** and **Loyal**. They come from the creature's data and blend with its side's personality (**Side personality defaults**, and the side's group personality in the planner). A player character starts as the usual hero (bold, loyal, unselfish, a good head), and its sheet moves it from there. Words in a biography ("cowardly", "ruthless", "loyal": see [keywords/](keywords/README.md)) move them up to 15 points each. Each trait's tooltip in the planner lists everything that moved it. Tactical bands:
- *Feral:* the closest foe, or whoever hurt it last.
- *Instinctive:* wounded prey; pack hunters gang up.
- *Competent:* focus fire and flanking.
- *Tactical:* healers and casters first; reads the odds.
- *Mastermind:* a side-wide focus, an ambush edge; the ruthless finish off the downed.

### Desires

Every creature keeps a list of desires: what it wants, of whom, and how badly, from 0 to 100 in five bands (Passing, Wants, Determined, Driven, Obsessed). It can want to hurt, heal, protect, bolster, talk to, keep away from, tie up, rob, be bolstered by, break free, free a friend, be rid of something, or leave the fight. Desires come from:
- its tactics: each turn it weighs every foe it can reach, every friend it could mend, whom it could talk round, whom it fears;
- its stated desires: up to three, set in the survey or the planner, naming only creatures it perceives on the battle map;
- the fight: whoever hurt it or felled a friend, grudges;
- its commander's wishes, the party's vote, and a friend asking it for a buff;
- its playstyles.

The strongest leads: desires 20 or more below a stated or fight-stirred one don't cross its mind, and an obsessed creature forgets caution (it ignores opportunity attacks). Thwarted desires fade: a locked door that won't give, a target it can't reach, getting hurt on the way. Each turn there's a hidden chance that its strongest desire takes over from what it's doing: **ADHD: how often a creature's mind jumps (%)** (20 by default), more for the least thoughtful; Tactical creatures and better act on what matters most instead. Each creature also has its own **ADHD** (0% by default, on its token's FastFighting tab and in the planner). The story now and then voices a creature's two strongest desires: *"Charlette really wants to heal Brent, but also kind of wants to hurt the wolf."*

### Talking

A fight can be talked down at any point, and some encounters never come to blows. Talkers persuade, intimidate or deceive, with the skills the system maps to each, against the system's DC for resisting. Talker and listener must share a language, unless **Ignore languages** is on; a creature with no language can't be talked to. Most need 2–6 successes. Hurting someone or failing to convince them makes them harder to sway, and an insult (a critical failure) means they won't listen again. A creature talked round surrenders, flees, stands down, changes sides, or gives something up. An enemy talked into changing sides only stands aside, and only on a hidden d100 under **Luck: an enemy changing sides** (69 by default); charm and dominate skip that roll.

**PCs decide their own fate.** Words can only make a PC pay up or run, and it takes two more successes than usual. A PC with nothing to give can only be scared off; one whose answer is "Let my weapons do the talking" won't listen at all.

**Standoffs.** An encounter opens as a standoff when every side's voice (its leader, or most of its members) would rather talk, or when almost everyone would; **Opening** can instead force **Always talk first** or **Straight to battle**. Nobody attacks while it lasts. Words can win it, and anyone giving something up or running settles the whole conflict. It breaks when someone gets upset (an insulting pitch, failures piling up, rounds dragging on, a beast that can't follow the talk, an impatient temper) or a blow lands between the two sides.

**Only an argument: no fighting** (an Opening choice, or the world default) is for a negotiation or a hearing that mustn't turn bloody. Whatever would come to blows makes the talks collapse instead, somewhat less often than a standoff would break (3 times in 4), and everyone goes their own way. Nobody runs or yields: a creature talked round backs down, and one made to pay pays and stays. What was agreed before a collapse stands. The results show how often the talks collapsed, and no simulated difficulty.

**Bargaining.** Two more questions, in the survey, the token's tab and the planner: **Do you offer something to end this argument?** and **Do you expect something to end this argument?** The answers: nothing, money, an item (one of its own things to offer; to expect, something of a kind: the system's categories, materials and rarities, worth at least so much, or unvalued), or a promise (no harm, passage, leaving). Only what a character really carries counts. A deal ends the encounter for the side that got what it wanted (a promise of no harm: a truce). Unmet demands are haggled down with the usual checks: the greedy hold out longer, the peaceable come round sooner. A player character hands over only what it offered, unless it's talked into more. In a system without coins or goods (Ironsworn), paying costs the side's shared Supply, and a foe made to give something up gives ground on its own track.

**Giving something up.** A creature made to pay gives what the other side expects, else what it offered, else 1–10% of its money or an item it carries but doesn't wield or wear. A PC hands over an item only on **PC luck: handing over an item** (39 or less by default). The talker gets it; if the talker ends the fight beaten, it goes back. Mid-fight the giver fights on, bitter. Do it For Real Now hands goods over in the turn they change hands; Rewind hands them back.

**Quarrels.** A neutral may come to blows with one side, most often after a botched pitch. Only those two fight, and the standoff holds while everyone's patience wears thin.

### Groups

**Hostile groups.** Every hostile token starts in group 1; move any of them to group 2 or 3 with the pills. Each group is a side of its own, the others' enemy as much as the party's (rival warbands, a monster loose among bandits). Groups share the Hostile tab's settings, and each has its own leader. The results show each group's chance of winning.

**Neutral friend groups.** When the planner opens, it proposes up to three friend groups among the neutrals: the neutral nearest the map's top-left corner starts group 1 with every neutral of its kind (the same stat block, or the system's type of creature); anyone within 3 squares of a member joins, up to three steps out; group 2 starts the same way from whoever is left, and everyone left after that is group 3. **Neutral friend groups: reach (squares)** sets the reach (1 to 20). Move anyone with the pills; your pick stands (a proposed group shows lighter). Members of a friend group want each other safe and stand together, and hurting one builds a grievance in the rest.

### Taking no side

Neutral tokens, and enemies talked out of the fight, take no side: nobody fights them and they fight no one. The Neutral tab's lean (takes no side; leans toward the party, the enemy, the nearest side or the underdog; left out; or fights everyone) doesn't put them on a side; it nudges what they want. A lean wears down when the favored side hurts someone the neutral cares about, and ends at once if that side hurts the neutral.
- **Crossed:** hurting it (a careless area spell catches a neutral within 10 ft of its targets), robbing it, insulting it, or hurting someone it wants safe offends it. Offended, it turns on that side alone, or, if it can talk, confronts the offender first. Do it For Real Now turns a neutral that turned on the party Hostile.
- **Won over:** either side's talkers can talk it into joining them, with no luck roll, if it hasn't seen that side cross it. Nobody is threatened into friendship. Do it For Real Now changes the token's disposition to its new side.
- **Who knows:** only a Tactical mind or better sees a neutral for what it is. Others may take it for an enemy, and a feral creature may attack anything close.
- **Getting involved:** a neutral with a lean gets involved about 1 time in 12, up to about 2 in 3 when it likes the side well and that side looks like winning. Involved, it works with words against the side it likes least.
- **Can't abide violence:** Diplomats, Moralists, People-Pleasers, and those who answer "Spare them: I avoid killing" or "Always talk unless I am currently being hurt", spend their turns talking the fighters into leaving.

Those who take no side never win or lose a fight. The results show how often a foe was talked into standing aside.

### Leaders and bosses

Every group (the party, each hostile group, each neutral friend group) has a **boss** (never the party) or a **leader**, and up to two **lieutenants**: the **B L 1 2** pills. Click a pill to give the role, click again to keep a token out of command, right-click to clear it. FastFighting fills them once, when the plan is new or just cleared (shown faded); after that only the GM changes them. Outside the party the best leader heads the group, as a boss when it outranks everyone else by 2 levels or more. The party keeps the roles you gave its members in earlier fights; otherwise it gets a leader only when exactly one member wants to lead.

The one in command adds its leadership bonus, its wishes pull on its followers (**Leader's influence**), and talking it down can take its group with it. When it's down, gone, or can't make itself seen and heard (blinded, deafened, silenced, stunned, confused, controlled), the 1st lieutenant steps up, then the 2nd. The story tells who takes command.

**Bosses** multiply what a leader does, by **Boss's influence**. They almost never run (about 1 in 20 of the times they would; a Chicken boss, 1 in 5) and never stand aside. They can't be talked down: in a standoff, talking a boss round means paying it to go (11–30% of the payer's money, or something it carries), and it leaves with its whole group. In a fight, a boss gives up only when badly hurt.

**Scheming.** A Wants to Lead character not in command may brood. With a treacherous streak (Cruel, Wildcard, Mercenary, Instigator), it withholds help from its leaders and is far easier to turn. A player character turns traitor only on **Luck check: a player character turning traitor** (9 by default).

### Morale and leaving

Losses, wounds, a fallen leader, bad odds and friends seen running weigh against Brave; combatants hold, waver or rout. A friend seen running shakes its group. One who decides to run first tries to take its group along; its commander decides whether the group goes. A commander, or someone brave and loyal enough, may spend an action rallying: those within 60 feet are steadier this round and the next.

**Fear conditions** (frightened, fleeing, turned) do what the system says while they last: by default the creature keeps away from whoever frightened it. Fear alone doesn't make it run, but it wears on its nerve, and fear piled past what its nerve can bear gives it a reason to.

**Leaving the field.** On a map, a creature that runs doesn't vanish. It heads for the nearest way off the scene, around walls and through doors it can open, and can still be struck or talked to on the way. It's gone when it reaches the edge, or after two whole turns in a row given to leaving. Struck or spoken to, it keeps going as often as **Committed to leaving: how often it keeps going (%)** says (79 by default; less for those who'd rather stay); stopped, it deals with what stopped it and sets off again. A side whose only creatures left are leaving has lost. In a live battle, its token is hidden (or left in place, by **Do it For Real Now: fled combatants**) and comes off the tracker.

**"I don't like to flee."** A character whose answer to When to retreat is **Fight to the end** ignores its own urge to run 90% of the time by default (**Doesn't like to flee: how often it stays (%)**, 50 to 90), half that for When the battle turns against us. It's still shaken, and the story says it held its ground. Fear from a spell or the rules still works as the system says.

### Held, hurt or controlled

A creature held (grabbed, tied up, caught in a web or a net) wants to break free, the more so with no foe beside it; friends free a tied-up ally, loyal ones most. What holds or hurts a creature (on fire, bleeding, prone) bothers it as much as it hurts, and it weighs being rid of it against what else it wants. A selfless creature may simply bear it: **Selfless creatures bear what holds or hurts them (%)** (29 by default) is how often a fully selfless one that doesn't stop to calculate does, each turn; never what would kill it. Tied up, it can't use what needs hands (the system says which; otherwise its helper's **Tied up stops spells** setting). A charmed or dominated creature wants what its controller wants; controlled by a player's character, it's that player's to run.

### Taunts, traps and theft

**Taunting.** A taunt makes a foe want to go for the taunter: a strong desire, not a command. A stronger want can still win, and the want ends when the taunter falls. Game systems taunt with their own skills and spells (XCC's Draw Agro). Some playstyles taunt too: a Tank most, then an Instigator (75%), Martyr (55%), Brawler (40%) and Redeem-Seeker (30%). A playstyle's taunt is an action within 30 feet, the better of Intimidation and Deception against the foe's resistance. If it gets through, it takes hold on a hidden d100 at or under **Playstyle taunts: taking hold (%)** (42 by default) times the taunter's share: a Tank on 42 or less, a Redeem-Seeker on 13 or less. It never works on the mindless. Some shrug off any taunt as it lands: Relentless 75%, Skeptic 60%, Peacekeeper 50%, Puzzle-Maniac 40%, Diplomat and Chicken 35%, Wallflower 30%, Lazy 25% (never more than 90%).

**Trap avoiders.** Hazards (traps, haunts, dangerous features) fire at whoever is in reach; a GM marks a token as one in its FastFighting tab. Some playstyles watch for them: a Thief most, then a Puzzle-Maniac (90%), Skeptic (75%), Lore-Collector (60%), Chicken (50%) and Wallflower (35%). At the start of a fight each rolls d100 per hazard against **Trap avoiders: spotting a trap (%)** (59 by default) times its share: a Thief spots it on 59 or less, a Wallflower on 21 or less. Anyone a hazard goes for knows it from then on. A creature keeps out of the hazards it knows, unless what it's after is inside and it wants it badly enough.

**Theft** in a fight is rare; most thieves take your things from your body afterwards. Only a **Thief**, or someone with the system's stealing skill well above typical for its level, steals mid-fight, and only when it's safe: its side clearly winning, or hidden with its mark alone. Against a PC it also needs **PC luck: being robbed** (29 or less by default), and the story never mentions it. Caught, the thief is revealed and becomes the victim's target. Stolen goods return if the thief is beaten.

### Buffs, debuffs and control

Spells, songs, skills and features that change the numbers (Bless, Haste, Rage, Bane, Faerie Fire, Hold Person, Hunter's Mark, a Demoralize, a Trip, a Feint) work the same way in every system: they change attack rolls, AC, saves and checks, damage, speed, actions, advantage, temporary hit points, resistances and conditions, for their duration, with saves to shake them off and concentration where the system has it. A creature casts a buff when its worth across everyone it reaches beats attacking with the same actions; thinking minds judge this best, and feral ones look after only themselves. Charmed or dominated creatures fight for their controller until the hold ends. One-roll edges (5e Help, Guidance, Bardic Inspiration, PF2e Aid, Ironsworn's Secure an Advantage) count for a friend's next roll against whoever it's set on. The Instigator loves debuffs most. A system without concentration or skill DCs leaves those parts out.

### Senses

To know a friend needs help, or a foe is hurt badly enough to finish, a creature has to perceive them. Every creature has six senses, and the helper sorts the system's own into them:
- **Sight:** a line of sight and light; in the dark, 30 feet by whatever light there is.
- **Lowlight:** sight in the dark (darkvision, infravision, truesight).
- **Hearing:** 60 feet, through walls.
- **Smell:** scent; never through a wall.
- **Feel:** any other sense needing no sight (blindsight, tremorsense, lifesense, echolocation), through walls.
- **Radar:** tech sensing of any kind, through walls.

Blinded creatures don't see and deafened ones don't hear; radar is a device's, so neither stops it. A foe it can't perceive looks unhurt to it. In a crisis (helping a friend, keeping someone from dying, avenging a fallen friend), any sense that could plausibly reach will do. Bystanders notice a fight the same way, and the story says how.

### Doors

Paths go round walls, and a creature walks to a closed door on its way and opens it. A locked door is worth only what it wants on the far side: it forces it, hacks it down or picks the lock, whichever is quickest for it, and each failure wears the desire down. A door opened in a live battle stays open; Rewind closes and relocks it. The system says how hard a door is to get through; a GM can give a door its own numbers in the wall's flags (`fast-fighting.door`).

### What else the simulation models

- The system's own rules, from its helper: the turn's actions, degrees of success, attack penalties, advantage, criticals, resistances and dying.
- Afflictions stage by stage, persistent damage, and riders on a hit (knockdown, grab, sneak attack, Pack Tactics, a save against prone or venom).
- Extras paid for on a hit (a smite's slot, a stunning strike's ki, a superiority die), spent more readily the fuller the pool.
- DCC's deed dice and Mighty Deeds, crit and fumble tables, action dice other than a d20, spell checks, and Luck burned to make a roll.
- Reactions besides opportunity attacks: Shield, Uncanny Dodge, Parry, Shield Block, Deflect Attacks, Nimble Dodge, Hellish Rebuke, Riposte, and counterspells.
- Opportunity attacks where the system has them: Tactical and Mastermind characters get clear safely (Disengage, Step) when they must leave; Competent ones think of it half the time; Feral and Instinctive ones never do.
- Summons, which join right after their summoner and fight for its side until their time or its concentration runs out. The planner's results don't count them.
- Legendary actions and Legendary Resistance; regeneration and fast healing (while regeneration works, the creature can't be killed); Undead Fortitude.
- Magic Resistance, save auras, evasion, and successes that count as critical successes; Recharge 5–6 and PF2e cooldowns; size limits on shoves and trips.
- Crowd control (slow, frighten, trip, immobilize, paralyze, sleep), valued by the damage it prevents; thinking creatures don't waste it on the immune.
- Healing by spells, potions and first aid, with range: a touch means walking over first.
- Terrain from Foundry's regions, by movement mode (rubble doesn't slow a flyer); walls block sight and movement goes round them; climbers go over and burrowers under. A high flyer can't be hit in melee from the ground.
- Any grid and units: distances come from the scene (a metre counted the table way, 1.5 m to a 5-foot square); units it doesn't know count each square as 5 ft.

## The story

The fight is told in one of three styles (**Story style**): **Roleplay** (prose, with cover, terrain, climbing, flying, burrowing, and relationships such as an enemy leader, a grudge, vengeance, a protector or a rival), **Standard** (what each character did and how it ended) or **Statistician** (every roll). Creatures that never joined the fight aren't listed, and hidden ones are never named. In a live battle, what the players shouldn't learn (who takes command, what a creature thinks or schemes, what sizing up a foe told it, its nerve failing) goes on a card for the GMs only. The narrator tells the story, never a creature in its own voice. Every Roleplay sentence comes from a roll table; **Settings → FastFighting → Story tables** installs them as editable RollTables.

## Languages

FastFighting ships in **English** and is built to be translated. Each person sees it in the language they picked in Foundry (Configure Settings → Language); anything a translation leaves out reads in English.
- **A translation covers** every window, setting, label and hint, and the story in all three styles (a translation can write its own Roleplay sentences rather than translate line by line).
- **Names** of characters, items, spells and effects are whatever your game system and its compendiums call them. Each helper writes some lines of its own (a recovery check, why a trait is what it is), in that helper's languages.
- **The game system in your language:** a system's translation is a module of its own. When your language isn't English and that translation isn't on in this world, each helper says so at the bottom of its settings, naming the last translation module we knew of (Spanish: pf2e-es for PF2e; translate-dnd5e-sdr2-es for D&D 5e). With a translation that rewords compendium items (Babele), the helpers still read their rules from the English Babele keeps.
- **Regional variants:** Foundry matches a language code exactly and falls back only to English, so a translation should use the code Foundry's own translation uses (`es` for a Spanish that reads naturally in every region).
- **Story tables** install in the GM's language. Tables you've installed or edited always win over the built-in ones.
- **Distances** read in the scene grid's units (Configure Scene → Grid: `m` and 1.5 per square on a metric map), counted the table way, 1.5 m to a 5-foot square. A scene with no units named reads in feet. Numbers follow the reader's language (4.5 m, 4,5 m).
- **Words kept in English:** each helper's `hardcoded-toEN.json` lists words it keeps in English for now, where a translation would contradict a game system that isn't translated yet.

### Translating

A translation needs no code. All of FastFighting's words are in two text files, and a translation is a copy of each:
1. Copy `languages/en.json` to `languages/<code>.json` (`fr.json` for French) and translate the text after each key. Keep the keys, and anything in `{braces}`, as they are: the braces are filled in with names and numbers, in whatever order your sentence puts them. Some entries are pieces of a longer line (their leading space or ` · ` included); the key's group shows where they go.
2. Add the language to the `"languages"` list in `module.json`, the way English is listed there.
3. For the Roleplay prose, copy `story/en.json` to `story/<code>.json` and translate its phrases. Sentences are built from them: a shape like `{actor} {aim} and their {weapon} {crit}!` takes one phrase from each list it names. Where your language needs whole sentences instead, a file can list finished sentences for any table, by the table's key (`{"event.opening": ["…", "…"]}`). A list can have as many entries as you like.
4. Each helper has its own `languages/en.json`, translated the same way. Leave the words its `hardcoded-toEN.json` names as they are.

Anything a translation leaves out reads in English. The tests check every listed language for unknown keys and matching placeholders.

The words read in biographies are in [keywords/](keywords/README.md), one file per language (`keywords/en.json`, and yours beside it, such as `keywords/es.json`), each word with what it raises and lowers. A translation's keywords add to the English ones and never replace them, since a biography may be written in either language: list only your language's words, and your negations ("nunca", "no"). [keywords/README.md](keywords/README.md) explains the ratings.

## Settings

World settings, under **Configure Settings → FastFighting**. The planner overrides some for one battle: Seconds, Max rounds, Downed, After the fight, Opening, Initiative, the toolbar toggles, and the side settings (the Neutral lean, healing).

| Setting | Default | What it does |
| --- | --- | --- |
| Use the experimental generic adapter | off | A generic d20 adapter for a system with no helper. **Generic system data paths** sets where actors keep HP, AC, attack bonus and damage. |
| Prediction time (seconds) | 6 | 4 to 20: fight after fight until the time is up. |
| Max rounds | 12 | 4 to 12; a battle still going after that is a stalemate. |
| Include hidden tokens | on | |
| Include other scene levels | off | |
| Bystanders can join | on | Tokens outside the encounter may notice the fight and join it. |
| Positioning and terrain | on | Distances, movement, terrain, walls and elevation. |
| Neutral tokens | Takes no side (until crossed) | The Neutral side's lean. |
| Neutral friend groups: reach (squares) | 3 | 1 to 20; world only, used as the planner opens. |
| Downed characters | Simulate dying and healing | Or Down = out of the fight, or Down = dead. |
| After the fight | Tend the fallen and tell it | Or Tend the fallen quietly, or Stop at the last blow. |
| Default PC healing | Let each character decide | Or Conservative, Balanced, Aggressive, At all costs. |
| Default PC response to a dying ally | Let each character decide | Or Rescue them, Keep fighting, Retreat, Protect self. |
| Leadership | on | |
| Leader's influence | 50 | 0 to 100: how readily followers take their commander's lead (0 nobody follows, 100 twice as readily). |
| Boss's influence | 2× | 1.25× to 3×: how much more readily a boss's lead is taken than a leader's. |
| Party's sway (%) | 3 | 1 to 20: how much the Party tab's vote sways the friendly side. |
| Morale and routing | on | |
| Talking | on | |
| Ignore languages | off | Anyone who speaks understands everyone who speaks. |
| How encounters open | Talk if they'd rather | Or Always talk first, Straight to battle, or Only an argument: no fighting. |
| Initiative | Combat tracker | Or Roll normally, or Stealth for hidden. The planner adds Party surprises and Enemy surprises. |
| PC luck: handing over an item | 39 | |
| PC luck: being robbed | 29 | |
| PC luck: being finished off | 39 | |
| Luck: an enemy changing sides | 69 | It goes through with it under this. |
| Luck check: a player character turning traitor | 9 | |
| Trap avoiders: spotting a trap (%) | 59 | |
| Playstyle taunts: taking hold (%) | 42 | Only the playstyles' taunts; a system's taunts follow its rules. |
| Selfless creatures bear what holds or hurts them (%) | 29 | |
| Doesn't like to flee: how often it stays (%) | 90 | 50 to 90. |
| Avoids killing: how often it holds back (%) | 90 | 50 to 90. |
| Committed to leaving: how often it keeps going (%) | 79 | |
| ADHD: how often a creature's mind jumps (%) | 20 | |
| Story style | Roleplay | Or Standard, or Statistician. |
| Story delivery | Public | Or Whisper to GMs. |
| Show the odds in the posted story | off | |
| Do it For Real Now: loot | Leave on corpse (lootable) | Or Drop a loot pile, or Do nothing. Shown only with a helper that handles loot. |
| Do it For Real Now: corpses | Keep, marked dead | Or Remove token (only when a loot pile is dropped). Shown only with a helper that handles loot. |
| Do it For Real Now: fled combatants | Hide token | Or Leave in place. |
| Do it For Real Now: play the fight on the map | on | Tokens walk their turns; off, they go straight to where each turn leaves them. |
| Players run their characters | on | Off: FastFighting plays every turn. |

Menus: **Story tables** (Manage), **Side personality defaults** (each side's Tactical, Brave, Selfish and Loyal), and **Generic system data paths**.

## What it doesn't do

- It holds no game rules of its own: without a helper for your system, or the experimental generic adapter, it does nothing.
- The Sample fight isn't the ruling: Do it For Real Now rolls a new fight.
- While **Players run their characters** is on, it doesn't play a player's turn unless you hand it that character, and it shows no desires for a character its player runs.
- In a live battle it spends no player resource except the rerolls each character allows.
- It doesn't end the encounter: the GM does.
- Some goals show in the Battle Vantage, marked as such, but don't change what a creature does yet: closing or locking a door, picking up an item, getting to a place, swimming, flying or climbing somewhere, hiding, taking cover, escaping by a way out, and using an object (a lever, a winch, a ritual circle).
- The planner's results leave out summoned creatures.
- Surveys never go to GMs or assistant GMs.

---

Writing a helper for another system, the API, hooks and the engine's internals: see [CODING_README.md](CODING_README.md).
