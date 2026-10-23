/**
 * The settings window's groups (settings.js): every setting and menu the window shows is in one group, the groups come
 * in a fixed order, each has its heading in languages/en.json, and FastFighting's tab is laid out in them.
 */
import { afterEach, describe, expect, test } from "vitest";
import { SETTING_GROUPS, settingsLayout, groupSettings, helperGroup, registerSettings } from "../scripts/settings.js";
import { MODULE_ID } from "../scripts/constants.js";
import { en, text } from "./foundry-i18n.js";

/** What registerSettings asks Foundry for: {settings: {id: data}, menus: {id: data}}, only what the window shows. */
function registered() {
  const settings = {};
  const menus = {};
  globalThis.game.settings = {
    register: (namespace, key, data) => { if ( data.config ) settings[`${namespace}.${key}`] = data; },
    registerMenu: (namespace, key, data) => { menus[`${namespace}.${key}`] = data; }
  };
  class Window {}
  registerSettings(Window, Window, Window, Window);
  return { settings, menus };
}

const placed = () => settingsLayout().flatMap(g => g.keys);

describe("every setting has a group", () => {
  test("each setting and menu the window shows is in one group, and nothing else is", () => {
    const { settings, menus } = registered();
    const shown = [...Object.keys(settings), ...Object.keys(menus)];
    expect(shown.filter(id => !placed().includes(id))).toEqual([]);
    expect(placed().filter(id => !shown.includes(id))).toEqual([]);
    expect(placed().length).toBe(new Set(placed()).size);
  });

  test("no group is empty", () => {
    expect(settingsLayout().filter(g => !g.keys.length).map(g => g.group)).toEqual([]);
  });

  test("Foundry isn't handed the group", () => {
    const { settings, menus } = registered();
    expect([...Object.values(settings), ...Object.values(menus)].filter(data => "group" in data)).toEqual([]);
  });

  test("each setting has a name and a hint, and each menu a name, a button and a hint", () => {
    const { settings, menus } = registered();
    const missing = [
      ...Object.values(settings).flatMap(s => [s.name, s.hint]),
      ...Object.values(menus).flatMap(m => [m.name, m.label, m.hint])
    ].filter(key => !(key in en));
    expect(missing).toEqual([]);
  });
});

describe("the groups", () => {
  test("come in this order", () => {
    expect(SETTING_GROUPS).toEqual(["live", "story", "planner", "behavior", "luck", "after", "troubleshooting", "generic"]);
    expect(settingsLayout().map(g => g.group)).toEqual(SETTING_GROUPS);
  });

  test("each has its heading in languages/en.json, and no heading is left over", () => {
    for ( const group of SETTING_GROUPS ) expect(text(`FASTFIGHTING.Settings.Group.${group}`)).toBeTruthy();
    const headings = Object.keys(en).filter(k => k.startsWith("FASTFIGHTING.Settings.Group.")).map(k => k.split(".").pop());
    expect(headings.sort()).toEqual([...SETTING_GROUPS].sort());
  });
});

/**
 * FastFighting's tab of the settings window, as far as groupSettings reads and writes it: each id's row (its own form
 * group), found by its input's name or its menu button's key, and what's appended to the tab.
 */
function tab(ids) {
  const rows = new Map(ids.map(id => [id, { id, closest: selector => (selector === ".form-group" ? rows.get(id) : null) }]));
  const children = [];
  return {
    children,
    querySelector(selector) {
      if ( selector === ".ff-settings-group" ) return children.find(c => c.className === "ff-settings-group") ?? null;
      const [, name, key] = selector.match(/^\[name="([^"]+)"\], \[data-key="([^"]+)"\]$/) ?? [];
      return name === key ? rows.get(name) ?? null : null;
    },
    append(...elements) { children.push(...elements); }
  };
}

describe("the settings window", () => {
  afterEach(() => { delete globalThis.document; });
  const fakeDocument = () => {
    globalThis.document = {
      createElement: tag => ({ tag, className: "", dataset: {}, textContent: "", children: [], append(...els) { this.children.push(...els); } })
    };
  };

  test("FastFighting's tab in its groups, in order, each a fieldset under its heading", () => {
    fakeDocument();
    const section = tab(placed());
    groupSettings(section);
    expect(section.children.map(f => [f.tag, f.className, f.dataset.group])).toEqual(SETTING_GROUPS.map(g => ["fieldset", "ff-settings-group", g]));
    for ( const [i, { group, keys }] of settingsLayout().entries() ) {
      const [legend, ...rows] = section.children[i].children;
      expect(legend.tag).toBe("legend");
      expect(legend.textContent).toBe(text(`FASTFIGHTING.Settings.Group.${group}`));
      expect(rows.map(r => r.id)).toEqual(keys);
    }
  });

  test("what isn't shown is skipped, and a group with nothing shown left out; laid out once", () => {
    fakeDocument();
    const live = settingsLayout().find(g => g.group === "live").keys;
    const section = tab([`${MODULE_ID}.troubleshooting`, ...live.slice(1)]);
    groupSettings(section);
    expect(section.children.map(f => f.dataset.group)).toEqual(["live", "troubleshooting"]);
    expect(section.children[0].children.slice(1).map(r => r.id)).toEqual(live.slice(1));
    groupSettings(section);
    expect(section.children.length).toBe(2);
  });

  /** The settings window as helperGroup reads it: the helper's own tab (its rows) and its button. */
  function window(rows) {
    const theirs = { classList: { contains: () => false }, querySelectorAll: () => rows };
    const button = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
    const root = { querySelector: selector => (selector.startsWith("section") ? theirs : selector.startsWith("nav") ? button : null) };
    const section = { children: [], querySelector: () => null, append(...els) { this.children.push(...els); } };
    return { root, section, button };
  }

  test("the system's helper's own settings at the foot, under its name; its own tab's button hidden", () => {
    fakeDocument();
    globalThis.game.modules = new Map([["ff-helper", { title: "FastFighting Helper", active: true }]]);
    const { root, section, button } = window([{ id: "loreBoost" }, { id: "tiedStopsSpells" }]);
    helperGroup(null, root, section, "ff-helper");
    const [fieldset] = section.children;
    expect([fieldset.tag, fieldset.dataset.group]).toEqual(["fieldset", "helper"]);
    expect(fieldset.children.map(c => c.id ?? c.textContent)).toEqual(["FastFighting Helper", "loreBoost", "tiedStopsSpells"]);
    expect(button.attrs.hidden).toBe("");
  });

  test("no helper, or one with no settings of its own: nothing", () => {
    fakeDocument();
    for ( const [helper, rows] of [[null, [{ id: "x" }]], ["ff-helper", []]] ) {
      const { root, section, button } = window(rows);
      helperGroup(null, root, section, helper);
      expect(section.children).toEqual([]);
      expect(button.attrs.hidden).toBeUndefined();
    }
  });
});
