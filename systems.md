# FastFighting: supported systems

FastFighting Core is system agnostic: a **helper module** for each game system tells it how actors store HP, defenses, attacks and spells, the system's rules for hitting, saving and dying, and how to write outcomes back.

Without a helper for your world's system, FastFighting stays inactive: its settings are greyed out and the Combat Tracker shows a notice. To try anyway, turn on *Use the experimental generic adapter*.

| System | Foundry system id | Helper module | Repository | Manifest URL |
| --- | --- | --- | --- | --- |
| Pathfinder Second Edition | `pf2e` | FastFighting PF2e (`fast-fighting-pf2e`) | https://github.com/galaara98/FastFighting-PF2e | https://github.com/galaara98/FastFighting-PF2e/releases/latest/download/module.json |
| Dungeons & Dragons Fifth Edition | `dnd5e` | FastFighting D&D 5e (`fast-fighting-dnd5e`) | https://github.com/galaara98/FastFighting-DnD5e | https://github.com/galaara98/FastFighting-DnD5e/releases/latest/download/module.json |
| Dungeon Crawl Classics (and Xcrawl Classics) | `dcc` | FastFighting DCC (`fast-fighting-dcc`) | https://github.com/galaara98/FastFighting-DCC | https://github.com/galaara98/FastFighting-DCC/releases/latest/download/module.json |
| Ironsworn and Starforged | `foundry-ironsworn` | FastFighting Ironsworn (`fast-fighting-ironsworn`) | https://github.com/galaara98/FastFighting-Ironsworn | https://github.com/galaara98/FastFighting-Ironsworn/releases/latest/download/module.json |
| Daggerheart | `daggerheart` | FastFighting Daggerheart (`fast-fighting-daggerheart`) | https://github.com/galaara98/FastFighting-Daggerheart | https://github.com/galaara98/FastFighting-Daggerheart/releases/latest/download/module.json |

Each helper declares its system in `module.json` (`relationships.systems`), so Foundry offers it only in worlds of that system, and the core ignores a helper registered for a system other than the world's.

## Writing a helper for another system

See [CODING_README.md](CODING_README.md#writing-a-system-helper). FastFighting PF2e is the reference implementation. Once yours is published, open a pull request that adds a row to the table above and an entry to `KNOWN_HELPERS` in `scripts/helpers.js`, so GMs on that system are pointed to it.
