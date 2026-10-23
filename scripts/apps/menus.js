/**
 * The menus of FastFighting's windows: popovers (`popover`, opened by a button's `popovertarget`), placed beside the
 * button that opened them and closed once an item is used (but for one marked `data-keep-open`: a two-step item, armed
 * by its first press). Escape closes one through the `closeMenu` keybinding (main.js), ahead of Foundry's own Escape,
 * which closes the window.
 */
import { clamp } from "../constants.js";

/** A menu just opened: under the button that opened it, right-aligned to it, kept on the screen. */
export function placePopover(pop, root) {
  const opener = root.querySelector(`[popovertarget="${pop.id}"]`);
  if ( !opener ) return;
  const r = opener.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const left = clamp(r.right - w, 8, window.innerWidth - w - 8);
  const below = r.bottom + 4;
  const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 4) : below;
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

/** A window's menus placed as they open and closed once used (its element: the window's own, kept across drawings). */
export function listenMenus(root) {
  // (A menu's opening doesn't bubble: caught on the way down.)
  root.addEventListener("toggle", event => {
    const t = event.target;
    if ( t.matches?.("[popover]") && event.newState === "open" ) placePopover(t, root);
  }, true);
  root.addEventListener("click", event => {
    const item = event.target.closest?.("[data-action], [data-ff-action]");
    const pop = item?.closest("[popover]");
    if ( pop && !item.dataset.keepOpen ) pop.hidePopover?.();
  });
}
