# FastFighting: supported systems

FastFighting Core is system agnostic, but it needs a **helper module** to understand each game system. The helper explains:
- how actors store HP, defenses, attacks and spells
- the system's rules for hitting, saving and dying
- how outcomes are written back

Without a helper for your world's system, FastFighting stays inactive: its settings are greyed out and the Combat Tracker shows a notice. If you want to try anyway, turn on *Use the experimental generic adapter*.

| System | Foundry system id | Helper module | Repository | Manifest URL |
| --- | --- | --- | --- | --- |
| Pathfinder Second Edition | `pf2e` | FastFighting PF2e (`fast-fighting-pf2e`) | https://github.com/galaara98/FastFighting-PF2e | https://github.com/galaara98/FastFighting-PF2e/releases/latest/download/module.json |
| Dungeons & Dragons Fifth Edition | `dnd5e` | FastFighting D&D 5e (`fast-fighting-dnd5e`) | https://github.com/galaara98/FastFighting-DnD5e | https://github.com/galaara98/FastFighting-DnD5e/releases/latest/download/module.json |
| Dungeon Crawl Classics (and Xcrawl Classics) | `dcc` | FastFighting DCC (`fast-fighting-dcc`) | https://github.com/galaara98/FastFighting-DCC | https://github.com/galaara98/FastFighting-DCC/releases/latest/download/module.json |
| Ironsworn and Starforged | `foundry-ironsworn` | FastFighting Ironsworn (`fast-fighting-ironsworn`) | https://github.com/galaara98/FastFighting-Ironsworn | https://github.com/galaara98/FastFighting-Ironsworn/releases/latest/download/module.json |

Each helper declares its system in `module.json` (`relationships.systems`), so Foundry only offers it in worlds of that system. The core also ignores any helper that registers for a different system than the world's.

## Writing a helper for another system

See the *For system and module developers* section of the [README](README.md). FastFighting PF2e is the reference implementation. When yours is published, open a pull request adding a row to the table above, and an entry to `KNOWN_HELPERS` in `scripts/helpers.js`, so GMs on that system are pointed to it.
