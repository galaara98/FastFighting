/**
 * A friend's reaction to a blow on a friend (allyHit: PF2e's champion's reactions): only with the foe inside its reach
 * too where it says so (byRange: both in the champion's aura); its strike back as it allows (strikeBack: in reach, a
 * Step first, or a shot); what the system's own application does itself (applies), done by it; and told with what it did.
 */
import { describe, expect, test } from "vitest";
import { beginRun, prepareBattle, replay } from "../scripts/engine/simulator.js";
import { respond, strikeBack } from "../scripts/engine/behavior/responses.js";
import { logLine } from "../scripts/story/log-lines.js";
import { parseFormula, part } from "../scripts/engine/dice.js";
import { pf2eRules } from "./fixtures/three-action-rules.js";
import { creature, strike, battle } from "./helpers.js";

const at = (x, y = 0) => ({ x, y, size: 5 });
const champion = (over = {}) => ({ id: "seelah.retributive-strike", label: "Retributive Strike", on: "allyHit", range: 15, byRange: 15, reduce: part([], 3), strike: true, ...over });
const bow = () => strike({ id: "bow", name: "Shortbow", melee: false, reach: undefined, range: { increment: 60, max: 300 } });

function setUp({ foeAt = 10, reaction = champion(), actions = [strike({ id: "sword", bonus: 20 })] } = {}) {
  const run = beginRun(prepareBattle(battle([
    creature({ id: "seelah", position: at(0), actions, reactions: [reaction] }),
    creature({ id: "lem", position: at(0, 10), hp: { value: 100, max: 100 } }),
    creature({ id: "scout", side: "hostile", position: at(foeAt), flags: { fearless: true } })
  ], { positioning: true, maxRounds: 3 }), pf2eRules), 1, { log: true });
  return { run, by: id => run.byId.get(id) };
}

describe("the foe inside its reach too (byRange)", () => {
  test("both in the aura: it answers; the foe outside it, it doesn't", () => {
    const near = setUp({ foeAt: 10 });
    expect(respond(near.run, near.by("seelah"), "allyHit", { by: near.by("scout"), ally: near.by("lem"), damage: 6, types: ["piercing"] })).toBeTruthy();
    const far = setUp({ foeAt: 70 });
    expect(respond(far.run, far.by("seelah"), "allyHit", { by: far.by("scout"), ally: far.by("lem"), damage: 6, types: ["piercing"] })).toBeNull();
  });

  test("without byRange, only the friend's distance counts (a guardian's Intercept Attack)", () => {
    const far = setUp({ foeAt: 70, reaction: champion({ byRange: undefined }) });
    expect(respond(far.run, far.by("seelah"), "allyHit", { by: far.by("scout"), ally: far.by("lem"), damage: 6, types: ["piercing"] })).toBeTruthy();
  });
});

describe("its strike back (strikeBack)", () => {
  test("in reach: its melee strike; out of it: none, unless it may Step or shoot", () => {
    const close = setUp({ foeAt: 5 });
    expect(strikeBack(close.run, close.by("seelah"), close.by("scout"), champion())).toMatchObject({ strike: { id: "sword" }, step: 0 });
    const just = setUp({ foeAt: 10 });
    expect(strikeBack(just.run, just.by("seelah"), just.by("scout"), champion())).toBeNull();
    expect(strikeBack(just.run, just.by("seelah"), just.by("scout"), champion({ strikeStep: 5 }))).toMatchObject({ strike: { id: "sword" }, step: 5 });
    const archer = setUp({ foeAt: 14, actions: [strike({ id: "sword", bonus: 20 }), bow()] });
    expect(strikeBack(archer.run, archer.by("seelah"), archer.by("scout"), champion())).toBeNull();
    expect(strikeBack(archer.run, archer.by("seelah"), archer.by("scout"), champion({ strikeRanged: true }))).toMatchObject({ strike: { id: "bow" } });
  });

  test("in a whole fight: the reaction is told with whom it shielded and what it took off; out of reach, said so", () => {
    let told = null;
    for ( let seed = 1; seed <= 12 && !told; seed++ ) {
      const r = replay(battle([
        creature({ id: "seelah", position: at(0), reactions: [champion()], actions: [strike({ id: "sword", bonus: 0, damage: [parseFormula("1", "slashing")] })] }),
        creature({ id: "lem", position: at(0, 10), hp: { value: 200, max: 200 }, actions: [strike({ bonus: 0, damage: [parseFormula("1", "slashing")] })] }),
        creature({ id: "scout", side: "hostile", position: at(5, 14), hp: { value: 200, max: 200 }, flags: { fearless: true }, tactics: { target: "nearest" }, actions: [bow()] })
      ], { positioning: true, maxRounds: 2 }), pf2eRules, seed);
      told = r.log.find(e => e.type === "reaction" && e.trigger === "allyHit");
    }
    expect(told).toMatchObject({ actorId: "seelah", ally: "lem", allyId: "lem", struck: false });
    expect(told.took).toBeGreaterThan(0);
    expect(logLine(told)).toContain("lem");
  });
});
