# FastFighting Core

> **AI use:** This module used AI in its creation.
> - **Programming:** I am a skilled programmer by profession, but AI was used heavily as a co-pilot.
> - **Strings:** ALL initial strings were proposed by a LLM to get the concepts out, ALL strings were  tracked to make sure they were re-written (for simple or ttrpg/game specific phrases, approved by) a native speaker.

A [Foundry VTT](https://foundryvtt.com) module that resolves a battle, or a tense standoff, from the encounter on the scene, so the table can move on.

## What it does

- **The Battle Planner** simulates the encounter thousands of times, with real dice math, shows the odds, and tells the story of the most typical fight. Sides, groups, roles and fudges are yours to set.
- **Prepare Players** asks each player how their character fights, spends, looks after others and talks, or lets the character decide from its sheet.
- **Go Live** plays the fight for real on the Combat Tracker, a turn at a time: FastFighting runs the creatures, the players run their characters, and every turn goes onto the sheets. **Fast Fight** plays on to the end without stopping.
- **The Battle Vantage** shows the GM what each creature wants and plans, and lets you step in.
- **Rewind** takes back a turn, or the whole encounter.

Creatures decide by personality, morale, leaders and grudges: they talk, bargain, surrender, flee and turn on their friends, not just trade blows.

## Why you'd want it

- Know whether an encounter is too easy or a wipe before the table finds out.
- Run big or messy fights without running every monster by hand.
- Keep playing when a player is away: FastFighting can take their character's turns.
- Get a fight told as a story, or as every roll, in chat.

The [guide](docs/guide.md) covers every button and setting; [STATS_AND_FORMULAS_README.md](STATS_AND_FORMULAS_README.md) has the numbers behind each decision.

## Requirements

- Foundry v14
- A helper module for your game system, which supplies the rules (see [systems.md](systems.md)):
  - [FastFighting PF2e](https://github.com/galaara98/FastFighting-PF2e) for Pathfinder Second Edition
  - [FastFighting D&D 5e](https://github.com/galaara98/FastFighting-DnD5e) for Dungeons & Dragons Fifth Edition
  - [FastFighting DCC](https://github.com/galaara98/FastFighting-DCC) for Dungeon Crawl Classics and Xcrawl Classics
  - [FastFighting Ironsworn](https://github.com/galaara98/FastFighting-Ironsworn) for Ironsworn and Starforged
  - [FastFighting Daggerheart](https://github.com/galaara98/FastFighting-Daggerheart) for Daggerheart

Without a helper, FastFighting stays inactive unless you turn on its experimental generic adapter.

Developers writing a helper: [CODING_README.md](CODING_README.md).

## Installation

In Foundry, go to **Add-on Modules → Install Module**, paste this manifest URL, then install your system's helper:

```
https://github.com/galaara98/FastFighting/releases/latest/download/module.json
```
