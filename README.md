# FastFighting

A system-agnostic [Foundry VTT](https://foundryvtt.com) module to speed up combat.

## Installation

In Foundry, go to **Add-on Modules → Install Module** and paste this manifest URL:

```
https://github.com/galaara98/FastFighting/releases/latest/download/module.json
```

## Development

Symlink or copy this folder into your Foundry data directory as `Data/modules/fast-fighting`, then enable it in a world.

## Releasing

Bump `version` in `module.json`, commit, then push a tag `vX.Y.Z`. The GitHub Action builds `module.zip` and attaches it with `module.json` to a release.
