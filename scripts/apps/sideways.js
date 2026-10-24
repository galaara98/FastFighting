/**
 * A strip that scrolls sideways (the Battle Vantage's turn order, the survey's tabs): the mouse wheel over it scrolls it
 * sideways too, where it has more than it shows.
 */

/** The wheel over any of `root`'s strips matching `selector` scrolls it sideways (root: the window's own element). */
export function wheelSideways(root, selector) {
  root.addEventListener("wheel", event => {
    const strip = event.target.closest?.(selector);
    if ( !strip || strip.scrollWidth <= strip.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX) ) return;
    strip.scrollLeft += event.deltaY;
    event.preventDefault();
  }, { passive: false });
}
