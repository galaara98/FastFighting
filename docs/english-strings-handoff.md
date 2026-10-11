# Handoff: writing FastFighting's English strings

*Written 2026-10-11 for a new Claude session. It covers all five FastFighting repos.*

## Progress (read this first)

- **Step 0 is done** (2026-10-11). Every word a GM or player reads is in `languages/en.json` (each repo) or the core's `story/en.json`; the code names keys only. Core commits ece9bd0 and a02f557 (API 9), one commit in each helper. All five suites pass, normally and with `npm run test:reworded`, which rewords every string so no test depends on the wording. Checked in the local Foundry (5e world): planner, results, all three story styles.
- **Step 1 is done** (2026-10-11): the tracker is `docs/strings/` in the core (`npm run strings -- status`; see below).
- **Next: Step 2**, the writing sessions. The user chose to start with the short strings (two words or fewer, two placeholders at most: 968 of them) in a CSV: `docs/strings/short-strings.csv`, built by `docs/strings/short-strings.mjs`, with a "Yours" column the user fills in Excel. When it comes back: enter each answer exactly (quotes around an answer are Excel's, not the user's: drop them), flag proofreading issues as before/after for approval, run the tests both ways, commit the strings and the CSV as the user saved it, and record the batch in the tracker. A blank "Yours" stays todo.

Decisions the user made along the way:
- **Developer messages** (console messages, errors thrown at other modules) are part of the review, but the user's wording goes **directly into the code**, not into `en.json`. The tracker lists them (area `<repo>/code`).
- **Localization must be doable by a non-coder editing only string files.** No translation may need code. So: word order lives in templates (`"{rest} and {last}"`), not in words glued in code; the code-only story language route was removed; the core README has a **Translating** section. Any language or key missing falls back to English, never a crash.
- The user said "review all strings". Reviewing doesn't make them the author (§4.2): they state each string fresh, as below.
- **`hardcoded-toEN.json`** in each helper: `lastUpdated` (a date) and `keys`, keys of the helper's `languages/en.json` (or groups of them) that stay English in every language for now, because a translation would contradict a game system that isn't translated. Core applies it (`api.keepEnglish`, `scripts/foundry/keep-english.js`). The user decides what's on it and updates the date.
- **Distances** read in the scene's grid units (imperial or metric); the engine counts feet inside. `distanceText` in `scripts/i18n.js`; the template is `FASTFIGHTING.Units.Distance`.

## For Claude: what this session is

The user is the author of the FastFighting modules for Foundry VTT. They plan to list the modules on the official foundryvtt.com package listing.

Every English string in the modules was written by Claude in earlier sessions. Foundry's AI Content Policy doesn't allow that for a listed package, so the user is going to go through every English string and **state, in their own words, what it should be.**

Your job is to make that process fast and accurate:
- Explain what each string is for.
- Enter the user's wording exactly.
- Keep the code, the tests and the records in order.

**You do not write any of the wording.**

## Why: Foundry's AI Content Policy

The policy is at https://foundryvtt.com/article/ai-policy/ (revised 2026-03-18). The parts that matter here:
- **§4.1:** "All user-facing prepared written text must be human-authored." This explicitly includes UI labels. AI may only proofread or format text a human wrote.
- **§4.1:** AI may translate human-written text, but a fluent speaker of the target language must review it before it's published. No translations ship today; an AI-made Spanish test translation was removed.
- **§4.2:** this section is about images, not text, but it shows the intent: a human editing or painting over AI output doesn't make it human-made. So the user writes each string fresh. Approving or lightly editing Claude's old wording doesn't make it theirs.
- **§4.4:** AI-written code is allowed if the author understands and can maintain all of it. AI help with documentation and tests is also allowed, so all of the engineering below is fine.
- **§4.5:** the package description on foundryvtt.com must be human-written.
- **§7:** the author carries the burden of proof. Commit history and records are the evidence, so keep them honest and complete.

The user wants to be compliant **and straightforward**. Every README opens with the user's own AI-use declaration, which currently says all initial strings were created by AI. It changes only when the strings really are the user's, and **the user words that change**.

## Ground rules for the session

1. **Never propose wording.** That means no suggestion, no default, no "something like …", no example sentence.
   - If the user asks what a string should say, explain what it has to accomplish: where it shows, who reads it, what they need to learn, the placeholders, the length.
   - Remind them once that wording you suggest wouldn't count as theirs.
2. **Don't show the current wording unless asked.** Describe what each string does instead.
   - If the user asks to see the current text, show it, and note once that copying it or lightly editing it wouldn't count as writing it.
   - A one-word label may naturally come out the same ("Cancel", "Dead"). That's fine when the user chose it.
3. **"Keep it" is not an answer.** Every string gets text the user states.
   - If they want to move on, mark the string *skipped*, not *written*.
4. **Enter the user's text verbatim.** You may proofread (§4.1): spelling, punctuation, consistent capitalization and terms, formatting, valid HTML, a missing or extra placeholder, a string too long for its spot.
   - **Standing rule from the user (2026-10-11): always turn a "smart" apostrophe (’ or ‘) into a straight ' when entering their text.** No approval needed for this one.
   - Show each fix as a before/after and apply it only once the user approves.
   - Never reword for style.
5. **Placeholders.** For each string, list the `{placeholders}` it must keep and what each one holds. Check the user's text keeps them, and ask if one is missing.
   - Many strings are fragments that get joined into sentences (the battle log, the story tables, list words). Show how a fragment gets used so the user can write it to fit.
6. **Record everything.** Use the tracker (Step 1) and one commit per batch (Step 2).
7. **Only the user words the README declaration.** Don't draft or change it.

## Step 0: put all the English in files the user edits (do this first)

This step is engineering, which §4.4 allows. Right now English lives in several places. Before writing starts, every user-visible English word should live in **exactly one data file** the user edits. Otherwise Claude's English survives in the code after the user rewrites the language files.

Where English lives today (counted 2026-10-11):
- **`languages/en.json`** in each repo:

  | Repo | Strings | Words |
  |---|---|---|
  | Core | 1,057 | ~5,900 |
  | PF2e | 41 | ~200 |
  | D&D 5e | 79 | ~270 |
  | DCC | 78 | ~300 |
  | Ironsworn | 86 | ~490 |

- **Core story tables:** `scripts/story/tables-en.js` builds 644 tables of 5 entries each. They come from about 1,640 phrases in building blocks:
  - `TYPE`: what a hit, wound, graze, miss, crit or botch looks like, for 16 damage types.
  - `SHAPES`: sentence shapes by delivery and degree of success.
  - `TALK` and `TALK_SHAPES`.
  - `RELATIONSHIP`, `MOVE`, `EVENT`.
  - `DESIRE_INTENSITY`, `DESIRE_SELF`, `DESIRE_VERB`.

  Move them into a data file but **keep the building-block structure**, so the user writes about 1,640 phrases rather than 3,200 finished sentences.
  - `scripts/story/tables.js` already looks up translations in `story/<lang>.json`, a folder the release zip includes when it exists.
  - Choose the English file's location to fit that lookup, and check `.github/workflows/release.yml` packages it.
  - `installStoryTables` uses `1d<n>`, so tables can have any number of entries. `tests/story.test.js` currently requires exactly 5; relax it if the user wants fewer.
- **English copies in code,** each a duplicate of something in `en.json`. Remove them all:
  - `localize(key, "English")` fallbacks in core (about 25 calls). `scripts/engine/mods.js` and `scripts/foundry/translation-advice.js` hold most of them.
  - `LOG_ENGLISH` (287 templates) and `DAMAGE_TYPE_ENGLISH` in `scripts/story/log-lines.js`.
  - `OUTCOME` in `scripts/i18n.js`.
  - The helpers' `t(key, "English")` and `sysOr(...)` fallbacks (`scripts/words.js` and their callers): about 35 in PF2e, 45 in 5e, 65 in DCC, 40 in Ironsworn.
- **English in code that isn't localized at all.**
  - Examples:
    - core `scripts/engine/simulator.js` ("notices the tense standoff", "takes offense and attacks", …);
    - `scripts/engine/behavior/talk.js` ("agrees to stand down", …);
    - `scripts/foundry/battle.js` ("I don't like to flee", …);
    - the helpers' `rules.js`, `commit.js`, `moves.js`, `traits.js`, `text.js`.
  - Rough counts of 3-word-plus literals:

    | Core (excluding the story tables and log) | PF2e | 5e | DCC | Ironsworn |
    |---|---|---|---|---|
    | ~180 | ~16 | ~35 | ~33 | ~40 |

  - Check each one. If a user can ever see it, move it into `en.json` under a key. If it's internal (an id, a debug message), leave it.
  - Console messages are developer-facing. Ask the user whether they want those included.
- **`module.json`:** the title and description in each repo (~325 words in all).

When Step 0 is done:
- Code calls `localize(key)` and similar with no English beside the key.
- The tests load the real `en.json` into a fake `game.i18n`, in a vitest setup file, for core and each helper. A helper's tests load core's `en.json` too. `tests/i18n.test.js` already builds a fake client this way.
- Tests that pin English wording (roughly 20 assertions across the repos) read the expected text from `en.json` or assert structure instead. Otherwise the user's rewrite breaks them.
- A test fails if English fallbacks creep back into code. For example: no `localize`/`t` call with a second string argument.
- `tests/i18n.test.js` keeps its made-up pseudo-language (accented English in ⟦brackets⟧). It catches anything that skips localization.
- All five suites pass. Commit and push.

## Step 1: the tracker

Done: `docs/strings/tracker.mjs` and its record `docs/strings/tracker.json` in the core repo (`docs/` isn't in the release zip). Run it from the core repo; the helpers must be checked out beside it.
- **Entries come from the files**, so nothing is missed: each key of each repo's `languages/en.json`; each **list** in `story/en.json` (the user writes a list at a time, any number of phrases); each repo's `module.json` title and description; each developer message in the code (by file, function and order).
- Each entry: repo, file, key, area, status (`todo` / `written` / `skipped`), date, commit, and a hash of its text when last recorded.
- `npm run strings -- status`: what's left, by area. `-- list <area> [n]`: the next strings to write there, with the placeholders each must keep.
- `npm run strings -- mark written <commit> <id> ...` records a batch (and refreshes its hashes). `-- sync` adds new strings, drops gone ones, and flags any whose text changed outside a recorded batch; `-- check` exits 1 if anything did.

The tracker and the commits are the §7 evidence of a human writing process.

## Step 2: writing sessions

Present strings in batches of about 10, as a numbered table:

| # | Key | Where it shows | What it must say | Must keep | Limits |
|---|---|---|---|---|---|

- **Where it shows:** the window, setting, log, story or tooltip, and who reads it (GM or player).
- **What it must say:** the meaning, never the wording.
- **Must keep:** its placeholders.
- **Limits:** for example, a button label must be short; a hint can be a sentence or two.

The user answers "1: …", "2: …".
1. Enter each answer exactly.
2. Flag proofreading issues for approval.
3. Run the tests, both ways (`npm test`, `npm run test:reworded`).
4. Commit the strings.
5. Record the batch: `npm run strings -- mark written <that commit> <ids>`, then commit the tracker ("Tracker: <area> <range>").

Commit message: `English strings (<area> <range>): written by the author, entered verbatim`, ending with the Co-Authored-By trailer, since Claude typed the edit. The commit author is the user's own git identity, which is already configured. Push at milestones; the user gave standing permission to push. Ask before creating new repos.

Suggested order (the user can change it):
1. **Core settings and windows** the GM meets first: `Settings` (73 strings, ~1,280 words), `Planner`, `Results`, `Survey`, `Tactics`, `MakeItSo`, `Tracker`, and the smaller groups.
2. **Playstyles:** 70 strings, ~1,470 words of names and descriptions.
3. **The battle log:** 287 short templates. Show where each appears in a sample fight.
4. **The story tables:** the largest part, about 1,640 phrases. Explain how building blocks combine, and show a sample sentence built from placeholders, not from old wording.
5. **The helpers' `en.json`:** PF2e, then D&D 5e, DCC, Ironsworn.
6. **The `module.json` titles and descriptions.**
7. **The foundryvtt.com description.** The user writes it directly when they submit (§4.5); it's not in any repo.

## Step 3: when every string is written

- Run all five suites. Spot-check in the local Foundry, in both a PF2e and a 5e world.
- Tell the user it's done. They write the new "Strings" line of the README declaration in all five READMEs. Don't draft it.
- **Translations:** none ship. A future translation can be machine-made from the user's English, but a fluent speaker must review it before release (§4.1).
- **At submission, the user:**
  - attests they understand and can maintain the code (§4.4), so it's worth them reading through it before then;
  - writes the listing description (§4.5);
  - doesn't claim "Zero AI" (§6.6).

## Project facts

- **Repos:** each is a folder under `C:\Users\chaos.DADSTOWER\claudestuff\` with a GitHub remote at `github.com/galaara98/<name>`:
  - `FastFighting` (Core), the engine, UI, story and all shared strings;
  - `FastFighting-PF2e`, `FastFighting-DnD5e`, `FastFighting-DCC`, `FastFighting-Ironsworn`, the system helpers.
- **Tests:** `npm test` (vitest) in each repo. On 2026-10-11 the counts were core 319, PF2e 53, D&D 5e 70, DCC 35, Ironsworn 22, all passing.
- **Commits:** end every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Release zip:** `.github/workflows/release.yml` zips `module.json scripts styles languages templates README.md systems.md LICENSE`, plus `story/` when it exists. A new data folder must be added there. `docs/` and `tests/` don't ship.
- **Local Foundry:** v14 at `http://localhost:30000`. Test worlds: `fastfighting-test-pf2e`, `fastfighting-test-dnd5e`, `fastfighting-test-ironsworn`, `fast-fighting-test-dcc`.
  - Test users have no passwords. If the setup screen asks for the admin password, ask the user.
  - A normal reload keeps cached module code: run `fetch(url, {cache: "reload"})` on each changed file, then reload.
- **Rights (§1.1):** test with SRD and open content. Don't read paid compendium content, such as the D&D Monster Manual or the DCC books, into the session.
- **Editing tip:** shell one-liners (`node -e`, `sed`) have mangled backslashes in regexes in these repos before. For scripted edits, write a script file with the Write tool and run it.
