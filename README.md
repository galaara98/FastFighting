# FastFighting Core

A [Foundry VTT](https://foundryvtt.com) module that resolves a battle, or a tense standoff, from the encounter on the scene, fairly and quickly, so the table can move on. It simulates the encounter thousands of times, round by round, with real dice math, and shows the odds. Then it tells the story of one fight drawn at random, and **Make it So** commits that fight to the tokens.

- **Foundry:** v14
- **System support comes from helper modules.** See [systems.md](systems.md):
  - [FastFighting PF2e](https://github.com/galaara98/FastFighting-PF2e) for Pathfinder Second Edition
  - [FastFighting D&D 5e](https://github.com/galaara98/FastFighting-DnD5e) for Dungeons & Dragons Fifth Edition
  - [FastFighting DCC](https://github.com/galaara98/FastFighting-DCC) for Dungeon Crawl Classics (and Xcrawl Classics)
- **Without a helper** for your world's system, FastFighting stays inactive. Its settings are greyed out, and the settings window and Combat Tracker point you to systems.md. An experimental generic d20 adapter can be switched on instead.

## Installation

In Foundry, go to **Add-on Modules → Install Module** and paste this manifest URL, then install your system's helper (see [systems.md](systems.md)):

```
https://github.com/galaara98/FastFighting/releases/latest/download/module.json
```

## Using it

**The encounter starts it.** Add combatants to an encounter in the Combat Tracker. Once it has at least two tokens, a **Battle Planner** button appears at the top of the tracker; it's GM only. <kbd>Shift</kbd>+<kbd>B</kbd> opens the planner too. It picks up an encounter already under way from whoever's turn it is, keeping wounds, dying and conditions.

**In the encounter, or just on the map.** Being in the encounter means being aware of the conflict when the simulation starts. Every other token on the map (a bystander) only checks, on its own turn, whether it becomes aware of the conflict now; once it is, it takes its turns from the next round, as if it had been in the encounter all along. It becomes aware when:
- it sees or hears a combatant (walls muffle sound), against the system's Perception (or the like);
- an ally runs to it calling for help;
- someone fleeing runs into it;
- someone attacks it (a hunter, a careless spell): then it's in the fight at once.

What a token does then depends on its disposition (the planner can move any token to another side, or leave it out):

| Disposition | In the encounter (aware from the start) | On the map, not in the encounter |
|---|---|---|
| **Friendly** | Fights for the party from round 1. | Checks each turn whether it notices; fights for the party from the round after. |
| **Hostile** | Fights for the enemy from round 1. | Checks each turn whether it notices; fights for the enemy from the round after. |
| **Neutral** | Takes no side, but weighs what it wants from round 1: its lean (the planner's Neutral tab), its friends among the other neutrals, whatever its Tactics say. It may be offended, confront someone, or be won over (see **Taking no side**). | Checks each turn whether it notices; from the round after, takes no side but starts weighing what it wants. |
| **Secret** | Hidden until it acts; fights for the side its allegiance names (the enemy by default; "takes no side" makes it a Neutral). | Checks each turn whether it notices; from the round after, as in the encounter. |

Its side, desires, nerve and personality decide the rest: a coward may still break and run, a talker may try words first. The encounter is the Combat Tracker's encounter for the scene; with none, everyone on the map is in it. The planner's toggles leave out bystanders, hidden tokens and tokens on other levels.

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
    - for Neutral, a lean: takes no side, or leans toward the party, the enemy, the nearest side or the underdog (see **Taking no side**); or it's left out, or fights everyone;
    - for Secret, an allegiance: left out, joins the party, joins the enemy, joins the nearest side, joins the underdog, takes no side, or fights everyone.
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

**Make it So commits the fight the simulation drew at random.** A 70% win is a loss three times in ten, as it should be, and the GM can't pick a better one: another draw, the most typical fight, or one a filter chose (a party victory, a defeat, a PC dies, a close call) are previews only, marked so. Make it So always goes back to the drawn fight; for a new one, run the simulation again. Undo still reverses a committed fight.

**After the fight.** When the last foe falls, the survivors tend their dying, before the dying make their next roll. They use free help first (first aid, medicine feats), then spells and potions. Anyone left untended lives or dies by the system's rules for dying, so nobody is committed half-dead.

**The fallen foes** are dealt with as the victors' playstyles say: one who spares them (a Moralist, a Diplomat most of the time, anyone with **"I never kill"** ticked) stops the rest from finishing them and gives them free first aid if it can; otherwise the Cruel finish them off; everyone else leaves them to the dice. "I never kill" also makes a character's killing blows knock out instead (unconscious and stable), and it never strikes the fallen.

**The fallen PCs.** Each time a creature wants to finish off a player character at 0 HP, it rolls d100 against the **PC luck: being finished off** slider (39 by default): at or under, it goes ahead; over, it turns away, and everything it wanted of that PC goes to the next foe it would pick. And a character with **fate** to spend (PF2e Hero Points, 5e Heroic Inspiration) uses it when someone would die: a blow, a save or a recovery check that would kill is rolled again (a hit may become a miss), or, for one's own death where the system has a sure way out, that (PF2e Heroic Recovery: all of one's Hero Points). It always spends for itself; for a friend, the more selfish, the less likely.

Choose one of:
- tend the fallen and tell it;
- tend them quietly, with the story ending at the last blow;
- stop at the last blow and play the rest out yourself.

**Make it So:**
- posts the story to chat (with the GM's choice of style; a **Statistician** account goes to the GMs alone, with a button to show it to everyone, while the table gets the Standard one). **Show the odds**, beside Make it So (off by default, remembered), adds each side's chance of winning to it;
- then whispers the GMs a short **summary**: how much time passed (fighting, and tending the fallen), and what each player character used up (slots, focus, potions, hero points, limited uses). It doesn't close the encounter or move the world clock;
- plays the fight on the map: the tokens run through every move in the story's order, quickly and around walls, then settle where the fight left them (snapped to the grid, never stacked). A setting turns this off, and the tokens go straight to their final spots;
- writes the outcome onto the tokens through the system's helper: HP, dying, conditions, death, resources spent, loot, the fled and the surrendered, and **buffs and debuffs still running** (a Bless with 8 rounds left stays on, as the spell's own effect, for those 8 rounds).

A confirmation lists every change first. **Undo** reverses it all, chat messages included, and keeps the last five.

## Talking

A fight can be talked down at any point, and some encounters never come to blows.

**Standoffs.** An encounter opens as a standoff when every side's voice would rather talk, or when almost everyone would. A side's voice is its leader, or most of its members if it has none. Nobody attacks while it lasts. It ends one of two ways:
- **Words win.** The persuaded stand down, or a threat makes them yield or run. If someone gives something up or runs, the whole conflict is settled.
- **Someone gets upset.** That could be an insulting pitch, failed pitches piling up, rounds dragging on, a beast that can't follow the talk, or an impatient temper. From that turn on, it's a battle.

A leader who wants to talk holds their side back. Before it breaks, a charismatic NPC leader may take one last turn to press the party.

**Pitches.** Persuade, intimidate or deceive, using whatever skills the system maps to each, against the system's DC for resisting. The target has to share a language with the talker, unless the **Ignore languages** setting (off by default; a toggle in each plan too) says anyone who speaks a language understands anyone else who does. A creature with no language at all can't be talked to either way.
- **The persuasion track:** most need 2–6 successes; the very gullible fold at once.
- **Grudges:** hurting someone or failing to convince them makes them harder to sway. An insult (a critical failure) means they won't listen again.
- **Outcomes:** surrender, flee, stand down, change sides (rare unless neutral), or **give something up**.
- **Changing sides:** an enemy talked into it only stands aside, taking no side (see below), and only if a hidden d100 comes up under the **switch luck** slider (69 by default); otherwise it's talked into one of the other outcomes. Spells and abilities made for it (charm, dominate) don't take this roll, and still turn a creature straight over until they end.

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

## Taking no side

Neutral tokens, and enemies talked out of the fight, stand on the field taking no side. Nobody fights them and they fight no one, each on its own. The planner's lean for the Neutral side doesn't put them on a side; it makes them want that side's members safe (a desire, "determined"), which guides where they go once something happens they care about. The underdog's members change as the fight goes. Neutral tokens also want each other safe (the villagers, the caravan). An enemy who stands aside still leans a little toward its old friends, the more so the more loyal it is.

A lean doesn't last: watching the side it leans toward hurt someone it cares about wears it down, and that side hurting it ends it at once (either way round).

- **Crossed:** whoever hurts it (a careless area spell catches one standing within 10 ft of its targets; careful casters aim around them), robs it, or insults it with a botched pitch offends it at once. Seeing someone hurt or hinder a creature it wants safe, or heal or bolster one it badly wants hurt, builds a grievance against the doer's side, faster the more it cares and the worse the harm; enough of it offends it too. Offended, it turns on that side (only that side) and fights it. Make it So turns a neutral that turned on the party Hostile.
- **Words first:** a talker who can make itself understood confronts the offender instead: a truce between the two of them in the middle of the fight. The offender's side can talk it round; it can talk the offender into making amends (handing something over, or an apology). It turns on them when it loses patience, or the moment that side crosses it again.
- **Won over:** either side's talkers can talk it into joining them, against its lean too, with no luck roll, as long as it hasn't seen that side cross it. Talkers weigh what joining would mean to it: a pitch that gives it what it wants (keeping someone safe, a chance at someone it wants hurt) is easier and quicker, so one already leaning their way doesn't take much; one that betrays what it wants is harder and slower. Nobody is threatened into friendship. Make it So changes the token's disposition to its new side, and a creature that stood aside to Neutral.
- **Who knows:** only a tactical mind (Tactical and up) sees someone taking no side for what it is, and only a tactical talker knows it could be won over. Anyone else goes by appearances and its desires: a neutral leaning toward its enemies looks like one of them, and to a feral creature anything close is fair game, so it may attack (which offends the neutral, and ends any lean toward its side). One who always tries words first (a Diplomat, "talk first", "always prefers talking") talks to a neutral it takes for a foe, and may win it over by accident; a desire to talk to it (stated, or its leader's) does the same.
- **Keeping the peace:** while a neutral is having words with a side, that side's smart members (Tactical and up) hold off hurting it or anyone it wants safe, unless the talk is going against them anyway (nobody left who can talk to it, or it's nearly out of patience). Smart creatures likewise won't break an opening standoff unless their side is losing the talk.
- **Not one for killing:** a character whose Tactics say "I never kill", seeing an enemy that was talked out of the fight, wants to talk to it again, just under whatever is most on its mind (unless it already wants to talk to it more): into leaving, or onto its side, as its playstyle leans (Leaders, Diplomats, Moralists, People-Pleasers, Scaredy-Cats, Wallflowers and the like would rather it left). Leaders and talkers among them want it more, look for the chance with any neutral they see, and always try to send it away: one less fighter on the field is safer than one more, even a friendly one.
- **Results:** those who take no side never win or lose a fight, and don't keep one going. The planner shows how often a foe was talked into standing aside.

## Theft

Theft mid-fight is rare; most who want your things take them from your body afterwards.
- **Who:** only a **Thief** (a playstyle) or someone with the system's stealing skill well above typical for their level.
- **When:** only when it's safe. Either their side is clearly winning, or they're hidden and their mark is alone. Alone means no friends within 30 ft, or the two of them more than one ordinary move from everyone else.
- **Openly:** the thief feints with its weapon first (it must hit, for no damage), then makes the system's stealing test.
- **Against a PC:** it also needs a hidden luck check (29 or less by default). The story never mentions it.
- **Getting caught** reveals the thief and makes it the victim's target. Thieves rob those who take no side too; getting caught by one turns it on the thief's side.
- **Taken back:** stolen goods return if the thief is beaten.

## Desires

Every character has a list of desires: what it wants right now, at whom, and how badly (0 to 100: Passing, Wants, Determined, Driven, Obsessed). They're its reasoning made visible, and they decide what it does:
- **Hurt, heal, protect, bolster (with a buff), talk to, keep away from.**
- **Where they come from:**
  - **its tactics:** each turn its tactical band weighs every foe it can reach (a Mastermind picks the healer to destroy, a Feral beast the nearest thing), every friend it could mend, whom it could talk round, whom it fears;
  - **its Tactics answers:** up to three desires stated for any character, PC or NPC (what, who, how badly; healing, bolstering and talking are offered only to those who can);
  - **the fight:** whoever hurt it (simple minds go straight for whoever just hurt them; hit from afar while already trading blows, they keep at the one in front of them), whoever felled a friend, a grudge;
  - **its leader and its team:** the leader's desires pull on it a medium amount, the team's a little. With nobody leading (none chosen, or the leader fallen), the team pulls together less, except when it comes to vengeance;
  - **its playstyles:** each pill guides how it picks up desires (below), added up across up to four.
- **The strongest leads.** Desires 20 or more below a stated or fight-stirred one don't cross the character's mind, and an obsession leaves no room for caution (it forgets about opportunity attacks).
- **Thwarted desires fade:** a locked door that won't give, a target it can't reach, getting hurt on the way, being badly hurt with the target far off. The character moves on when something gets too hard or too dangerous.
- **The story** now and then pauses on a character's two strongest desires: *"Charlette really wants to heal Brent, but also kind of wants to hurt the wolf."* The phrases are roll tables you can edit.

## Buffs, debuffs and control

Spells, songs, skills and features that change the numbers instead of (or as well as) dealing damage. The system helper reads them; the core plays them out the same way in every system:
- **Buffs** for friends or itself: Bless, Heroism, Shield of Faith, Haste, Courageous Anthem, Rage, Dodge, Action Surge. One friend, several, or everyone in an aura.
- **Debuffs and control** on foes: Bane, Faerie Fire, Slow, Hold Person, frightened, prone, Hunter's Mark and Hex (extra damage on the caster's own hits), a Demoralize or a Trip (a skill against the foe's defense), a Feint (off guard to the feinter alone).
- **What they change:** attack rolls, AC, saves and checks (a flat bonus, or a die such as Bless's d4), damage, speed, actions (Haste, Slow), advantage and disadvantage, temporary hit points, resistances (Rage, Stoneskin), conditions.
- **How long:** for their rounds; a save at the end of each turn can shake them off (Hold Person); damage ends some (sleep). Where the system has **concentration**, one spell at a time, and a hard knock or being taken out ends it.
- **Charmed or dominated:** the creature fights for whoever holds it until the hold ends (it runs out, a save, the holder loses concentration or falls, or the holder's side harms a charmed one). Its friends are reluctant to cut it down. The story still counts it as one of its own.
- **Choosing them:** a buff is worth casting when what it adds up to, across everyone it reaches, over the rounds it will matter, beats attacking with the same actions. Thinking minds see this best; feral ones only look after themselves. Late in a won fight, nobody bothers.
- **Spoilers:** the **Instigator** pill loves locking foes down, harassing and debuffing them (up to 2.5 times the appeal). Puzzle-Maniac, Cruel, Wallflower and Leader lean that way a little.
- **The story** tells it: *"Akra lifts Bless over the group: Akra, Zanna and Randal, emboldened."* Dodge, Reckless Attack and Action Surge get lines of their own.

A system that has none of this (no concentration, no skill DCs) simply leaves it out; nothing else changes.

## Senses

To know that a friend needs help, or that a foe is hurt badly enough to finish, a character has to perceive them: see them (a line of sight, and light, or darkvision in the dark), hear them (60 feet, through walls), or sense them another way (blindsight, tremorsense, scent ..., each with its range, from the system's helper). Blinded creatures don't see, deafened ones don't hear. A foe it can't perceive looks unhurt to it, and it doesn't go after the fallen it can't make out. In a crisis perception bends: helping a friend, keeping someone from dying, or avenging a fallen friend, any sense that could plausibly reach them will do (twice the range, no line of sight or light needed).

## Doors

Paths go round walls; a closed door on the way is walked to and opened. A locked one is worth only what the character wants most on the far side of it (more patience when there's nobody else to fight):
- **force it** with the system's strength check, **hack it down** with its best weapon, or **pick the lock** if it has the skill and tools, whichever is quickest for that character;
- every failed try wears the desire down; giving up turns it to something else;
- a door the fight opened opens on the map when the story gets there, and stays open after Make it So; Undo closes (and relocks) it.

The system says what a door is like and how hard it is to get through (its defense, hit points, DCs, and its own damage rules such as PF2e hardness or a 5e damage threshold). A GM can give a door its own numbers in the wall's flags (`fast-fighting.door`).

## Reluctance

Two boxes beside the playstyle pills: **"I don't like to use consumables"** and **"I don't like to use spells that cost something"** (cantrips are free). The character is about a tenth as willing to spend them, until the moment demands it: a friend (or itself) close to death, or, for a character whose playstyle is to help, a friend in a bad way.

## What else the simulation models

- **Rules:** whatever the system's helper provides, such as the turn's actions, degrees of success, attack penalties, advantage, criticals, resistances and dying.
- **Afflictions:** stage by stage, with onset.
- **Persistent damage.**
- **Riders:** knockdown, grab, sneak attack, pack attack or Pack Tactics, and saves on a hit (a wolf's bite: Strength or prone; a spider's venom: half on a success).
- **What a hit can carry, for a price:** extras a creature adds to a hit when it thinks it worth spending on (a smite's spell slot, a stunning strike's ki, a maneuver's superiority die), and a die that mends a close miss. The emptier the pool, the more a use has to be worth; conservers want more, those going all out less.
- **Deeds:** a deed die rolled with every attack, added to the roll and the damage, and a deed declared before it (DCC Mighty Deeds: trip, blind, disarm, a defensive stance) that happens on a hit if the die shows enough.
- **Crit and fumble tables:** where a system crits by table instead of doubling (DCC), a crit rolls on the attacker's table for extra damage and a lasting effect, and a fumble on the fumbler's.
- **Action dice other than a d20:** a giant's d24, a second action on a d16, crit ranges scaled to the die.
- **Checks that pick the result:** a spell check whose total says what the spell does (DCC), with spells lost on a failure or a god's patience wearing thin.
- **Luck:** points burned after a roll falls short to make it (DCC), the more readily the more is at stake; some spend it for friends.
- **Reactions that answer** (besides opportunity attacks), each taking the round's reaction when it's worth what it costs: a spell that turns a hit into a miss (Shield), a dodge that halves a blow (Uncanny Dodge), damage taken off it (Parry, Shield Block, Deflect Attacks), a bonus to AC as the attack comes (Nimble Dodge), fire for whoever hurt you (Hellish Rebuke), a strike back at a melee miss (Riposte), and counterspells (by the spell's level, a check, or the caster's save).
- **Summons:** creatures called mid-fight (Spiritual Weapon, Conjure Animals, Summon Animal ...) join right after their summoner and fight for its side, worth it when they'd do more over the fight than its own blows. They go when their time runs out, when the summoner's concentration breaks, or when it stops sustaining them (PF2e); something that isn't a creature (a spiritual weapon) can't be attacked and doesn't hold the field alone. They aren't the table's: left out of the results and Make it So, though the story tells what they did.
- **Legendary creatures:** legendary actions are taken between other creatures' turns, from a pool that comes back at the start of the creature's own turn, each the best blow it can strike from where it stands. Legendary Resistance turns a failed save that would take it out of the fight (a hold, a stun, a killing blast) into a success while it lasts.
- **Abilities that come back:** a 5e "Recharge 5–6" rolls at the start of the creature's turn; a PF2e "can't use it again for 1d4 rounds" waits that long.
- **Size:** you can only shove or trip a creature up to one size larger.
- **Crowd control:** spells that slow, frighten, trip, immobilize, paralyze or put foes to sleep, by degree of success, for their duration.
  - They're valued by the damage they prevent.
  - The system's tags decide immunity (mental, fear, sleep and others), and some systems let strong targets resist better (PF2e incapacitation).
  - Thinking creatures don't waste them on the immune. Feral casters cast at random, or whatever does the most right now.
- **Healing:** spells, potions and first aid.
  - Heals have a range: a touch means walking over first, and a heal that leaves the main action free (a bonus action) is preferred.
  - Anyone down is back up with any heal, so for them the cheapest way wins.
- **Opportunity attacks** (in systems that have them; the helper says who can make one):
  - Walking out of a foe's reach gives it one melee attack, its reaction for the round.
  - Tactical and Mastermind characters always weigh it: they keep fighting the foe beside them, and when they must leave (to heal, to flee) they get clear safely first (5e Disengage, PF2e Step) if the turn still allows what they're leaving for.
  - Competent characters think of it half the time; Feral and Instinctive ones never do. A character whose player ticked "roleplaying is very important to me" forgets half the time.
  - A way out that doesn't cost the main action (5e Nimble Escape, Cunning Action) is second nature to anything that isn't feral.
- **Personality: Tactical, Brave, Selfish, Loyal,** from 0 to 100 with named bands. They come from creature data and blend with the side's personality.
  - *Feral:* the closest foe, or whoever hurt it last.
  - *Instinctive:* wounded prey; pack hunters gang up.
  - *Competent:* focus fire and flanking.
  - *Tactical:* healers and casters first, and reads the odds.
  - *Mastermind:* a side-wide focus, an ambush edge, and the ruthless finish off the downed.
- **Morale:** losses, wounds, a fallen leader or master, and bad odds, all against Brave. Combatants hold, waver or rout.
- **Leadership:** the best social or warfare skill, plus commanding features.
- **Terrain and movement:** travel cost per movement mode from Foundry's region terrain, so rubble doesn't slow a flyer. A high flyer can't be hit in melee by a ground-bound creature.
- **Walls:** they block sight, and movement goes the shortest way round (a quick grid search over the fighters' part of the map). Climbers go over and burrowers under. With no way round, crossing a wall counts as four times difficult terrain for that square, and a creature that can't manage that in one move gives up on going that way.
- **Any grid and any units:** distances come from the scene's grid size and units, whatever the system calls them (ft, feet, m, metres ...; a metre counted the table way, 1.5 m to a 5-foot square). Units it doesn't know count each square as 5 ft.

## Prepare Players

**Prepare Players** opens a survey on each player's screen, with one tab per token they control. Every question starts on *"Let ⟨character⟩ decide: …"*, showing what the character would probably do:
- favorite attack, fighting style and first target;
- spending limited resources, healing others and drinking potions;
- what to do when an ally is dying, and after being revived;
- when to retreat, shield use and talking;
- **others nearby:** stay with the fight, run for help when it goes badly, or hunt down enemies about;
- notes for the GM.

Answers save as they're made, and two players sharing a token see each other's changes live. The planner shows each player's status, with a button to (re)open their survey.

**Playstyles:** up to four pills per character, PC or NPC, picked in order of importance (each pill shows its place, 1 to 4). Every pill counts, the first in full and each later one less (75%, 55%, 40%): in personality, quirks, desires, and tactics (where pills disagree on a tactic, each simulated fight goes with one of them, the first most often). Unpicking one moves the later ones up. They shift traits, change the defaults, switch on quirks, and guide how the character picks up desires:

| Pill | Desires |
| --- | --- |
| Scaredy-Cat | keeps away from the most dangerous foe; gives up easily; hits back half-heartedly |
| Cruel | the weakest, and the fallen; hits back hard; likes leaving a foe hampered |
| Moralist | never the fallen; heals friends, guards the weakest |
| People-Pleaser | wants what its leader and friends want (listens far more than most); likes to talk and to bolster friends |
| Fragile | once hurt: away from whoever is hurting it, and mends itself; setbacks wear it down |
| Impatient | the nearest foe; setbacks wear it down twice as fast; little patience for locks |
| Brawler | the nearest foe; hits back hard; no talking |
| Skeptic | its leader and team sway it half as much; slow to talk |
| Speed-Runner | the quickest kills |
| Leader | the biggest threat (now and then pins it down); looks after and bolsters its people; when it isn't the leader, mostly goes its own way |
| Instigator | spoils everyone's plans: locks foes down, harasses and debuffs them more than anyone; the most dangerous foe and the other side's leader; may defy its own leader |
| Diplomat | talking; spares the fallen |
| Wallflower | keeps its distance; would rather hamper foes from afar; listens to the crowd less |
| Martyr | guards the weakest friend; fears nothing; avenges the fallen twice as hard |
| Mercenary | easy pickings; barely avenges anyone; gives up when it gets hard |
| Enabler | heals, guards and bolsters friends; backs the leader |
| Redeem-Seeker | the biggest threat; won't give up |
| Lore-Collector | foes it hasn't sized up yet |
| Puzzle-Maniac | weaknesses to exploit, casters, a clever lock-down, and locked doors (twice the patience) |
| Wildcard | something random catches its eye; nobody's voice counts for much; may defy its leader |
| Thief | robs when it's safe; a lock is an invitation |
| Vengeful | hits back twice as hard; avenges fallen friends; its grudges never cool |
| Relentless | sticks with the foe it's on; shrugs off setbacks; keeps at doors |
| Lazy | the nearest foe and no long walks; not much help to anyone; gives up fast; can't hold a grudge |

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
- **Unaligned sides:** Neutral lean (takes no side, by default) and Secret allegiance.
- **Dying and healing:** the downed model, after the fight, and PC healing and dying defaults.
- **Modifiers:** leadership, morale, positioning, talking (and whether to ignore languages), how encounters open, and the initiative source.
- **Luck checks** (sliders):
  - a PC handing over an item, default 39;
  - a PC being robbed, default 29;
  - a PC being finished off at 0 HP, default 39;
  - an enemy changing sides (under this), default 69.
- **Story:** style, delivery, and whether the posted story shows the odds (off).
- **Make it So:** loot, corpse and fled handling, and whether the fight plays out on the map.
- **Defaults:** side personalities, and data paths for the generic adapter.

## For system and module developers

FastFighting is split into a pure simulation engine (`scripts/engine/`), system **helpers**, and the Foundry UI. The core owns only its own ideas: personality, morale, leadership, positioning, standoffs, the story, and how creatures leave a fight. Every game rule comes from the helper. FastFighting PF2e, FastFighting D&D 5e and FastFighting DCC are reference implementations of three very different systems.

```js
Hooks.once("fastFighting.init", api => {
  if ( (api.version ?? 1) < 5 ) return; // the helper interface this is written against
  class MySystemAdapter extends api.SystemAdapter {
    get label() { return "My System"; }
    get rules() { return myRules; }
    canHandle(actor) { ... }
    async toCombatantSpec(tokenDoc) { ... }          // see CombatantSpec in scripts/engine/battle-state.js
    deriveTraits(actor) { ... }
    detectLeaders(specs) { ... }
    difficultyCrossCheck(friendly, hostile) { ... }  // {label: trivial|low|moderate|severe|extreme, text?, xp}
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

**Recognise things by slug, read them by what they do.** When a helper has to know a particular feature, action or spell, it looks for its slug or identifier (PF2e `slug`, dnd5e `system.identifier`), never its name: slugs are the same in every book, every edition of the free rules and every language, while names change with translations, reprints and homebrew copies (the name is only a fallback). Better still, read what an item does (its activities, effects, rule elements, and as a last resort its words), so paid books and homebrew nobody has seen yet still work. Both reference helpers work from the free rules (the SRD, the PF2e remaster) alone; anything more is read the same way.

**The rules object** is pure and is called thousands of times:
- **The turn:** `turn(u)` gives the budget (`{actions: 3}` or `{action: 1, bonus: 1, move: 30}`).
  - `mainPool` names the pool a plain-number cost uses.
  - `movement` is `"actions"` (each move costs an action) or `"feet"` (spend movement, then Dash).
  - `costOf(action)`, `basicAction`, `talkCost`, `stealCost`, `feintCost`, `firstAidCost`, `shieldCost` and `standCost(u)` set what things cost.
- **Rolls:**
  - `degreeOfSuccess(natural, total, dc, kind, die)` returns 0–3, where `kind` is attack, save or check, and `die` (when it isn't a plain d20) is `{faces, critOn, fumbleOn}`: the die rolled, the d20-relative natural that threatens a crit (the rules scale it to the die) and the natural at or under which it fumbles;
  - `actionDie(u, n)`: the die a creature's n-th action this turn rolls (DCC action dice), when actions don't say;
  - `roll(rng, mod, dc, {advantage, kind})`;
  - `attackPenalty(action, attacksMade)`;
  - `saveMultiplier(degree, save)`, `afflictionStep(degree, phase)`, `critical(parts)` and `healCheckMultiplier(degree)`;
  - `minimumDamage`.
- **Situations:** `modifiers.attack`, `defense`, `save`, `check`, `steal`, `exposed` and `actionsLost`. The engine passes the facts (prone, grabbed, flanked, distance, allies adjacent, engaged, conditions); the rules return bonuses and advantage.
- **Damage and dying:**
  - `applyIwr(iwr, byType)`;
  - `onDropped(unit, {crit, model, amount, overflow})`, `onHealed(unit, amount)` and `recoveryCheck(unit, rng)`;
  - `firstAidDC(unit)`, `firstAid(unit, degree)` and `persistentFlatCheck(rng)`.
- **Crowd control, buffs and debuffs:**
  - `isImmune(target, action)`, `controlShift(ctx)`, `conditionWeight(key, value)`, and `conditionMods(key, value)` (a condition as bonuses and penalties, so it's weighed like any other: PF2e frightened 1 is -1 to everything);
  - `defenseDc(target, against)` (the DC a skill action rolls against; default 10 + the defense) and `resistShare(value)` (how much of a blow a resistance stops; default half);
  - `concentration: {save, dc(damage), breaksOn: [conditions]}`, where the system has it.
- **Doors:** `door` (the typical door: defense, hit points, DCs and whatever its own rules use), `doorCosts` (`open`, `force`, `pick`), and `doorDamage(door, damage)` (how much of a blow gets through). The helper puts `doorWork: {force: {mod}, pick: {mod}}` on each spec.
- **Reactions:** `opportunity(reactor, mover)` returns the strike a creature makes at a foe leaving its reach, or null if it can't; `reactions(u)` (default 1 a round); `disengage(u)` returns `{cost, label}`, how to leave safely. `bestReactionStrike(u)` in core-api picks the usual strike.
- **What's typical for a level:** `typical.ac`, `save`, `skill` and `dc`.
- **Per-fight state:** `initUnit(u)` and `capture(u)`.
- **After the fight:** `recoverBody(u, rng)`: a dead player character's last chance once friends reach it (DCC: roll the body). It sets the unit's status and hit points and returns the line to log.
- **The story:** `storyDamageType(type)` maps your damage types onto the story's imagery.

**Senses, fate and what's already on a creature:**
- `spec.senses`: `[{type, range, dark, blind}]` beyond plain sight and hearing (`dark`: sees in darkness; `blind`: needs no sight). `rules.hearingFeet` (default 60). The scene's darkness comes in `options.darkness`.
- `spec.resources.fate` and `spec.fateLabel`: points spent to keep someone from dying; `rules.avertDeath(u)` is the system's sure way out for one's own death, if it has one.
- `spec.mods`: bonuses already on it when the fight starts (one, or a list), but only what the system's own numbers don't already include.
- `rules.knockOut(u)` (a blow from someone who never kills) and `rules.secondsPerRound` (default 6, for the GM's summary).
- Lingering effects: `final.effects` lists what's still running; `commitOutcome`'s `options.effectSource(id)` finds the action that laid each, whose `effectRef` (the helper's own) says what to copy onto the creature.

**Dice, deeds, tables, checks and Luck in a CombatantSpec** (see `behavior/riders.js`, `behavior/casting.js` and `behavior/luck.js`):
- On an action: `die` (its own die), `critOn`, `fumbleOn`, `deedDie` (rolled with the attack, added to the roll and the damage), `crit: {die, mod, rows}` (its crit table), `repeat` (a DamagePart: how many times the damage is rolled), `healDice` (so many of the target's own hit dice, `spec.hitDie`).
- A table row: `{lo, hi, damage, multiply, outcome, self, slay}`. `spec.fumble`: the fumbler's table, `{die, mod, rows}`. `spec.critAgainst`: taken off crit rolls made against it by anyone but a player character.
- `spec.riders`: `[{id, label, when: "hit" | "miss", melee, ranged, weapon, resource, amount, uses, oncePerTurn, damage, critDouble, save, onSave, outcome, attackDie, tell}]`.
- `spec.deeds`: `[{id, label, melee, ranged, tiers: [{min, outcome}]}]` (an outcome with `self` lands on the one who did it).
- A check with tiers: `casting: {mod, faces, fumbleOn, lostOnFail, disapproval, label}`, `tiers: [{min, max, ...fields}]` (a save's `dc: "check"` is the check's total), `castChance`; the action's own fields are what a success most often does.
- `spec.boosts`: `[{pool, label, per, faces, allies, range, kinds, keep, recovers}]`, spending `spec.resources[pool]`.
- Legendary: `spec.legendary: {pool}` and actions with `legendary: cost` (taken between others' turns, never on its own); `spec.standFirm: {pool, label}` (a resource that turns a failed save that matters into a success).
- An action with `uses` can come back: `recharge: {on, die}` (5e "Recharge 5–6": `{on: 5, die: 6}`, rolled at the start of its turn) or `cooldown: {n, faces}` (PF2e "can't use it again for 1d4 rounds": `{n: 1, faces: 4}`).
- Riders also take `vs` (only against creatures with one of these traits), `group` (one of a group per hit), `cost` (what it takes from the turn, on one's own turn: `{bonus: 1, slot: 1}`) and `dear` (a spell slot's level, which prices it).

**Reactions and summons in a CombatantSpec** (see `behavior/responses.js` and `behavior/summons.js`):
- `spec.reactions`: `[{id, label, on: "attacked" | "hit" | "missed" | "damaged" | "spell", ac, halve, reduce, strike, damage, save, counter: {level, mod} | {level, save}, resource, amount, uses, range, melee, ranged, physical, needsShield, tell}]`. They share `rules.reactions(u)` a round with opportunity attacks.
- A summoning: `{kind: "summon", creatures: [CombatantSpec], rounds, concentration, sustain: cost, sustainOrEnd}`; a creature with `untargetable` can't be attacked. `spec.size` (0 tiny … 5 gargantuan) and an action's `maxSize` are for the system's `isImmune` to compare.

**Buffs, debuffs and control in a CombatantSpec** (see `scripts/engine/mods.js`, `behavior/effects.js`, `behavior/control.js` and `behavior/support.js`):
- **An outcome** is `{conditions, mods, tempHp, mark, iwr, actionsNow, rounds, label, endsOnDamage, endsOnHarm, repeatSave: {type, dc}, onlyVs, self}`, all optional. `mods` holds `attack`, `ac`, `saves`, `checks`, `damage`, `speed`, `actions` (numbers), `attackDie` / `saveDie` (signed faces: 4 is +1d4), and `adv`, `defAdv`, `saveAdv` (+1 or -1). The engine's own conditions are `prone`, `immobilized`, `incapacitated` and `controlled`.
- **A buff:** `{kind: "buff", outcome, targets: "self" | aura: feet | area: {targets}, range | reach, concentration, oncePerTurn, economy, tell}`.
- **Control or a debuff:** `{kind: "control", save: {type, dc, advantage} | check: {mod, against, attack} | bonus | auto: true, onSave | onHit | outcome, oncePerTarget, concentration, freeWhileHeld}`.

Helpers import shared pieces from `scripts/core-api.js`, such as `SystemAdapter`, `parseFormula`, `parseTypedFormula`, `rollD20`, `TALK_KINDS`, `bestReactionStrike`, `combineMods`, `describeMods` and `CORE_API_VERSION`.

The engine counts distance in feet: give speeds, reach and ranges in feet (convert metric data), and the core converts the scene's grid. Heal actions can carry `reach` (touch) or `range`.

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
