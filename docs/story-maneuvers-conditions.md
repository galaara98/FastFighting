# Maneuvers and conditions: master list

This is a working master list for the FastFighting story core. A **maneuver** is something a creature does. A **condition** is something a creature is. Each system helper maps its own terms onto one master id, so the story can say "Valeros trips the goblin" or "the goblin is frightened" without game words.

**Scope.** The list leaves out things other parts of the module already tell: attacks of every kind (Strike, Clash, Area Fire, Auto-Fire, Reactive Strike/opportunity attacks, breath weapons, Rend, End the Fight, Take Decisive Action, Battle), spellcasting, damage and hit points, and vehicles and starships. Class features are only listed when they are the usual way a system does something everyone does (rage, hunter's mark, aim).

**Reading the tables.**
- "maps from" lists `system: term` pairs. PF2e = Pathfinder 2e remaster (Player Core, GM Core, Monster Core). SF2e = Starfinder 2e (Player Core). 5e = both SRD 5.1 and 5.2 unless marked. DCC = Dungeon Crawl Classics. DH = Daggerheart. Ironsworn and Starforged are written out in full.
- "gap" marks a sci-fi entry that no open ruleset names. "derived" means the helper has to work it out from state, because no system has a term for it.
- "(tag)" marks a Daggerheart condition that only exists in a feature's text, not in the core list. The DH helper should match these by tag name.
- One system term should map to one id. Where a term has to be split by what caused it, the "Helper notes" section below says so.
- The "what it looks like" lines are notes for whoever writes the story sentences. They are not final module strings: under the Foundry AI policy, the English story text has to be written by a person.

Counts: 72 maneuvers, 61 conditions, and 21 bookkeeping-only entries. (Added after the research: flee, callForHelp, callToArms, noticeSight, noticeSound, noticeSmell, noticeFeel, noticeRadar, lazy.)

## Maneuvers (things a creature does)

| id | what it looks like | maps from |
|---|---|---|
| **Moving** | | |
| `move` | crosses the floor, closing the distance or taking up a new spot | PF2e: Stride; SF2e: Stride; 5e: moving up to its speed; DH: moving within Close range as part of an action; DCC: movement |
| `dash` | sprints flat out, covering ground fast | 5e: Dash; PF2e/SF2e: two or more Strides in one turn (derived); DH: moving to Far or Very Far range (Agility roll) |
| `step` | takes one careful step, slipping out of reach or around a foe without giving it an opening | PF2e/SF2e: Step; 5e: Disengage |
| `retreat` | breaks off and falls back, putting the fight behind it | derived: moving away from every foe it was engaged with; Ironsworn/Starforged: Face Danger to break away; DCC: withdrawing from melee |
| `charge` | rushes headlong at a foe | DCC: charge; PF2e: Sudden Charge (feat), Pounce (creature); 5e: Charge, Pounce, Trampling Charge (creature traits) |
| `tumbleThrough` | rolls, ducks or vaults past a foe through the space it guards | PF2e/SF2e: Tumble Through |
| `leap` | jumps a gap, a table or a low wall | PF2e/SF2e: Leap, High Jump, Long Jump; 5e: long jump, high jump |
| `climb` | scrambles up a wall, a rope or a heap of rubble | PF2e/SF2e: Climb; 5e: climbing; DCC: climb sheer surfaces (thief) |
| `swim` | strikes out through the water | PF2e/SF2e: Swim; 5e: swimming, underwater combat |
| `fly` | takes to the air: wings beat, a jetpack roars, it banks and hovers | PF2e/SF2e: Fly, Maneuver in Flight; 5e: flying, hover |
| `burrow` | digs down and moves beneath the ground | PF2e/SF2e: Burrow; 5e: burrowing |
| `crawl` | drags itself along the ground | PF2e/SF2e: Crawl; 5e: crawling |
| `dropProne` | throws itself flat; hits the deck | PF2e/SF2e: Drop Prone; 5e: dropping prone |
| `standUp` | scrambles back to its feet | PF2e/SF2e: Stand; 5e: standing up; DCC: standing up |
| `balance` | picks its way along a narrow beam or across a slick floor | PF2e/SF2e: Balance; 5e: Acrobatics check to keep its footing |
| `squeeze` | wriggles through a gap too tight for it | PF2e/SF2e: Squeeze; 5e: squeezing into a smaller space |
| `catchFall` | catches a ledge, or checks a fall in mid-air | PF2e/SF2e: Grab an Edge, Arrest a Fall |
| `mount` | swings up into the saddle, or leaps down from it | PF2e/SF2e: Mount; 5e: mounting and dismounting; DCC: mounted combat |
| `flee` | panics and runs for it, back turned, anywhere away from the fight | PF2e/SF2e: fleeing (acting on it); 5e: fleeing in fear; DCC: failed morale (flight); derived: running from a fight it was losing |
| `callForHelp` | shouts or runs to fetch friends who don't know about the fight yet | derived (the core's run for help) |
| `callToArms` | a leader calls its own people into the fight | derived (the core: a leader in the fight calling in its group) |
| **Noticing** | | |
| `noticeSight` | sees the commotion and turns toward it | derived (the core's bystanders, by sight) |
| `noticeSound` | hears the commotion: clashing steel, shouts, a scream | derived (the core's bystanders, by sound) |
| `noticeSmell` | smells the commotion: blood, sweat, smoke on the air (never through a wall) | PF2e/SF2e: scent; derived (spec.senses.smell) |
| `noticeFeel` | senses the commotion some other way: the ground trembling, the stir of life, a psychic ripple | PF2e/SF2e: tremorsense, lifesense, thoughtsense, echolocation, electromagnetic sense ...; 5e: tremorsense, blindsight; derived (spec.senses.feel) |
| `noticeRadar` | picks up the commotion on tech sensing: a ping on radar, a blip on a scanner, a motion tracker | sci-fi: radar, sonar, scanners, motion trackers (devices, not a creature's own senses); derived (spec.senses.radar) |
| **Defending** | | |
| `takeCover` | ducks behind a crate, a pillar or a wall | PF2e/SF2e: Take Cover; 5e: moving behind cover (no action); Starforged: React Under Fire (taking cover) |
| `raiseShield` | brings its shield up and braces | PF2e/SF2e: Raise a Shield |
| `block` | takes the blow on its shield or armor | PF2e/SF2e: Shield Block; DH: marking an Armor Slot |
| `defend` | turns wholly to defense: weaving, parrying, giving nothing away | 5e: Dodge; PF2e: Parry (weapon trait action); DCC: defensive maneuver (Mighty Deed); DH: reaction roll to evade; Ironsworn: Face Danger (to evade); Starforged: React Under Fire |
| `avertGaze` | turns its eyes from a deadly stare | PF2e/SF2e: Avert Gaze; 5e: averting its eyes from a gaze (medusa, basilisk) |
| **Stealth and awareness** | | |
| `hide` | slips out of sight into shadow, smoke or cover | PF2e/SF2e: Hide; 5e: Hide; DH: becoming Hidden; DCC: hide in shadows (thief) |
| `sneak` | creeps, unseen, to a new spot | PF2e/SF2e: Sneak; 5e: moving while hidden (Stealth); DCC: sneak silently (thief) |
| `search` | scans the room for a lurking foe | PF2e/SF2e: Seek; 5e: Search |
| `assess` | sizes up a foe, reading its weak spots or what it means to do | PF2e/SF2e: Recall Knowledge, Sense Motive; 5e (5.2): Study; Ironsworn/Starforged: Gather Information (during a fight) |
| `pointOut` | shouts and points to where an unseen foe is lurking | PF2e/SF2e: Point Out |
| **Words and nerve** | | |
| `demoralize` | snarls a threat or looms, trying to break the foe's nerve | PF2e/SF2e: Demoralize; PF2e: Frightful Presence (creature); 5e: Frightful Presence (creature); 5e (5.2): Influence (Intimidation); Ironsworn/Starforged: Compel (by threat) |
| `feint` | fakes one way and goes the other | PF2e/SF2e: Feint |
| `distract` | throws a pebble, shouts, or waves a cloak to draw eyes away | PF2e/SF2e: Create a Diversion |
| `parley` | calls out in the middle of the fight to bargain, demand surrender or talk the foe down | 5e (5.2): Influence; PF2e/SF2e: Request; Ironsworn/Starforged: Compel |
| `rally` | shouts encouragement that steadies wavering allies | DCC: rallying maneuver (Mighty Deed); DH: Rally (Bard); 5e: Bardic Inspiration (class feature) |
| `surrender` | throws down its weapons and yields | DCC: failed morale check (surrender); derived elsewhere |
| **Teamwork and timing** | | |
| `aid` | sets an ally up: an opening, a distraction, a steadying hand | PF2e/SF2e: Aid; 5e: Help; DH: Help an Ally, Tag Team Roll, Group Action Roll; Ironsworn/Starforged: Aid Your Ally |
| `ready` | holds, poised, waiting for its moment, weapon trained on the doorway | PF2e/SF2e: Ready, Delay; 5e: Ready; gap: overwatch |
| `gainGround` | presses for position, setting up the next move | Starforged: Gain Ground; Ironsworn: Secure an Advantage, Turn the Tide |
| **Holds and forced movement** | | |
| `grapple` | seizes a foe and holds on: an arm lock, a bear hug, jaws clamped on a limb | PF2e/SF2e: Grapple; PF2e: Grab, Improved Grab (creature); 5e (5.1): grapple; 5e (5.2): Unarmed Strike (Grapple); 5e: creature attacks that leave the target grappled; DCC: grappling |
| `shove` | drives a foe back a pace or two | PF2e/SF2e: Shove; PF2e: Push, Improved Push (creature); 5e (5.1): shove (push away); 5e (5.2): Unarmed Strike (Shove, push), Push weapon mastery; DCC: pushback attack (Mighty Deed); DH: push effects |
| `trip` | sweeps a foe's legs, or knocks it off its feet | PF2e/SF2e: Trip; PF2e: Knockdown, Improved Knockdown (creature); 5e (5.1): shove (knock prone); 5e (5.2): Unarmed Strike (Shove, prone), Topple weapon mastery; 5e: Pounce, Wing Attack (creature); DCC: trips and throws (Mighty Deed) |
| `disarm` | knocks the weapon out of a foe's grip | PF2e/SF2e: Disarm; DCC: disarming attack (Mighty Deed) |
| `reposition` | hauls or steers a foe to a new spot, or drags it closer | PF2e/SF2e: Reposition; 5e: moving a grappled creature; creature pull effects |
| `fling` | hurls a foe through the air | PF2e: Buck and creature throw abilities; 5e: Whirlwind (air elemental) and other creature flings; DCC: throws (trips and throws) |
| `escape` | twists free of a grip, a web or its bonds | PF2e/SF2e: Escape; 5e: escaping a grapple; DH: breaking free of Restrained; DCC: breaking a grapple |
| `release` | lets go of a foe it held, or lets something fall from its hand | PF2e/SF2e: Release; 5e: releasing a grapple |
| `constrict` | squeezes a held foe in coils or arms | PF2e: Constrict, Greater Constrict (creature); 5e: Constrict (creature) |
| `swallow` | gulps a foe down whole | PF2e: Swallow Whole (creature); 5e: Swallow (creature) |
| `engulf` | rolls over a foe and draws it into its body | PF2e: Engulf (creature); 5e: Engulf (creature) |
| `trample` | stampedes over smaller foes | PF2e: Trample (creature); 5e: Trampling Charge and trample attacks (creature) |
| `blindFoe` | throws sand, dirt or a cloak into a foe's eyes | DCC: blinding attack (Mighty Deed) |
| **Gear** | | |
| `drawWeapon` | draws, sheathes or swaps a weapon, or straps on a shield | PF2e/SF2e: Interact (draw or stow); 5e: object interaction (draw or sheathe), donning or doffing a shield; DH: swapping to an inventory weapon |
| `reload` | reloads: a fresh bolt, a new magazine, a spare cell | PF2e/SF2e: Interact (reload); 5e: the Loading and Ammunition properties |
| `useItem` | uses something it carries: gulps a potion, triggers a gadget | PF2e/SF2e: Activate an Item, Interact (drink or apply); SF2e: Operate Device; 5e (5.1): Use an Object; 5e (5.2): Utilize, Magic action (using a magic item) |
| `interact` | deals with the scene: yanks a lever, slams a door, snatches up a fallen blade | PF2e/SF2e: Interact (anything else); 5e: free object interaction |
| `forceOpen` | shoulders through a door or wrenches open a hatch | PF2e/SF2e: Force Open; 5e: Strength check to break something open |
| `steal` | lifts something from a foe's belt | PF2e/SF2e: Steal, Palm an Object; DCC: pick pockets (thief) |
| `disableDevice` | jams a trap or a mechanism | PF2e/SF2e: Disable a Device; 5e: thieves' tools; DCC: disable traps (thief) |
| `hack` | breaks into a system in the middle of the fight: a turret, a door, a drone | SF2e: Hack (Computers); gap: sci-fi hacking |
| `commandAnimal` | barks an order to its mount or beast companion | PF2e/SF2e: Command an Animal; 5e: controlling a mount |
| **Care and grit** | | |
| `firstAid` | kneels to bind a wound or steady a dying ally | PF2e/SF2e: Administer First Aid, Treat Poison, Battle Medicine (feat); 5e: stabilizing (Medicine check), healer's kit; Ironsworn/Starforged: Heal |
| `douseFlames` | beats out the flames or rolls on the ground to smother them | 5e (5.2): putting out Burning; PF2e/SF2e: help to end persistent fire (rolling on the ground, water) |
| `fightOn` | should be down, but stays on its feet and keeps fighting | PF2e: Ferocity (creature), Orc Ferocity; 5e: Relentless, Undead Fortitude (creature), Relentless Endurance (orc); DH: Blaze of Glory |
| **Ranged and sci-fi** | | |
| `aim` | takes careful aim, or locks on | SF2e: Aim (operative); 5e (5.2): Steady Aim (rogue); DCC: precision shot (Mighty Deed); gap: target lock |
| `suppressingFire` | hoses an area with fire to pin the enemy down and cover its allies | SF2e: Suppressing Fire (soldier, through Area Fire or Auto-Fire); gap: covering fire |

## Conditions (things a creature is)

| id | what it looks like | maps from |
|---|---|---|
| **Senses and visibility** | | |
| `blinded` | can't see; it swings wildly and gropes for its foes | PF2e/SF2e: blinded; 5e: Blinded; DCC: blinded (after a blinding deed or a critical hit); gap: flashbang |
| `dazzled` | eyes streaming, squinting through glare or sparks | PF2e/SF2e: dazzled; gap: flare or muzzle flash |
| `deafened` | ears ringing, deaf to shouted warnings | PF2e/SF2e: deafened; 5e: Deafened; gap: sonic blast |
| `silenced` | can't make a sound; its voice is gone | DH: Silenced (tag); 5e, PF2e: inside or under a silence spell |
| `concealed` | blurred by smoke, fog or darkness, and hard to pin down | PF2e/SF2e: concealed; 5e: in a lightly or heavily obscured area |
| `hidden` | out of sight; its foes have lost track of it | PF2e/SF2e: hidden, undetected, unnoticed; 5e (5.1): hidden after a Hide; 5e (5.2): Invisible gained from the Hide action; DH: Hidden, Cloaked (tag); DCC: hiding in shadows |
| `invisible` | fades from view by magic or a cloaking field | PF2e/SF2e: invisible; 5e: Invisible (from magic); DH: Invisible (tag); gap: cloaking field |
| **Mind and nerve** | | |
| `frightened` | afraid: eyes wide, hanging back | PF2e/SF2e: frightened; 5e: Frightened; DH: Horrified, Scared, Terrified (tags) |
| `fleeing` | panicked, and running | PF2e/SF2e: fleeing; DCC: failed morale check (flight); 5e: forced to flee (a fear spell) |
| `shaken` | rattled; its nerve is frayed | Ironsworn/Starforged: shaken; DH: Rattled (tag); DH: Vulnerable from marking its last Stress (see helper notes) |
| `charmed` | treats its enemy as a friend | 5e: Charmed; PF2e/SF2e: friendly or helpful attitude caused by a charm effect; DCC: charm person |
| `fascinated` | spellbound, staring | PF2e/SF2e: fascinated; DH: Enraptured (tag) |
| `confused` | lashes out at random, at friend and foe alike | PF2e/SF2e: confused; 5e: a confusion spell |
| `controlled` | moves like a puppet on someone else's strings | PF2e/SF2e: controlled; 5e: dominated (a dominate spell); gap: hacked robot or drone |
| `befuddled` | its thoughts are foggy; slow to react, stumbling over words | PF2e/SF2e: stupefied; DCC: Intelligence or Personality loss |
| `enraged` | lost in a red rage | PF2e: Rage (barbarian); 5e: Rage (barbarian); DH: Frenzied (tag) |
| **Body and vigor** | | |
| `weakened` | arms like lead; its blows land feebly | PF2e/SF2e: enfeebled; DCC: Strength loss |
| `clumsy` | unsteady, fumbling | PF2e/SF2e: clumsy; DCC: Agility loss |
| `drained` | pale, as though its life has been leached away | PF2e/SF2e: drained; 5e: lowered hit point maximum (life drain); DCC: Stamina loss; DH: Drained (tag) |
| `exhausted` | spent: gasping, limbs heavy | PF2e/SF2e: fatigued; 5e: Exhaustion (any level short of death); DH: Exhausted (tag) |
| `sickened` | queasy and retching | PF2e/SF2e: sickened; DH: Nauseated, Sickened (tags) |
| `poisoned` | venom in its blood: sweating, unsteady | 5e: Poisoned; PF2e/SF2e: persistent poison damage, poison afflictions; DH: Poisoned, Envenomated (tags); DCC: poison |
| `bloodied` | badly hurt, with blood showing | 5e (5.2): Bloodied; Ironsworn/Starforged: wounded; PF2e, SF2e, 5e (5.1), DCC, DH: derived (hit points at half or below) |
| `maimed` | a crippling injury: a ruined hand, a lost eye | Ironsworn: maimed; Starforged: permanently harmed; DCC: maiming critical results, surviving after the body is rolled |
| `cursed` | a curse clings to it: ill omens, bad luck | DH: Cursed, Hexed (tags); PF2e/SF2e: curse afflictions; 5e: bestow curse |
| **Ongoing harm** | | |
| `bleeding` | bleeding freely from an open wound | PF2e/SF2e: persistent bleed damage |
| `burning` | on fire | PF2e/SF2e: persistent fire damage; 5e (5.2): Burning; DH: On Fire, Ablaze, Ignited (tags) |
| `corroding` | acid eating at its armor and skin | PF2e/SF2e: persistent acid damage; DH: Corroded (tag) |
| `lingeringHarm` | some other harm keeps biting: frost creeping, sparks crawling, a psychic ache | PF2e/SF2e: persistent damage of any other type (cold, electricity, sonic, mental, spirit, vitality, void, force) |
| `suffocating` | can't breathe: choking, drowning, or the air ripped away | 5e (5.1): suffocating; 5e (5.2): Suffocation; PF2e/SF2e: suffocation and drowning (environment rules); SF2e: vacuum exposure; gap: decompression |
| `lazy` | could act, and knowingly doesn't: hangs back, lets others do the work | derived (the core: a turn spent doing nothing while able; the Lazy playstyle's slacking) |
| **Position and holds** | | |
| `prone` | down on the ground | PF2e/SF2e: prone; 5e: Prone; DCC: knocked down |
| `grabbed` | held fast in someone's grip | PF2e/SF2e: grabbed; 5e: Grappled; DCC: grappled; DH: Grappled (tag) |
| `restrained` | pinned, bound or webbed, and close to helpless | PF2e/SF2e: restrained; 5e: Restrained; DCC: pinned; DH: Chained, Pinned (tags) |
| `immobilized` | rooted to the spot, but its arms are still free | PF2e/SF2e: immobilized; DH: Restrained (core condition, name clash), Rooted (tag); gap: mag-locked, glued down by foam |
| `swallowed` | inside the beast's gullet | PF2e: swallowed by Swallow Whole; 5e: swallowed; DH: Swallowed (tag) |
| `engulfed` | trapped inside an ooze's body | PF2e: engulfed by Engulf; 5e: engulfed; DH: Enveloped (tag) |
| `inCover` | crouched behind cover | PF2e/SF2e: standard or greater cover (including after Take Cover); 5e: half, three-quarters or total cover |
| `flanked` | caught between two foes | PF2e/SF2e: flanked (off-guard to the flankers) |
| `offGuard` | its guard is down and an opening shows | PF2e/SF2e: off-guard; DH: Vulnerable, Distracted (tag); 5e (5.2): target of the Vex weapon mastery; 5e: "attacks against it have advantage" with no other condition to explain it |
| `pressed` | on the back foot, giving ground | Starforged: in a bad spot; Ironsworn: the foe has initiative |
| `surprised` | caught unawares as the fight breaks out | 5e (5.1): surprised; 5e (5.2): Surprise; DCC: surprised (surprise round) |
| `marked` | singled out as quarry: a hunter's eye, a target lock | PF2e: Hunt Prey (its prey); SF2e: Aim (the operative's mark); 5e: Hunter's Mark; DH: Ranger's Focus, Marked, Marked for Death (tags); gap: tagged or painted target |
| **Tempo** | | |
| `slowed` | sluggish; every move costs an effort | PF2e/SF2e: slowed; 5e: Slow spell, Slow weapon mastery (5.2); DH: Slowed (tag); gap: stasis field |
| `hastened` | moves in a blur | PF2e/SF2e: quickened; 5e: Haste spell |
| `reeling` | rocked by a blow, off balance for a moment | 5e (5.2): Sap weapon mastery; DH: Dazed (tag); DCC: dazed critical results |
| `stunned` | senseless, unable to act | PF2e/SF2e: stunned; 5e: Stunned, Incapacitated (alone); DH: Stunned (tag); DCC: stunned critical results; SF2e: critical failure while glitching; gap: stun weapon |
| `paralyzed` | frozen rigid | PF2e/SF2e: paralyzed; 5e: Paralyzed; DCC: paralysis (e.g. a ghoul's touch) |
| `petrified` | turned to stone | PF2e/SF2e: petrified; 5e: Petrified; DH: Petrified (tag) |
| **Down** | | |
| `unconscious` | out cold, or asleep | PF2e/SF2e: unconscious; 5e: Unconscious, stable; DH: Unconscious (after Avoid Death), Asleep (tag); DCC: knocked out, magical sleep |
| `dying` | down and bleeding out | PF2e/SF2e: dying; 5e: at 0 hit points and making death saves; DCC: bleeding out; DH: marking its last Hit Point (before its death move resolves); Ironsworn/Starforged: Face Death |
| `dead` | dead | PF2e/SF2e: dead; 5e: dead; DCC: dead (bleeding out runs its course); DH: Blaze of Glory, or a failed Risk It All; Ironsworn/Starforged: Face Death (miss) |
| **Gear** | | |
| `disarmed` | empty-handed; its weapon lies out of reach | derived (no weapon in hand after a disarm or fumble); DCC: disarming attack, dropped-weapon fumbles |
| `gearBroken` | its shield splinters, its blade snaps, its force field winks out | PF2e/SF2e: broken (shield or weapon); DCC: broken-weapon fumbles and deeds; gap: shields down |
| `weaponJammed` | its weapon jams or misfires | gap; DCC: fumble results; PF2e: misfire (Guns & Gears, legacy, not in Player Core) |
| `outOfAmmo` | out of ammunition: the gun clicks dry, the quiver is empty | gap; derived in PF2e, SF2e and 5e (no ammunition left) |
| `overheated` | its weapon or suit is too hot to use | gap |
| `glitching` | its tech sputters and its systems fail | SF2e: glitching; gap: EMP, hacked gear |
| **Sci-fi and environment** | | |
| `suppressed` | pinned down under fire, keeping its head low | SF2e: suppressed; gap: pinned down |
| `adrift` | floating helplessly in zero gravity | SF2e: untethered; gap: zero-g, blown loose by decompression |
| `irradiated` | sick with radiation: blistered skin, nausea | SF2e: radiation (hazard or affliction); gap |

## Bookkeeping only (no story line)

These change numbers but don't change what a watcher would see, or they are already told some other way.

- **PF2e/SF2e: doomed.** A hidden counter of how close death is, with no outward sign. The story tells `dying` and `dead` instead.
- **PF2e/SF2e: wounded.** A counter for the next time the creature is dying. Not the same thing as Ironsworn's "wounded", which maps to `bloodied`.
- **PF2e/SF2e: observed.** The normal, fully visible state.
- **PF2e/SF2e: encumbered; 5e: carrying-capacity encumbrance; Ironsworn: encumbered.** Rarely changes during a fight. At most it's a line of scene-setting.
- **PF2e/SF2e: attitudes (hostile, unfriendly, indifferent, friendly, helpful).** Social standing. Only a change caused by a charm is told, as `charmed`.
- **PF2e: cursebound.** An oracle's class resource.
- **PF2e/SF2e: persistent damage as a label.** It is told by damage type instead (`bleeding`, `burning`, `corroding`, `poisoned`, `lingeringHarm`).
- **PF2e/SF2e: Sustain, Dismiss; 5e: concentration.** Upkeep on spells, which belongs to the spell telling.
- **PF2e: hero points.** A player resource.
- **5e (5.2): dehydration, malnutrition.** Hazards of travel, not of a fight.
- **5e: exhaustion level 6.** It is `dead`, not a separate state.
- **Initiative and turn order (PF2e/SF2e/5e initiative, DH spotlight, Ironsworn/Starforged Enter the Fray).** The fight's opening already tells this.
- **Ironsworn/Starforged: unprepared.** Short of supplies. It can't be seen in a fight.
- **Ironsworn: corrupted, cursed, tormented. Starforged: doomed, tormented, indebted, traumatized.** Long-term burdens. In the moment the story tells `shaken` (or `maimed` for harm).
- **Ironsworn/Starforged: momentum, Lose Momentum, and the suffer moves (Endure Harm, Endure Stress, Companion Endure Harm or Takes a Hit, Face Desolation, Sacrifice Resources).** Steps of resolution. Their results come out as conditions.
- **DH: Hope, Fear, Stress, Armor Slot counts, Experiences.** Resources. Only the moments that cross a line are told: blocking (`block`), and running out of Stress (`shaken`).
- **DCC: Luck, Luck burn, spellburn, corruption, disapproval.** Resources and the costs of casting. Spellburn is part of the spell telling.
- **DCC: the deed die itself.** The deed it fuels maps to a maneuver.
- **SF2e (Tech Core): compromised, inoperable, malfunctioning, off-kilter, wrecked.** Starship conditions, at vehicle scale.
- **Starforged: battered, cursed (vehicle impacts).** Vehicle scale.
- **PF2e/SF2e: Delay (if the helper prefers).** It is mapped to `ready` above, but most turns where a creature delays aren't worth a line.

## Helper notes (ambiguous terms)

1. **The same word means different things.** Ironsworn "wounded" maps to `bloodied`, but PF2e "wounded" is bookkeeping. DH "Restrained" (can't move, can still act) maps to `immobilized`, but 5e and PF2e "restrained" map to `restrained`. DH "Cursed" maps to `cursed`, but Ironsworn "cursed" is a bookkeeping burden. "Doomed" is bookkeeping in both PF2e and Starforged.
2. **Split by what caused it.** A 5e (5.2) Invisible condition that came from the Hide action maps to `hidden`; from magic, it maps to `invisible`. DH Vulnerable from marking the last Stress maps to `shaken`; otherwise it maps to `offGuard`. A 5e shove maps to `shove` when it pushes and to `trip` when it knocks prone. PF2e Interact maps to `drawWeapon`, `reload`, `useItem` or `interact` depending on the object.
3. **Flanked is its own state, wherever a system has it.** PF2e and SF2e fold it into off-guard: off-guard *because it's flanked* maps to `flanked`; off-guard from anything else (a feint, a grab, being caught unaware) maps to `offGuard`. In 5e, flanking is an optional rule that gives the flankers advantage: `flanked` while it lasts, and nothing else. A system with no flanking never uses `flanked`.
4. **5e Incapacitated** on its own maps to `stunned`. When it comes with Paralyzed, Petrified, Stunned or Unconscious, tell that condition instead.
5. **Merges worth a second look.** PF2e Step and 5e Disengage are merged into `step`. PF2e hidden, undetected and unnoticed are merged into `hidden`, though "nobody has spotted her yet" could become its own line. PF2e enfeebled, clumsy, stupefied and drained are kept apart because they read differently, but they could collapse into one "weakened" entry if four is too many. Covering fire is folded into `suppressingFire`, overwatch into `ready`, and decompression into `suffocating` plus `adrift`.
6. **Ironsworn/Starforged moves are broad** (Face Danger, Secure an Advantage, Compel). The stat rolled is a good tiebreaker: edge → `defend`/`step`/`tumbleThrough`; shadow → `hide`/`sneak`/`distract`; iron → `grapple`/`shove`/`escape`; wits → `assess`/`aim`; heart → `rally`/`parley`/`demoralize`.
7. **DH condition tags** come from feature text. I collected them through a fan mirror of the SRD, and some adversary tags may come from content outside the SRD. Check each one against the official SRD PDF before encoding it.
8. **Possible overlap with other telling.** `bloodied`, `dying` and `dead` may already be covered by the damage and defeat telling, and `marked` and `hastened` by the spell or feature telling. Keep them here only if the core wants one place for states.

## Sources

Checked online for this list:
- Archives of Nethys, PF2e conditions (Player Core): https://2e.aonprd.com/Conditions.aspx
- Archives of Nethys, SF2e conditions (adds glitching, suppressed, untethered; starship conditions from Tech Core): https://2e.aonsrd.com/conditions and https://2e.aonsrd.com/conditions/39-suppressed
- Archives of Nethys, SF2e actions (Area Fire, Auto-Fire, Take Cover, Raise a Shield, Point Out): https://2e.aonsrd.com/actions
- Archives of Nethys, SF2e Computers skill (Access Infosphere, Operate Device, Disable a Device, Hack): https://2e.aonsrd.com/skills/4-computers
- Archives of Nethys, SF2e operative (Aim) and soldier (suppressing fire): https://2e.aonsrd.com/classes/3-operative and https://2e.aonsrd.com/classes/5-soldier
- Archives of Nethys, SF2e environment and damage in space (vacuum, radiation, untethered drift): https://2e.aonsrd.com/rules/1251-environment and https://2e.aonsrd.com/rules/847-damage-in-space
- Daggerheart SRD (Darrington Press, DPCGL): https://www.daggerheart.com/wp-content/uploads/2025/05/DH-SRD-May202025.pdf; fan mirror used to search it: https://callmepartario.github.io/og-dhsrd/
- DCC Mighty Deeds of Arms categories (secondary summary): https://www.tenkarstavern.com/2012/06/dcc-rpg-dirty-mighty-deeds-of-arms-done.html

From the open rules as I know them (not re-checked line by line):
- PF2e remaster Player Core, GM Core and Monster Core (ORC), including basic, specialty and skill actions and creature abilities: https://2e.aonprd.com/Actions.aspx and https://2e.aonprd.com/MonsterAbilities.aspx
- D&D SRD 5.1 and SRD 5.2 (CC-BY-4.0), including conditions, actions, the 5.2 rules glossary (Bloodied, Burning, Surprise, Suffocation) and weapon mastery: https://www.dndbeyond.com/srd
- DCC RPG core rulebook (Goodman Games; mechanics designated as Open Game Content): combat, Mighty Deeds, morale, grappling, bleeding out
- Ironsworn and Ironsworn: Starforged (Shawn Tomkin, CC BY 4.0): moves, debilities and impacts: https://www.ironswornrpg.com and https://github.com/rsek/datasworn
