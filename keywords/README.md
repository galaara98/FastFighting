# Keywords

FastFighting reads a character's biography and description (whatever its system's helper gives it: a PF2e
creature's notes, a D&D 5e biography, a DCC character's notes) for words that say something about who it is. Each word
or phrase in [en.json](en.json) says what it raises and what it lowers:

- **traits**: points on the character's personality (0 to 100 each), wherever it's read: in the planner, in every
  simulated fight. The planner's tooltip on a trait shows the words that moved it ("biography (cruel and ruthless): +15").
- **playstyles**: how much the word counts toward (or, below 0, against) each playstyle, when FastFighting sets a
  character up by itself. A playstyle needs a score of 30 to be picked; one keyword's worth is 15.

This file is meant to be improved. If a word is missing, rated too high or too low, or matches text it shouldn't,
suggest a change (an issue or a pull request against `keywords/en.json`). The tests check the file: run `npm test`.

## An entry

```json
"ruthless": { "playstyles": { "cruel": 1, "moralist": -0.5 }, "traits": { "selfish": 10 } },
"general":  { "playstyles": { "leader": 1 }, "traits": { "tactical": 4 }, "whole": true },
```

- **The word** is lower case. It matches **the start of a word**, in any case: `greed` finds "greedy" and "Greed", but
  not "pedigreed". So a stem covers its forms: `treacher` finds "treacherous" and "treachery". A phrase works the
  same way: `"quick to anger"`.
- **`whole: true`** matches only the whole word, for a stem that would find too much (`general` would find "generally",
  `mad` "made", `corrupt` "corruption", `medic` "medicine").
- **`playstyles`**, in keywords' worth: **1** a clear sign, **0.5** a leaning, **0.3** a hint, below 0 against it (a
  pacifist is no Brawler). Up to 2 either way. The ids are the playstyles' own: chicken, cruel, moralist,
  peacekeeper, peoplePleaser, fragile, impatient, brawler, skeptic, speedRunner, leader, instigator, diplomat,
  kiter, wallflower, martyr, tank, mercenary, enabler, redeemSeeker, loreCollector, puzzleManiac, wildcard, thief,
  vengeful, relentless, lazy, unmundane.
- **`traits`**, in points: **2** slight, **5** clear, **8** strong, **12** defining; up to 15 either way. Tactical (a
  good head), brave (nerve), selfish (looks out for itself), loyal (stands by its side).

## How words add up

- The same thing said again counts once: an entry counts once however often it appears ("hateful, hateful,
  hateful" is one); where entries overlap, only the longest counts ("cowardly" is `cowardly`, not `coward` as
  well); and entries rated exactly alike count once together, so a word and its synonyms ("hateful", "full of
  hate", "hatred") are one. Give synonyms the same rating; give a word a different rating when it says more.
- A word right after a **negation** in the same sentence doesn't count ("never cruel", "not a coward", "no longer
  loyal"). The negations are the file's `negations` list.
- A word right after a **reversal** in the same sentence counts the other way ("despises cowards": a bold one; "hates
  violence": one who likes peace). The reversals are the file's `reversals` list. So rate a thing someone may like
  or dislike (fighting, peace, money, knowledge) as what **liking** it says.
- All the words found add up, and then they're held in: at most two keywords' worth for any playstyle, and 15 points
  for any trait. So a biography can tip a character, but it can't overrule everything else about it.
- Where a character's sheet keeps them apart, what's said of the character itself (a creature's description; a
  character's appearance, attitude, beliefs, likes, edicts) counts in full; its backstory (a story with others in it:
  the bandits it fought) a quarter; and what it's against (its dislikes, its anathema) in full, the other way:
  "dislikes fighting" makes one who likes peace, "dislikes cowards and liars" a bolder, more honest one. Its allies and
  enemies aren't read.
- A biography's words don't move the traits of the mindless or of hazards.

## Choosing a rating

Rate what the word says about how someone **behaves in a fight or a tense standoff**, not how it looks. "Hulking"
leans toward a Brawler; "beautiful" says nothing, so it isn't here. Remember what systems and their books lean
toward: heroic, kindly words are everywhere, and a villain or an anti-hero is often described only by a word or two
(cruel, ruthless, mercenary, cynical), so those words carry real weight.

Check a word against real text before adding it. Many describe things as well as people: "crude spears", "persistent
damage", "the cave lies north", "corruption of the land", "frightened 1". Prefer a narrower form or `whole: true`.

## Other languages

A translation adds a file here named for its language (`es.json`, `fr.json`) in the same shape. Its words are looked
for **as well as** the English ones, since a biography may be written in either: list only your language's words. If
it lists a word the English file has, its entry is used instead for that word. Its `negations` and `reversals` are
added to the English ones.
