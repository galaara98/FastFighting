/**
 * The index of short strings (two words or fewer, two placeholders at most) for the author to write: a CSV with what
 * each must say, where it shows, its limits and the proposed text, and a column for the author's own wording.
 *   node docs/strings/short-strings.mjs            writes docs/strings/short-strings.csv
 *   node docs/strings/short-strings.mjs <out.csv> --skip <answered.csv> ...
 *                                                  a later batch: leaves out every string answered in those CSVs
 * The repos sit side by side, as for tracker.mjs.
 */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const REPOS = { core: "FastFighting", pf2e: "FastFighting-PF2e", dnd5e: "FastFighting-DnD5e", dcc: "FastFighting-DCC", ironsworn: "FastFighting-Ironsworn" };
const flat = (o, p = "", out = {}) => { for ( const [k, v] of Object.entries(o) ) { if ( v && typeof v === "object" ) flat(v, `${p}${k}.`, out); else out[`${p}${k}`] = v; } return out; };
const words = s => (String(s).replace(/\{\w+\}/g, " ").replace(/<[^>]+>/g, " ").match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]*/g) ?? []).length;
const marks = s => [...new Set(String(s).match(/\{\w+\}/g) ?? [])];

/* -------------------------------------------- */
/*  Where things show                           */
/* -------------------------------------------- */
const W = {
  settings: "Configure Settings → FastFighting (GM)",
  settingOption: "A choice in a FastFighting setting's dropdown, and in the Battle Planner (GM)",
  planner: "Battle Planner window (GM)",
  plannerRoster: "Battle Planner: a creature's row in the roster (GM)",
  plannerSide: "Battle Planner: a side's settings (GM)",
  plannerOptions: "Battle Planner: the options along the top (GM)",
  results: "Battle Planner: the results (GM)",
  sample: "Battle Planner: Results → Sample fight (GM)",
  makeItSo: "Make it So: the list of changes, in its dialog and chat card (GM)",
  summary: "Make it So: the summary card in chat (GM, or everyone)",
  survey: "The players' tactics survey, and the planner's tactics panel (players and GM)",
  story: "The story of the fight, in chat (GM, or everyone)",
  standard: "The Standard story: each character's line (chat)",
  log: "The Statistician story's log, one line per event (chat, and the planner's Sample fight)",
  tables: "Story tables: the names of the RollTables a GM installs (Settings → FastFighting → Story tables), joined with ' · ' (GM)",
  storyWord: "The Roleplay story (chat)",
  helper: "The notice in FastFighting's settings and the Combat Tracker, when a system has no helper (GM)",
  generic: "Generic system support: its settings dialog and the planner (GM)",
  defaults: "Side defaults dialog (Settings → FastFighting) (GM)"
};

/* -------------------------------------------- */
/*  Core                                        */
/* -------------------------------------------- */
const SETTING = {
  maxRounds: "the round limit for a simulated fight", neutralDefault: "how neutral tokens take part by default",
  downedModel: "what dropping to 0 HP means", leadership: "leaders and their command (on or off)", surpriseDefault: "how initiative and surprise are decided",
  talking: "creatures can talk instead of fighting (on or off)", ignoreLanguages: "talking works without a shared language (on or off)", storyStyle: "which story style is told by default",
  storyMode: "who the story is posted for", leaderInfluence: "how readily followers take their commander's lead", bossInfluence: "how much more a boss's lead counts"
};
const SIDE = { friendly: "the party's side", hostile: "the enemy side: the Hostile tab and side choice, and its name when it fights as one group", hostileGroup: "a hostile group's name, with its number, when the hostile tokens fight in more than one group", neutralGroup: "a neutral team's name, with its number: a Secret token's team pills in the planner", neutral: "neutral tokens (taking part as set)", secret: "secret tokens (hidden from the players)" };
const BAND = {
  feral: "Tactical, lowest band (0-19): pure instinct", instinctive: "Tactical, 20-39", competent: "Tactical, 40-59", tactical: "Tactical, 60-79", mastermind: "Tactical, highest band (80+)",
  craven: "Brave, lowest band (0-19)", skittish: "Brave, 20-39", steady: "Brave, 40-59", bold: "Brave, 60-79", fearless: "Brave, highest band (80+)",
  devoted: "Selfish, lowest band (0-19): puts others first", selfless: "Selfish, 20-39", pragmatic: "Selfish, 40-59", selfish: "Selfish, 60-79", ruthless: "Selfish, highest band (80+)",
  treacherous: "Loyal, lowest band (0-19)", wavering: "Loyal, 20-39", dependable: "Loyal, 40-59", loyal: "Loyal, 60-79", unshakable: "Loyal, highest band (80+)"
};
const STAT = { ac: "armor class", hp: "hit points", attack: "attack bonus (or spell DC)", damage: "damage per hit", leadBrave: "the bravery bonus a leader gives its side", leadTactical: "the lowest tactical level a leader holds its side to", leadAttack: "the attack bonus a leader gives its side", leadAc: "the AC bonus a leader gives its side" };
const KIND = { pc: "badge for a player character", npc: "badge before an NPC's level ('Lvl 3')", companion: "badge for a companion (animal companion, familiar)", summon: "badge for a summoned creature", minion: "badge for a minion", hazard: "badge for a hazard" };
const MODE = { walk: "moves by walking", fly: "moves by flying", swim: "moves by swimming", climb: "moves by climbing", burrow: "moves by burrowing" };
const STATUS = { standing: "still standing at the end", down: "down (unconscious or dying)", dead: "dead", fled: "fled the fight", surrendered: "surrendered", switched: "switched sides", stoodDown: "stood down (talked out of fighting)", neutral: "stood aside (talked into taking no side)", conceded: "gave something up to end it", noSide: "took no side" };
const DIFF = { trivial: "lowest", low: "second lowest", moderate: "middle", severe: "second highest", extreme: "highest" };
const PLANNER = {
  Title: ["the window's title", "Short title"], Runs: ["label: how many fights to simulate", "Short label"], MaxRounds: ["label: the round limit", "Short label"], Seed: ["label: the random seed (the same seed replays the same fights)", "Short label"],
  Random: ["placeholder in the seed box when it's empty: a random seed", "One or two words, lower case"], Downed: ["label: what dropping to 0 HP means", "Short label"], Initiative: ["label: how initiative and surprise are decided", "Short label"],
  Positioning: ["toggle: use the map (terrain, walls, distance)", "Short label"], Morale: ["toggle: creatures can break and flee", "Short label"], Leadership: ["toggle: leaders and command", "Short label"],
  Hidden: ["toggle: include hidden tokens", "Short label"], Run: ["button: start the simulation", "Button, one word"],
  Lean: ["label: which way a neutral side leans", "Short label"], Healing: ["label: how readily the party heals others", "Short label"], SideMorale: ["toggle: this side can break and run (rout)", "Short label"],
  GroupTraits: ["heading: the side's shared personality traits", "Short heading"], Leader: ["label: who leads the side", "Short label"], NoLeader: ["choice: the side has no leaders", "Short"],
  SideDefault: ["tooltip note: this value comes from the side's default", "Lower case, short"], HiddenToken: ["tooltip on an icon: the token is hidden", "Short"], Details: ["screen-reader label of the button that opens a creature's details", "Short"],
  IgnoreTerrain: ["detail: the creature ignores difficult terrain", "Short"], Movement: ["detail heading: the creature's speeds", "Short heading"], Environment: ["detail heading: the terrain the creature stands in", "Short heading"],
  Options: ["detail heading: the creature's actions", "Short heading"], RunFailed: ["error notice when a simulation fails", "Short sentence"], FightsWith: ["a token's side, when it fights with another side", "Short"],
  Group: ["screen-reader label of the group buttons (1 2 3)", "Short"], Terrain: ["note on the approach line: slowed by terrain (followed by ×1.25)", "Lower case, short"],
  DifficultHere: ["chip: the creature stands in difficult terrain", "Lower case, short"], HazardHere: ["chip: the creature stands in a hazardous region", "Lower case, short"],
  ControlledBy: ["tooltip on the chip naming a token's players", "Short"], Fudge: ["tooltip note: the GM's adjustment to a value ('+5 fudge')", "Lower case, one word"],
  Talking: ["toggle: creatures can talk instead of fight", "Short label"], IgnoreLanguages: ["toggle: talking works without a shared language", "Short label"],
  Bystanders: ["toggle: tokens outside the encounter can join in", "Short label"], Bystander: ["chip on a token outside the encounter (it may join in)", "One word"],
  Cancel: ["button: stop a running simulation", "Button, one word"], Opening: ["label: how the fight opens (talk first, fight, decide)", "Short label"],
  AroundWalls: ["note on the approach line: has to go around walls", "Lower case, short"], AutoLeaders: ["the leaders picked automatically", "Short"], Command: ["screen-reader label of the command role buttons", "Short"],
  "Role.boss.Name": ["command role: the boss", "One or two words"], "Role.boss.Short": ["one-letter button for the boss role", "One character"],
  "Role.leader.Name": ["command role: the leader", "One or two words"], "Role.leader.Short": ["one-letter button for the leader role", "One character"],
  "Role.lt1.Name": ["command role: first lieutenant", "Two words at most"], "Role.lt1.Short": ["one-character button for the first lieutenant", "One character"],
  "Role.lt2.Name": ["command role: second lieutenant", "Two words at most"], "Role.lt2.Short": ["one-character button for the second lieutenant", "One character"]
};
const RESULTS = {
  "Tab.overview": "tab: the overall odds", "Tab.combatants": "tab: each creature's fate", "Tab.swing": "tab: what changes the odds most", "Tab.resources": "tab: what each side uses up", "Tab.sample": "tab: one fight, told as a story",
  Stalemate: "headline figure: the chance no one wins", PartyWins: "headline figure: the chance the party wins", MedianRounds: "headline figure: how many rounds a fight lasts", Simulated: "headline figure: how hard the fight is, by the simulation",
  RoundN: "tooltip on a bar of the rounds chart: 'Round 3: 25%'", Dangerous: "heading: the foes that deal the most damage",
  DmgAbbr: "abbreviation of damage, after a number", Downed: "how often a character goes down (followed by a figure)", Dead: "how often a creature dies (a bar's label)", Standing: "how often a creature is still standing (a bar's label)",
  Down: "how often a creature is down at the end (a bar's label)", Fled: "how often a creature flees (a bar's label)", Footnote: "footnote before the number of simulated fights", Combatant: "column heading: the creature",
  Fate: "column heading: how each creature ends up", HpLeft: "column heading: hit points left", Damage: "column heading: damage dealt", Healing: "column heading: healing done", Resource: "column heading: a resource (spell slots, potions …)",
  AvgUsed: "column heading: how much of it is used on average", TalkedDown: "how often a creature is talked out of fighting", Switched: "how often a creature switches sides (a bar's label)", Neutral: "how often a creature stands aside (a bar's label)"
};
const SAMPLE = {
  "Outcome.stalemate": "the outcome of a fight no one won", Show: "label: which fight to show (any, typical, the party wins …)", Roll: "button: show another fight", Result: "label before the fight's outcome", Rounds: "after the number of rounds the fight took",
  Unchanged: "a creature the fight left unchanged", "How.drawn": "chip: the fight Make it So would commit, drawn fairly", "How.typical": "chip: the most typical fight", "How.another": "chip: another fair draw (only to look at)", Preview: "chip: this fight is only a preview, not the one Make it So commits"
};
const OUTCOME = {
  Hp: "a change of hit points: from → to", Dies: "a player character dies (stands out: capitals in the proposal)", Dead: "an NPC is dead", Down: "the creature is down", Unconscious: "unconscious but stable",
  Dying: "dying, with the system's dying value", Wounded: "wounded, with the system's wounded value", Surrenders: "the creature surrenders", Uses: "uses up so many of a resource", Affected: "the word for an effect that has no name",
  Persistent: "persistent damage still on the creature", Affliction: "an affliction and its stage"
};
const TACTICS = {
  Auto: ["choice: let the character decide, naming what it would pick", "Short"], "ActionKind.strike": ["kind of action: a weapon attack", "Lower case, short"], "ActionKind.spell-attack": ["kind of action: a spell attack", "Lower case, short"],
  "ActionKind.heal": ["kind of action: healing", "Lower case, short"], "ActionKind.buff": ["kind of action: a buff", "Lower case, short"], "style.Label": ["question: how the character fights", "Short label"],
  "healAggro.Label": ["question: how readily it heals others", "Short label"], "selfRevived.retreat": ["answer: after being revived, retreat", "Short"], "shield.Label": ["question: when to raise a shield", "Short label"],
  "shield.never": ["answer: never raise a shield", "Short"], "beyond.Label": ["question: what to do about creatures outside the fight", "Short label"]
};
const SURVEY = { Level: "label before the character's level", Reset: "button: clear the answers", Ready: "button: the player is done", Prepare: "button: send the survey to the players", "Status.none": "status: the player hasn't been asked", "Status.requested": "status: the survey is opening for the player", "Status.entering": "status: the player is answering", "Status.done": "status: the player is done", MyTactics: "button on the Encounters tab: open your own survey" };
const STORY_MISC = {
  Speaker: ["the name the story is posted under in chat", "Short name"], StyleLabel: ["label: which story style", "Short label"], "Style.roleplay": ["story style: prose", "One word"], "Style.standard": ["story style: what each character did", "One word"],
  "Style.statistician": ["story style: every roll", "One word"], "Mode.public": ["setting choice: post the story for everyone", "One word"], TablesFolder: ["name of the folder the story tables are installed in", "Short name"],
  TablesMenuName: ["settings menu: the story tables", "Short label"], TablesMenuLabel: ["button that opens the story tables dialog", "Button, one word"], Reinstall: ["button: reinstall every story table, overwriting edits", "Button, short"],
  Themselves: ["in a character's thought, the creature itself as the target ('heal themselves')", "Lower case, one word"], APrice: ["what a bribe was, when it has no amount", "Lower case, short"],
  Desire: ["one desire in a character's thought: how badly + what ('really wants to' + 'heal Lini')", "Keep both; order is yours"]
};
const LABELS = { Hits: "so many hits", Crits: "so many critical hits", Misses: "so many misses", Resisted: "so many resisted", Bolstered: "used a buff so many times", Healed: "healed so many times, so many HP", Potions: "drank so many potions", Moved: "moved so far", Status: "where the creature ended up, and its HP" };
const DESIRE = {
  Label: ["heading: the character's desires", "Short heading"], What: ["screen-reader label: what it wants to do", "Short"], Who: ["choice: who it wants to do it to (none chosen yet)", "Short"], HowMuch: ["label: how badly it wants it", "Short"],
  "Kind.none": ["choice: no desire", "A dash or a word"], "Kind.hurt": ["desire: hurt someone", "One word"], "Kind.heal": ["desire: heal someone", "One word"], "Kind.protect": ["desire: protect someone", "One word"], "Kind.aid": ["desire: bolster someone", "One word"], "Kind.talk": ["desire: talk to someone", "Short"],
  "Level.passing": ["how badly: a passing wish (weakest)", "One word"], "Level.wants": ["how badly: wants it", "One word"], "Level.determined": ["how badly: determined", "One word"], "Level.driven": ["how badly: driven", "One word"], "Level.obsessed": ["how badly: obsessed (strongest)", "One word"]
};
const SUMMARY = { Nothing: "a character spent nothing", Minute: "one minute (of game time the fight took)", Minutes: "so many minutes", Second: "one second", Seconds: "so many seconds" };

// The log's short pieces: [what, where it goes].
const LOG = {
  Progress: ["an Ironsworn progress roll: progress against the challenge dice", "a roll"], AC: ["armor class, in a roll ('vs AC 15')", "abbreviation"], DC: ["difficulty class, in a roll ('vs DC 15')", "abbreviation"], DcOf: ["a DC named for a defense ('Will DC')", "a roll"],
  Defense: ["what a roll is against when it isn't named", "lower case"], Degree0: ["result: critical failure", "lower case"], Degree1: ["result: failure", "lower case"], Degree2: ["result: success", "lower case"], Degree3: ["result: critical success", "lower case"],
  Ironsworn1: ["Ironsworn result: a miss", "lower case"], Ironsworn2: ["Ironsworn result: a weak hit", "lower case"], Ironsworn3: ["Ironsworn result: a strong hit", "lower case"], Momentum: ["Ironsworn: momentum burned", "lower case"],
  Damage: ["damage: amount and type ('8 fire')", "keep both"], DamageN: ["damage with no type", "lower case"], DeedRoll: ["DCC: the deed die's roll", "lower case"], SizedUp: ["a bonus for having sized the foe up", "lower case"],
  AttackN: ["which attack this is in the turn ('attack #2')", "lower case"], CritTable: ["DCC: the crit table roll", "lower case"], Self: ["the creature itself as a target", "lower case, one word"], NoRoll: ["the action needed no roll", "lower case"],
  Shifted: ["the result was shifted by an effect", "in brackets"], OnSelf: ["it landed on the caster itself", "in brackets"], NoEffect: ["nothing happened", "lower case"], Succeeds: ["a deed succeeds", "lower case"], Fails: ["a deed fails", "lower case"],
  SlainOutright: ["a crit kills on the spot", "lower case"], CastWorks: ["a spell works, with its result row", "lower case"], CastFumble: ["a spell is fumbled", "lower case"], CastDisapproval: ["a cleric's god disapproves (DCC)", "lower case"],
  CastFails: ["a spell fails", "lower case"], SpellLost: ["the spell is lost for the day (DCC)", "lower case"], DisapprovalRange: ["the cleric's disapproval range (DCC)", "in brackets"], BoostFor: ["burning luck for someone else", "starts with a space"],
  MadeIt: ["the boosted roll now succeeds", "lower case"], StillShort: ["the boosted roll still fails", "lower case"], TriggerHit: ["a reaction's trigger: being hit", "lower case"], TriggerAttacked: ["trigger: being attacked", "lower case"],
  TriggerMissed: ["trigger: being missed", "lower case"], TriggerDamaged: ["trigger: being damaged", "lower case"], TriggerSpell: ["trigger: a spell", "lower case"], Vanish: ["a summoned creature disappears, and why", "a whole line"],
  VanishReleased: ["why: its summoner let it go", "lower case"], VanishUnsustained: ["why: its spell wasn't sustained", "lower case"], VanishIdle: ["why: it had nothing to do", "lower case"], CounterRoll: ["a counter's roll", "starts with ' · '"],
  Countered: ["the counter works", "lower case"], GetsThrough: ["the counter fails: it gets through", "lower case"], Medicine: ["a medicine check during healing", "lower case"], Revived: ["the healing brought them back up", "starts with ' · '"],
  Terrain: ["movement slowed by terrain, with the regions crossed", "starts with a space, in brackets"], ModeWalk: ["moving by walking", "verb, lower case"], ModeFly: ["by flying", "verb"], ModeSwim: ["by swimming", "verb"], ModeClimb: ["by climbing", "verb"],
  ModeBurrow: ["by burrowing", "verb"], ModeMove: ["moving, any other way", "verb"], TheDoor: ["a door, as a destination", "lower case"], Disengage: ["someone disengages: their name and how", "a whole line"], Disengages: ["how, when the system doesn't say", "verb, lower case"],
  DoorOpen: ["at a door: opens it", "lower case"], DoorForce: ["forces it", "lower case"], DoorAttack: ["attacks it", "lower case"], DoorGiveUp: ["gives up on it", "lower case"], DoorOpened: ["result: the door is open", "lower case"], DoorHolds: ["result: the door holds", "lower case"],
  Boss: ["the one followed is the boss", "starts with a space, in brackets"], DesireHurt: ["in a thought: wants to hurt", "lower case"], DesireHeal: ["wants to heal", "lower case"], DesireProtect: ["wants to protect", "lower case"], DesireAid: ["wants to bolster", "lower case"],
  DesireTalk: ["wants to talk to", "lower case"], DesireAvoid: ["wants to avoid", "lower case"], Notice: ["a bystander notices the fight, and how", "a whole line"], NoticeSound: ["how: hears it", "lower case"], NoticeStandoff: ["how: the standoff", "lower case"],
  NoticeAttacked: ["how: attacked by someone", "lower case"], LearnsNothing: ["sizing up teaches nothing", "lower case"], AgainstThem: ["'its next roll against them'", "ends with a space"], CommandAfter: ["no one left to lead after someone", "starts with a space"],
  CommandFrom: ["takes command from someone", "starts with a space"], RoleBoss: ["command role: boss", "lower case"], RoleLeader: ["command role: leader", "lower case"], RoleLieutenant: ["command role: lieutenant, numbered", "lower case"],
  Stabilized: ["first aid result: stabilized", "lower case"], Dies: ["first aid result: dies", "lower case"], DyingN: ["first aid result: still dying", "lower case"], BuffAgainst: ["a buff that works against certain foes", "starts with a space, in brackets"],
  TempHp: ["temporary hit points gained", "starts with ' · '"], AskedBy: ["the buff was asked for by someone", "starts with ' · '"], Bolstered: ["a buff's effect, when it has no name", "lower case"], LetsGo: ["a caster lets effects go (to cast another)", "a whole line"],
  CantAct: ["concentration lost because it can't act", "starts with a space, in brackets"], TheEffect: ["an effect with no name", "lower case"], SparesThem: ["leaves a fallen foe alone", "lower case"], TurnsOn: ["and turns on someone else", "starts with ', '"],
  AllegianceBack: ["a creature returns to its side", "a whole line"], Over: ["a truce over a victim", "starts with a space"], WhyHurt: ["why someone taking no side is offended: hurt", "lower case"], WhyRobbed: ["robbed", "lower case"], WhyInsulted: ["insulted", "lower case"],
  WhyImpatient: ["lost patience", "lower case"], FeintMiss: ["a thief's feint misses", "lower case"], Steals: ["steals something", "lower case"], Caught: ["the thief is caught", "lower case"], NothingTaken: ["nothing stolen", "lower case"], Nothing: ["a bribe of nothing", "lower case"],
  GivesLuck: ["the luck roll behind giving something up", "starts with ' · '"], SwaySwitched: ["someone switches sides", "a whole line"], BreakStandoff: ["someone breaks the standoff, and how", "a whole line"], Condition: ["someone is left with a condition", "a whole line"],
  Reeling: ["a condition with no name", "lower case"], Down: ["someone falls (with how close to dying)", "a whole line"], DownDying: ["their dying value", "starts with a space, in brackets"], Slain: ["someone is slain", "a whole line"], Draw: ["someone draws an item", "a whole line"],
  Flee: ["someone flees", "a whole line"], FleeDread: ["someone runs from someone they dread", "a whole line"], ByName: ["ordered by someone", "starts with a space"], HoldsOn: ["stays up at 1 HP, when the system doesn't name it", "lower case"],
  Initiative: ["the initiative order", "a whole line"], Persistent: ["someone takes persistent damage", "a whole line"], Rally: ["someone rallies allies", "a whole line"], StandsFirm: ["stands firm, when the system doesn't name it", "lower case"],
  Sustain: ["someone sustains a spell", "a whole line"], Waver: ["someone wavers", "a whole line"], Stand: ["someone stands up", "a whole line"], Leave: ["someone slips away", "a whole line"], RiderMended: ["a rider's roll mends a miss", "starts with ' · '"],
  RoundShort: ["a round's heading in the log ('R3')", "very short"], Final: ["heading: how everyone ended up", "one word"], FinalSwayed: ["how they were swayed", "starts with a space, in brackets"], FinalDying: ["their dying value", "starts with ', '"],
  FinalWounded: ["their wounded value", "starts with ', '"], HpN: ["hit points", "short"], NoteStole: ["a note: stole something from someone", "lower case"], NoteKept: ["a note: kept something, by luck", "lower case"], NoteGave: ["a note: gave something to someone", "lower case"],
  Money: ["an amount of money: number and coin ('3 gp')", "keep both"], Separator: ["between items in a list of results", "punctuation"], TerrainRegions: ["the regions crossed", "starts with ': '"]
};
const DAMAGE = t => [`the damage type '${t}', after an amount ('8 ${t}')`, "lower case"];
const EFFECT = {
  hastened: "faster: more actions", slowed: "slower: fewer actions", emboldened: "better attacks", weakened: "worse attacks", shielded: "harder to hit", exposed: "easier to hit", steeled: "better saves", shaken: "worse saves",
  empowered: "more damage", enfeebled: "less damage", focused: "advantage on its attacks", rattled: "disadvantage on its attacks", fleetFooted: "faster on its feet", inspired: "better checks", bolstered: "extra temporary hit points", affected: "changed some other way", sizedUp: "sized up by a foe", fumble: "a fumble's effect, when it has no name"
};

/* Story table name parts. */
const PART = {
  action: "group: attacks", talk: "group: talking", relationship: "group: relationship asides", move: "group: movement", event: "group: everything else", desire: "group: thoughts", intensity: "thoughts: how badly", verb: "thoughts: what", self: "thoughts: about itself",
  melee: "melee attacks", ranged: "ranged attacks", spell: "spells", criticalSuccess: "result: critical success", majorSuccess: "result: a big success", success: "result: success", minorSuccess: "result: a narrow success",
  minorFailure: "result: a narrow failure", failure: "result: failure", majorFailure: "result: a bad failure", criticalFailure: "result: critical failure", persuade: "talking: persuading", intimidate: "talking: intimidating", deceive: "talking: deceiving",
  none: "relationship: none", enemyLeader: "relationship: against the enemy leader", talkingNemesis: "relationship: against someone who refused to listen", grudge: "relationship: a grudge", avenger: "relationship: avenging a fallen ally",
  protector: "relationship: protecting an ally", finishing: "relationship: finishing someone off", rival: "relationship: a running rivalry", walk: "moving: walking", fly: "flying", swim: "swimming", climb: "climbing", burrow: "burrowing",
  approach: "moving toward a foe", terrain: "moving through rough terrain", flee: "fleeing", hunt: "hunting more prey", help: "going for help",
  passing: "how badly: a passing wish", wants: "how badly: wants", determined: "how badly: determined", driven: "how badly: driven", obsessed: "how badly: obsessed", hurt: "wants to hurt", heal: "heals / wants to heal", protect: "wants to protect", aid: "wants to bolster", avoid: "wants to avoid",
  opening: "the fight begins", surprise: "an ambush opens the fight", down: "someone falls", death: "someone dies", finished: "someone already down is finished off", struckDown: "someone already down is hit again",
  recoveryGood: "a dying character's recovery goes well", recoveryBad: "a dying character's recovery goes badly", firstAid: "first aid saves someone", firstAidFail: "first aid fails", aftermathAlone: "after the fight: the fallen lie untended",
  aftermath: "after the fight: the fallen are tended", stabilize: "a dying character stabilizes", healSelf: "someone heals themselves", potion: "someone drinks a potion", revive: "someone is healed back up", stand: "someone stands up",
  shield: "someone raises a shield", draw: "someone draws an item", prone: "someone is knocked prone", grabbed: "someone is grabbed", escape: "someone escapes a grab", stuck: "someone fails to escape a grab", waver: "someone's nerve wavers",
  intercept: "someone takes a blow for an ally", holdGround: "someone holds their ground", answerCall: "someone answers a call for help", edgeFails: "aiding a friend fails", edgeFailsSelf: "aiding oneself fails", studyFails: "sizing up a foe teaches nothing",
  scheme: "a lieutenant schemes against its leader", commandTakes: "someone takes command from another", commandTakesFresh: "someone takes command", commandBack: "the leader takes command back", commandLost: "no one is left to lead",
  shareLore: "someone tells allies what it learned of a foe", observe: "someone watches foes instead of talking", study: "someone sizes up a foe", parley: "someone tries to talk the other side down", callHelp: "someone calls for help",
  noticeSight: "a bystander sees the fight", noticeSound: "a bystander hears it", noticeFled: "a bystander is run into by someone fleeing", noticeHelp: "a bystander is called for help", noticeAttacked: "a bystander is attacked",
  join: "a bystander joins in", joinForced: "a bystander is drawn in", watch: "a bystander watches", leave: "someone slips away", standoff: "a tense standoff opens the fight", breakStandoff: "someone breaks the standoff",
  breakBeast: "a beast breaks the standoff", bribed: "someone is paid to go", retreatCall: "a leader calls a retreat", retreatUrged: "a retreat, at someone's urging", retreatRefused: "a leader refuses to retreat", holdOrdered: "someone holds, as ordered",
  fallBack: "someone falls back with the retreat", leadRetreat: "someone leads the retreat", rally: "someone rallies allies", breakAnnoyed: "the standoff breaks: someone blames the other side", breakBlood: "the standoff breaks: blood is drawn",
  breakInsulted: "the standoff breaks: someone takes offence", standDown: "someone stands down", peace: "the fight ends in peace", talksStall: "talks stall: the standoff ends with nothing settled", noticeStandoff: "a bystander notices the standoff",
  paidOff: "someone is paid off", paidKept: "someone agrees to pay, but keeps it", paidNothing: "someone has nothing to pay with", concedeMoney: "someone gives up money to end it", concedeItem: "someone gives up an item to end it",
  concedeKept: "someone agrees to give something up, but keeps it", lieAndRun: "someone lies about having nothing, and runs", lastWord: "someone gets a last word in", conditionRider: "someone is left with a condition",
  controlTakes: "a control effect takes hold", controlResisted: "a control effect is resisted", buffOne: "someone bolsters an ally", buffMany: "someone bolsters several allies", buffWithSelf: "someone bolsters allies and themselves",
  dodge: "someone dodges", reckless: "someone attacks recklessly", surge: "someone surges into action", buffSelf: "someone bolsters themselves", controlBackfire: "a control effect backfires", concentrationLost: "a caster loses concentration",
  allegianceTurn: "someone is turned against their side", allegianceBack: "someone comes back to their senses", knockout: "someone is knocked out", executeSpared: "someone spares a fallen foe and goes after another",
  executeSparedAlone: "someone spares a fallen foe", executeGoes: "someone moves to finish a fallen foe", deed: "a Mighty Deed works (DCC)", riderTakes: "an extra effect on a hit takes hold", critEffect: "a critical hit's effect",
  fumble: "someone fumbles", fumbleEffect: "a fumble's effect", spellFails: "a spell fails", spellLost: "a spell is lost (DCC)", disapproval: "a cleric's god disapproves (DCC)", boost: "someone burns luck", boostFor: "someone burns luck for another",
  fateSelf: "someone spends fate to cheat death", fateFor: "someone spends fate to save another", bodyAlive: "rolling the body: alive after all (DCC)", bodyDead: "rolling the body: truly dead (DCC)", reactHit: "a reaction to being hit",
  reactAttacked: "a reaction to being attacked", reactMissed: "a reaction to a miss", reactDamaged: "a reaction to damage", counterTakes: "a counter works", counterFails: "a counter fails", summonOne: "someone summons a creature",
  summonMany: "someone summons several creatures", vanish: "a summoned creature vanishes", mercy: "someone shows mercy", shakeOff: "someone shakes off an effect", controlImmune: "a control effect can't touch its target",
  theftSuccess: "someone steals something", theftEmpty: "a thief comes away empty-handed", feintMiss: "a thief's feint misses", theftFeint: "someone feints, then steals", theftCaught: "a thief is caught", reclaim: "someone gets back what was taken",
  dealStruck: "the end: a deal is struck", backedOff: "the end: the other side backs off", surrender: "someone surrenders", swayFlee: "someone is talked into fleeing", switch: "someone switches sides", recruit: "someone is won over and joins",
  standAside: "someone is talked into standing aside", standAsideAgain: "someone stands aside again", nearlyTurns: "someone taking no side nearly turns on a side", watchNeutral: "someone taking no side watches",
  offended: "someone taking no side is offended", offendedHurt: "someone taking no side is offended: they were hurt", offendedVictim: "someone taking no side is offended on someone's behalf", offendedRobbed: "someone taking no side is offended: robbed",
  offendedInsulted: "someone taking no side is offended: insulted", truce: "a truce with someone taking no side", truceVictim: "a truce over a victim", amends: "someone makes amends", holdsBack: "someone holds back", feud: "a quarrel with someone taking no side",
  meddle: "someone taking no side speaks up for a side", meddleExtort: "someone taking no side squeezes a side", aloof: "someone keeps out of it", peacekeep: "someone tries to calm things down", calmed: "someone is calmed down",
  lapse: "someone lets the matter drop", persistent: "persistent damage", afflictionSaveFail: "a save against an affliction fails", afflictionSavePass: "a save against an affliction succeeds", opportunity: "an attack of opportunity",
  disengage: "someone disengages", thoughtTwo: "a moment of thought: two desires", thoughtOne: "a moment of thought: one desire", moveDoor: "someone heads for a door", doorOpen: "someone opens a door", doorForced: "someone forces a door",
  doorForcedFail: "someone fails to force a door", doorPicked: "someone picks a lock", doorPickedFail: "someone fails to pick a lock", doorSmashed: "someone smashes a door", doorHit: "someone hits a door", doorMiss: "someone misses a door",
  doorGiveUp: "someone gives up on a door", moveTend: "someone goes to tend a fallen ally", riderSavePass: "a save against an extra effect succeeds", afflictionStage: "an affliction worsens", afflictionEnd: "an affliction runs its course",
  coverDuck: "someone ducks behind cover", coverShoot: "someone shoots from cover", step: "someone steps carefully away", victory: "the end: the winners", victoryOne: "the end: the one winner", lastStanding: "the end: only someone taking no side stands",
  noOne: "the end: no one is left standing", stalemate: "the end: a stalemate"
};
const DAMAGE_TYPES = ["bludgeoning", "piercing", "slashing", "fire", "cold", "electricity", "acid", "sonic", "force", "vitality", "void", "poison", "bleed", "mental", "spirit", "untyped"];
for ( const t of DAMAGE_TYPES ) PART[t] ??= `damage type: ${t}`;

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */
const HELPER = {
  pf2e: {
    Label: [W.planner, "the game system's name, as the planner shows it", "Short name"], FocusPoint: [W.makeItSo, "a Focus Point spent", "Short"], Surrendered: ["The condition FastFighting puts on a creature that surrenders (its name on the sheet)", "the condition's name", "Short"],
    Remains: [W.makeItSo, "the name of what's left of a creature ('Remains of Goblin')", "Short"], HeroPoints: ["The planner and the log", "the name of Hero Points", "Short"], Aid: [W.log, "the Aid action", "Short"], RecallKnowledge: [W.log, "the Recall Knowledge action", "Short"],
    "Settings.loreBoost.Name": [W.settings, "setting: how much a Lore-Collector gains from sizing up a foe", "Short label"], HeroPoint: [W.makeItSo, "one Hero Point spent", "Short"], TwoActions: [W.log, "an action taking two actions ('Elemental Blast, two actions')", "Short"],
    Exploited: [W.story, "a foe marked by Exploit Vulnerability, with the bonus", "Lower case"], Flustered: [W.story, "left flustered by Bon Mot", "Lower case"], Helpless: [W.story, "left helpless", "Lower case"], Aided: [W.story, "helped by Aid", "Lower case"], Hindered: [W.story, "hindered by a failed Aid", "Lower case"],
    "Recovery.Stable": [W.log, "a recovery check: stabilizes, unconscious", "Lower case"], "Lead.Commander": ["The planner: why a creature leads", "a Commander, with its tactics count", "Short"], "Reason.Mindless": ["The planner: why a trait is what it is", "mindless", "Short"],
    "Reason.Pc": ["The planner: why a trait is what it is", "a player character", "Short"], "Reason.Animal": ["The planner: why a trait is what it is", "animal instinct", "Short"], "Reason.Int": ["The planner: why a trait is what it is", "its Intelligence", "Short"],
    "Reason.Construct": ["The planner: why a trait is what it is", "a construct", "Short"], "Reason.Undead": ["The planner: why a trait is what it is", "undead", "Short"], "Reason.SelfPreservation": ["The planner: why a trait is what it is", "added: animal self-preservation", "Starts with ', '"],
    "Reason.Default": ["The planner: why a trait is what it is", "the default", "Short"], "Reason.Trait": ["The planner: why a trait is what it is", "one of its traits", "Short"], "Reason.Party": ["The planner: why a trait is what it is", "a member of the party", "Short"], "Reason.Summoned": ["The planner: why a trait is what it is", "summoned", "Short"],
    "Affliction.Name": ["The effect Make it So puts on the character sheet", "an affliction's name and stage", "Short"], "Affliction.Stage": ["The effect's description, on the character sheet", "the affliction's stage", "Short sentence"]
  },
  dnd5e: {
    PactSlot: [W.makeItSo, "a pact magic slot spent", "Short"], Surrendered: ["The condition FastFighting puts on a creature that surrenders", "the condition's name", "Short"],
    HeroicInspiration: ["The planner and the log", "Heroic Inspiration (2024 rules)", "Short"], Inspiration: ["The planner and the log", "Inspiration (2014 rules)", "One word"], "Settings.loreBoost.Name": [W.settings, "setting: how much a Lore-Collector gains from sizing up a foe", "Short label"],
    Passive: [W.log, "a passive skill as a DC ('passive Insight')", "Lower case"], Dodge: [W.log, "the Dodge action", "One word"], Dodging: [W.story, "the effect of dodging", "Lower case"], Reckless: [W.story, "the effect of Reckless Attack", "Lower case"],
    Surging: [W.story, "the effect of Action Surge", "Lower case"], KnockedProne: [W.story, "a hit knocks someone prone", "Lower case"], Shove: [W.log, "the Shove action", "One word"], OffHand: [W.log, "an off-hand attack ('Dagger (off hand)')", "Short"],
    MartialArts: [W.log, "a Martial Arts attack ('Unarmed Strike (Martial Arts)')", "Short"], Bolstered: [W.story, "a buff's effect with no name", "Lower case"], LegendaryResistance: [W.log, "Legendary Resistance, when the system doesn't name it", "Short"],
    Help: [W.log, "the Help action", "One word"], Helped: [W.story, "helped by the Help action", "Lower case"], Study: [W.log, "the Study action", "One word"], "Reason.Pc": ["The planner: why a trait is what it is", "a player character", "Short"],
    "Reason.Int": ["The planner: why a trait is what it is", "its Intelligence", "Short"], "Reason.Beast": ["The planner: why a trait is what it is", "a beast", "Short"], "Reason.BarelyThinks": ["The planner: why a trait is what it is", "barely thinks", "Short"],
    "Reason.WisSave": ["The planner: why a trait is what it is", "its Wisdom save", "Short"], "Reason.Construct": ["The planner: why a trait is what it is", "a construct", "Short"], "Reason.Typical": ["The planner: why a trait is what it is", "typical for it", "Short"],
    "Reason.Fiend": ["The planner: why a trait is what it is", "a fiend", "Short"], "Reason.Celestial": ["The planner: why a trait is what it is", "a celestial", "Short"], Hexed: [W.story, "cursed by Hex", "Lower case"], Marked: [W.story, "marked by Hunter's Mark", "Lower case"]
  },
  dcc: {
    Label: [W.planner, "the game system's name", "Short name"], LabelXcc: [W.planner, "the game system's name, with XCC on", "Short name"], Luck: ["The planner and the log", "Luck", "One word"], Spellburn: ["The planner and the log", "Spellburn", "One word"],
    IntelligenceCheck: [W.log, "an Intelligence check", "Short"], Personality: [W.log, "Personality (the stat talking uses)", "One word"], PickPockets: [W.log, "the Pick Pockets skill", "Short"], TurnUnholy: [W.log, "the Turn Unholy ability", "Short"],
    Surrendered: ["The status FastFighting puts on a creature that surrenders", "its name", "Short"], "Settings.loreBoost.Name": [W.settings, "setting: how much a Lore-Collector gains from sizing up a foe", "Short label"], Will: [W.log, "the Will save", "One word"],
    Reflex: [W.log, "the Reflex save", "One word"], Ac: [W.log, "armor class (abbreviation)", "Abbreviation"], Attack: [W.story, "attack rolls, in a rally's bonus ('+2 attack')", "Lower case"], Saves: [W.story, "saves, in a rally's bonus", "Lower case"],
    SpellCheck: [W.log, "a spell check", "Lower case"], Turned: [W.story, "turned by Turn Unholy", "Lower case"], TurnUnholyCheck: [W.log, "a Turn Unholy check", "Lower case"], Lawful: [W.log, "alignment: lawful", "One word"], Chaotic: [W.log, "alignment: chaotic", "One word"], Neutral: [W.log, "alignment: neutral", "One word"],
    "Deed.Trip": [W.log, "the trip deed", "Short"], "Deed.KnockedDown": [W.story, "knocked down by a deed", "Lower case"], "Deed.Blind": [W.log, "the blinding deed", "Short"], "Deed.Disarm": [W.log, "the disarming deed", "Short"], "Deed.Disarmed": [W.story, "disarmed", "Lower case"],
    "Deed.Defend": [W.log, "the defensive deed", "Short"], "Deed.Rally": [W.log, "the rallying deed", "Short"], "Deed.ThrownDown": [W.story, "thrown down by a deed", "Lower case"], "Deed.Blinded": [W.story, "blinded by a deed", "Lower case"],
    "Deed.Ac": [W.story, "a defensive deed's AC bonus ('+1 AC')", "Short"], "Deed.Dazzled": [W.story, "dazzled, with the penalties", "Lower case"], "Deed.Rallied": [W.story, "rallied, with the bonuses", "Lower case"], "Deed.Lent": [W.story, "one bonus a rally lends ('+2 attack')", "Keep both"],
    "Reason.Zero": ["The planner: why a trait is what it is", "a 0-level character", "Short"], "Reason.Pc": ["The planner: why a trait is what it is", "a player character", "Short"], "Reason.Typical": ["The planner: why a trait is what it is", "typical for it", "Short"],
    "Reason.Int": ["The planner: why a trait is what it is", "its Intelligence", "Short"], "Reason.Beast": ["The planner: why a trait is what it is", "a beast", "Short"], "Reason.BarelyThinks": ["The planner: why a trait is what it is", "barely thinks", "Short"],
    "Reason.Caster": ["The planner: why a trait is what it is", "a spellcaster", "Short"], "Reason.WillSave": ["The planner: why a trait is what it is", "its Will save", "Short"], "Ability.str": [W.log, "Strength", "One word"], "Ability.agl": [W.log, "Agility", "One word"], "Ability.sta": [W.log, "Stamina", "One word"],
    "Out.Unconscious": [W.makeItSo, "unconscious", "Short"], "Out.Luck": [W.makeItSo, "Luck burned", "Short"],
    "Out.Disapproval": [W.makeItSo, "a cleric's disapproval range after the fight", "Short"]
  },
  ironsworn: {
    Label: [W.planner, "the game system's name", "Short name"], Momentum: ["The planner and the log", "Momentum", "One word"], CompelHeart: [W.log, "Compel, with heart", "Short"], CompelIron: [W.log, "Compel, with iron", "Short"], CompelShadow: [W.log, "Compel, with shadow", "Short"],
    Compel: [W.log, "the Compel move", "One word"], Rank: ["The planner", "a foe's rank", "Lower case"], Heart: ["The planner", "the heart stat", "Lower case"], "Settings.rulesPreference.Name": [W.settings, "setting: which ruleset's moves to prefer", "Short label"],
    "Settings.rulesPreference.classic": [W.settings, "choice: prefer Ironsworn's moves", "Short"], "Settings.rulesPreference.starforged": [W.settings, "choice: prefer Starforged's moves", "Short"], "Settings.loreBoost.Name": [W.settings, "setting: how much a Lore-Collector gains from sizing up a foe", "Short label"],
    AtRange: [W.log, "an attack made at range", "Starts with a space, in brackets"], Attack: [W.log, "an attack", "One word"], MomentumChange: [W.log, "a change in momentum", "Starts with ', '"], TheRoll: [W.log, "the roll, when it has no name", "Lower case"],
    "Endure.Press": [W.log, "Endure Harm: presses on", "Lower case"], "Endure.Reels": [W.log, "Endure Harm: reels, losing momentum", "Lower case"], "Move.Strike": [W.log, "the Strike move", "Move name"], "Move.Clash": [W.log, "the Clash move", "Move name"], "Move.GainGround": [W.log, "the Gain Ground move", "Move name"],
    "Move.EndureHarm": [W.log, "the Endure Harm move", "Move name"], "Move.FaceDeath": [W.log, "the Face Death move", "Move name"], "Control.hasinitiative": [W.log, "a character has the initiative (Ironsworn)", "Lower case"], "Control.losesinitiative": [W.log, "a character loses the initiative", "Lower case"],
    "Stat.edge": [W.log, "the edge stat", "Lower case"], "Stat.heart": [W.log, "the heart stat", "Lower case"], "Stat.iron": [W.log, "the iron stat", "Lower case"], "Stat.shadow": [W.log, "the shadow stat", "Lower case"], "Stat.wits": [W.log, "the wits stat", "Lower case"],
    "Nature.people": ["The planner", "a foe's nature: people", "Lower case"], "Nature.firstborn": ["The planner", "a foe's nature: firstborn", "Lower case"], "Nature.animal": ["The planner", "a foe's nature: animal", "Lower case"], "Nature.beast": ["The planner", "a foe's nature: beast", "Lower case"],
    "Nature.horror": ["The planner", "a foe's nature: horror", "Lower case"], "Nature.machine": ["The planner", "a foe's nature: machine", "Lower case"], "Reason.Rank": ["The planner: why a trait is what it is", "its nature and rank", "Short"],
    "Out.Health": [W.makeItSo, "health from → to", "Short"], "Out.Momentum": [W.makeItSo, "momentum from → to", "Short"], "Out.Burned": [W.makeItSo, "momentum burned so many times", "Starts with a space, in brackets"], "Out.Wounded": [W.makeItSo, "wounded", "One word"],
    "Out.Dies": [W.makeItSo, "a player character dies (capitals in the proposal)", "Short"], "Out.Cold": [W.makeItSo, "out cold", "Short"], "Out.Surrenders": [W.makeItSo, "surrenders", "One word"], "Out.StandsDown": [W.makeItSo, "stands down", "Short"],
    "Gives.Momentum": [W.log, "momentum a hit gives ('+1 momentum')", "Short"], "Lead.Heart": ["The planner: why a character leads", "its heart", "Short"], "Lead.Rank": ["The planner: why a creature leads", "its rank", "Short"]
  }
};

/* -------------------------------------------- */
/*  Describing one string                       */
/* -------------------------------------------- */
function describe(repo, key, value) {
  const rel = key.split(".").slice(1).join(".");
  const [group, ...rest] = rel.split(".");
  const sub = rest.join(".");
  if ( repo !== "core" ) {
    const d = HELPER[repo][rel];
    if ( d ) return { area: `${repo}: ${rest.length ? group : "General"}`, where: d[0], what: d[1], limits: d[2] };
    // System words this module stands in for (5e skills, conditions, coins; PF2e actions and features; DCC conditions and told words).
    if ( group === "Skill" ) return { area: `${repo}: Skill`, where: "The log and the stories, where the system has no word", what: `a skill's name (${sub})`, limits: "The skill's name" };
    if ( group === "Cond" ) return { area: `${repo}: Cond`, where: "The stories and Make it So, where the system has no word", what: `a condition's name (${sub})`, limits: "Lower case" };
    if ( group === "Coin" ) return { area: `${repo}: Coin`, where: "Money in the log and the stories", what: `a coin's abbreviation (${sub})`, limits: "Abbreviation" };
    if ( group === "Action" ) return { area: `${repo}: Action`, where: "The log, where the system has no name for it", what: `the ${sub} action`, limits: "The action's name" };
    if ( group === "Feature" ) return { area: `${repo}: Feature`, where: "The log, where the character's item has no name", what: `the ${sub.replace(/-/g, " ")} feature`, limits: "The feature's name" };
    if ( group === "Told" ) return { area: "dcc: Told", where: W.story, what: `a condition a spell or deed leaves: ${sub}`, limits: "Lower case" };
    if ( group === "Mods" ) {
      const m = { attack: "a bonus or penalty to attacks", ac: "to AC", saves: "to saves", damage: "to damage", Hampered: "hampered, with the penalties", Bolstered: "bolstered, with the bonuses" }[sub];
      return { area: "dcc: Mods", where: W.story, what: m, limits: "Lower case" };
    }
    if ( group === "Worded" ) return { area: "dnd5e: Worded", where: W.story, what: `how a creature is left by the condition '${sub}'`, limits: "Lower case" };
    if ( group === "Move" ) return { area: "ironsworn: Move", where: W.log, what: `a move's name: ${sub}`, limits: "Move name" };
    if ( group === "Lead" ) return { area: `${repo}: Lead`, where: "The planner: why a creature leads", what: sub, limits: "Short" };
    return null;
  }
  // Core.
  const setOpt = (g, meaning) => ({ area: `Choices: ${g}`, where: W.settingOption, what: meaning, limits: "Short choice" });
  switch ( group ) {
    case "Units": return sub === "Feet" ? { area: "Words", where: "Distances everywhere, when the scene names no units", what: "the abbreviation for feet", limits: "Abbreviation" }
      : { area: "Words", where: "Distances everywhere", what: "how a distance is written: number and unit", limits: "Keep both, in your order" };
    case "Words": return {
      List: { area: "Words", where: "Lists of names everywhere ('Amiri, Ezren and Lini')", what: "join the last name to the rest", limits: "Keep both" },
      ListSeparator: { area: "Words", where: "Lists of names everywhere", what: "between names in a list", limits: "Punctuation (a comma and a space)" },
      Luck: { area: "Words", where: W.story, what: "a luck resource, when the system doesn't name it", limits: "Lower case, one word" },
      Fate: { area: "Words", where: "The log and the stories", what: "a fate resource (like Hero Points), when the system doesn't name it", limits: "Lower case, one word" }
    }[sub];
    case "Generic": {
      if ( sub.startsWith("Path.") ) return { area: "Generic system", where: "Generic system data paths dialog (GM)", what: `field label: where the actor keeps its ${{ hp: "current HP", hpMax: "maximum HP", attack: "attack bonus", damage: "damage formula", level: "level", initiative: "initiative modifier" }[rest[1]]}`, limits: "Short label" };
      return { Attack: { area: "Generic system", where: W.generic, what: "the one attack the generic system gives every creature", limits: "One word" },
        MenuLabel: { area: "Generic system", where: W.settings, what: "button that opens the generic data paths dialog", limits: "Button, one word" },
        DefaultReason: { area: "Generic system", where: "The planner: why a trait is what it is", what: "the generic system's default", limits: "Short" },
        Persuasion: { area: "Generic system", where: W.log, what: "the skill the generic system talks with: persuading", limits: "A skill's name" },
        Intimidation: { area: "Generic system", where: W.log, what: "the skill for intimidating", limits: "A skill's name" } }[sub];
    }
    case "Settings": return { area: "Settings", where: W.settings, what: sub === "sideDefaults.Label" ? "button that opens the side defaults dialog" : `the setting's name: ${SETTING[rest[0]]}`, limits: sub.endsWith("Label") ? "Button, one word" : "Short label, one line" };
    case "Lean": return setOpt(`${group}`, "fights everyone (a side of its own)");
    case "Downed": return setOpt("Downed", "dropping to 0 HP is death");
    case "HealAggro": return setOpt("Healing", { conservative: "heals others only when needed", balanced: "heals when it's worth it", aggressive: "heals readily" }[sub]);
    case "AllyDying": return setOpt("Ally dying", { rescue: "rescue them", fight: "keep fighting", retreat: "retreat", protectSelf: "protect yourself" }[sub]);
    case "Surprise": return setOpt("Initiative", { none: "roll initiative normally, no surprise", tracker: "use the Combat Tracker's initiative", friendly: "the party surprises the enemy", hostile: "the enemy surprises the party" }[sub]);
    case "Loot": return setOpt("Loot", "do nothing with the dead's belongings");
    case "Corpse": return setOpt("Corpses", "remove a dead creature's token");
    case "Fled": return setOpt("Fled", "hide the token of a creature that fled");
    case "Side": return { area: "Sides", where: "The planner's side tabs, the results and the stories", what: SIDE[sub], limits: "Short name" };
    case "Trait": return { area: "Personality", where: "The planner and the defaults dialog (GM)", what: `the personality trait '${sub}'`, limits: "One word" };
    case "Band": return { area: "Personality", where: "The planner: a trait's value in words (GM)", what: BAND[sub], limits: "One word" };
    case "Stat": return { area: "Planner", where: W.plannerRoster, what: STAT[sub], limits: "Short label" };
    case "Kind": return { area: "Planner", where: W.plannerRoster, what: KIND[sub], limits: "Very short badge" };
    case "Mode": return { area: "Planner", where: "Battle Planner: how a creature reaches its foe ('Walks 30 ft to reach Goblin')", what: MODE[sub], limits: "Verb, capitalized" };
    case "Status": return { area: "Status", where: "The sample fight and the stories", what: STATUS[sub], limits: "Short" };
    case "Difficulty": return { area: "Results", where: W.results, what: `the simulated difficulty: ${DIFF[sub]} of five`, limits: "One word" };
    case "Fudge": return { area: "Planner", where: "Battle Planner: tooltips on the fudge buttons (GM)", what: { Up: "raise this value", Down: "lower this value", Remove: "clear the adjustment" }[sub], limits: "Short tooltip" };
    case "Defaults": return { area: "Defaults", where: W.defaults, what: "button: restore the defaults", limits: "Button, short" };
    case "Planner": { const d = PLANNER[sub]; return d && { area: "Planner", where: sub.startsWith("Role") ? W.plannerSide : W.planner, what: d[0], limits: d[1] }; }
    case "Results": return RESULTS[sub] && { area: "Results", where: W.results, what: RESULTS[sub], limits: sub.startsWith("Tab") ? "Tab label, short" : "Short" };
    case "Swing": return { area: "Results", where: "Battle Planner: Results → Swing factors (GM)", what: { Without: "the fight without one creature", NoLeadership: "the fight without leadership", NoMorale: "the fight without morale" }[sub], limits: "Short" };
    case "Sample": return SAMPLE[sub] && { area: "Sample fight", where: W.sample, what: SAMPLE[sub], limits: "Short" };
    case "MakeItSo": {
      if ( sub === "Moves" ) return { area: "Make it So", where: W.makeItSo, what: "a token moves so far", limits: "Short" };
      if ( sub === "Receives" ) return { area: "Make it So", where: W.makeItSo, what: "gets something from someone (a payment, a bribe)", limits: "Short" };
      if ( sub === "Stolen" ) return { area: "Make it So", where: W.makeItSo, what: "something of this creature's was stolen by someone", limits: "Short" };
      if ( sub === "Steals" ) return { area: "Make it So", where: W.makeItSo, what: "this creature steals something from someone", limits: "Short" };
      const k = rest[1];
      return OUTCOME[k] && { area: "Make it So", where: W.makeItSo, what: OUTCOME[k], limits: "Short" };
    }
    case "Tactics": { const d = TACTICS[sub]; return d && { area: "Tactics survey", where: W.survey, what: d[0], limits: d[1] }; }
    case "Survey": return SURVEY[sub] && { area: "Tactics survey", where: W.survey, what: SURVEY[sub], limits: "Short" };
    case "Playstyle":
      if ( sub === "Label" ) return { area: "Playstyles", where: W.survey, what: "heading: the character's playstyles", limits: "Short heading" };
      if ( sub === "Count" ) return { area: "Playstyles", where: W.survey, what: "how many playstyles are chosen, of the most allowed", limits: "Short" };
      if ( sub === "NpcTitle" ) return { area: "Playstyles", where: W.planner, what: "heading: playstyles the GM gives an NPC", limits: "Short heading" };
      return { area: "Playstyles", where: W.survey, what: `the name of the playstyle '${rest[0]}'`, limits: "One or two words" };
    case "Story": {
      if ( rest[0] === "Part" ) return { area: "Story table names", where: W.tables, what: PART[rest[1]], limits: "Short, title case" };
      if ( rest[0] === "Labels" ) return { area: "Standard story", where: W.standard, what: LABELS[rest[1]], limits: "Lower case" };
      const d = STORY_MISC[sub];
      return d && { area: "Story", where: sub === "Desire" || sub === "Themselves" || sub === "APrice" ? W.storyWord : sub.startsWith("Tables") || sub === "Reinstall" ? "Story tables dialog (GM)" : W.story, what: d[0], limits: d[1] };
    }
    case "Helper":
      if ( rest[0] === "Module" ) return { area: "Helper notice", where: W.helper, what: `the name of FastFighting's module for ${rest[1]}`, limits: "A module's name" };
      return { area: "Helper notice", where: W.helper, what: { ok: "the system is supported", ListLink: "link to the list of supported systems" }[sub], limits: "Short" };
    case "Desire": { const d = DESIRE[sub]; return d && { area: "Tactics survey", where: W.survey, what: d[0], limits: d[1] }; }
    case "Summary": return { area: "Make it So", where: W.summary, what: SUMMARY[sub], limits: "Short" };
    case "Log": { const d = LOG[sub]; return d && { area: "Battle log", where: W.log, what: d[0], limits: d[1].charAt(0).toUpperCase() + d[1].slice(1) }; }
    case "DamageType": { const d = DAMAGE(sub); return { area: "Damage types", where: W.log, what: d[0], limits: "Lower case" }; }
    case "Effect": return { area: "Effects", where: "The stories and Make it So ('is hastened')", what: `how bonuses or penalties leave a creature: ${EFFECT[sub]}`, limits: "Lower case, one word" };
  }
  return null;
}

/* -------------------------------------------- */
/*  The CSV                                     */
/* -------------------------------------------- */
const MODULES = { core: "Core", pf2e: "PF2e", dnd5e: "D&D 5e", dcc: "DCC", ironsworn: "Ironsworn" };

/** A CSV's rows as arrays (RFC 4180: quoted fields, doubled quotes, line breaks inside quotes). */
function parseCsv(text) {
  const out = [];
  let row = [], field = "", quoted = false;
  for ( let i = 0; i < text.length; i++ ) {
    const c = text[i];
    if ( quoted ) {
      if ( c !== "\"" ) field += c;
      else if ( text[i + 1] === "\"" ) { field += "\""; i++; }
      else quoted = false;
    }
    else if ( c === "\"" ) quoted = true;
    else if ( c === "," ) { row.push(field); field = ""; }
    else if ( c === "\n" ) { row.push(field); out.push(row); row = []; field = ""; }
    else if ( c !== "\r" ) field += c;
  }
  if ( field || row.length ) { row.push(field); out.push(row); }
  return out;
}

// The strings the author already answered in an earlier batch ("Module|Key").
const args = process.argv.slice(2);
const answered = new Set();
for ( let i = args.indexOf("--skip"); i >= 0; i = args.indexOf("--skip", i + 1) ) {
  const [head, ...body] = parseCsv(readFileSync(args[i + 1], "utf8").replace(/^\uFEFF/, ""));
  const col = name => head.indexOf(name);
  for ( const r of body ) if ( (r[col("Yours")] ?? "").trim() ) answered.add(`${r[col("Module")]}|${r[col("Key")]}`);
}
const outFile = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--skip");

const rows = [];
const missing = [];
for ( const [repo, dir] of Object.entries(REPOS) ) {
  const en = flat(JSON.parse(readFileSync(join(ROOT, dir, "languages/en.json"), "utf8")));
  for ( const [key, value] of Object.entries(en) ) {
    if ( words(value) > 2 || marks(value).length > 2 ) continue;
    if ( answered.has(`${MODULES[repo]}|${key}`) ) continue;
    const d = describe(repo, key, value);
    if ( !d?.what ) { missing.push(`${repo} ${key} ${JSON.stringify(value)}`); continue; }
    const notes = [d.limits];
    if ( marks(value).length ) notes.push(`keep ${marks(value).join(" ")}`);
    if ( /^\s/.test(value) && !/start/i.test(d.limits) ) notes.push("starts with a space");
    if ( /\s$/.test(value) && !/end/i.test(d.limits) ) notes.push("ends with a space");
    rows.push({ repo, key, ...d, limits: notes.join("; "), value });
  }
}
if ( missing.length ) { console.error(`No description for ${missing.length}:\n${missing.join("\n")}`); process.exit(1); }

// The order a GM meets them: core's windows and settings, its words, the story's tables, then each helper.
const ORDER = ["Settings", "Choices", "Generic system", "Defaults", "Sides", "Personality", "Planner", "Results", "Sample fight", "Status", "Make it So", "Tactics survey", "Playstyles", "Helper notice", "Words", "Effects", "Damage types", "Standard story", "Story", "Battle log", "Story table names"];
const rank = r => (r.repo === "core" ? ORDER.findIndex(a => r.area.startsWith(a)) : 100 + Object.keys(REPOS).indexOf(r.repo));
rows.sort((a, b) => rank(a) - rank(b));

const cell = v => `"${String(v).replace(/"/g, "\"\"")}"`;
const PREFIX = { core: "FASTFIGHTING", pf2e: "FFPF2E", dnd5e: "FFDND5E", dcc: "FFDCC", ironsworn: "FFIRONSWORN" };
const lines = [["#", "Module", "Area", "Key", "Where it shows", "What it must say", "Limits", "Proposed", "Yours"].map(cell).join(",")];
rows.forEach((r, i) => {
  const module = MODULES[r.repo];
  // The proposal in quotes, so spaces at either end show and Excel never reads it as a formula.
  lines.push([i + 1, module, r.area.replace(/^\w+: /, ""), r.key, r.where, r.what, r.limits, `"${r.value}"`, ""].map(cell).join(","));
});
writeFileSync(outFile ?? join(HERE, "short-strings.csv"), `\uFEFF${lines.join("\r\n")}\r\n`);
console.log(`${rows.length} strings written`);
