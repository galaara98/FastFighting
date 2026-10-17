/**
 * A window about to show another scene's or encounter's plan or battle: what the GM was typing kept first (the field
 * left, so its change is saved where it was typed), then its border blinks orange twice, quickly, before it's drawn
 * again for the new one.
 */
const BLINK_MS = 500;

/** Leave the field the GM is in, inside `app`, so what was typed is kept (its change saved as any other). */
export function keepTyping(app) {
  const active = document.activeElement;
  if ( active && app?.element?.contains(active) ) active.blur();
}

/** Blink `app`'s border orange twice; resolves once it has. */
export function blink(app) {
  const el = app?.element;
  if ( !el ) return Promise.resolve();
  el.classList.remove("ff-blink");
  void el.offsetWidth; // (begun again, if it was blinking already)
  el.classList.add("ff-blink");
  return new Promise(resolve => setTimeout(() => {
    el.classList.remove("ff-blink");
    resolve();
  }, BLINK_MS));
}
