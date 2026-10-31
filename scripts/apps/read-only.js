/**
 * A Battle Planner or Battle Vantage in a GM's browser that isn't in control of FastFighting (foundry/control.js): read
 * only. A bar at its top says who's in control, with Take Control; its fields are off, and of its actions only those
 * that change nothing (`looks`: tabs, focus, panning) still work.
 */
import { MODULE_ID } from "../constants.js";
import { controller, inControl, takeControl } from "../foundry/control.js";

/** The apps already guarded: their root element, so its listener is added once. */
const guarded = new WeakSet();

/** An element's action: one that changes nothing, or none. */
const looksOnly = (el, looks) => !el?.dataset?.action || looks.includes(el.dataset.action);

/**
 * Drawn: read only where this browser isn't in control, else as it is. `looks`: the actions still allowed; `fields`:
 * a selector for the fields still allowed (a search box).
 */
export function readOnly(app, { looks = [], fields = "" } = {}) {
  const root = app?.element;
  if ( !root ) return;
  const off = !inControl();
  root.classList.toggle("ff-read-only", off);
  root.querySelector(":scope .ff-read-only-bar")?.remove();
  if ( !guarded.has(root) ) {
    guarded.add(root);
    // (Before the app's own click handling: an action that changes something does nothing here.)
    root.addEventListener("click", event => {
      if ( inControl() ) return;
      const el = event.target?.closest?.("[data-action]");
      if ( !el || !root.contains(el) || looksOnly(el, looks) ) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true });
  }
  if ( !off ) return;
  for ( const el of root.querySelectorAll("[data-action]") ) {
    if ( !looksOnly(el, looks) ) el.setAttribute("aria-disabled", "true");
  }
  for ( const el of root.querySelectorAll("input, select, textarea") ) {
    if ( !fields || !el.matches(fields) ) el.disabled = true;
  }
  const bar = document.createElement("div");
  bar.className = "ff-read-only-bar";
  const text = document.createElement("span");
  text.textContent = game.i18n.format("FASTFIGHTING.Control.ReadOnly", { name: controller()?.name ?? "" });
  const take = document.createElement("button");
  take.type = "button";
  take.className = "ff-take-control";
  take.innerHTML = `<i class="fa-solid fa-hand" aria-hidden="true"></i> `;
  take.append(game.i18n.localize("FASTFIGHTING.Control.Take"));
  take.addEventListener("click", async event => {
    event.preventDefault();
    take.disabled = true;
    try {
      await takeControl();
    } catch ( err ) {
      console.error(`${MODULE_ID} | taking control`, err);
      take.disabled = false;
    }
  });
  bar.append(text, take);
  // (Above the window's content, under its title: the content lays out its own parts.)
  const content = root.querySelector(":scope > .window-content");
  if ( content ) root.insertBefore(bar, content);
  else root.prepend(bar);
}
