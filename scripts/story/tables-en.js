/**
 * English story tables. Every table is a list of 5 entries; the story writer rolls one entry from the table
 * that matches each event, then (for attacks and talks) appends a roll from the matching relationship table.
 *
 * Table keys (also the names of the RollTables installed into a world, see story/tables.js):
 *   action.<delivery>.<damageType>.<tier>     delivery: melee | ranged | spell
 *   talk.<skill>.<tier>                       skill: diplomacy | intimidation | deception
 *   relationship.<kind>.<polarity>            kind: none | enemyLeader | talkingNemesis | grudge | avenger |
 *                                                   protector | finishing | rival      polarity: success | failure
 *   move.<mode>.<situation>                   mode: walk | fly | swim | climb | burrow
 *                                             situation: approach | terrain | flee | hunt | help
 *   event.<name>                              everything else (falls, heals, notices, surrenders, ...)
 *
 * Placeholders: {actor} {target} {weapon} {damage} {region} {by} {stage} {affliction}
 * Entries never use gendered pronouns.
 */

export const TIERS = ["criticalSuccess", "majorSuccess", "success", "minorSuccess", "minorFailure", "failure", "majorFailure", "criticalFailure"];
export const DELIVERIES = ["melee", "ranged", "spell"];
export const DAMAGE_TYPES = ["bludgeoning", "piercing", "slashing", "fire", "cold", "electricity", "acid", "sonic", "force", "vitality", "void", "poison", "bleed", "mental", "spirit", "untyped"];
export const TALK_SKILLS = ["diplomacy", "intimidation", "deception"];
export const RELATIONSHIPS = ["none", "enemyLeader", "talkingNemesis", "grudge", "avenger", "protector", "finishing", "rival"];
export const MOVE_MODES = ["walk", "fly", "swim", "climb", "burrow"];
export const MOVE_SITUATIONS = ["approach", "terrain", "flee", "hunt", "help"];

/** Imagery for each damage type: what a hit does, what a graze looks like, a miss, a crit, a botch. */
const TYPE = {
  bludgeoning: {
    hit: ["slams into", "crashes against", "hammers", "batters", "pounds"],
    wound: ["something cracks", "the breath leaves {target} in a rush", "{target} staggers under the weight of it", "the blow rattles teeth", "bone groans under the impact"],
    graze: ["glances off", "thumps against", "clips", "knocks against", "bumps"],
    miss: ["thuds into empty ground", "whooshes past", "swings through nothing", "cracks against stone instead", "misses by a hair's breadth"],
    crit: ["folds {target} in half", "sends {target} reeling like a rag doll", "lands with a sickening crunch", "rings {target} like a bell", "flattens {target}'s guard and more"],
    botch: ["overbalances and nearly falls", "jars their own arms to the shoulder", "loses their grip for a heartbeat", "spins around off-balance", "stumbles into the swing's own momentum"]
  },
  piercing: {
    hit: ["punches into", "drives into", "stabs", "spears", "skewers"],
    wound: ["the point sinks deep", "blood beads around the wound", "{target} gasps at the bite of it", "it sticks fast for a moment", "a dark stain spreads"],
    graze: ["pricks", "scratches", "nicks", "catches the edge of", "just finds"],
    miss: ["darts past", "skitters off armor", "finds only cloth", "hisses by", "buries itself harmlessly nearby"],
    crit: ["finds the gap between plates", "pins {target} like a specimen", "drives clean through", "strikes somewhere vital", "punctures straight to the bone"],
    botch: ["snags and nearly wrenches free of their hand", "jabs wildly at nothing", "loses the point in a crack in the floor", "fumbles the angle completely", "pitches forward after the thrust"]
  },
  slashing: {
    hit: ["carves into", "slices across", "cleaves at", "rakes", "opens a gash on"],
    wound: ["a long red line opens", "cloth and skin part together", "blood wells up at once", "{target} hisses as the edge bites", "a ragged cut appears"],
    graze: ["nicks", "draws a thin line across", "shaves past", "scores", "lightly kisses"],
    miss: ["whistles through empty air", "bites only air", "skips off a guard", "sweeps short", "carves a shallow arc through nothing"],
    crit: ["nearly cuts {target} in two", "lays {target} open", "draws a spray of red in a wide arc", "carves deep enough to leave a lifelong scar", "hews through guard and flesh alike"],
    botch: ["overswings and stumbles", "buries the edge in the ground", "nearly loses the weapon mid-swing", "spins half around", "cuts a clumsy arc that leaves an opening"]
  },
  fire: {
    hit: ["engulfs", "scorches", "sears", "sets alight", "washes over"],
    wound: ["the smell of singed hair fills the air", "skin blisters and blackens", "{target} beats at the flames", "smoke curls from scorched clothing", "embers dance off {target}"],
    graze: ["singes", "licks at", "warms", "flickers across", "brushes"],
    miss: ["roars past in a gout of heat", "splashes harmlessly against the ground", "gutters out short", "flares wide", "burns a black mark beside {target}"],
    crit: ["turns {target} into a living torch", "explodes against {target} in a ball of flame", "chars {target} to the core", "leaves {target} wreathed in fire", "burns so bright everyone looks away"],
    botch: ["sputters and dies in a puff of smoke", "flares back toward the caster", "fizzles into harmless sparks", "scorches the caster's own sleeve", "wobbles off into the sky"]
  },
  cold: {
    hit: ["frosts over", "bites into", "freezes", "rimes", "chills"],
    wound: ["ice crackles across {target}'s skin", "breath fogs in sudden cold", "{target}'s limbs stiffen", "frost blooms on armor", "fingers go numb and white"],
    graze: ["nips at", "frosts the edge of", "brushes coldly across", "puffs a chill over", "touches"],
    miss: ["leaves a sheet of frost on the ground", "hisses past in a cloud of rime", "shatters into harmless sleet", "chills only the air", "frosts the nearest wall instead"],
    crit: ["encases {target} in ice", "freezes {target} solid for a heartbeat", "cracks like a glacier against {target}", "leaves {target} rimed and shaking", "steals every scrap of warmth from {target}"],
    botch: ["dissipates into a light snowfall", "frosts the caster's own fingers", "cracks apart in midair", "melts away before it lands", "drifts aside as harmless mist"]
  },
  electricity: {
    hit: ["jolts", "arcs into", "crackles through", "shocks", "strikes"],
    wound: ["{target}'s muscles lock up", "hair stands on end", "the smell of ozone hangs heavy", "{target} jerks like a puppet", "sparks dance over metal"],
    graze: ["tingles across", "sparks against", "snaps at", "crackles near", "buzzes over"],
    miss: ["forks into the ground", "earths itself harmlessly", "snaps past with a crack of thunder", "dances away along a wall", "fizzles out in a spray of sparks"],
    crit: ["lights {target} up from within", "slams {target} with a thunderclap", "leaves {target} smoking and twitching", "arcs through every buckle and nail", "blasts {target} off their feet"],
    botch: ["sparks wildly and goes nowhere", "jolts the caster's own arm", "crackles into a harmless glow", "grounds out at their feet", "pops like a soap bubble"]
  },
  acid: {
    hit: ["splashes over", "eats into", "spatters", "drenches", "burns into"],
    wound: ["armor hisses and pits", "{target} cries out as it bites", "smoke rises from the wound", "the stench is eye-watering", "skin bubbles and peels"],
    graze: ["flecks", "spits across", "speckles", "dribbles over", "touches"],
    miss: ["sizzles into the dirt", "eats a hole in the floor", "splashes wide", "hisses harmlessly away", "pits a nearby stone"],
    crit: ["coats {target} completely", "melts straight through {target}'s defenses", "eats deep with a horrible hiss", "drenches {target} in caustic ruin", "leaves {target} scarred and steaming"],
    botch: ["splatters everywhere but the target", "spits back toward the caster", "dribbles out weakly", "fizzes to nothing", "burns a hole in the caster's own pack"]
  },
  sonic: {
    hit: ["booms against", "shrieks into", "shakes", "rattles", "thunders into"],
    wound: ["{target}'s ears ring", "teeth buzz in {target}'s skull", "{target} staggers, dazed", "dust shakes loose all around", "the air itself shudders"],
    graze: ["hums against", "buzzes past", "rings off", "thrums near", "whines across"],
    miss: ["echoes off the walls", "rolls away like distant thunder", "shatters a pebble instead", "booms into the empty air", "fades into a dull ringing"],
    crit: ["bursts against {target} like a thunderclap", "rattles {target} to the bones", "leaves {target} bleeding from the ears", "rings out so loud everyone flinches", "shatters {target}'s balance completely"],
    botch: ["comes out as a feeble squeak", "echoes back on the caster", "warbles off key", "dies into silence", "rattles the caster's own teeth"]
  },
  force: {
    hit: ["slams into", "batters", "strikes", "crashes against", "drives into"],
    wound: ["{target} reels from the unseen blow", "the air ripples with the impact", "{target} is shoved back a step", "a sound like a struck drum rings out", "{target} grunts at the pressure"],
    graze: ["pushes at", "jostles", "presses against", "nudges", "buffets"],
    miss: ["ripples harmlessly past", "dissipates in a shimmer", "strikes the ground with a dull thump", "bends away", "flickers out"],
    crit: ["hurls {target} backward", "hammers {target} with invisible fists", "crumples {target}'s guard", "slams {target} down hard", "punches straight through {target}'s defenses"],
    botch: ["unravels into motes of light", "bounces back toward the caster", "fizzles into a shimmer", "wobbles off course", "pops harmlessly"]
  },
  vitality: {
    hit: ["sears", "blazes into", "burns", "floods", "scours"],
    wound: ["{target} recoils from the living light", "{target}'s unnatural flesh smokes", "a radiant glow clings to {target}", "{target} shrieks at the touch of life", "the light burns away shadows"],
    graze: ["glows against", "brushes", "warms", "flickers over", "tingles across"],
    miss: ["blooms harmlessly in the air", "fades like dawn mist", "washes past", "glimmers away", "lights the ground instead"],
    crit: ["bathes {target} in searing radiance", "burns {target} like the noon sun", "blazes through {target}", "leaves {target} smoking and howling", "scours {target} with pure life"],
    botch: ["sputters into a weak glow", "lights the caster up like a lantern", "fades before it lands", "scatters into sparkles", "dims to nothing"]
  },
  void: {
    hit: ["withers", "drains", "chills the life from", "rots", "saps"],
    wound: ["{target}'s skin grays and cracks", "warmth drains from {target}'s face", "{target} shudders as something vital slips away", "veins darken beneath {target}'s skin", "{target} ages a year in a heartbeat"],
    graze: ["brushes the life from", "dims", "touches", "chills", "grays the edge of"],
    miss: ["withers the grass instead", "fades into shadow", "seeps into the ground", "curls away like smoke", "rots a nearby beam"],
    crit: ["leaves {target} gaunt and hollow-eyed", "drinks deep of {target}'s life", "withers {target} almost to the bone", "wraps {target} in a shroud of decay", "steals the color from {target} entirely"],
    botch: ["drifts away as harmless shadow", "chills the caster's own hand", "dissolves into gloom", "sinks into the floor", "flickers and goes out"]
  },
  poison: {
    hit: ["poisons", "envenoms", "sickens", "taints", "seeps into"],
    wound: ["{target} retches", "{target}'s lips go blue", "a fever flush climbs {target}'s neck", "{target} sways, sickened", "veins darken around the wound"],
    graze: ["stings", "taints", "brushes", "barely touches", "dabs at"],
    miss: ["drips harmlessly", "misses by a hair", "beads on armor", "splashes away", "never finds skin"],
    crit: ["floods {target} with venom", "leaves {target} convulsing", "sends {target} reeling and gagging", "poisons {target} to the core", "turns {target} gray-green"],
    botch: ["dribbles out uselessly", "nearly envenoms the wielder", "goes stale and inert", "spills everywhere", "flakes away"]
  },
  bleed: {
    hit: ["opens", "tears", "rips", "lacerates", "cuts"],
    wound: ["blood flows freely", "the wound will not close", "red drips steadily", "{target} presses a hand to the wound", "{target} leaves a trail of blood"],
    graze: ["scratches", "nicks", "scrapes", "grazes", "scores"],
    miss: ["finds no purchase", "slides away", "draws nothing", "misses the mark", "tears only cloth"],
    crit: ["opens a wound that pours", "leaves {target} soaked in red", "tears something that won't stop bleeding", "draws a fountain of blood", "rips {target} open"],
    botch: ["catches on nothing", "misses wildly", "snags", "slips", "tears the wielder's own sleeve"]
  },
  mental: {
    hit: ["assaults the mind of", "rips through the thoughts of", "overwhelms", "twists the mind of", "stabs into the thoughts of"],
    wound: ["{target} clutches their head", "{target}'s eyes lose focus", "{target} screams at visions no one else sees", "{target}'s thoughts scatter", "blood trickles from {target}'s nose"],
    graze: ["unsettles", "whispers at", "brushes the mind of", "nags at", "flickers through"],
    miss: ["slides off an iron will", "finds only a locked mind", "echoes in an empty head", "dissolves into static", "breaks against {target}'s focus"],
    crit: ["shatters {target}'s concentration", "drops {target} into a waking nightmare", "turns {target}'s thoughts against them", "leaves {target} gibbering", "cracks {target}'s mind like an egg"],
    botch: ["rebounds into the caster's own head", "dissolves into confusion", "comes out as a jumble", "fizzles in a headache", "leaves the caster dizzy"]
  },
  spirit: {
    hit: ["strikes the soul of", "rends", "lashes the spirit of", "scours", "sears the essence of"],
    wound: ["{target}'s spirit shudders", "a ghostly light flares around {target}", "{target} feels something torn loose", "{target} gasps as their soul is touched", "shadows flee from {target}"],
    graze: ["brushes the spirit of", "touches", "flickers across", "chills", "stirs"],
    miss: ["passes through like a ghost", "fades with a sigh", "drifts away", "finds no soul to strike", "dissipates like breath on glass"],
    crit: ["tears at {target}'s very soul", "leaves {target} hollow and shaken", "rips {target}'s spirit half loose", "blazes through {target}'s essence", "silences something deep within {target}"],
    botch: ["drifts away like smoke", "unsettles the caster instead", "fades unheard", "slips away", "dims to nothing"]
  },
  untyped: {
    hit: ["strikes", "hits", "catches", "lands on", "connects with"],
    wound: ["{target} winces", "{target} grunts in pain", "{target} gives ground", "{target} reels", "{target} curses"],
    graze: ["clips", "brushes", "barely touches", "glances off", "nicks"],
    miss: ["misses", "goes wide", "falls short", "is turned aside", "finds nothing"],
    crit: ["lands perfectly", "strikes true and hard", "sends {target} sprawling", "hits exactly where it hurts", "connects with devastating force"],
    botch: ["goes badly wrong", "leaves an opening", "fumbles", "misfires", "falls apart"]
  }
};

/** How each delivery is described. */
const DELIVERY = {
  melee: { verb: ["swings", "lunges", "strikes", "slashes in", "drives forward"], aim: ["closes in", "presses the attack", "steps inside {target}'s guard", "feints, then strikes", "lunges"] },
  ranged: { verb: ["looses", "fires", "hurls", "lets fly", "throws"], aim: ["takes aim", "sights down the shaft", "steadies, then looses", "fires from cover", "snaps off a shot"] },
  spell: { verb: ["unleashes", "hurls", "calls down", "conjures", "casts"], aim: ["weaves the spell", "speaks the words", "traces the sigil", "gathers power", "lets the magic go"] }
};

/** Five sentence shapes per delivery and tier; {hit} {wound} {graze} {miss} {crit} {botch} come from the damage type. */
const SHAPES = {
  melee: {
    criticalSuccess: ["{actor} {aim} and their {weapon} {crit}!", "A perfect opening: {actor}'s {weapon} {crit}.", "{actor} roars, and their {weapon} {crit}; {wound}.", "{actor} moves like a storm; their {weapon} {crit}.", "Nothing could have stopped it: {actor}'s {weapon} {crit}."],
    majorSuccess: ["{actor}'s {weapon} {hit} {target} with room to spare; {wound}.", "{actor} {aim} and their {weapon} {hit} {target}; {wound}.", "{target} never sees it coming as {actor}'s {weapon} {hit} them; {wound}.", "{actor} batters past {target}'s guard; their {weapon} {hit} {target} hard; {wound}.", "With brutal ease {actor}'s {weapon} {hit} {target}; {wound}."],
    success: ["{actor}'s {weapon} {hit} {target}; {wound}.", "{actor} {aim}, and their {weapon} {hit} {target}.", "{actor}'s {weapon} {hit} {target} in a flurry; {wound}.", "{actor} finds an opening and their {weapon} {hit} {target}.", "{actor} trades blows with {target}, and their {weapon} {hit} {target}."],
    minorSuccess: ["{actor}'s {weapon} {graze} {target}, just enough to hurt.", "{target} twists away, but {actor}'s {weapon} {graze} them.", "Barely: {actor}'s {weapon} {graze} {target}.", "{actor} overreaches, but their {weapon} still {graze} {target}.", "By a finger's width, {actor}'s {weapon} {graze} {target}."],
    minorFailure: ["{actor}'s {weapon} {miss}; so close {target} feels the wind of it.", "{target} jerks back as {actor}'s {weapon} {miss}.", "Almost! {actor}'s {weapon} {miss}.", "{actor} lunges, and their {weapon} {miss} by inches.", "{target} parries at the last moment and {actor}'s {weapon} {miss}."],
    failure: ["{actor}'s {weapon} {miss}.", "{target} sidesteps, and {actor}'s {weapon} {miss}.", "{actor} swings, but their {weapon} {miss}.", "{target} turns the blow aside and {actor}'s {weapon} {miss}.", "{actor} presses in, but their {weapon} {miss}."],
    majorFailure: ["{actor} telegraphs it badly, and their {weapon} {miss}.", "{target} reads {actor} easily; the {weapon} {miss}.", "{actor} flails, and their {weapon} {miss}, nowhere near.", "{target} nearly laughs as {actor}'s {weapon} {miss}.", "Wildly off: {actor}'s {weapon} {miss}."],
    criticalFailure: ["{actor} {botch}.", "Disaster: {actor} {botch}.", "{actor}'s attack goes wrong and {actor} {botch}.", "{target} slips aside and {actor} {botch}.", "{actor} {botch}, wide open."]
  },
  ranged: {
    criticalSuccess: ["{actor} {aim}; their {weapon} {crit}!", "A perfect shot: {actor}'s {weapon} {crit}.", "From across the field {actor}'s {weapon} {crit}; {wound}.", "{actor} doesn't even seem to aim; their {weapon} {crit}.", "The shot of a lifetime: {actor}'s {weapon} {crit}."],
    majorSuccess: ["{actor}'s {weapon} {hit} {target} dead center; {wound}.", "{actor} {aim} and their {weapon} {hit} {target}; {wound}.", "{actor}'s {weapon} {hit} {target} before they can react; {wound}.", "Clean and true, {actor}'s {weapon} {hit} {target}; {wound}.", "{actor}'s {weapon} {hit} {target} square; {wound}."],
    success: ["{actor} {aim} and {weapon} {hit} {target}.", "{actor}'s {weapon} {hit} {target}; {wound}.", "{actor} looses; their {weapon} {hit} {target}.", "{actor}'s {weapon} {hit} {target} without warning.", "{actor} {aim}, and their {weapon} finds {target}."],
    minorSuccess: ["{actor}'s {weapon} {graze} {target}.", "{target} jinks aside, but {actor}'s {weapon} still {graze} them.", "Just barely, {actor}'s {weapon} {graze} {target}.", "{actor}'s hurried shot {graze} {target}.", "{actor}'s {weapon} {graze} {target}, more luck than skill."],
    minorFailure: ["{actor}'s {weapon} {miss}, a hand's breadth from {target}.", "{target} hears {actor}'s {weapon} as it {miss}.", "So close: {actor}'s {weapon} {miss}.", "{target} flinches as {actor}'s {weapon} {miss}.", "{actor} curses as their {weapon} {miss} by a whisker."],
    failure: ["{actor}'s {weapon} {miss}.", "{actor} looses, but their {weapon} {miss}.", "{target} moves at the last moment and {actor}'s {weapon} {miss}.", "{actor}'s {weapon} {miss}; {target} keeps coming.", "{actor} fires again; the {weapon} {miss}."],
    majorFailure: ["{actor}'s {weapon} {miss}, nowhere near {target}.", "A wild shot: {actor}'s {weapon} {miss}.", "{actor} rushes the shot, and their {weapon} {miss}.", "{actor}'s {weapon} {miss} by a mile.", "{target} doesn't even flinch as {actor}'s {weapon} {miss}."],
    criticalFailure: ["{actor} {botch}.", "{actor} fumbles the shot and {botch}.", "Disaster for {actor}, who {botch}.", "{actor}'s aim fails completely; {actor} {botch}.", "{actor} {botch}, to {target}'s delight."]
  },
  spell: {
    criticalSuccess: ["{actor} {aim}; their {weapon} {crit}!", "Power surges as {actor}'s {weapon} {crit}.", "{actor}'s {weapon} {crit}; {wound}.", "The air itself recoils as {actor}'s {weapon} {crit}.", "{actor} unleashes everything: their {weapon} {crit}."],
    majorSuccess: ["{actor}'s {weapon} {hit} {target} in full force; {wound}.", "{actor} {aim} and their {weapon} {hit} {target}; {wound}.", "{target} can't escape {actor}'s {weapon}, which {hit} them; {wound}.", "{actor}'s {weapon} {hit} {target}, who takes the full brunt; {wound}.", "{actor}'s {weapon} {hit} {target} squarely; {wound}."],
    success: ["{actor}'s {weapon} {hit} {target}.", "{actor} {aim}; their {weapon} {hit} {target}; {wound}.", "{actor} casts {weapon}, which {hit} {target}.", "{actor} finishes the incantation and {weapon} {hit} {target}.", "{actor}'s {weapon} {hit} {target}; {wound}."],
    minorSuccess: ["{target} twists aside, but {actor}'s {weapon} still {graze} them.", "{actor}'s {weapon} {graze} {target}, half its force spent.", "{target} braces against {actor}'s {weapon}, which only {graze} them.", "{actor}'s {weapon} {graze} {target} as they dive clear.", "Only partly: {actor}'s {weapon} {graze} {target}."],
    minorFailure: ["{target} throws off {actor}'s {weapon} at the last instant; it {miss}.", "{actor}'s {weapon} {miss}, a near thing.", "{target} shrugs free as {actor}'s {weapon} {miss}.", "{actor}'s {weapon} {miss}, barely.", "So close, but {actor}'s {weapon} {miss}."],
    failure: ["{target} resists; {actor}'s {weapon} {miss}.", "{actor}'s {weapon} {miss}.", "{target} stands firm as {actor}'s {weapon} {miss}.", "{actor} casts {weapon}, but it {miss}.", "{actor}'s {weapon} {miss}; {target} is unharmed."],
    majorFailure: ["{target} brushes off {actor}'s {weapon} entirely; it {miss}.", "{actor}'s {weapon} {miss}, easily resisted.", "{target} hardly notices as {actor}'s {weapon} {miss}.", "{actor}'s {weapon} {miss}; {target} is unimpressed.", "{actor}'s magic falters and {weapon} {miss}."],
    criticalFailure: ["{target} shrugs off {actor}'s {weapon} as if it were a breeze; it {botch}.", "{actor}'s {weapon} {botch}.", "{actor} loses the thread and the spell {botch}.", "{target} laughs as {actor}'s {weapon} {botch}.", "{actor}'s {weapon} {botch}; {target} is untouched."]
  }
};

const TALK = {
  diplomacy: {
    verb: ["reasons with", "appeals to", "pleads with", "offers terms to", "speaks earnestly to"],
    good: ["{target} lowers their weapon a fraction", "{target} hesitates, listening", "something in {target}'s stance softens", "{target} glances at their allies, uncertain", "{target} seems to weigh the offer"],
    bad: ["{target} isn't listening", "{target} shakes their head", "the words fall flat", "{target} only grips their weapon tighter", "{target} spits at the suggestion"]
  },
  intimidation: {
    verb: ["threatens", "roars at", "stares down", "promises ruin to", "bellows at"],
    good: ["{target} takes an involuntary step back", "{target}'s face goes pale", "{target}'s hands shake", "{target} looks for a way out", "{target} swallows hard"],
    bad: ["{target} laughs it off", "{target} stands their ground", "{target} sneers back", "{target} isn't impressed", "{target} answers with a snarl"]
  },
  deception: {
    verb: ["bluffs", "lies smoothly to", "feeds a tale to", "tricks", "spins a story for"],
    good: ["{target} buys every word", "doubt creeps into {target}'s eyes", "{target} looks around nervously", "{target} believes it, for now", "{target} starts to second-guess everything"],
    bad: ["{target} sees right through it", "{target} narrows their eyes", "the lie is too thin", "{target} isn't fooled", "{target} calls the bluff"]
  }
};

const TALK_SHAPES = {
  criticalSuccess: ["{actor} {verb} {target}, and every word lands; {good}.", "{actor} {verb} {target} perfectly; {good}.", "{actor}'s words hit like a hammer; {good}.", "{actor} {verb} {target} with total conviction; {good}.", "It's masterful: {actor} {verb} {target}, and {good}."],
  majorSuccess: ["{actor} {verb} {target}; {good}.", "{actor} {verb} {target} with ease; {good}.", "{actor} {verb} {target} confidently; {good}.", "{target} can't argue as {actor} {verb} them; {good}.", "{actor} {verb} {target}, and {good}."],
  success: ["{actor} {verb} {target}; {good}.", "{actor} {verb} {target}, and it works a little; {good}.", "{actor} {verb} {target} between blows; {good}.", "{actor} {verb} {target}; slowly, {good}.", "{actor} {verb} {target}; {good}."],
  minorSuccess: ["{actor} {verb} {target}, just convincingly enough; {good}.", "{actor} stumbles over the words but still {verb} {target}; {good}.", "{actor} {verb} {target}; barely, {good}.", "It's shaky, but {actor} {verb} {target}; {good}.", "{actor} {verb} {target}, and {good}, if only just."],
  minorFailure: ["{actor} {verb} {target}, almost getting through; {bad}.", "{actor} {verb} {target}, but {bad}, if only just.", "{actor} {verb} {target}; for a moment it seems to work, but {bad}.", "{actor} {verb} {target}; {bad}, though {target} hesitates.", "{actor} {verb} {target}; nearly, but {bad}."],
  failure: ["{actor} {verb} {target}; {bad}.", "{actor} {verb} {target}, but {bad}.", "{actor} {verb} {target} without effect; {bad}.", "{actor} {verb} {target}; {bad}.", "{actor} {verb} {target} in vain; {bad}."],
  majorFailure: ["{actor} {verb} {target} clumsily; {bad}.", "{actor} {verb} {target}, and it backfires; {bad}.", "{actor}'s attempt falls apart; {bad}.", "{actor} {verb} {target} badly; {bad}.", "{actor} {verb} {target}; {bad}, and {target} is angrier for it."],
  criticalFailure: ["{actor} {verb} {target} and makes it so much worse; {target} will not listen to {actor} again.", "{actor}'s words are an insult; {target} won't hear another one.", "{actor} {verb} {target}, and the conversation is over for good.", "{target} is enraged by {actor}'s words; there's no talking now.", "{actor} {verb} {target}; {bad}, and {target} vows never to listen again."]
};

/** Relationship clauses, appended to attack or talk sentences. "none" is usually silent. */
const RELATIONSHIP = {
  none: { success: ["", "", "", "", ""], failure: ["", "", "", "", ""] },
  enemyLeader: {
    success: [" The enemy leader is shaken.", " Their commander falters, and the whole line feels it.", " A blow struck at the heart of the enemy.", " The enemy's leader is bloodied for all to see.", " Their champion is not invincible after all."],
    failure: [" The enemy leader shrugs it off with a sneer.", " Their commander barely notices.", " The enemy leader's followers cheer.", " Their champion stands tall.", " The leader is untouched, and everyone sees it."]
  },
  talkingNemesis: {
    success: [" After all the arguing, this is the answer.", " Words failed; this didn't.", " {target} won't be dismissing {actor} now.", " So much for not listening.", " This time {target} hears {actor} loud and clear."],
    failure: [" {target} smirks, as dismissive as before.", " Once again {target} refuses {actor}.", " {target} remains as immovable as ever.", " Nothing {actor} does reaches {target}.", " {target} has stopped taking {actor} seriously."]
  },
  grudge: {
    success: [" Payback, at last.", " {actor} hasn't forgotten the earlier wound.", " That one was personal.", " {actor} returns the favor with interest.", " The debt is repaid in kind."],
    failure: [" {actor}'s anger throws off the timing.", " Rage makes {actor} sloppy.", " The grudge clouds {actor}'s aim.", " {actor} wants it too badly.", " Fury is no substitute for skill."]
  },
  avenger: {
    success: [" That was for the fallen.", " {actor} strikes in their friend's name.", " Vengeance, swift and sure.", " Someone had to answer for what happened.", " Grief sharpens {actor}'s strike."],
    failure: [" Grief steals {actor}'s focus.", " {actor}'s eyes are still on the fallen friend.", " Tears blur {actor}'s aim.", " Vengeance will have to wait.", " Rage and sorrow make {actor} careless."]
  },
  protector: {
    success: [" {target} is driven away from {actor}'s friend.", " {actor} stands between {target} and an ally.", " No one touches {actor}'s friends.", " {actor} draws {target}'s attention away from the wounded.", " The ally behind {actor} breathes a little easier."],
    failure: [" {target} keeps pressing toward {actor}'s ally.", " {actor} can't pull {target} off their friend.", " The ally is still in danger.", " {target} ignores {actor} completely.", " Protecting a friend is harder than it looks."]
  },
  finishing: {
    success: [" A cruel, final blow.", " There will be no getting up from that.", " Mercy has no place here.", " {target} had no chance to rise.", " It is done."],
    failure: [" Even helpless, {target} somehow survives.", " Fate spares {target} for now.", " The killing blow goes astray.", " {target} clings to life.", " Not yet."]
  },
  rival: {
    success: [" The duel between these two goes on.", " {actor} gains the upper hand in their private war.", " Another point to {actor}.", " {target} knows {actor} well by now, and it isn't enough.", " This rivalry is far from over."],
    failure: [" {target} has {actor}'s measure.", " Again {target} reads {actor} perfectly.", " The rivalry tilts toward {target}.", " {target} has seen this move before.", " {actor} grows frustrated with this particular foe."]
  }
};

const MOVE = {
  walk: {
    approach: ["{actor} charges toward {target}.", "{actor} sprints across the gap toward {target}.", "{actor} weaves forward toward {target}.", "{actor} vaults a fallen crate and closes on {target}.", "{actor} slides in low toward {target}."],
    terrain: ["{actor} picks a way across {region}, slowed but determined.", "{actor} stumbles through {region}, closing on {target}.", "{region} drags at {actor}'s feet.", "{actor} leaps from rock to rock across {region}.", "{actor} slogs through {region} toward {target}."],
    flee: ["{actor} turns and runs.", "{actor} bolts for safety.", "{actor} scrambles away, looking back in fear.", "{actor} breaks into a desperate sprint.", "{actor} ducks low and dashes off."],
    hunt: ["{actor} goes looking for more prey.", "{actor} stalks toward {target}.", "{actor} isn't finished yet, and turns toward {target}.", "{actor} sets off after {target}.", "{actor} prowls toward an unsuspecting {target}."],
    help: ["{actor} runs for help.", "{actor} breaks away to find {target}.", "{actor} sprints toward {target}, waving and shouting.", "{actor} dodges clear and heads for {target}.", "{actor} dashes off to fetch {target}."]
  },
  fly: {
    approach: ["{actor} swoops toward {target}.", "{actor} dives down at {target}.", "{actor} wheels overhead and drops toward {target}.", "{actor} glides in on {target}.", "{actor} beats the air and surges toward {target}."],
    terrain: ["{actor} soars over {region} without a care.", "{region} passes beneath {actor}'s wings.", "{actor} skims above {region}.", "{actor} flies over {region}, leaving the ground-bound behind.", "Untroubled by {region}, {actor} glides on."],
    flee: ["{actor} takes to the air and flees.", "{actor} climbs into the sky and away.", "{actor} wheels away into the distance.", "{actor} flaps frantically out of reach.", "{actor} soars off."],
    hunt: ["{actor} circles, searching for {target}.", "{actor} swoops off after {target}.", "{actor} spies {target} from above.", "{actor} dives toward {target}.", "{actor} glides toward {target} with intent."],
    help: ["{actor} flies off to find {target}.", "{actor} soars toward {target}, calling out.", "{actor} wings away for help.", "{actor} races through the air to {target}.", "{actor} streaks off toward {target}."]
  },
  swim: {
    approach: ["{actor} cuts through the water toward {target}.", "{actor} knifes forward toward {target}.", "{actor} strokes hard toward {target}.", "{actor} surges through the current at {target}.", "{actor} glides beneath the surface toward {target}."],
    terrain: ["{actor} fights the water across {region}.", "{region} churns around {actor}.", "{actor} kicks through {region}.", "{actor} struggles across {region}.", "{actor} pushes through {region}."],
    flee: ["{actor} dives and swims away.", "{actor} vanishes beneath the surface.", "{actor} thrashes away through the water.", "{actor} swims for it.", "{actor} slips away underwater."],
    hunt: ["{actor} glides after {target}.", "{actor} circles toward {target}.", "{actor} slides through the water after {target}.", "{actor} hunts {target} beneath the surface.", "{actor} swims toward {target}."],
    help: ["{actor} swims off for help.", "{actor} strokes hard toward {target}.", "{actor} heads for {target}.", "{actor} surfaces near {target}, shouting.", "{actor} kicks off to find {target}."]
  },
  climb: {
    approach: ["{actor} scrambles up and over to reach {target}.", "{actor} climbs along the wall toward {target}.", "{actor} hauls up and drops down beside {target}.", "{actor} scales the obstacle toward {target}.", "{actor} swings up and over, closing on {target}."],
    terrain: ["{actor} climbs over {region} rather than through it.", "{actor} scrambles up the rocks of {region}.", "{actor} picks a high route across {region}.", "{actor} clambers across {region}.", "{actor} finds handholds all across {region}."],
    flee: ["{actor} scrambles up and away.", "{actor} climbs out of reach.", "{actor} vanishes over the top.", "{actor} clambers off in a panic.", "{actor} hauls up and out of the fight."],
    hunt: ["{actor} climbs off after {target}.", "{actor} scales the wall after {target}.", "{actor} creeps along the heights toward {target}.", "{actor} drops from above toward {target}.", "{actor} clambers toward {target}."],
    help: ["{actor} climbs off to fetch {target}.", "{actor} scales the wall, shouting for {target}.", "{actor} scrambles away for help.", "{actor} clambers toward {target}.", "{actor} heads up and over to find {target}."]
  },
  burrow: {
    approach: ["{actor} tunnels toward {target}.", "The ground heaves as {actor} burrows toward {target}.", "{actor} vanishes underground and surfaces near {target}.", "{actor} digs toward {target}.", "Earth sprays as {actor} bores toward {target}."],
    terrain: ["{actor} passes beneath {region} entirely.", "{region} means nothing to {actor}, deep underground.", "{actor} tunnels under {region}.", "{actor} burrows below {region}.", "Untroubled by {region}, {actor} digs on."],
    flee: ["{actor} burrows away.", "{actor} vanishes into the ground.", "{actor} digs frantically out of sight.", "{actor} disappears beneath the earth.", "Only a mound of dirt marks where {actor} went."],
    hunt: ["{actor} tunnels after {target}.", "{actor} burrows toward {target}.", "The ground ripples as {actor} hunts {target}.", "{actor} digs toward {target}.", "{actor} vanishes, heading for {target}."],
    help: ["{actor} burrows off for help.", "{actor} tunnels toward {target}.", "{actor} digs toward {target}, calling out.", "{actor} vanishes, seeking {target}.", "{actor} bores away to find {target}."]
  }
};

const EVENT = {
  opening: ["Steel is drawn and the fight begins.", "For a heartbeat no one moves. Then everyone does.", "The air goes still, then erupts.", "Battle is joined.", "Eyes meet across the field, and the fight is on."],
  surprise: ["The ambush springs!", "They never saw it coming.", "Out of nowhere, the attack comes.", "Surprise is total.", "The first blow falls before anyone is ready."],
  down: ["{actor} collapses.", "{actor} crumples to the ground.", "{actor} drops, gasping.", "{actor} falls and does not rise.", "{actor} goes down hard."],
  death: ["{actor} is slain.", "{actor} falls, never to rise.", "{actor} breathes one last time.", "{actor} lies still.", "{actor}'s fight is over, forever."],
  finished: ["{by} ends {actor} where they lie.", "{actor} is finished off by {by}.", "A last blow from {by} and {actor} is gone.", "{by} makes certain of {actor}.", "No mercy: {by} finishes {actor}."],
  struckDown: ["{actor}, already down, is struck again.", "{actor} is hit while helpless.", "Even fallen, {actor} isn't safe.", "Another blow lands on the fallen {actor}.", "{actor} groans as the blow lands."],
  recoveryGood: ["{actor} fights for every breath and holds on.", "{actor} clings to life.", "{actor}'s breathing steadies a little.", "{actor} refuses to let go.", "{actor} stirs faintly."],
  recoveryBad: ["{actor} slips closer to death.", "{actor}'s breathing grows shallow.", "{actor} fades.", "{actor} grows pale and still.", "Life ebbs from {actor}."],
  stabilize: ["{actor} stabilizes, unconscious but alive.", "{actor}'s breathing evens out; the danger has passed for now.", "{actor} will live, though still out cold.", "{actor} stops slipping away.", "{actor} drifts into a deep but living sleep."],
  heal: ["{actor} tends to {target}, mending wounds.", "{actor}'s magic knits {target}'s flesh.", "{actor} channels healing into {target}.", "{actor} patches up {target} amid the chaos.", "Warm light flows from {actor} into {target}."],
  healSelf: ["{actor} catches a breath and mends their own wounds.", "{actor} heals themselves.", "{actor} steadies and recovers.", "{actor} pulls themselves together.", "{actor} draws strength back into their own body."],
  potion: ["{actor} gulps down a potion.", "{actor} downs a healing draught.", "{actor} drinks deep from a vial and color returns.", "{actor} knocks back a potion.", "{actor} drains a flask and feels better."],
  revive: ["{actor} brings {target} back from the brink!", "{target} gasps awake under {actor}'s care.", "{actor} drags {target} back to consciousness.", "{target}'s eyes snap open as {actor}'s healing takes hold.", "{actor} refuses to let {target} go, and {target} wakes."],
  stand: ["{actor} gets back up.", "{actor} staggers to their feet.", "{actor} rises.", "{actor} pushes up from the ground.", "{actor} scrambles upright."],
  shield: ["{actor} raises a shield.", "{actor} sets their shield.", "{actor} hunkers behind the shield.", "{actor} braces behind the shield.", "{actor} lifts the shield, waiting."],
  draw: ["{actor} draws {weapon}.", "{actor} readies {weapon}.", "Steel rings as {actor} draws {weapon}.", "{actor} pulls {weapon} free.", "{actor} brings {weapon} to hand."],
  prone: ["{actor} is knocked flat.", "{actor} goes sprawling.", "{actor} is dragged down.", "{actor} hits the ground.", "{actor} is bowled over."],
  grabbed: ["{actor} is seized by {by}.", "{by} grabs {actor}.", "{actor} is caught fast in {by}'s grip.", "{by} pins {actor}.", "{actor} struggles in {by}'s hold."],
  escape: ["{actor} wrenches free.", "{actor} twists loose.", "{actor} breaks the hold.", "{actor} slips the grip.", "{actor} pulls free."],
  stuck: ["{actor} struggles but can't break free.", "{actor} strains against the hold.", "The grip on {actor} holds.", "{actor} thrashes uselessly.", "{actor} is still held fast."],
  waver: ["{actor}'s nerve falters.", "{actor} glances toward the exits.", "Doubt flickers across {actor}'s face.", "{actor} hesitates.", "{actor}'s hands begin to shake."],
  flee: ["{actor} breaks and runs.", "{actor} has had enough and flees.", "{actor} turns tail.", "{actor} bolts.", "{actor} abandons the fight."],
  study: ["{actor} studies {target}, looking for weaknesses.", "{actor} watches {target} carefully.", "{actor} recalls everything known about {target}.", "{actor} sizes {target} up.", "{actor} searches memory for how to beat {target}."],
  parley: ["{actor} calls out, trying to talk.", "{actor} raises a hand and shouts for peace.", "{actor} tries to reason, but no one understands.", "{actor} calls for a truce.", "{actor} tries words first."],
  callHelp: ["{actor} shouts to {target} for help!", "{actor} yells for {target}.", "{actor} calls {target} to arms.", "\"Help!\" {actor} cries to {target}.", "{actor} rouses {target} with a desperate shout."],
  noticeSight: ["{actor} sees the fight.", "{actor} spots the commotion.", "{actor} looks up at the violence.", "{actor} catches sight of the battle.", "{actor} turns toward the fighting."],
  noticeSound: ["{actor} hears the sounds of battle.", "The clash of steel reaches {actor}.", "{actor} hears shouting nearby.", "Distant screams reach {actor}.", "{actor} pricks up their ears at the noise."],
  noticeFled: ["{by} stumbles right into {actor}.", "{actor} is nearly bowled over by the fleeing {by}.", "{by} crashes into {actor}'s path.", "{actor} is startled by {by} running past.", "{by} flees straight past {actor}."],
  noticeHelp: ["{actor} answers {by}'s call.", "{actor} hears {by}'s cry for help.", "{by}'s shout reaches {actor}.", "{actor} is roused by {by}.", "{actor} hears a friend calling."],
  noticeAttacked: ["{actor} is set upon without warning.", "{by} falls upon an unsuspecting {actor}.", "{actor} has no warning before {by} attacks.", "{by} catches {actor} completely off guard.", "{actor} is ambushed by {by}."],
  join: ["{actor} joins the fight.", "{actor} charges in.", "{actor} draws a weapon and enters the fray.", "{actor} throws in with the fighting.", "{actor} runs to join the battle."],
  joinForced: ["{actor} has no choice but to fight.", "{actor} is dragged into the battle.", "{actor} must defend themselves.", "{actor} is forced into the fight.", "{actor} fights back."],
  watch: ["{actor} hangs back, watching.", "{actor} keeps their distance.", "{actor} watches from the edges.", "{actor} isn't ready to get involved.", "{actor} waits to see how it goes."],
  leave: ["{actor} wants no part of it and slips away.", "{actor} quietly leaves.", "{actor} backs off and vanishes.", "{actor} decides this isn't their fight.", "{actor} melts into the shadows."],
  surrender: ["{actor} throws down their weapon and yields.", "{actor} drops to their knees and surrenders.", "{actor} raises empty hands.", "{actor} gives up the fight.", "{actor} yields to {by}."],
  swayFlee: ["{actor}, convinced by {by}, flees.", "{actor} takes {by}'s advice and leaves.", "{actor} backs away and runs.", "{actor} decides to live another day.", "{actor} slips off, persuaded."],
  switch: ["{actor} turns on their former allies!", "{actor} switches sides, swayed by {by}.", "{actor} now fights beside {by}.", "{actor} changes allegiance mid-battle.", "{actor} throws in with {by}."],
  persistent: ["{actor} keeps burning from the earlier wound.", "{actor} suffers lingering harm.", "The wound keeps hurting {actor}.", "{actor} can't shake the lingering damage.", "{actor} is still suffering."],
  afflictionSaveFail: ["{affliction} takes hold of {actor}.", "{actor} feels {affliction} spreading.", "{actor} sways as {affliction} sets in.", "{affliction} seeps into {actor}.", "{actor} has been afflicted by {affliction}."],
  afflictionSavePass: ["{actor} resists {affliction}.", "{actor} shakes off {affliction}.", "{affliction} fails to take hold of {actor}.", "{actor} fights off {affliction}.", "{actor} is unaffected by {affliction}."],
  afflictionStage: ["{affliction} worsens in {actor}.", "{actor} suffers from {affliction}.", "{affliction} burns through {actor}'s veins.", "{actor} doubles over from {affliction}.", "{affliction} tightens its grip on {actor}."],
  afflictionEnd: ["{actor} recovers from {affliction}.", "{affliction} runs its course in {actor}.", "{actor} finally shakes off {affliction}.", "{affliction} fades from {actor}.", "{actor} is free of {affliction}."],
  coverDuck: ["{target} ducks behind cover.", "{target} presses against the wall as it passes.", "{target} dives behind cover just in time.", "Cover saves {target}.", "{target} drops behind the nearest wall."],
  coverShoot: ["{actor} leans out from cover.", "{actor} pops up from behind the wall.", "Sheltered by the wall, {actor} takes aim.", "{actor} steadies against the stonework.", "{actor} fires from behind cover."],
  step: ["{actor} steps back to a better position.", "{actor} slides away to reset.", "{actor} dances back out of reach.", "{actor} repositions.", "{actor} gives ground deliberately."],
  victory: ["When the dust settles, {winners} stand victorious.", "It's over. {winners} carry the day.", "Silence returns. {winners} have won.", "{winners} prevail.", "The battle belongs to {winners}."],
  noOne: ["When it ends, no one is left standing.", "Silence falls over a field of the fallen.", "There are no victors here.", "Everyone has fallen.", "Nothing moves when it's over."],
  stalemate: ["Neither side breaks, and the fight grinds on.", "Exhausted, both sides pull apart.", "It ends in a bitter stalemate.", "No one wins this day.", "The fight goes on past all reason."]
};

function fill(template, parts) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (parts[k] !== undefined ? parts[k] : m));
}

/** Build every table: key -> 5 entries. */
export function buildEnglishTables() {
  const tables = {};
  for ( const delivery of DELIVERIES ) {
    for ( const type of DAMAGE_TYPES ) {
      const t = TYPE[type];
      for ( const tier of TIERS ) {
        tables[`action.${delivery}.${type}.${tier}`] = SHAPES[delivery][tier].map((shape, i) => fill(shape, {
          aim: DELIVERY[delivery].aim[i % 5],
          hit: t.hit[i % 5], wound: t.wound[(i + 1) % 5], graze: t.graze[i % 5],
          miss: t.miss[i % 5], crit: t.crit[i % 5], botch: t.botch[i % 5]
        }));
      }
    }
  }
  for ( const skill of TALK_SKILLS ) {
    for ( const tier of TIERS ) {
      tables[`talk.${skill}.${tier}`] = TALK_SHAPES[tier].map((shape, i) => fill(shape, {
        verb: TALK[skill].verb[i % 5], good: TALK[skill].good[i % 5], bad: TALK[skill].bad[i % 5]
      }));
    }
  }
  for ( const kind of RELATIONSHIPS ) {
    for ( const polarity of ["success", "failure"] ) tables[`relationship.${kind}.${polarity}`] = RELATIONSHIP[kind][polarity];
  }
  for ( const mode of MOVE_MODES ) {
    for ( const situation of MOVE_SITUATIONS ) tables[`move.${mode}.${situation}`] = MOVE[mode][situation];
  }
  for ( const [name, entries] of Object.entries(EVENT) ) tables[`event.${name}`] = entries;
  return tables;
}

/** Human-friendly table name for a key, e.g. "Melee · Slashing · Minor Success". */
export function tableName(key) {
  const words = key.split(".").map(w => w.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()));
  return words.join(" · ");
}
