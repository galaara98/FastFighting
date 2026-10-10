const MODULE_ID = "fast-fighting";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing FastFighting`);

  game.settings.register(MODULE_ID, "enabled", {
    name: "FASTFIGHTING.Settings.Enabled.Name",
    hint: "FASTFIGHTING.Settings.Enabled.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | Ready (system: ${game.system.id})`);
});
