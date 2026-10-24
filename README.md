# FastFighting Core

> **AI use:** This module used AI in its creation.
> - **Programming:** I am a skilled programmer by profession, but AI was used heavily as a co-pilot.
> - **Strings:** ALL initial strings were proposed by a LLM to get the concepts out, ALL strings were  tracked to make sure they were re-written (for simple or ttrpg/game specific phrases, approved by) a native speaker.

A [Foundry VTT](https://foundryvtt.com) module that resolves a battle, or a tense standoff, from the encounter on the scene, so the table can move on. It simulates the encounter thousands of times, round by round, with real dice math, and shows the odds. It tells the story of the most typical fight, and **Go Live** plays the fight for real on the Combat Tracker, a turn at a time: FastFighting runs the creatures, the players run their characters.

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

GMs get buttons at the top of the Combat Tracker: **Planner**, **Survey** (see [Prepare Players](#prepare-players)) and, once the planner has run that encounter, **Vantage** (see [Live battles](#go-live-live-battles)); it goes when the encounter ends. The planner needs at least two tokens in the encounter; <kbd>Shift</kbd>+<kbd>B</kbd> opens it too. It picks up an encounter already under way from whoever's turn it is, keeping wounds, dying and conditions.

**One plan per encounter.** The planner follows the encounter the tracker shows and keeps your choices (sides, groups, roles, fudges, options) with that encounter until it ends. Combatants who join and tokens that come or go are taken in, and your choices stand. A new encounter starts from what you set up on the scene before it began; a fresh one puts every hostile token in one group. **Clear this plan** (in the top bar's ⋯ menu) resets the plan to the defaults, after asking. With no encounter, the plan belongs to the scene.

**Pausing.** The fight is read off the map, so opening the planner pauses the game. Closing it un-pauses, unless the game was paused before or you un-paused it meanwhile. In a live battle the game is paused while the fight is FastFighting's (playing a turn, reading a player's, waiting for **Next Turn**) and goes on for a player's turn; pause or un-pause it yourself and that holds until the next turn. Rewind This Encounter keeps it paused while it writes to the map. A pause stops only players: the GM's changes and token movement go on.

The window needs at least 1000×600 and uses any extra space.

**Top bar:** where the plan stands (its creatures and teams, the fights run, how many players are ready, the game paused), **Seconds** (how long the prediction runs; changing it doesn't call for a new run), and the one button to press now: **Run**; **Stop** while it runs; **Go Live** once it has run, with Run beside it. Change the plan after a run and it says so: Run again before Go Live works. Refresh re-reads the tokens. The ⋯ menu has **Re-pick automatic roles** (the leaders, bosses and lieutenants you didn't choose; yours stay), **Re-pick all roles** (yours too, on a second press), and **Clear this plan…**; the re-picks leave the teams alone.

**Left: three views.**
- **Teams:** a card per team, by side (Friendly, Hostile, Neutral, Secret): the Friendly Team **F**, the hostile groups **H1** to **H3**, the neutral friend groups **N1** to **N3**. Each card shows its leader and what it has; open it for its creatures. Filter by side or by name.
- Each creature: a click shows it in Details; its command role (**B L 1 2**, a menu: see [Leaders and bosses](#leaders-and-bosses)); its team (a menu, for hostile, neutral and Secret tokens); whether it takes part; and a ⋯ menu for its side, its survey (see [Prepare Players](#prepare-players)) and its token.
- **Encounter:** **Downed**, **After the fight** (see [After the fight](#after-the-fight)), **Opening** (see [Talking](#talking)) and **Surprise** (Follow System is greyed out where the system has no surprise rules; the turn order is always the Combat Tracker's once initiative is rolled); the rules (Terrain & positioning, Morale, Leadership, Talking, Ignore languages); who takes part (Bystanders, Hidden tokens); live battles (Players run their characters, Apply players' damage); the prediction (**Max rounds**, **Seed**); a helper's own encounter settings (FastFighting Ironsworn: how the encounter is tracked, its rank, and whose sheet keeps the track); and **Loot on the map** (see [Aftermath](#aftermath)). A closed section says what it's set to.
- **Players:** **Prepare Players**, each player's survey and characters, and the characters whose players are away.

**Right: Details and the results.** Once it has run, each side's odds of winning stay at the top.
- **Details:** the team or creature last clicked (the Friendly Team at first).
  - A team: its **Team cash** (the Friendly Team's is its characters' money; the others' is what the team has besides its sheets, in the system's coin, shared for deals: bribes, tolls, extortion), its **Reinforcements** (see [Leaders and bosses](#leaders-and-bosses)), its creatures, and its side's settings: group personality, leaders and the leadership bonus, healing aggressiveness, **Can rout**, and a neutral's lean (see [Taking no side](#taking-no-side)). These are kept by side, so a side's teams share them.
  - A creature: HP, AC, how it reaches the nearest enemy (mode, distance, terrain), its odds, its personality traits, its stat fudges, **Ignores terrain**, **Dies at 0 HP**, and its playstyles and answers.
- **Overview:** each number with its change since the run before.
  - **The Friendlies:** their odds of winning, a PC dying, a PC going down, and the Friendlies wiped (every PC down, dead or captured); PCs down and HP left on average; how much of the PCs' limited resources a fight uses; and the allies most at risk.
  - **The stakes:** costly wins (of the Friendlies' wins, those where a PC dies or half the PCs go down); the ally whose going down costs the Friendlies most, with their odds when it does; and how many PCs go down in the worst fight in ten.
  - **Money**, in the system's main coin (gold, in most): the spoils on average (coin and goods handed or taken to the Friendlies, and, when they win, what's on the foes they beat), the losses on average (paid out, stolen, or taken off their fallen), a deal struck (a bribe, toll or extortion, on either side), and a PC robbed or paying out.
  - **The foes:** how they end (slain, down, captured, fled, gave up, talked over, still standing); a foe's leader falling; foes talked down, fights settled with words, and talks that collapsed; the most dangerous foes.
  - **The fight:** how long it lasts, who most often falls first, bystanders joining, reinforcements arriving, and the win odds' margin (how sure they are, from the fights run).
- **Combatants:** each token's odds of standing, down, dead, fled, surrendered, stood down and switched sides; HP left, damage, healing, and its chance to fall first. A name shows it in Details.
- **Swing factors:** runs the fight again without each creature and with each rule off, to show what moves the Friendlies' odds most. Pills choose what to test (the Friendlies, their foes, neutrals, the rules); fewer tests finish sooner. A change that may be chance shows faint. Once it has run, the Overview adds the **Linchpin**, the **Key target** and what the fight **Hinges on**.
- **Resources:** spell slots, focus points and consumables spent.
- **Sample fight:** the story of the most typical fight (the most common outcome, of the usual length). It's a sample, not the ruling: Go Live plays a new fight with rolls nobody has seen, so a 70% win is a loss three times in ten.

A big battle gets fewer fights in the time given, and the planner warns when they're too few for sure odds. Reopened on a battle that hasn't changed, the planner shows its last run again; runs are kept in the GM's browser, not in the world, where players could read the odds (only the last one is, while **Troubleshooting** is on).

## Who takes part

Tokens in the encounter know about the conflict from the start. Every other token on the map is a bystander: on each of its turns it checks whether it notices the fight and, once it does, acts from the next round. It notices when it sees or hears a combatant (against the system's Perception or the like; walls muffle sound), when an ally runs to it for help, when someone fleeing runs into it, or when someone attacks it (then it joins at once). With no encounter on the scene, everyone on the map is in it. The **Bystanders** and **Hidden tokens** toggles and the **Include other scene levels** setting decide who else counts.

A token's disposition sets its side; the planner can move any token to another side or leave it out.
- **Friendly** fights on the Friendly Team, with the player characters.
- **Hostile** fights for its hostile group (group 1 unless you move it). Each group fights the others as well as the Friendly Team.
- **Neutral** takes no side but weighs what it wants: its lean, its friend group, its tactics. It may take offense, confront someone or be won over.
- **Secret** stays hidden until it acts and fights with the team you put it on: a hostile group (group 1 by default) or a neutral team, which takes no side as a Neutral does.

Personality decides the rest: a coward may still run, a talker may try words first.

## Prepare Players

**Prepare Players** (the tracker's **Survey** button) opens a survey on each player's screen, on its Friendly Team tab. Its tabs, along the top (the mouse wheel scrolls them sideways when there are more than fit), are the Friendly Team's and one per token they control, each saying where it stands: the vote open or locked in, or how many answers are set. A character's questions come in sections (Fighting, Spending, Looking after others, Talking and leaving), each closed one listing what's set. Every question starts on *"Let this character decide"*: what the character would probably do. The questions:
- favorite weapon or attack, fighting style, who to pursue first, and foes who fall;
- spell slots, focus and limited abilities; magic and specialties; consumables; healing others; drinking its own potions;
- when an ally is dying, and after being revived;
- when to retreat, shield or defending, and talking instead of fighting;
- others nearby: stay with the fight, run for help when it goes badly, or hunt down enemies nearby;
- up to three desires (see [Desires](#desires));
- for live battles, its reactions and rerolls.

**Magic and specialties** appears only for a character with something special: magic, anything with uses or a resource of its own (not gear), or whatever its helper marks as a class's or creature's own. It sets how often the character reaches for these over what anyone could do (a plain blow, the everyday moves, talking): No preference, A little more often, Much more often or Whenever it can. Its fighting style still decides where it stands.

Answers save as they're made, and two players sharing a token see each other's changes live. The planner shows each player's status, with a button to (re)open their survey. Surveys go only to players, never to a GM or assistant GM, even one who controls tokens. The exception is players who are away: Prepare Players sends every GM logged in one survey with a tab for each character on the map whose players are all logged out, and a **Friendly Team: ⟨player⟩** tab for each player away whose token no other player shares. A GM's Friendly Team vote there counts for that player this round; until the GM locks it in, the player can change it when they're back. A ring on a voter's dot shows who has locked in.

**I'm ready** tells the GM the player is done. It locks in their Friendly Team vote too, so while the vote is open it takes a second press.

**The Friendly Team tab** (the survey's first) asks six questions for the whole friendly side: who to go after first, whether to talk first, what to do with foes who fall, how to look after each other, how freely to spend spells, focus and potions, and when to pull out. Each player has one vote, shown to everyone as a dot in the player's color with their initial. A player votes until they lock in (**Lock-in**, then again to confirm; the tab is underlined orange while they're elsewhere with the vote open) or close the survey; the tab then stays read-only until the GM sends a new survey, which starts a new vote. Only logged-in players with a character in the fight count. The most-voted answer is the Friendly Team's; the Friendly Team leader's player breaks a tie, and a tie the leader doesn't settle counts as no answer. The Friendly Team's answers nudge what each friendly creature wants, and in some fights stand in for its "Let this character decide" on talking, spending, foes who fall and pulling out; [**Friendly vote's sway**](STATS_AND_FORMULAS_README.md#friendly-votes-sway) sets how much.

**Asking about one character.** A friendly creature's ⋯ menu in the planner has **Ask its players**: their survey opens on it, with the Friendly Team tab to look at, not vote on. **Answer as GM** opens that character's survey for every GM logged in, to answer for a player who's away.

**My tactics.** A player who controls a token on the map, or owns a character, gets a **My tactics** button in the Encounters tab that opens the same survey at any time. It has a tab for each of their tokens on the map and for each of their characters with no token there. A linked token shares its actor's answers; an unlinked token keeps its own and stands in for its actor while on the map. A player who owns a character but can't open its Token or Prototype Token also gets a **FastFighting** button on its sheet's title bar: it opens that character's tactics alone, with no desires and no Friendly Team vote, and a plain Close that tells the GM nothing. If the survey is already open (the GM asked for it), the button only brings it to the front.

**The token's FastFighting tab (GM).** Every token's window, and the Prototype Token window, has a FastFighting tab. For a creature no player owns, it starts with a GM-only section: a **Hazard** mark (As the game system has it, Not a hazard, Simple: fires once, or Complex: acts every round); where the system keeps food, a **Hunger** mark (Let FastFighting decide, Famished, Hungry or Not hungry); its **ADHD**; and **Keep its name secret**. Then come the same playstyles and questions as the survey (not desires: only the survey knows who a character perceives). A token on the map edits its own answers (a linked one's are its actor's); the Prototype Token edits the actor's, where each new token starts.

**Set up by itself.** The first time FastFighting sees a character (in the planner, its token's tab or a survey), it picks up to four playstyles from its numbers and actions, what its helper reads (class, ancestry, kind of creature, alignment, gear, role), and words in its biography ([keywords/en.json](keywords/en.json)). It never picks two that pull against each other, such as a Chicken and a Martyr, and a plain creature may get none. After that the playstyles are the table's. **Reset answers** (the ⋯ menu on a character's card or its token's tab; it asks first) sets every answer back to "Let this character decide" and picks the playstyles again. "Let this character decide" stands for answers the helper works out from the character (class, features, spells, gear, alignment), or the core from its hidden scores where the helper says nothing. They're worked out again when the character changes; answers someone chose stay.

**What the GM sees.** GMs and assistant GMs see a character's hidden scores (Tactical, Brave, Selfish, Loyal) above its questions, and, in orange under each question, what "Let this character decide" chooses and why. Players see only "Let this character decide".

### Playstyles

Up to four pills per character, PC or NPC, in order of importance: the first counts most. A chosen pill's ‹ and › move it earlier or later; unpicking one moves the later ones up. Where pills disagree on a tactic, each simulated fight goes with one of them, the first most often. Pills shift traits, change the defaults, switch on quirks and steer desires ([how pills combine](STATS_AND_FORMULAS_README.md#playstyles-how-pills-combine), [each pill's numbers](STATS_AND_FORMULAS_README.md#playstyle-numbers)):

| Pill | What it does |
| --- | --- |
| Brawler | the nearest foe; hits back hard; doesn't talk; jeers now and then (a taunt) |
| Chicken | keeps away from the most dangerous foe; gives up easily; hits back half-heartedly; hard to taunt; leading, takes its group with it when it runs; trap avoider |
| Cruel | the weakest, and the fallen; hits back hard; likes leaving a foe hampered |
| Diplomat | talks; spares the fallen; hard to taunt; can't abide violence |
| DPS | its most damaging option every time, spending what it takes until it's gone; the foes it hurts most; flanks and hides for a sneak attack; impatient with talk |
| Enabler | bolsters friends first, then gives them an edge (Aid, a foe knocked down, grabbed, shaken; a flank); heals only when it has nothing else to give; backs the leader |
| Fragile | once hurt, keeps away from whoever hurts it and heals itself; setbacks wear it down; its flight takes others along |
| Impatient | the nearest foe; setbacks wear it down fastest; little patience for locks; in a hurry: won't stop to get clear of a foe, raise a shield or set anything up |
| Kiter | keeps its distance: a shot from out of reach, or in, a blow and out again; falls back as foes close, toward its friends; picks on foes that can't follow; cornered, it fights |
| Instigator | locks foes down, harasses and debuffs them more than anyone; the most dangerous foe and the enemy leader; may defy its own leader; taunts |
| Lazy | the nearest foe, no long walks; sometimes ignores a taunt; little help to anyone; gives up fast; holds no grudge; its flight takes others along |
| Lore-Collector | sizes up a new foe before acting against it, then rolls much better against every foe of that sort (by the **Lore-Collector advantage** setting); may share what it learned; trap avoider |
| Medic | heals first and early (a friend at three quarters is reason enough), the dying above all; keeps its healing for healing; bolsters when nobody's hurt; gives a friend its own potion; stays close |
| Martyr | guards the weakest friend; fears nothing; avenges the fallen fiercely; rallies; taunts foes off its friends |
| Mercenary | easy pickings; barely avenges anyone; gives up when it gets hard; its flight takes others along; extorts, and takes a bribe readily |
| Moralist | never strikes the fallen and pulls killing blows where the system allows; heals friends, guards the weakest; can't abide violence |
| Peacekeeper | hard to taunt; a standoff with it lasts longer; calms quarrels; foes it talks round stand down; its words are trusted, and it never threatens; spares the fallen; can't abide violence |
| People-Pleaser | wants what its leader wants; likes to talk and to bolster friends; can't abide violence |
| Puzzle-Maniac | weaknesses, casters, clever lock-downs, its own specialties, and locked doors (patient with them); hard to taunt; trap avoider |
| Redeem-Seeker | the biggest threat; won't give up; now and then dares a foe to come at it |
| Relentless | sticks with its foe (the hardest of all to taunt); shrugs off setbacks; keeps at doors; a little wary of outsiders' words |
| Skeptic | hard to taunt; listens less to its leader; slow to talk; harder for outsiders to talk round; trap avoider |
| Tank | stands in front: taunts foes off its friends, draws attacks, guards the weakest, fears nothing, never retreats, keeps its shield up, minds getting hit less |
| Thief | robs when it's safe; a lock is an invitation; trap avoider |
| Un-Mundane | its magic and specialties over plain blows and talk ("Much more often"), spending freely; foes its powers find a weak spot in |
| Vengeful | hits back hardest; avenges fallen friends; its grudges never cool |
| Wallflower | keeps its distance; often ignores a taunt; hampers foes from afar; keeps out of notice; its flight takes a few along; trap avoider |
| Wants to Lead | the biggest threat; looks after, bolsters and rallies its people; listens little to its commander; may scheme if not chosen to lead |
| Wildcard | something random catches its eye; nobody's voice counts for much; may defy its leader |

Checkboxes beside the pills:
- **Stay mostly true to my calculated tactical level:** playstyles and answers barely move the calculated strategy.
- **Roleplaying is very important to me:** playstyles weigh more, and their quirks show much more often.
- **I don't like to use spells that cost something:** spells that use slots, focus or daily uses become rare, until a life is at stake. Cantrips are free. The Consumables answer **I don't like to use consumables** does the same for potions, scrolls and bombs.

Three answers carry a wish, as strongly as the answer leans that way ([wishes](STATS_AND_FORMULAS_README.md#tactics-answers-wishes-and-let-this-character-decide)):

| Question | The wish | Answers, from strongest to none |
|---|---|---|
| Talking instead of fighting | talks whole turns at a time, even without much skill, and votes to open with a standoff; not while it's being hurt | Always talk unless I am currently being hurt; Talk first: try to end it with words; Talk when it could work; Let my weapons do the talking |
| Foes who fall | avoids killing (see [After the fight](#after-the-fight)) | Spare them: I avoid killing; Tie them up; Leave them be or Rob them; Finish them |
| When to retreat | doesn't like to flee (see [Morale and leaving](#morale-and-leaving)) | Fight to the end; When the battle turns against us; When I'm badly hurt |

## Go Live: live battles

**Go Live** closes the planner and plays the fight on the Combat Tracker, a turn at a time. It needs a helper that plays live battles; with an older helper the button is greyed out and says to update it.

The tracker's **Vantage** does the same from the planner's last run of that encounter, but waits: the Battle Vantage opens with **Begin Encounter** glowing until the encounter begins. Foundry's own Begin Encounter works too, and so does pressing it with the planner open on a ready Sample fight. Each plan and battle belongs to its encounter (a scene can have several; the title bars show the scene, and the encounter's number when there's more than one): view another scene or encounter and the planner and the Battle Vantage keep what you were typing, blink orange twice, and show that one's.

- **The start:** everyone in the encounter goes on the tracker, initiative is rolled for whoever hasn't rolled (a player keeps their roll), the encounter starts, and the chat tells the opening. The **Battle Vantage** opens for the GM who started it. The first turn is played at once if it's FastFighting's.
- **FastFighting's turns** (the creatures', and a character's when FastFighting plays it): it decides and rolls the turn as the simulation would, writes it onto the sheets through the helper (hit points, conditions, dying, resources spent, the fled and the surrendered, buffs and debuffs as the spell's own effect), moves tokens around walls, opens doors, and tells the turn in the chat. Then it waits for **Next Turn** (on the card, in the Battle Vantage, or the tracker's own). **Play to the end** goes on without waiting; where FastFighting plays every token, **>> Fast Fight >>** goes quicker still (see [The Battle Vantage](#the-battle-vantage)).
- **The system's own dice:** in FastFighting's turns, attacks, saves and checks are rolled with the system's own roller wherever its helper can, cards in the chat; a character's save is rolled on its player's screen while they're here. One the helper can't settle, a GM picks how it went (or lets FastFighting roll it). A spell shows its own card, and its damage is rolled once and applied to each target by its save. FastFighting applies that damage itself, so leave those cards' own Apply buttons alone.
- **FastFighting's own rolls show in the chat like anyone's:** whatever it rolls itself (damage, healing, a save, a recharge, a recovery check) is a real roll card with its dice, spoken by the creature's token. A player's character's are public, a creature's follow your roll mode, and a creature the players can't see rolls for the GMs only. With **Play to the end**, and in the aftermath, they gather on one folded card for the GMs instead. Rewind takes them back with the turn.
- **A player's turn:** the player plays it with the system's own sheet and cards. When the turn ends, FastFighting reads the roll cards (through the helper) and the sheet changes, and takes them in as if it had seen them: grudges, fear, morale, who was talked round. Anything it isn't sure of goes to the GMs first, to keep, drop or set right; then it tells the turn.
- **Deals:**
  - **A creature's deal with a player's character:** a card asks its player (Accept, Refuse). With no answer in time, the character's nature decides. Either way, the GM has the final say.
  - **A player's own deal:** on their own turn, a card offers **I want to bribe or extort** (the next card posted takes it away). Its dialog picks whom (one the character perceives from where it stands, within talking range), what (pay them to leave, pay them to keep away, or make them pay: an amount, or nothing to just tell them to go), the skill (any, the talking ones first), and the goods: things dragged into the offer with a count, and money by coin. They roll it the system's way.
  - **The creature answers aloud** as the attempt begins, on the map and in the chat: a few words ("Interesting offer.") when it understands; gibberish when there's no language in common, and that ends the player's chance at a deal this turn. Where the system has no languages, the GM says whether the two can talk.
  - **The GM's review:** every deal involving a player waits for it. A GM-only card and the Battle Vantage's **Deals waiting** open a window with the roll against its DC, the answer, and what FastFighting makes of the target (greed, nerve, loyalty, the deal against its purse). **Approve** or **Deny**.
  - **At the sheets:** goods move with the turn; if the payer hasn't got them on the sheet any more, nothing moves and the GMs are told.
  - **Dropped goods:** apart, they lie on the ground for the taker: an Item Piles pile where it's set up for the system (PF2e: with **Item Piles: PF2e**), else the system's own loot pile; with neither, they change hands at once.
  - **Dishonor:** striking one that's walking away after a deal with your side tells the GMs.
  - **In the story:** a deal is told as anyone at the table would see it, never what was offered, demanded or asked for. Only those making it, and the GMs, see the terms.
- **Names in the story:** a creature is named once a player's character has seen it (in sight, or in blows or words with it), or from the start if its nameplate shows to everyone; until then it's someone, numbered. Where the system lets nameplates decide (PF2e's **Tokens Determine NPC Name Visibility**), the story follows the nameplate, as the system's cards do. **Keep its name secret**, on the token's FastFighting tab, keeps it someone all fight.
- **Reactions rolled for real:** a player who says yes to a reaction (or has it on **Always use it**) rolls it themselves, as on their turn: a card only they and the GMs see asks them to, and they press **I've done my reaction** when it's rolled (the card goes). Meanwhile the creature's turn waits, and the Battle Vantage shows it, with **They've rolled it** and **Go on without it**. FastFighting reads their attack and damage cards and plays the strike with them. A creature's reaction, or one whose player isn't here, is rolled with the system's own roller where the helper can, its cards in the chat. A player's reaction's damage at a creature FastFighting runs goes by **Apply players' damage**: applied, or a GM says Apply, Half, Double or Dismiss. A reaction that drops a moving character, knocks it prone or holds it stops the move: the token goes back where the move began and its player is told why. A critical hit that disrupts an action (PF2e's Reactive Strike on a manipulate action) is told too.
- **Areas:** a creature's area (a cone, a line, a cube, a burst) is laid on the map as the system lays its own, and catches only those inside it, walls blocking; it's cleared when the tracker moves on.
- **Players' damage:** a player can't apply damage to a creature FastFighting runs. With **Apply players' damage** on, FastFighting applies the player's damage card at once, through the system, and marks a creature it drops; otherwise, and for a card with a save first, several targets or none, the Battle Vantage lists it for a GM to **Apply**, **Half**, **Double** or **Dismiss**. Where the system or a module applies players' damage itself, the toggles are greyed out.
- **One player's character to another:** with **Apply players' damage** off, a heal, damage or effect one player's character gives another, even when FastFighting plays it for an absent player, is posted but not applied: its card keeps the system's Apply, and the Battle Vantage lists it. Where the players don't run their characters, FastFighting applies it all.
- **Players run their characters** (a planner toggle, on by default). Off, FastFighting plays every turn. In the Battle Vantage, **FastFighting plays their turns** takes over one character for a player who has to leave; clear it to hand the character back.
- **Players who drop out** (**Play for disconnected players**, on, 2 minutes): when a player disconnects, each of their characters with no other player connected gets a countdown, shown beside **Add** in the Battle Vantage; when it runs out, FastFighting plays their turns. A player not connected as the encounter begins counts as gone from the start. A player who comes back stops the countdown, and after 12 seconds connected gets every character they own back, even ones a GM handed to FastFighting. None of this happens in a battle where **Players run their characters** is off: FastFighting plays everyone, whoever comes or goes.
- **Reactions:** each character's FastFighting tab lists its reactions with **Always use it**, **Ask me** or **Never use it**. Asked, the player answers on their screen (the GM answers when they're away or don't answer in time). An NPC's reactions follow its tactics, unless **Ask me about NPC reactions** is on in the Battle Vantage; then the GM allows each.
- **Rerolls:** where the system has a reroll to spend (PF2e Hero Points, 5e Inspiration), each character says whether FastFighting may spend it to save its own life or a teammate's.
- **Bystanders** who notice the fight join the tracker and take their turns. **Summons** appear as tokens beside their summoner.
- **Spotlight systems** (Daggerheart, Ironsworn) have no initiative: the Battle Vantage gives the spotlight to whoever FastFighting would pick next, or to whoever the GM picks.
- **The end:** the chat says which side won. **Settle the aftermath** has FastFighting deal with what's left (the dying bleed out or hold on, the beaten are dealt with, goods go back to their owners). The encounter stays open until a GM ends it (Foundry's End Encounter, or the Battle Vantage's).

### The Battle Vantage

The GMs' window for a live battle. It follows the turn the tracker shows, Foundry's **Skip Defeated** included.
- **Turn bar:** the round, whose turn it is, what the battle is waiting for, and the one button to press now: **Begin Encounter**, **Play it** (with **Skip to Next Turn** beside it), **Next Turn**, or **Settle the aftermath**, then **End Encounter** (Foundry's own, which asks first). **Rewind** sits beside it. While a player's turn waits for review, or a player's reaction is being rolled, Next Turn shows how many things wait, and asks before moving on past them. The ⋯ menu: Play to the end, Ask me about NPC reactions, Apply players' damage, End Encounter, and **Rewind This Encounter** (press twice).
- **Turn order:** the tracker's, a chip for each creature; a click puts it in focus. The arrow keys and the mouse wheel move along it.
- **Waiting:** everything waiting on you, what holds the battle up first: a player's reaction being rolled (They've rolled it, Go on without it); a player's turn to review (keep, drop or set right what was read, then **Tell it**); the notes told with that turn; players' damage to apply (Apply, Half, Double, Dismiss); deals to review. It comes to the front when something new holds the battle up.
- **Teams:** each team's head, its view of the fight (going after someone, holding back, leaving), its creatures, and its reinforcements, with **Call**.
- **Map of minds:** every creature on the map as a node, laid out as its token stands; drag, pan and zoom. Where you drag them lasts while the window is open: **Reset** (or opening it again) lays them out from the map. Each desire, and each condition from someone, is an arrow between two creatures (wants to hurt, wants to talk round and how, afraid of, grabbed by, holds a grudge, won't listen to). What a creature has on its own (prone, hasn't noticed the fight, thinking of running) floats round it. A goal about a thing points at it: the door it wants through, the trap it keeps clear of. Every line and symbol has an intensity; the GM can raise it, lower it or set it aside at 0, and what the GM sets holds until it's handed back. A character its player runs shows no desires.
- **Creature:** click a creature, or select its single token on the map, to see what it wants, what's on it, who wants something of it, and the conditions and table rolls to put on it; its team (**F**, **H1** to **H3**, **N1** to **N3**) and its role. The line under the pointer glows: − and + lower and raise it (− at its lowest removes it), ] and [ step through the creature's lines (all in **Configure Controls**). + on the creature itself, or its **Add** button, adds one.
- **What happened at the table:** what FastFighting couldn't see (talked round by a Diplomacy roll, wanting to hurt someone, shaken, fleeing, surrendering), applied as the simulation would have.
- **Conditions:** each with its value, its source, its duration, and whether the sheet shows it or FastFighting keeps it. The GM can put on any condition the core or the system knows, change a value, or take one off, including those toward someone (afraid of, grabbed by, goaded by, controlled by, tied up by, off guard to, and a power's mark). What the sheets can show goes on the sheet; the rest FastFighting keeps with the battle. Rewind takes a GM's change back with the turn it came after. Conditions drive behavior, not only numbers: a frightened creature keeps away from whoever frightened it, a grabbed one is set on whoever holds it, and a charmed one never attacks its charmer.
- **Moving a creature** to another team works out again what it wants, and everyone's wishes toward it. A token on the map that isn't in the battle can be brought in.
- **>> Fast Fight >>**, beside the turn bar's button when FastFighting plays every token (no character a player runs, or **Players run their characters** off): plays the rest of the fight at once. No turn card and no wait between turns, moves walked quickly, and Dice So Nice's 3D dice off until it stops. The rest is as usual: the system's cards, rolls and story in the chat, and each turn can be rewound afterwards. Unlike Play to the end, rolls stay in the chat; it turns Play to the end off. It stops when the battle ends, a player's character must act, something needs a GM (a roll to settle, a reaction to allow), or you use the tracker, Next Turn or Rewind. Once the fight has lasted the system's fewest Max rounds (PF2e: 6), two whole rounds with nothing changing (no one hurt, healed, fallen, fled, given up or talked over) make it ask whether to keep going; after a yes, not again for at least four rounds. **Stop** ends it after the turn under way.

### Rewind

**Rewind**, on the card after each turn FastFighting plays and in the Battle Vantage, is the tracker's Previous Turn, and the battle follows the tracker back however it goes (its own Previous Turn and Previous Round too). Each turn after the one it goes back to is taken back, last first: what it wrote on the sheets, its cards, its moves, and the minds as they were. A turn FastFighting played stands as it ended, and Next Turn plays the next one again with fresh dice; a player's turn is theirs again, and all its cards are read again when it ends. At the battle's first turn, Rewind takes that turn back and waits for **Play it**; with nothing to take back, it's greyed out. The last 12 turns rewind this way; further back, the tracker is put back where it was. A player's turn is taken back whole, whatever it changed by hand (the player's moves, hit points, spell slots and other resources, items used, conditions; a GM's clicks on the system's own buttons too), as long as the GM's browser wasn't reloaded during it. **Rewind This Encounter** takes the whole battle back to before it began. The battle is saved as it's played (in a journal entry only GMs can see), so a reload or a GM leaving loses nothing: the next GM picks it up where it was.

**Fights from before live battles** (versions 0.1 to 0.2.5, which played the whole fight at once) can no longer be rewound.

## After the fight

When the last foe falls, the survivors tend their dying before the dying make their next roll: free help first (first aid, medicine feats), then spells and potions. Anyone left untended lives or dies by the system's rules for dying. **After the fight** picks how much of this happens: **Tend the fallen and tell it**, **Tend the fallen quietly** (the story ends at the last blow), or **Stop at the last blow** (you play the rest out).

**Fallen foes** are dealt with by each victor's answer to **Foes who fall** (its own, or the Friendly Team vote's), then its playstyles:
- **Spare them: I avoid killing** (also Moralists, and Diplomats most of the time): it stops others from finishing them and gives free first aid if it can. Its killing blows knock out instead, and it never strikes the fallen. **Killing-averse creature holds back (%)** sets how often, less for answers that lean less that way ([mercy](STATS_AND_FORMULAS_README.md#avoiding-killing-mercy)).
- **Finish them** (also the Cruel, with no other answer): it finishes them off.
- **Tie them up:** it pulls killing blows most of the time and ties up the fallen with whatever's to hand. Prisoners are out of the fight even if healed, and tended after it. Mid-fight it ties someone up when no foe stands within its reach (without a map, after the fight). A prisoner struggles against its bonds, and friends may untie it. In a live battle the sheet shows it with the system's restrained status; the results show how often each creature ends up **Tied up**.
- **Rob them:** it takes a fallen foe's purse, else something it carries, else (not a player character's) what it held or wore, during the fight or after; a player character's things only on its luck check. The robber gives it back if it ends the fight beaten.
- **Leave them be:** left to the dice.

**Fallen PCs.** A creature that wants to finish off a player character at 0 HP goes ahead only on a hidden roll ([**Downed PC finished off**](STATS_AND_FORMULAS_README.md#execute-luck-finishing-off-a-pc)); otherwise it turns to the next foe. A character with **fate** to spend (PF2e Hero Points, 5e Heroic Inspiration) uses it when someone would die: the killing blow, save or recovery check is rolled again, or, for its own death where the system has a sure way out, that (PF2e Heroic Recovery). It always spends for itself; for a friend, the more selfish it is, the less likely ([fate](STATS_AND_FORMULAS_README.md#fate-rerolls-that-keep-someone-alive)).

## How creatures decide

The simulation and the live battle make the same decisions. The links go to the numbers and formulas in [STATS_AND_FORMULAS_README.md](STATS_AND_FORMULAS_README.md); [CODING_README.md](CODING_README.md#engine-behavior-in-detail) covers the code.

### Personality

Four hidden [traits](STATS_AND_FORMULAS_README.md#personality-traits), **Tactical**, **Brave**, **Selfish** and **Loyal**, drive every choice. They come from the sheet (a player character starts as the usual hero), blended with the side's personality (**Side personality defaults**, or the planner's group personality) and nudged by words in a biography ([keywords/](keywords/README.md)). Each trait's tooltip in the planner lists what moved it. The four sum to 250 at most: raising one past that lowers the highest of the others, and a sheet that reads over it loses the excess from its highest and has its answers worked out again (not its playstyles). Playstyle and leader bonuses come on top. [Tactical](STATS_AND_FORMULAS_README.md#tactical-tiers) runs from *Feral* (the closest foe, or whoever hurt it last) through *Instinctive*, *Competent* and *Tactical* to *Mastermind* (its whole side on one target).

### Desires

Each creature keeps a list of [desires](STATS_AND_FORMULAS_README.md#desires-and-their-level), from Passing to Obsessed: to hurt, heal, protect, bolster, talk to, keep away from, break free, leave the fight, and more. They come from its tactics, the fight (a grudge, a fallen friend), its commander, the Friendly Team's vote, its playstyles, and up to three desires stated in its survey or the planner. [The strongest leads](STATS_AND_FORMULAS_README.md#what-comes-to-mind) and [thwarted ones fade](STATS_AND_FORMULAS_README.md#frustration). Tactical creatures [focus fire](STATS_AND_FORMULAS_README.md#focus-fire) on foes their side has already hit (pack hunters always, the Cruel most of all), and the smart ones [keep together](STATS_AND_FORMULAS_README.md#keeping-together) without bunching up. A less thoughtful creature's mind sometimes [jumps](STATS_AND_FORMULAS_README.md#adhd) to its strongest desire (**ADHD: mind jumps**); a creature's own **ADHD**, on its token's FastFighting tab or in the planner, makes it less thoughtful. The story now and then voices a creature's two strongest desires.

### Talking

Talkers [persuade, intimidate or deceive](STATS_AND_FORMULAS_README.md#who-talks-and-how-often) with the system's skills until they [win enough successes](STATS_AND_FORMULAS_README.md#the-persuasion-track). Harm and failed pitches make a listener harder to sway, and after an insult (a critical failure) it won't listen again. Talker and listener need a shared language unless **Ignore languages** is on. A creature talked round [surrenders, flees, stands down or changes sides](STATS_AND_FORMULAS_README.md#what-a-convinced-foe-does); an enemy changing sides only stands aside, and only on **Enemy changes sides**. Only threats work on a PC, and only to make it run; one whose answer is "Let my weapons do the talking" won't listen at all.

Creatures FastFighting plays also [strike deals](STATS_AND_FORMULAS_README.md#deals-bribes-extortion-and-scaring-off): the losing and timid pay a foe to leave, the greedy and bold extort money, the bold threaten the weaker into going, and a neutral sends off whoever comes too close; a timid neutral just leaves when blows are struck, and if attacked tries to buy its way out with its reaction. A bribe is easier than a threat, and a threat that asks for money hardest. The payer must still have the goods when they change hands. Paid apart, the goods are dropped for the taker to pick up. One that acts before all its foes, or surprises them, may ask a toll instead: pay me and I'll go (a leader for its whole team, at two thirds of a share each); paid, it leaves, a player's character at once. A lavish bribe or a superb roll may buy a foe over instead: an enemy only stands aside, leaning your way, and one taking no side joins you. One who agrees to go joins a free neutral group if there is one (its leader urging the team to come too) and walks off the map; attacking it on its way is dishonorable, and the GM is told.

An encounter [opens as a standoff](STATS_AND_FORMULAS_README.md#how-an-encounter-opens) when the sides would rather talk, or as **Opening** says; nobody attacks until someone [loses patience](STATS_AND_FORMULAS_README.md#impatience-what-breaks-a-standoff) or a blow lands. [**Only an argument: no fighting**](STATS_AND_FORMULAS_README.md#only-an-argument) never comes to blows: what would start a fight collapses the talks instead, and the results show how often. A neutral may [quarrel](STATS_AND_FORMULAS_README.md#crossed-grievance-truce-and-turning-on-a-side) with one side after a botched pitch, and only those two fight.

### Groups

Hostile tokens start in group 1 (**H1**); a creature's team menu moves it to **H2** or **H3**, each a side of its own with its own leader. When it opens, the planner proposes up to three [friend groups](STATS_AND_FORMULAS_README.md#neutral-friend-groups-reach) among the neutrals, by kind and nearness. Friends look after each other, and hurting one angers the rest.

### Taking no side

Neutral tokens, and enemies talked out of the fight, [take no side](STATS_AND_FORMULAS_README.md#taking-no-side-neutral-tokens-and-leans): nobody fights them, and they never win or lose. The Neutral tab's lean only nudges what they want. Hurt, rob or insult a neutral and it [turns on the offender's side](STATS_AND_FORMULAS_README.md#crossed-grievance-truce-and-turning-on-a-side) (Go Live makes one that turns on the Friendlies Hostile); either side's talkers can [win it over](STATS_AND_FORMULAS_README.md#winning-over-calming-and-sending-away). Only a Tactical mind or better [knows a neutral for what it is](STATS_AND_FORMULAS_README.md#taken-for-a-foe-caught-in-the-blast-spared-in-a-truce). A neutral with a lean [sometimes speaks up](STATS_AND_FORMULAS_README.md#meddling-neutrals-getting-involved) against the side it likes least. The peaceable (Diplomats, Moralists, Peacekeepers, People-Pleasers, and those who answer "Spare them: I avoid killing" or "Always talk unless I am currently being hurt") spend their turns talking the fighters into leaving.

### Leaders and bosses

Each group (the Friendly Team, each hostile group, each neutral friend group) has a **boss** (never the Friendly Team) or a **leader**, and up to two **lieutenants**: **B L 1 2**, from a creature's role menu, which also has **Out of command** and **Automatic**. FastFighting [fills them](STATS_AND_FORMULAS_README.md#chain-of-command) once, when the plan is new or just cleared (shown dashed); after that only the GM changes them, or the planner's ⋯ menu re-picks them. Outside the Friendly Team the best leader heads the group, as a boss when it outranks every other member by 2 levels or more. The Friendly Team keeps the roles you gave its members before, or gets a leader only when exactly one member wants to lead.

The commander [lends its group a bonus](STATS_AND_FORMULAS_README.md#what-a-leader-lends), [pulls its followers](STATS_AND_FORMULAS_README.md#following-the-leader) toward its wishes (**Leader's influence**, **Boss's influence**), and talking it down can take its group with it. When it falls or can't make itself seen and heard, a lieutenant steps up. Bosses almost never run. A Wants to Lead character out of command may [scheme](STATS_AND_FORMULAS_README.md#scheming); a PC turns traitor only on **PC turns traitor**.

**Reinforcements.** A team's Details take one creature (drag it from a compendium or the Actors directory, or **Choose…** from the world's actors) and how many can come. A team's leader [calls them](STATS_AND_FORMULAS_README.md#reinforcements) when the fight turns against it (an action; the Friendly Team's only when FastFighting plays all of it), and they come the next round from the map's far edge. In a live battle the Battle Vantage lists each team's and lets the GM call them.

**Teams act as teams.** Each round, a group's head [sizes up the fight](STATS_AND_FORMULAS_README.md#team-stances), the smarter the more carefully:
- **Leaving:** a competent head takes its team out of a fight whose odds look too long.
- **Jumping in:** a neutral friend group jumps in to save the side it leans to, or against a side it holds a grudge against.
- **Waiting, then preying:** a tactical head hangs back while two others fight, then goes after whichever is spent, to rob, extort or finish them.
- **A new head:** one taking over decides again, by its own nature, and may call its team back.
- **The Friendly Team:** takes part only when FastFighting plays all of it.

### Morale and leaving

Losses, wounds, a fallen leader, bad odds and friends seen running [weigh against Brave](STATS_AND_FORMULAS_README.md#morale-stress) until a creature [wavers or routs](STATS_AND_FORMULAS_README.md#morale-check-hold-waver-rout). One that runs [tries to take its group along](STATS_AND_FORMULAS_README.md#calling-a-retreat), and a commander, or a brave and loyal friend, may [rally](STATS_AND_FORMULAS_README.md#rallying) them. [Fear conditions](STATS_AND_FORMULAS_README.md#fear) do what the system says, and fear past what a creature's nerve can bear gives it a reason to run. [Of its own accord](STATS_AND_FORMULAS_README.md#leaving-of-its-own-accord), a hostile with nobody to lead it, or led by one who'd rather run, may decide its life is worth more than the spoils; and one that has stolen, looted or picked up something may make off with it.

On a map, a runner [heads for the nearest way off](STATS_AND_FORMULAS_README.md#leaving-the-fight) and is gone at the edge, or after two whole turns in a row given to leaving. Struck or spoken to, it [may stop](STATS_AND_FORMULAS_README.md#being-stopped-on-the-way-out) (**Leaving creature keeps going**). Once it's gone, a live battle hides its token and takes it off the tracker, or leaves it in place (**Tokens that fled**). A side whose only creatures left are leaving has lost. A character that answers **Fight to the end** to When to retreat usually [stands its ground](STATS_AND_FORMULAS_README.md#standing-its-ground) (**Fighter to the end stands firm (%)**), though fear from a spell or the rules still works.

### Held, hurt or controlled

A [held](STATS_AND_FORMULAS_README.md#holds-and-escapes) creature (grabbed, tied up, caught in a web or a net) wants to break free, and friends free a tied-up ally. It weighs what hurts it (burning, bleeding, prone) against what else it wants; a selfless one may [bear it](STATS_AND_FORMULAS_README.md#bearing-a-hold-or-hurt-ignore-troubles) (**Selfless creature shrugs off troubles**). Tied up, it can't use what needs hands (the system says which, or its helper's **Tied up stops spells** setting). A charmed or dominated creature wants what its controller wants; under a player's character, it's that player's to run.

### Taunts, traps and theft

A [taunt](STATS_AND_FORMULAS_README.md#taunts-goading) makes a foe want to go for the taunter: a strong desire, not a command. Systems taunt with their own skills and spells; Tanks, Instigators, Martyrs, Brawlers and Redeem-Seekers taunt too (**Playstyle taunt takes hold**). [Trap avoiders](STATS_AND_FORMULAS_README.md#trap-avoiders), Thieves most, may spot each hazard at the start of a fight (**Trap avoider spots a trap**) and keep out of it; a GM marks a token as a hazard in its FastFighting tab. [Theft](STATS_AND_FORMULAS_README.md#theft-mid-fight) mid-fight is rare: only a Thief or an unusually skilled pickpocket steals, only when it's safe, and from a PC only on **Thief robs a PC**, which the story never mentions. Stolen goods return if the thief is beaten.

### Buffs, debuffs and control

[Buffs](STATS_AND_FORMULAS_README.md#buffs-and-support), [debuffs and control](STATS_AND_FORMULAS_README.md#control-and-debuffs) (Bless, Haste, Bane, Hold Person, a Demoralize, a Trip) work the same way in every system, for their duration, with saves and [concentration](STATS_AND_FORMULAS_README.md#concentration) where the system has them. A creature buffs when that's worth more than attacking; thinking minds judge this best. One-roll edges (5e Help, PF2e Aid, Guidance) count for a friend's next roll.

### Senses

A creature acts only on what it [perceives](STATS_AND_FORMULAS_README.md#senses-what-a-creature-can-tell): a foe it can't perceive looks unhurt, and a friend in need goes unnoticed. The helper sorts the system's senses into sight, lowlight, hearing, smell, feel (blindsight, tremorsense and the like) and radar; in a crisis, any sense that could plausibly reach will do. [Bystanders](STATS_AND_FORMULAS_README.md#noticing-the-fight-bystanders) notice a fight the same way.

### Doors

Creatures [open doors](STATS_AND_FORMULAS_README.md#movement-reach-and-getting-there) on their way. A locked door is worth only what lies beyond it: a creature forces it, hacks it down or picks the lock, and [each failure wears its desire down](STATS_AND_FORMULAS_README.md#frustration). A door opened in a live battle stays open until Rewind closes and relocks it. A GM can give a door its own numbers in the wall's flags (`fast-fighting.door`).

### What else the simulation models

The numbers are under [Fighting and the simulation](STATS_AND_FORMULAS_README.md#fighting-and-the-simulation) and each system's section.
- The system's own rules, from its helper: actions, degrees of success, attack penalties, advantage, criticals, resistances and dying.
- Afflictions, persistent damage, and riders on a hit (knockdown, grab, sneak attack, Pack Tactics).
- Extras paid for on a hit (a smite's slot, a stunning strike's ki, a superiority die).
- DCC's deed dice and Mighty Deeds, crit and fumble tables, action dice, spell checks and burned Luck.
- Reactions (Shield, Uncanny Dodge, Parry, Shield Block, Riposte, counterspells and more), and [opportunity attacks](STATS_AND_FORMULAS_README.md#opportunity-attacks-and-getting-clear), which the smarter avoid with Disengage or Step.
- [Summons](STATS_AND_FORMULAS_README.md#summons), fighting for their summoner's side; the planner's results don't count them.
- Legendary actions and Legendary Resistance, regeneration, fast healing and Undead Fortitude.
- Magic Resistance, save auras, evasion, recharges and cooldowns, and size limits on shoves and trips.
- Crowd control, valued by the damage it prevents; thinking creatures don't waste it on the immune.
- Healing by spells, potions and first aid, with range: a touch means walking over first.
- [Getting ready](STATS_AND_FORMULAS_README.md#getting-ready-draws-reloads-and-a-turn-for-the-next): a weapon drawn and loaded (a crossbow's Reload), a potion got out, a healer on its way, when the turn can't do what it wants; and what's spare after its main actions spent on where it stands next: into reach or range, a flank, cover, between its friends and their foes, or out of reach.
- Terrain from Foundry's regions, by movement mode; walls block sight and movement; climbers go over and burrowers under, and a high flyer can't be hit in melee from the ground.
- Any grid and units, from the scene (1.5 m to a 5-foot square); units it doesn't know count each square as 5 ft.

## The story

The fight is told in one of three styles (**Story style**): **Roleplay** (prose, with cover, terrain, climbing, flying, burrowing, and relationships such as an enemy leader, a grudge, vengeance, a protector or a rival), **Standard** (what each character did and how it ended) or **Statistician** (every roll). Creatures that never joined the fight aren't listed, and hidden ones are never named. In a live battle, what the players shouldn't learn (who takes command, what a creature thinks or schemes, what sizing up a foe told it, its nerve failing) goes on a card for the GMs only. A turn where a creature keeps out of the fight is told too, and so is a player's recovery check (or death save). The narrator tells the story, never a creature in its own voice. Every Roleplay sentence comes from a roll table; **Settings → FastFighting → Story tables** installs them as editable RollTables.

With Health Estimate installed, the story uses its words for how hurt a creature looks.

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
3. For the Roleplay prose, copy `story/en.json` to `story/<code>.json` and translate its sentences. Each table's key lists finished sentences (`{"event.opening": ["…", "…"]}`), with only the `{braces}` to keep. A list can have as many entries as you like.
4. Each helper has its own `languages/en.json`, translated the same way. Leave the words its `hardcoded-toEN.json` names as they are.

Anything a translation leaves out reads in English. The tests check every listed language for unknown keys and matching placeholders.

The words read in biographies are in [keywords/](keywords/README.md), one file per language (`keywords/en.json`, and yours beside it, such as `keywords/es.json`), each word with what it raises and lowers. A translation's keywords add to the English ones and never replace them, since a biography may be written in either language: list only your language's words, and your negations ("nunca", "no"). [keywords/README.md](keywords/README.md) explains the ratings.

## Settings

World settings, under **Configure Settings → FastFighting**, in groups that open and close (a search opens them all). The planner overrides some for one battle: Seconds, Max rounds, Downed, After the fight, Opening, Surprise, the Encounter view's toggles, and the side settings (the Neutral lean, healing). The chances (Personality & luck, mostly) are hidden d100 rolls. Some are the game system's: its helper sets their range and default, and may word them for its rules (Max rounds, Lore-Collector advantage). A helper's own settings show at the bottom, under its name; **Systems without a helper** shows only when this system has none. [STATS_AND_FORMULAS_README.md](STATS_AND_FORMULAS_README.md) gives each number's range and what it changes.

### Live battles

| Setting | Default | What it controls |
| --- | --- | --- |
| Play the fight on the map | on | Tokens walk their turns; off, they jump to where each turn leaves them. |
| Players run their characters | on | Players take their own characters' turns; off, FastFighting plays every turn. |
| Play for disconnected players | on | A character whose players have all disconnected gets a countdown in the Battle Vantage, and FastFighting plays it when that runs out; off, its turns wait. |
| Disconnected player countdown | 120 | How many seconds that countdown lasts. |
| Apply players' damage | off | A player's damage card against a creature FastFighting runs is applied at once; off, the Battle Vantage asks a GM. Per battle in the planner and the Battle Vantage; greyed out where the system applies players' damage itself. |

### Story & chat

| Setting | Default | What it controls |
| --- | --- | --- |
| Story style | Roleplay | How the story is told; Statistician lists every roll, for GMs only. |
| Story delivery | Public | Who sees the story. |
| Show the odds in the story | off | Each side's odds at the story's end. |
| Story tables (menu) | — | Installs the Roleplay sentences as editable RollTables. |

### Planner defaults

| Setting | Default | What it controls |
| --- | --- | --- |
| Prediction time (seconds) | 10 | How long the planner simulates. |
| Max rounds | The system's (PF2e: 12, from 6 to 16); else 12 | Rounds before a simulated fight is a stalemate. A live battle never ends as one. |
| Include hidden tokens | on | Hidden tokens outside the encounter take part. |
| Include other scene levels | off | Tokens outside the encounter on the scene's other levels take part. |
| Bystanders can join | on | Tokens outside the encounter may join. |
| Neutral tokens | Takes no side (until crossed) | The Neutral side's lean. |
| Neutral friend groups: reach (squares) | 3 | How near neutrals must be for the planner to group them. |
| Surprise | Follow System | Who is surprised as a fight starts; No one where the system has no surprise rules. |
| How encounters open | Talk if they'd rather | Whether a fight opens as a standoff. |
| Positioning and terrain | on | Distances, movement, terrain, walls and elevation. |
| Downed characters | Simulate dying and healing | What 0 HP means. |

### How creatures decide

| Setting | Default | What it controls |
| --- | --- | --- |
| Leadership | on | Leaders, bosses and lieutenants. |
| Leader's influence | 50 | How readily followers take their commander's lead (0: nobody follows; 100: twice as readily). |
| Boss's influence (×) | 2 | How much more readily a boss is followed than a leader. |
| Morale and routing | on | Wavering and running away. |
| Talking | on | Talking foes out of the fight. |
| Ignore languages | off | Anyone who speaks understands everyone who speaks. |
| PC healing | Let each character decide | How freely PCs heal. |
| PCs when an ally is dying | Let each character decide | What PCs put first when an ally is dying. |
| Friendly vote's sway (%) | 3 | How much the Friendly Team tab's vote sways the friendly side. |
| Dampen non-friendly focus fire | 0 | How much less creatures not on the Friendly side focus fire (100: half as much). |
| Lore-Collector advantage (×) | The system's (PF2e: 2×); else 2.5× | How much likelier a Lore-Collector's rolls are after it sizes up a foe, against foes of that sort; the helper names its system's skill for it (PF2e: Recall Knowledge). |

### Personality & luck

| Setting | Default | What it controls |
| --- | --- | --- |
| Thief robs a PC | 29 | A thief taking something from a PC, standing or fallen. |
| Downed PC finished off | 39 | A creature finishing off a PC at 0 HP. |
| PC turns traitor | 9 | A PC talked into changing sides going through with it. |
| Enemy changes sides | 69 | An enemy talked into changing sides going through with it. |
| Trap avoider spots a trap | 59 | A trap avoider spotting a hazard. |
| Playstyle taunt takes hold | 42 | A playstyle's taunt taking hold (a system's taunts follow its rules). |
| Selfless creature shrugs off troubles | 29 | A selfless creature carrying on regardless. |
| Fighter to the end stands firm (%) | 90 | A Fight to the end character resisting its urge to run. |
| Killing-averse creature holds back (%) | 90 | A character that avoids killing holding back from a kill. |
| Leaving creature keeps going | 79 | A leaving creature keeping on when struck or spoken to. |
| Roleplayer forgets opportunity attacks | 33 | A character played for the story forgetting to play safe around opportunity attacks. |
| ADHD: mind jumps | 20 | A creature dropping what it's doing for its strongest desire. |
| Side personality defaults (menu) | — | Each side's Tactical, Brave, Selfish and Loyal. |

### Aftermath

| Setting | Default | What it controls |
| --- | --- | --- |
| After the fight | Tend the fallen and tell it | Tending the dying, and telling it. |
| Slain creatures' gear | Leave on corpse (lootable) | A slain creature's gear in a live battle (only with a helper that handles loot). |
| Slain tokens | Keep, marked dead | Slain tokens (only with a helper that handles loot). |
| Dead player characters leave meat | off | A dead player character's loot token also holds its meat (only where the helper knows its system's meat). |
| Tokens that fled | Hide token | Tokens that fled a live battle. |

- **Loot on the map:** the Planner's **Place a chest** and **Place a bag** (its Encounter view) put an empty pile where you click next: an Item Piles pile when Item Piles is set up, else the system's loot pile, else one of FastFighting's own. Its own window then opens for you to fill. It's a lure: a thief, a greedy creature or a hungry one may want what's in it more than a fight.
- **Piles and hunger:** where the system's helper knows its food, [what lies on the map](STATS_AND_FORMULAS_README.md#piles-meat-and-hunger) is worth going for. A thief or a greedy creature goes for a rich pile when it's safe. A hungry creature eats: a pile's food, or the meat of the dead (a teammate's only for a cannibal or a feral mind). A wise one barely minds hunger mid-fight, but any creature that eats may come famished.
- **Meat:** where the system's helper knows its meat, a creature's body leaves uncooked meat when it dies, with the rest of its gear. Nothing comes from a body of no flesh.
- **The fallen's loot, live:** with Item Piles and **Leave on corpse**, a creature's token becomes an Item Piles pile when it falls, and turns back if it gets up. A player's character that dies leaves a loot token on top of it with a copy of its things; its sheet is untouched. The loot token is an Item Piles pile, else the system's loot pile, else one FastFighting makes. Creatures that rob the fallen take from it. **Do nothing** turns both off. A pile never joins a battle.

### Troubleshooting & data

| Setting | Default | What it controls |
| --- | --- | --- |
| Troubleshooting | off | Keeps each live battle's transcript, and the planner's last run, for 30 days. Off, a transcript goes with its encounter. On, the last run's odds are in the world, where a player who digs could read them. |
| Background workers | on | Runs the planner's fights on background threads. Off: on the main thread. Workers that fail switch off by themselves. |
| Live battle data (menu) | — | Each live battle's journal: export one or all, or clean up those over a month old. |

**Reporting a bug?** Turn on **Troubleshooting** first, play or plan the fight again, then export from **Live battle data** and attach the file.

### Systems without a helper

| Setting | Default | What it controls |
| --- | --- | --- |
| Use the experimental generic adapter | off | A generic d20 adapter for a system with no helper. |
| Generic system data paths (menu) | — | Where the generic adapter reads an actor's HP, AC, attack bonus and damage. |

## Performance survey

Optional: the [FastFighting Performance Survey](https://tally.so/r/vXjzAv) asks about your setup, a battle you planned and how many fights the planner ran. It helps make FastFighting faster. The link is also at the foot of FastFighting's settings.

## What it doesn't do

- It holds no game rules of its own: without a helper for your system, or the experimental generic adapter, it does nothing.
- The Sample fight isn't the ruling: Go Live rolls a new fight.
- While **Players run their characters** is on, it doesn't play a player's turn unless you hand it that character, and it shows no desires for a character its player runs.
- In a live battle it spends no player resource except the rerolls each character allows.
- It doesn't end the encounter: the GM does.
- Some goals show in the Battle Vantage, marked as such, but don't change what a creature does yet: closing or locking a door, picking up an item, getting to a place, swimming, flying or climbing somewhere, hiding, taking cover, escaping by a way out, and using an object (a lever, a winch, a ritual circle).
- The planner's results leave out summoned creatures.
- Surveys never go to GMs or assistant GMs.

---

Every formula and number behind the decisions: [STATS_AND_FORMULAS_README.md](STATS_AND_FORMULAS_README.md). Writing a helper for another system, the API, hooks and the engine's internals: [CODING_README.md](CODING_README.md).
