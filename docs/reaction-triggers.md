# Reactions: master list of triggers and effects

This is a working master list of reactions for the FastFighting engine and its helpers. A **trigger** is the moment in a fight that a reaction answers. An **effect** is what the reaction does. Each system helper maps its reactions onto one trigger id (plus filters) and one or more effect ids, so the engine can check a moment once, whatever a system calls the reaction. It works like the maneuvers and conditions list: the ids are shared, and each system's own terms map onto them.

**Scope.** "Reaction" is meant broadly: anything a creature does outside its own turn in answer to a moment in the fight. That covers PF2e reactions (including hazards and items with the reaction glyph), 5e reactions and triggered traits, legendary and lair actions, Daggerheart reaction features, Armor Slots and reaction rolls, DCC free attacks, spell duels and Luck, Ironsworn and Starforged moves that respond to the fiction, and genre conventions from space, cyberpunk, mecha, horror, superhero, western, martial-arts, military and heist games. Riders a creature adds on its own turn (DCC Mighty Deeds, 5e Stunning Strike) are listed too, because they hang on the same moments (`ownHit` plus `rider`).

**Reading the tables.**
- Sources: PF2e = Pathfinder 2e (the system's packs plus Battlezoo). 5e = SRD 5.1 and 5.2 and the dnd5e packs. DCC includes XCC. DH = Daggerheart. Ironsworn (with Delve) and Starforged (with Sundered Isles) are written out in full. Genre tags come after the semicolon. A genre tag means games of that genre use the trigger; it does not name a ruleset. SF2e was not scanned, because no packs were installed; its few known reactions sit under "space".
- "engine moment" is where the engine would check the trigger. A hook name in bold means the engine already checks it there today (`responses.js`: attacked, hit, missed, damaged, allyHit, spell; `reactions.js`: leaveReach, for opportunity attacks).
- Filters are not triggers. The engine already knows them at that moment: melee or ranged, a critical hit or failure, the damage type, a damage threshold, range or reach, whether it can see the source, a raised shield, ally or any creature. They go on the reaction (as `melee`, `ranged`, `physical`, `range` and `needsShield` do today). The JSON lists the useful filters for each trigger.
- Names and descriptions are working labels, not module strings. Under the Foundry AI policy, any English the module shows has to be written by a person.
- The ids are in `scripts/story/master.js` (`REACTION_TRIGGERS`, by group, and `REACTION_EFFECTS`). A reaction's `on` names one trigger, or a list of them; the engine's older names still work (`spell` is `foeCasts`, `leaveReach` is `foeLeavesReach`).

Counts: 101 triggers in 12 groups (atSelf 18, atAlly 14, foeAction 8, movement 6, magic 4, tech 7, social 5, fear 6, turnRound 8, environment 6, hazard 7, other 12), 58 effects, and 13 rare cases mapped to the nearest trigger. The three research catalogs held 233 triggers and 174 effects between them. Every one of those is merged into an entry here or named under "Rare".

## Triggers

### At itself (`atSelf`)

Something is done to it: the attack sequence, saves, holds and falls.

| id | name | when | sources | engine moment |
|---|---|---|---|---|
| `attacked` | Attacked | A foe attacks it, before the roll is made. | PF2e, 5e, DH, Ironsworn, Starforged; space, cyberpunk, superhero, western, martial arts, military | before an attack roll at it · **attacked** |
| `underFire` | Pinned by fire | Heavy or suppressive fire is laid on its position, whether or not any of it hits. | space, cyberpunk, western, military | when suppressing fire covers the area it is in |
| `inBlastArea` | In the blast | It is inside the area of a burst, cone, line, grenade or barrage that is about to go off. | PF2e; space, cyberpunk, mecha, superhero, military | when an area effect is placed over it, before any save |
| `hit` | Hit | An attack hits it, before the damage is rolled. | PF2e, 5e, DCC, DH; superhero, martial arts | after an attack at it hits, before damage · **hit** |
| `missed` | Missed | An attack at it misses, or fails badly. | PF2e, 5e, DH; superhero, western, martial arts | after an attack at it misses · **missed** |
| `wouldTakeDamage` | About to be hurt | Damage (or a declared harm) is on its way but not yet marked, so it can still be cut, shifted or paid for some other way. | PF2e, 5e, DH, Ironsworn, Starforged; horror, superhero, heist | after damage is rolled, before it is applied · **hit** |
| `damaged` | Hurt | It has just taken damage, often from a foe it can see or reach. | PF2e, 5e, DCC, DH | after damage is dealt to it · **damaged** |
| `badlyHurt` | Badly hurt | Its health falls past a set mark: half, bloodied, a count of wounds, or one hit point left. | PF2e, 5e, DH; space, horror, military | when its hit points fall past a set fraction |
| `wouldDrop` | About to fall | Damage would bring it to zero or kill it, or it must make its death move. | PF2e, 5e, DCC, DH, Ironsworn, Starforged | when damage would drop it to 0, before it falls |
| `slain` | Slain | It is killed, destroyed or taken out, and something happens on the way down. | PF2e, 5e, DCC, DH | as it drops or dies |
| `mustSave` | Must resist | A spell, area or hazard calls on it to dodge or resist (a save or reaction roll), and it has not rolled yet. | PF2e, 5e, DCC, DH, Ironsworn, Starforged | before it rolls a save |
| `wouldGainCondition` | About to be afflicted | Something would charm, frighten, grab, poison, curse or otherwise afflict it. | PF2e, 5e, DH | when a condition or affliction would land on it |
| `touched` | Touched | A creature touches it, grabs it, or strikes it with its body. | PF2e, 5e, DCC, DH; horror, superhero | when a creature touches it or hits it unarmed |
| `maneuvered` | A maneuver tried on it | A foe tries to grab, trip, shove, disarm or rob it, before the result is known. | PF2e | when a foe attempts a maneuver against it, before the roll |
| `grabbed` | Grabbed | It becomes grabbed, restrained, pinned or swallowed. | PF2e; horror, superhero, martial arts | when it becomes grabbed or restrained |
| `knockedDown` | Knocked down | It is knocked prone, tripped or swept off its feet. | PF2e; superhero, martial arts | when it would be knocked prone |
| `forcedMovement` | Moved by force | It is shoved, pulled, dragged or flung against its will. | PF2e, 5e | when a push or pull would move it |
| `falling` | Falling | It (or someone near it) starts to fall, or is thrown loose: off a ledge, into a pit, or adrift when the gravity fails. | PF2e, 5e, DCC; space, horror, superhero | when it starts to fall or is knocked loose |

### At a friend (`atAlly`)

Something is done to an ally, a ward, or the mount or vehicle it rides.

| id | name | when | sources | engine moment |
|---|---|---|---|---|
| `allyTargeted` | Friend attacked | A foe attacks or aims a harmful effect at an ally near it, before the roll. | PF2e, 5e, DH; space, cyberpunk, horror, superhero, western, martial arts, military | before an attack roll at an ally in range |
| `allyHit` | Friend hit | An attack lands on an ally near it, before the damage. | PF2e, 5e, DH | after an attack hits an ally in range, before damage · **allyHit** |
| `allyDamaged` | Friend hurt | An ally (or, for some, any creature) near it has just taken damage. | PF2e, 5e, DH, Ironsworn, Starforged | after damage is dealt to an ally in range |
| `allyWouldDrop` | Friend about to fall | An ally (or any creature) near it would drop to zero or die, and has not yet. | PF2e | when damage would drop an ally in range to 0 |
| `allyDown` | Friend down | An ally drops, is defeated, or is left bleeding out. | PF2e, DCC, DH; space, horror, superhero, western, military | after an ally in sight drops to 0 |
| `allyRolls` | Friend rolls | An ally attempts, fails or succeeds at a check, save or attack it could help with. | PF2e, 5e, DCC, DH, Ironsworn, Starforged; space, superhero, heist | around an ally's roll, before the result stands |
| `allyStrikes` | Friend attacks | An ally attacks a foe, lands a blow, crits, or drops it. | PF2e, DH, Ironsworn | after an ally's attack on a foe near it |
| `allyActs` | Friend casts or acts | An ally casts a spell or uses a particular action near it. | PF2e | after an ally casts or acts in range |
| `commanded` | Called to act | A leader, rider, controller or teammate spends its own action so that this creature acts now. | PF2e, 5e, DH, Ironsworn; superhero, martial arts | when an ally spends its action to command it |
| `allyMoves` | Friend moves | An ally moves, jumps or breaks cover near it. | PF2e; space, cyberpunk, western, military | after an ally moves within range |
| `allyAfflicted` | Friend afflicted | An ally becomes frightened, grabbed or restrained, or is dragged away. | PF2e; space, horror | when an ally in sight gains a condition |
| `wardInPeril` | Someone in its care in danger | A bystander, a hostage, or someone it has sworn to protect is about to be hurt, falls, or is caught in danger. | horror, superhero, western, military | when a ward or bystander near it is threatened |
| `rideTargeted` | Its ride attacked | The mount, ship, mech or vehicle it rides or crews is the target of an attack. | PF2e; space, mecha, military | before an attack roll at the mount or vehicle it is on |
| `rideHurt` | Its ride hurt | Its mount or vehicle takes damage, is spooked by gunfire or a monster, or is lost. | DCC, Starforged; horror, western, military | after its mount or vehicle is damaged or spooked |

### What a foe does (`foeAction`)

A foe acts near it, rolls, fails, struggles, or turns up.

| id | name | when | sources | engine moment |
|---|---|---|---|---|
| `foeOpening` | Foe drops its guard | A foe within reach uses its hands, shoots, stoops for a weapon or otherwise leaves an opening. | PF2e, DCC | when a foe in its reach manipulates, shoots or fumbles |
| `foeRolls` | Foe rolls | A foe is about to roll, or has rolled and would succeed, and it can meddle before the result stands. | PF2e, 5e, DH | around a foe's roll in range, before the result stands |
| `foeFails` | Foe fails | A foe fails or fumbles a roll (or rolls with Fear), handing over an opening or the initiative. | PF2e, DCC, DH, Ironsworn, Starforged | after a foe in range fails a roll |
| `heldFoeStruggles` | Held foe struggles | A creature it is holding tries to break free, attack or move, or slips loose. | PF2e, 5e, DH; superhero, martial arts | when a creature it holds tries to escape |
| `foeSpotted` | Foe appears | It becomes aware of a foe: a hidden one revealed, a cloak failing, one teleporting in, or one it sees before its allies do. | PF2e; space, cyberpunk, horror, superhero, military, heist | when a foe becomes visible or known to it |
| `aboutToBeFound` | About to be found | A searcher, sentry, camera or light is about to reveal it while it is hidden. | PF2e; cyberpunk, horror, military, heist | when a foe's search or a sweep would reveal it |
| `foeGoesForWeapon` | Foe goes for a weapon | In a standoff or a tense talk, a foe reaches for a gun, a device or a hostage. | cyberpunk, western, military, heist | when a foe draws or makes a sudden move before the fight starts |
| `breachAttempt` | Breaking in | Foes try to get through a door, hatch, hull or barricade it guards, or to board its vessel. | space, horror, military | when a foe tries to force an entry it guards |

### Movement (`movement`)

A foe moves relative to it.

| id | name | when | sources | engine moment |
|---|---|---|---|---|
| `foeApproaches` | Foe closes in | A foe comes within reach, into its aura or a warded zone, or charges at it. | PF2e, 5e, DCC, DH, Ironsworn; superhero, western, martial arts | when a foe moves into its reach or range |
| `foeMovesInReach` | Foe moves in reach | A foe within reach moves, steps around it, or stands up, without leaving its reach. | PF2e | when a foe in its reach moves or stands |
| `foeLeavesReach` | Foe pulls away | A foe in its reach moves off, retreats or withdraws. | PF2e, 5e, DCC, DH | when a foe moves out of its reach · **leaveReach** |
| `inItsSpace` | Something in its space | A creature enters, crosses or leaves the space it occupies (a swarm, a buried lurker, something it hangs over). | PF2e | when a creature moves into or through its space |
| `foeMovesInOpen` | Target in its sights | A foe moves, breaks cover or acts in a field of fire it is watching. | space, mecha, western, military, heist | when a foe moves or acts inside the area it overwatches |
| `pursuerCloses` | Pursuer gains | Something chasing it gains ground or comes into view behind it. | cyberpunk, horror, western, heist | when a pursuer closes on it in a chase |

### Magic and powers (`magic`)

| id | name | when | sources | engine moment |
|---|---|---|---|---|
| `foeCasts` | Foe casts | A creature it can perceive casts a spell, sustains one, or sets off a power or device. | PF2e, 5e, DCC, DH; space, cyberpunk, superhero | when a foe casts a spell it can see · **spell** |
| `spellTargets` | Spell aimed at it | A spell, a mind-touching power or another hostile effect targets it. | PF2e, 5e, DCC; space, horror, superhero | when a spell or effect targets it, before any save |
| `magicNearby` | Magic stirs nearby | Magic of a certain kind is used near it: a teleport, a heal, a spell of one tradition or element. | PF2e | when a spell of a given kind takes effect in range |
| `concentrationJolted` | Jolted while casting | It is hurt or shaken while it keeps a spell going. | 5e, DCC | after it takes damage while sustaining a spell |

### Tech and vehicles (`tech`)

Mostly sci-fi; a fantasy shield or weapon breaking also lands here.

| id | name | when | sources | engine moment |
|---|---|---|---|---|
| `lockedOn` | Locked on | A foe gets a targeting lock on it or its vehicle, a beat before the shot. | space, cyberpunk, mecha, military | when a foe locks on to it |
| `missileIncoming` | Missile incoming | A guided missile, torpedo or attack drone is launched at it, its vehicle, or something it guards. | space, mecha, military | when a guided munition is launched at it |
| `shieldsFailing` | Shields failing | An energy shield, a deflector or one shield facing drops to zero or past a warning mark. | space, mecha, superhero | when its shields fall past a mark |
| `gearBreaking` | Gear failing | Its shield, weapon, armour, cyberware or a vehicle system is damaged, knocked out, or about to break. | PF2e; space, cyberpunk, mecha, military | when its gear or a system takes damage or breaks |
| `overload` | Overheating | A reactor, weapon or implant it controls passes a heat or power limit. | space, cyberpunk, mecha | when its heat or power passes a limit |
| `aboutToBlow` | About to blow | The mech, vehicle or reactor it is inside is about to explode or be destroyed. | space, mecha, military | when the vehicle it is in would be destroyed |
| `hacked` | Hacked | A foe breaks into a system, device or implant it owns or guards, or it sees a hacker at work nearby. | space, cyberpunk, military, heist | when a foe hacks something it guards |

### Words (`social`)

| id | name | when | sources | engine moment |
|---|---|---|---|---|
| `pressed` | Pressed to give in | Someone tries to persuade, bargain with, coerce or intimidate it. | PF2e, DH, Ironsworn, Starforged | when a foe uses a social action on it |
| `deceived` | Lied to | A creature lies to it, feints, or wears a false face, or its own lie or disguise is uncovered. | PF2e, DH | when a foe feints or deceives it |
| `taunted` | Taunted | Someone insults, goads or challenges it. | DCC, DH, Ironsworn | when a foe taunts or challenges it |
| `speech` | Hears speech | A creature speaks, sings or performs where it can hear, including talk it overhears. | PF2e, DH | when a creature in earshot speaks or performs |
| `ruleBroken` | Rule broken | Someone trespasses, cheats, breaks a ward, or does something its faith forbids. | PF2e, 5e, DH | when a creature breaks a rule it guards |

### Fear (`fear`)

Mostly horror, where the answer is often involuntary (see helper notes).

| id | name | when | sources | engine moment |
|---|---|---|---|---|
| `suddenScare` | Startled | Something sudden happens near it: a bang, a shape lunging out, a hand on its shoulder. | horror | when a sudden event happens beside it |
| `horrorSeen` | Sees the horror | It sees something gruesome or unnatural, or the thing stalking it comes into view. | space, horror, heist | when it first sees a horrific sight or creature |
| `strained` | Under strain | Fear, shock or despair would weigh on it: Stress, sanity or nerve is about to be marked. | DH, Ironsworn, Starforged; horror | when stress or sanity would be marked |
| `breakingPoint` | Breaking point | Its stress or panic track crosses a line, or a stress die shows its bad face. | space, horror, military, heist | when its stress passes a threshold |
| `allyPanics` | Friend panics | An ally nearby screams, panics, breaks or flees. | PF2e; space, horror, military | when an ally in sight becomes frightened or flees |
| `leaderFalls` | Leader falls | Its side's leader, officer or boss is killed, captured or taken out. | DH; space, western, military, heist | when its side's leader drops |

### Turns and the round (`turnRound`)

| id | name | when | sources | engine moment |
|---|---|---|---|---|
| `fightStarts` | The fight begins | The fight breaks out: initiative is rolled, an ambush is sprung, or a standoff snaps into violence. | PF2e, 5e, DCC, DH, Ironsworn, Starforged; horror, western, martial arts, military, heist | as the fight opens, before the first turn |
| `ownTurnStarts` | Its turn starts | Its own turn begins, or it takes the spotlight for the first time in a scene. | PF2e, DH | at the start of its own turn |
| `ownTurnEnds` | Its turn ends | Its own turn ends, or it has just taken the last action of its turn. | PF2e | at the end of its own turn |
| `otherTurnStarts` | Another's turn starts | Another creature begins its turn, often only one it can see or one inside its aura. | PF2e, 5e, DH | at the start of another creature's turn |
| `otherTurnEnds` | Another's turn ends | Another creature finishes its turn, anywhere or only next to it or inside its aura. | PF2e, 5e, DH | at the end of another creature's turn |
| `betweenTurns` | A slot between turns | A set point in the round comes round (such as initiative 20), or one side pays to cut in outside the turn order. | 5e, DH | between turns, at a fixed count or when a side pays to interrupt |
| `readiedTrigger` | A chosen trigger happens | Something it named in advance (while readying, holding an action or preparing for the day) comes to pass. | PF2e, 5e, DCC; space, horror, superhero, western, martial arts, military, heist | when the condition it named while readying comes true |
| `countdownEnds` | A countdown runs out | A countdown, clock or threat track fills or reaches a marked value. | DH, Ironsworn, Starforged | when a countdown it watches reaches its mark |

### Surroundings (`environment`)

| id | name | when | sources | engine moment |
|---|---|---|---|---|
| `airFails` | Air failing | The air goes: a hull breach, venting, a choking cloud, or water closing over it. | PF2e; space, horror | when the air around it turns unbreathable |
| `bigImpact` | Collision coming | A crash, a charging vehicle or a collapsing structure is about to hit it, its vehicle, or people nearby. | space, cyberpunk, mecha, horror, superhero, military | just before a collision or collapse hits |
| `lightsOut` | Lights out | The light fails around it: a power cut, a dropped torch, a flare burning out. | space, horror, heist | when its area goes dark |
| `alarmRaised` | Alarm raised | An alarm sounds, a check-in is missed, or security is otherwise alerted. | space, cyberpunk, military, heist | when the alarm goes up |
| `disturbance` | Something's off | It hears, sees or senses something out of place nearby: a strange noise, a light, a body on the floor. | 5e, DH, Ironsworn, Starforged; horror, military, heist | when a sound, light or sign reaches its senses |
| `environmentTurns` | Surroundings turn | Weather, terrain, depth or another natural force threatens it. | DH, Ironsworn, Starforged | when the scene's environment strikes |

### Hazards (`hazard`)

A trap's or haunt's own triggers. A creature caught by a hazard uses `inBlastArea`, `mustSave` or `falling` instead.

| id | name | when | sources | engine moment |
|---|---|---|---|---|
| `entersArea` | Steps into it | A creature steps into, onto or through a marked area, zone or trapped spot. | PF2e, 5e, DH, Ironsworn, Starforged | when a creature enters a marked area |
| `approachesHazard` | Comes close | A creature comes within a set distance of, or next to, a trap or haunted object. | PF2e | when a creature comes within range of the hazard |
| `touchesObject` | Touches it | A creature touches, opens, moves or steps on a trapped object, sometimes with a click and a beat of warning. | PF2e; horror, western, military, heist | when a creature handles or steps on the trapped object |
| `disableAttempt` | Tampered with | A creature tries (and often fails) to disable, pick or force the hazard, or fumbles its way across hazardous ground. | PF2e, 5e, DH, Ironsworn, Starforged | after a check to disable or cross it |
| `hazardDamaged` | Hazard damaged | The hazard, or a part of it, takes damage, breaks, or is critically hit. | PF2e | after the hazard takes damage |
| `lingers` | Lingers | A creature stays in the area for a set time, or a set time passes. | PF2e | at the end of a turn spent in the area |
| `hazardSensed` | Hazard noticed | A creature looks at, reads, tastes, uses or makes noise near the hazard, or several gather in its area. | PF2e | when a creature senses or uses the hazard |

### Its own actions, and the rest (`other`)

| id | name | when | sources | engine moment |
|---|---|---|---|---|
| `ownRoll` | Its own roll | It is about to roll, or has rolled and not yet resolved, and can add, reroll or swap dice. | PF2e, 5e, DCC, DH, Ironsworn, Starforged | around its own roll, before the result stands |
| `ownRollFails` | Its roll fails | Its own save or check fails (or fails badly), with a chance to overturn it. | PF2e, 5e, DCC, DH | after its own save or check fails |
| `ownRollSucceeds` | Its roll succeeds | Its own save or check succeeds, opening a follow-up. | PF2e | after its own save or check succeeds |
| `specialRoll` | Dice show something | Its dice show a special result: a natural 1 or 20, a matched pair, Hope or Fear. | 5e, DCC, DH, Ironsworn, Starforged | when its roll shows a special face |
| `ownHit` | Its blow lands | Its own attack hits, crits or deals damage, and it can add something. | PF2e, 5e, DCC, DH, Ironsworn, Starforged | after its own attack hits |
| `ownMiss` | Its attack misses | Its own attack or spell misses, with a chance to salvage something. | PF2e, 5e, DH | after its own attack misses |
| `dropsFoe` | Drops a foe | It kills or downs an enemy, or takes out a minion. | PF2e, 5e, DCC, DH, Ironsworn, Starforged; superhero, western, martial arts | after it drops a foe |
| `ownAction` | Uses a certain action | It uses (or lands) a particular action of its own: a grab, a reload, a leap, a spell. | PF2e | after it uses a named action |
| `deathNearby` | A death nearby | A creature it can sense dies: a foe, or a friend before its eyes. | PF2e; space, horror, western, military | when a creature in sight dies |
| `runsDry` | Runs dry | A pool it leans on bottoms out: momentum, supply, its last Stress, the last of its ammunition. | DH, Ironsworn, Starforged | when one of its resources hits zero |
| `pointSpent` | A point changes hands | A Hope, Fear, Luck, hero point or similar is spent or gained near it. | DCC, DH | when a side spends or gains a meta point |
| `complication` | Plan goes wrong | A complication turns up that it could plausibly have prepared for. | space, cyberpunk, heist | when a setback is declared against its side |

## Rare: map to the nearest

These came up once or twice in the scans, or only outside a fight. They get no entry of their own; a helper files them under the trigger named.

- PF2e: a condition ends (waking up, turning back from stone): map to `ownTurnStarts`.
- PF2e: it transforms (grows, changes shape, reverts): map to `ownAction`.
- PF2e: the vessel it depends on (a chariot, a jar) is destroyed: map to `gearBreaking`, or `rideHurt` for a vehicle.
- PF2e: an item is dropped within reach, or a creature eats or drinks nearby: map to `foeOpening`.
- PF2e: a creature starts a reaction: map to `foeCasts` if it's a spell, else `foeOpening`.
- PF2e: a trap or snare goes off nearby (not the hazard's own trigger): map to `inBlastArea` for those caught, `disableAttempt` for the one who set it off.
- PF2e: army warfare (a morale check, a troop losing a segment): map to `leaderFalls` or `badlyHurt`.
- PF2e: scripted adventure events (an encounter beginning, a named NPC acting): the GM fires these; nearest `fightStarts` or `countdownEnds`.
- PF2e oddities from the scan: a white hair plucked (`touched`), a name said three times (`speech`), a bright light revealing it (`aboutToBeFound`), a fortune or misfortune effect used (`ownRoll` or `foeRolls`), a teleport ending nearby (`magicNearby`).
- Daggerheart: someone ends up alone (foeIsolated): check it at `otherTurnEnds`.
- Ironsworn/Starforged: a bond or relationship tested: out of a fight; at most `pressed`.
- Daggerheart/Ironsworn: the party rests while a threat is active: out of a fight; `countdownEnds` if a threat clock moves.
- Exalted: attacks cross at the same instant (clash): map to `attacked`, with a strike effect that settles which blow lands.

## Effects

One entry for each thing a reaction does, whatever set it off. A reaction can carry several: PF2e Reactive Strike is `strike` plus `disrupt` on a critical hit, and Retributive Strike is `reduce` plus `strike`. "engine" names the effect key the engine already has (`responses.js`): ac, halve, reduce, redirect (it takes the blow itself), strike (its best melee strike), counter, and damage plus a save.

| id | name | what it does | sources | engine |
|---|---|---|---|---|
| **Defend itself** | | | | |
| `acBonus` | Raise its guard | A bonus to its defense against this attack (a dodge, a shield snapped up, its ship jinking) that may turn a hit into a miss. | PF2e, 5e, DCC, DH; space, cyberpunk, mecha, western, martial arts, military | **ac** |
| `negate` | Make it miss | The attack misses or does nothing outright: a deflected arrow, a caught rock, a critical hit turned into a plain one. | PF2e, 5e, DH; space, superhero, martial arts |  |
| `halve` | Halve the damage | Cuts the damage of the blow in half. | 5e | **halve** |
| `reduce` | Soak some | Takes a die, a flat amount or a damage tier off the blow: a shield block, a parry, armour taking the brunt, bracing for it. | PF2e, 5e, DCC, DH; space, mecha, superhero, martial arts, military | **reduce** |
| `shrugOff` | Pay to shrug it off | Rolls, or spends Stress, Hope, momentum, a hero point or a benny, to soften or cancel harm instead of taking it. | DH, Ironsworn, Starforged; space, cyberpunk, superhero, western, heist |  |
| `heal` | Heal | Regains hit points or gains temporary ones, or heals an ally, sometimes rushing to its side first. | PF2e; space, horror, superhero, military |  |
| `stayUp` | Cling to life | Stays up at 1 hit point, heals on the spot, or survives a brush with death. | PF2e, 5e, DH, Ironsworn, Starforged |  |
| `resist` | Resist | A bonus or advantage on the save, or ignores or ends the effect outright: steady nerves, a spell held together, a spooked mount kept in hand, feet planted against a shove. | PF2e, 5e, DCC, DH; horror, western, military |  |
| `bolsterRoll` | Better its roll | Adds to, rerolls or improves its own roll before it stands, up to turning a failure into a success. | PF2e, 5e, DCC, DH, Ironsworn |  |
| **Help a friend** | | | | |
| `helpAlly` | Help a friend | Gives an ally a bonus, a reroll or a better result. | PF2e, 5e, DCC, DH, Ironsworn; space, superhero, heist |  |
| `guardAlly` | Cover a friend | Raises an ally's defense, hampers whoever is attacking it, or lays down covering fire. | 5e, DH; space, cyberpunk, western, military |  |
| `letAllyAct` | Let a friend act | Lets an ally attack, cast, move or react right now, or finishes a combined move the ally started. | 5e, DH, Ironsworn; superhero, martial arts |  |
| `takeTheBlow` | Take it for them | Steps in and becomes the target, or takes the damage, in a friend's place, even throwing itself on the grenade. | PF2e, 5e, DH; space, horror, superhero, martial arts, military, heist | **redirect** |
| `rescue` | Pull them clear | Drags an ally or bystander out of the line of fire or a hazard, catches them as they fall, holds on as they are dragged off, or holds up what is falling on them. | space, horror, superhero, military |  |
| **Hit back** | | | | |
| `strike` | Strike back | Makes an attack out of turn at the foe that set it off (or the next one along): a riposte, an opportunity swing, an overwatch shot, return fire. | PF2e, 5e, DCC, DH; space, cyberpunk, mecha, superhero, western, martial arts, military, heist | **strike** |
| `harmSource` | Punish the source | Deals damage to whoever set it off, often allowing a save: hellfire, thorns, a shock through the fist. | PF2e, 5e, DCC, DH; horror, superhero, martial arts | **damage+save** |
| `areaBurst` | Burst | Lets loose an effect in a burst, cone, line or aura around it, including a last blast as it dies. | PF2e, 5e, DH |  |
| `redirectAttack` | Turn it elsewhere | Sends the attack or spell to another target: back at the attacker, onto a bystander pulled into the way, or wherever it likes. | PF2e, 5e, DH; space, cyberpunk, superhero, western, martial arts, heist |  |
| `rider` | Add a rider | Adds damage, a condition or a push to its own hit that has just landed. | 5e, DCC, DH, Ironsworn |  |
| **Hamper the foe** | | | | |
| `afflict` | Afflict the foe | Leaves the foe frightened, off-guard, slowed, poisoned, cursed, marked with Stress, or the like. | PF2e, 5e, DH |  |
| `spoilRoll` | Spoil a foe's roll | Worsens a foe's roll or defense: a penalty, a forced reroll, disadvantage, a flipped die. | PF2e, 5e, DH |  |
| `trip` | Trip it | Knocks the foe prone, or uses its own rush to throw it down. | PF2e; superhero, martial arts |  |
| `moveFoe` | Move the foe | Pushes, pulls or repositions the foe, or makes it spend its own move running. | PF2e, 5e, DCC, DH |  |
| `grab` | Seize it | Grabs, restrains, engulfs or swallows the foe, turns the foe's grab into its own, or tightens a hold. | PF2e; superhero, martial arts |  |
| `disarm` | Disarm | Knocks away or snatches an item from the foe. | PF2e |  |
| `disrupt` | Spoil the action | Interrupts the foe's action so it fails or is wasted: a blow that breaks its focus, a hacker unplugged, its link jammed. | PF2e; space, cyberpunk, military, heist |  |
| `counter` | Counter the magic | Counteracts, dispels or absorbs a spell or power as it is cast, sometimes soaking it up for charges. | PF2e, 5e, DCC, DH; space, cyberpunk, superhero | **counter** |
| `taunt` | Draw them in | Makes the foe come after it, or makes others poor targets. | DCC, DH |  |
| `bluff` | Talk its way out | A quick lie, a cover story or a hard word to stop someone acting or raising the alarm. | cyberpunk, western, heist |  |
| **Move and position** | | | | |
| `move` | Move | Moves outside its turn: steps away, flies off, swaps places, teleports, or breaks into a run. | PF2e, 5e, DH; cyberpunk, horror, western, heist |  |
| `takeCover` | Hit the dirt | Drops flat or dives behind cover against fire or a blast, and may stay down, pinned, until it lifts. | PF2e; space, cyberpunk, horror, western, military | **ac** |
| `standUp` | Spring up | Gets back on its feet at once. | PF2e; superhero, martial arts |  |
| `fallSafely` | Land safely | Slows a fall, softens the landing, or catches a handhold so it isn't thrown or sucked away. | PF2e, 5e, DCC; space, horror, superhero |  |
| `escape` | Slip free | Breaks or slips out of a grab, a pin or a binding at once. | PF2e, 5e; horror, superhero, martial arts |  |
| `hide` | Hide | Goes hidden, concealed or invisible, or freezes still so it isn't seen and doesn't set anything off. | PF2e, 5e, DH; cyberpunk, horror, military, heist |  |
| **Tempo and resources** | | | | |
| `actNow` | Act now | Takes an action (or a whole turn) out of order, draws first, or seizes the initiative. | PF2e, 5e, DCC, DH, Ironsworn, Starforged; space, cyberpunk, superhero, western, martial arts, heist |  |
| `gainPoint` | Gain a point | Gains or gets back a point or a resource: Hope, Fear, Luck, momentum, a spell slot, a recharge, ammunition. | PF2e, DCC, DH, Ironsworn |  |
| `boost` | Surge | Gains a bonus to its attacks, damage, checks or speed for a while: a rage, an adrenaline rush, a protective fury. | PF2e, DH; horror, superhero, western, military |  |
| **Magic and powers** | | | | |
| `useAbility` | Cast or unleash | Casts a spell, reshapes one in flight, or lets loose a signature ability (a breath, a gaze, a spray); what happens is the spell's or the ability's own. | PF2e, 5e |  |
| `create` | Make something | Creates a barrier, a cloud, difficult ground, light, a decoy or a summoned ally, or splits into more of itself. | PF2e, 5e, DH; space, horror, heist |  |
| `transform` | Transform | Changes shape or size, or turns back into its true form. | PF2e, DH |  |
| `learn` | Learn something | Recalls what it knows, detects, or traces the trigger back to where it came from. | PF2e; space, cyberpunk, heist |  |
| **Alarm and the scene** | | | | |
| `alert` | Raise the alarm | Shouts a warning or sounds the alarm: allies aren't caught off guard, and help may come. | 5e, DH; space, cyberpunk, horror, military, heist |  |
| `investigate` | Go and look | Moves toward a noise, an alarm or a last-seen spot to see what's there. | cyberpunk, horror, military, heist |  |
| `changeScene` | Change the scene | A countdown advances, a threat grows, the ground shifts, or a new danger turns up. | DH, Ironsworn, Starforged |  |
| `flashback` | Flashback | Settles now something it set up earlier, or produces gear it would have packed. | space, cyberpunk, military, heist |  |
| **Fear** | | | | |
| `panic` | Panic roll | Rolls on a panic or fright table, and the result decides its response (freeze, scream, run, lash out, or a rush of adrenaline). | space, horror, military |  |
| `freeze` | Freeze | Flinches or locks up: drops what it holds, loses an action or its turn, or shuts down or faints for longer. | space, horror, military |  |
| `scream` | Scream | Cries out: alerts everything nearby, and may spread the panic to its allies. | space, horror, military |  |
| `flee` | Run for it | Breaks and runs, falls back, surrenders, or drops the job and heads for the way out. | space, cyberpunk, horror, western, military, heist |  |
| `lashOut` | Lash out | Attacks the nearest creature, friend or foe, in a frenzy. | horror, military |  |
| `strain` | Take the strain | Marks stress, loses sanity, or takes on a fear condition. | space, horror, military, heist |  |
| **Tech and vehicles** | | | | |
| `pointDefense` | Shoot it down | Shoots down, decoys or jams an incoming missile, drone or targeting lock. | space, cyberpunk, mecha, military |  |
| `damageControl` | Damage control | Patches, reroutes, vents or powers down a failing system, or shifts power to its shields, to keep things from getting worse. | space, cyberpunk, mecha, horror, superhero, military |  |
| `bailOut` | Bail out | Ejects, jumps away, teleports out or jacks out of the net, leaving the fight entirely. | space, cyberpunk, mecha, superhero, military |  |
| `counterHack` | Counter-hack | Sets defensive programs on an intruder to hurt it, slow it, trace it or throw it out. | space, cyberpunk, heist |  |
| `seal` | Seal it | Shuts and holds a door, hatch, helmet or whole area against vacuum, gas, fire, boarders or the thing at the door. | space, cyberpunk, horror, military, heist |  |
| `throwBack` | Throw it back | Throws, kicks or bats a live explosive away before it goes off. | space, cyberpunk, superhero, military |  |

## The engine today, and what to add next

| engine moment | master trigger | what the reaction says (`responses.js` keys) |
|---|---|---|
| before an attack roll at it | `attacked` | ac |
| before an attack roll at a friend near it | `allyTargeted` | ac (a bonus to the friend's defense against that attack: `guardAlly`) |
| an attack hits it, before damage | `hit`, and `wouldTakeDamage` when an attack deals the damage | ac, halve, reduce |
| a melee attack misses it | `missed` | strike |
| a foe's blow hurt it | `damaged` | damage and save |
| an attack hits a friend near it | `allyHit` | reduce, strike, redirect |
| a blow would drop it | `wouldDrop` | stayUp {hp, wounded} (`stayUp`) |
| it drops or dies | `slain` | areaBurst {damage, save, range} (`areaBurst`), answered on its way down |
| a foe casts a spell it can see | `foeCasts` (`spell`) | counter |
| a foe walks out of its reach (`reactions.js`) | `foeLeavesReach` | its opportunity strike |
| a ranged attack, or a manipulate action, in its reach | `foeOpening` | its opportunity strike, where `rules.opportunityOn` names it (PF2e) |
| standing up in its reach | `foeMovesInReach` | its opportunity strike, where `rules.opportunityOn` names it (PF2e) |
| a move that ends in its reach after a square or more inside it (a reach weapon walked into: `throughReach`) | `foeMovesInReach` | its opportunity strike, where `rules.opportunityOn` names it (PF2e) |
| a friend ends a move beside it (`answerMove`) | `allyMoves` | step (feet: a move of its own to the best spot it finds), kin |
| a foe comes into its reach (`answerMove`) | `foeApproaches` | strike, step, kin |

A reaction marked `free` costs no reaction (a creature's nature: a death burst). One marked `passive` is always on (an XCC brawler's Toughness): never asked about in a live battle, and not listed on the character's tab.

The PF2e scan gives a rough order for what to add next. These are the busiest triggers with no moment yet, by the approximate number of distinct PF2e reactions behind each: `ownRollFails` (94), `ownHit` (89), `spellTargets` (84), `magicNearby` (54), `mustSave` (53). (`foeApproaches`, 48, has one now.) Across the other systems, `mustSave`, `ownRoll` and `ownHit` turn up in every one scanned, so they are the safest to add next. Hazards would need `entersArea` (251), `touchesObject` (219) and `approachesHazard` (141) first, if the engine ever runs traps.

Still open:
- **Damage that isn't an attack.** `wouldTakeDamage` is checked at `hit`, on expected damage, which works for blows. A spell, an area or a hazard has no moment before its damage lands, so Shield Block against a spell, a Daggerheart Armor Slot against a blast, or Ironsworn Endure Harm against a fall all go unchecked.
- **A critical Reactive Strike disrupting the manipulate action it answered** (PF2e) is not played yet: the strike lands, the action goes on.
- **In a live battle,** the watcher during a player's turn sees moves (`foeLeavesReach`) and, where the helper reads them (`liveOpening`: PF2e), cards that lower the character's guard in an NPC's reach (`foeOpening`). Standing up at the table (`foeMovesInReach`) is not watched yet.

## Helper notes: how each system maps

**PF2e.** The scan sorted each reaction by the trigger sentence. A helper does the same by slug, then reads the trigger for its filters (melee, ranged, damage type, crit). Examples:
- Nimble Dodge: `attacked` + `acBonus`.
- Shield Block: `wouldTakeDamage` (the engine: `hit`, needsShield) + `reduce`.
- Reactive Strike and Attack of Opportunity: `foeOpening`, `foeMovesInReach` and `foeLeavesReach` + `strike` (+ `disrupt` on a critical hit against a manipulate action).
- Ferocity and Orc Ferocity: `wouldDrop` + `stayUp`.
- Retributive Strike: `allyHit` + `reduce` + `strike`. Intercept Attack: `allyHit` + `takeTheBlow`.
- Counterspell: `foeCasts` + `counter`. Recognize Spell: `foeCasts` + `learn`.
- Critical hits and critical failures are filters (`hit` with crit, `missed` with critical failure), not triggers of their own. Degrees of success map to the filters "would succeed", "failed" and "critical failure".
- Hazard reactions use the hazard group. Items that react (the reaction glyph) map the same way as creature abilities.
- Effects: the scan tagged several per reaction. Map each tag to its master effect (acBonus, reduce, strike, afflict, and so on). `useAbility` is only a holder: read the spell or ability for its real effect.

**5e.** One reaction a round, plus triggered traits that cost no reaction (auras, Split, Death Burst), which use the same moments.
- Opportunity Attack: `foeLeavesReach` + `strike`. Shield: `hit` + `acBonus`. Uncanny Dodge: `hit` + `halve`.
- Deflect Attacks and Deflect Missiles: `hit` (ranged only for Missiles) + `reduce` (+ `redirectAttack` when it throws the missile back). Parry: `hit` (melee) + `reduce`. Riposte: `missed` (melee) + `strike`.
- Hellish Rebuke: `damaged` + `harmSource`. Fire Shield: `hit` (melee) or `touched` + `harmSource`, without spending a reaction.
- Counterspell: `foeCasts` + `counter`. Concentration saves: `concentrationJolted` + `resist`.
- Relentless Endurance and Undead Fortitude: `wouldDrop` + `stayUp`. Legendary Resistance: `ownRollFails` + `bolsterRoll` (not a reaction, but the same moment).
- Legendary Actions: `otherTurnEnds` + `actNow`. Lair Actions: `betweenTurns`. Ready: `readiedTrigger`.
- "(non-SRD)" examples (Sentinel, War Caster, Interception, Absorb Elements) are names only, so a helper sees the shape. Their text is not in the open rules.

**DCC (and XCC).** DCC has no reaction economy by design. Its out-of-turn moments map like this:
- The free attack on a foe withdrawing from melee: `foeLeavesReach` + `strike` (XCC's Acrobat can deny it).
- Spell duels: `foeCasts` + `counter`.
- Burning Luck: `ownRoll` or `ownRollFails` + `bolsterRoll`. A halfling burning Luck for a friend: `allyRolls` + `helpAlly`.
- Crit and fumble results that hand over a free attack: `foeOpening` or `foeFails` + `strike`.
- Mighty Deeds are declared on the warrior's own attack: `ownHit` + `rider`, not a reaction. A Will save to keep concentrating: `concentrationJolted`.
- XCC: Brawler Toughness is `hit` (melee) + `reduce`, and Mojo is `ownRoll`. Draw Agro and Disrespect are the gnome's and jammer's own actions; the foe's side of them is `taunted`.

**Daggerheart.** Daggerheart passes the spotlight instead of taking turns.
- Adversary features marked as reactions map by their trigger clause, most often `damaged` + `harmSource`, `attacked` or `allyDown`.
- Armor Slots: `wouldTakeDamage` + `reduce` (one threshold down). Reaction rolls: `mustSave`. The Major and Severe thresholds are the "heavy" filter on `damaged` and `wouldTakeDamage`.
- A roll with Hope or with Fear: `specialRoll`. The GM spending Fear to interrupt: `betweenTurns`. Features that answer Fear or Hope being spent: `pointSpent`. Marking the last Stress: `runsDry` (and the condition `shaken`).
- Environment features: countdowns are `countdownEnds`, and zones are `entersArea`. A Tag Team Roll: `commanded` + `letAllyAct`.

**Ironsworn and Starforged.** These games have no reactions as such: moves answer the fiction. A helper maps a move that responds to something onto that moment:
- Face Danger against an imminent threat: `mustSave` (or `attacked`, if it's a blow) + `acBonus` or `move`.
- Clash when the foe has the initiative, or in a bad spot: `attacked` + `strike` (a strong hit adds `actNow`, seizing the initiative).
- React Under Fire: `attacked` or `underFire` + `takeCover` or `acBonus`.
- Endure Harm: `wouldTakeDamage` + `shrugOff`. Endure Stress: `strained` + `shrugOff` or `strain`. Face Death: `wouldDrop` + `stayUp`.
- Companion Endure Harm and Companion Takes a Hit: `allyDamaged`. Aid Your Ally: `allyRolls` + `helpAlly`.
- Enter the Fray: `fightStarts`. Compel, from the side being compelled: `pressed`. Pay the Price: `foeFails` (from the GM's side) + `changeScene`.
- Burning momentum: `ownRoll` + `bolsterRoll`. Lose Momentum and Sacrifice Resources: `runsDry`. Withstand Damage: `rideHurt`. Advance a Threat: `countdownEnds`.
- Asset abilities ("when you ...") follow their own clause. As with maneuvers, the stat rolled settles close calls: edge → `move` or `acBonus`; iron → `strike` or `reduce`; heart → `resist` or `helpAlly`; shadow → `hide`; wits → `learn`.

**Genre styles (no ruleset).** These triggers come from genre conventions, so a style turns them on rather than a system helper:
- Horror switches on the fear group. Its answers (`panic`, `freeze`, `scream`, `flee`, `lashOut`, `strain`) are drawn from a weighted table instead of being weighed by worth, and cost no reaction. Panic spreads: `scream` sets off `allyPanics` in others.
- Military adds `underFire`, overwatch (`foeMovesInOpen`: ranged and at a distance, unlike an opportunity attack), `inBlastArea` with `throwBack` and `takeCover`, and morale through `leaderFalls`.
- Space and mecha add the tech group. Vehicle reactions belong to whoever holds the crew station: `rideTargeted` goes to the pilot (`acBonus`), the gunner (`pointDefense`) or the engineer (`damageControl`).
- Heist adds `aboutToBeFound`, `alarmRaised`, `disturbance` and `complication` (`flashback`). Superhero adds `wardInPeril` (`rescue`) and the team moves (`commanded`, `letAllyAct`).
- Many military and sci-fi answers trade the next turn for the effect now (Lancer Brace, Call of Cthulhu diving for cover, Feng Shui's active dodge). That cost is one rider on the reaction ("costs its next action"), not a separate effect.

## Helper notes: ambiguous terms

1. **The same word, different moments.** "Parry" is a 5e monster reaction (`hit` + `reduce`), but in PF2e it's a weapon-trait action on its own turn (the maneuver `defend`). "Redirect" in the engine means taking the blow itself (`takeTheBlow`). The effect `redirectAttack` sends the attack somewhere else. "Evasion" in 5e is a passive on a Dexterity save (`mustSave`). Savage Worlds' Evasion edge answers an area attack (`inBlastArea`).
2. **Before and after pairs.** `attacked` → `hit` → `wouldTakeDamage` → `damaged`; `allyTargeted` → `allyHit` → `allyDamaged`; `wouldDrop` → `slain`; `allyWouldDrop` → `allyDown`; `mustSave` → `ownRollFails`/`ownRollSucceeds`. Map a reaction to the earliest moment at which it can still change the outcome.
3. **One reaction, several moments.** A reaction may listen at more than one trigger (Reactive Strike at three). The engine should let `on` be a list.
4. **No reaction spent.** Passive auras (5e Fire Shield, Daggerheart adversary passives), legendary actions, Luck, momentum and fear responses use these triggers without costing the creature its reaction for the round. The reaction should say so (`free: true` or similar).
5. **Merges worth a second look.** `inBlastArea` folds a grenade's beat of warning into any area effect. `foeApproaches` folds entering reach, entering an aura and charging together, with range as a filter. `deathNearby` covers both a foe dying (PF2e Death's Call) and a friend killed in front of it (horror panic), with "friend" as a filter. `resist` is broad: save bonuses, ignoring an effect, ending a condition, keeping concentration, and controlling a mount. The fear effects (`freeze`, `scream`, `flee`) could fold into `panic` if one table entry is enough.
6. **Hazards are not creatures.** Hazard triggers fire for the hazard. A creature caught by one answers through `inBlastArea`, `mustSave`, `falling` or `airFails`.

## Sources

Merged from three research catalogs, made for this list and not kept in the repository (names and short neutral descriptions only; no rules text):
- PF2e: about 2,900 distinct reaction names (844 of them hazard or trap reactions), from 97 compendium packs of the PF2e system v8.6.0 plus the Battlezoo Strange & Unusual module. Counts are approximate, from a keyword classifier with spot checks.
- Other systems: the dnd5e packs (spells, features, monsters, items; 2014 and 2024), Daggerheart adversaries, environments and player features, the foundry-ironsworn moves and assets (Ironsworn, Delve, Starforged, Sundered Isles), and the DCC and XCC core-book modules. Taken from the installed packs and modules, not checked online.
- Genres: genre games and conventions (Lancer, Traveller, Starfinder 1e and 2e, Star Trek Adventures, Shadowrun, Cyberpunk RED, Infinity, BattleTech, Call of Cthulhu, Mothership, Alien RPG, Delta Green, Vaesen, Mutants & Masterminds, Marvel Multiverse RPG, Masks, Monster of the Week, Savage Worlds, Deadlands, Boot Hill, Exalted, Feng Shui, Hero System, GURPS, Twilight 2000, Blades in the Dark, Leverage, Night's Black Agents). The catalog carries its own confidence flags (Starfinder 2e Overwatch and Hair Trigger, Savage Worlds First Strike, some Infinity RPG names). Check them before relying on an example.
