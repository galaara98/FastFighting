/**
 * The Battle Vantage's map of minds: every creature (and the things they want: a door, a trap, an item) as a node,
 * every desire, condition and goal toward someone or something as an arrow between them, and what a creature has on
 * its own (prone, unaware of the fight, thinking of running) as symbols around it. Nodes start where their tokens
 * stand on the map; the GM drags them aside (the arrows stay on), pans, and zooms. A click (a press without a drag)
 * focuses a creature. Each arrow and symbol shows its intensity (a hidden 1 for one that's only on or off), with one
 * less and one more (none at its most). With a creature in focus, what the pointer is on (or Tab steps to: act("next"))
 * glows and says what it is, and act("lower" | "raise") works on it; "raise" on the creature in focus asks
 * for a new line from it (onAdd). Ctrl-click (or Cmd-click) adds a creature to the selection or takes it away;
 * dragging one that's selected moves them all. A creature's menu (right-click): select or unselect it, select its
 * team, select its leader. The selection is kept in state.selected.
 *
 * Built from the graph the Battle Vantage makes ready (battle-vantage.js networkView), with words already in it:
 *   nodes: [{id, type: "creature"|"thing"|"elsewhere", name, img, icon, cls, status, x, y (feet), team, leaderId, marks: [mark]}]
 *   edges: [{id, from, to, cls, icon, text, tip, adjust, lower, raise}]
 *   mark:  {id, icon, text, tip, cls, adjust, lower, raise}
 */

/** Pixels a foot, laying nodes out as on the map. */
const SCALE = 12;
/** How close two nodes may sit, after laying them out (they're pushed apart). */
const ROOM = 140;
/** A node's radius: a creature's, a thing's. */
const RADIUS = { creature: 30, elsewhere: 24, thing: 20 };
/** How far apart arrows between the same two run, and how far round a node its symbols sit. */
const SPREAD = 26;
const MARK_RING = 44;
const ZOOM = { min: 0.2, max: 3, step: 1.2 };
/** A press that moves less than this is a click. */
const CLICK = 4;
/** The lines' layer: big enough to hold the whole diagram, its corner this far up and left of the diagram's. */
const SHEET = 20000;

const escape = s => foundry.utils.escapeHTML(String(s ?? ""));
const radiusOf = n => RADIUS[n?.type] ?? RADIUS.creature;

/**
 * Where each node goes, in the diagram's pixels: where the GM put it (pinned), else where its token stands on the
 * map, pushed apart from the others until none crowd.
 */
export function layoutNodes(nodes, pinned = new Map()) {
  const at = new Map();
  for ( const n of nodes ) {
    const p = pinned.get(n.id);
    at.set(n.id, p ? { x: p.x, y: p.y, fixed: true } : { x: (Number(n.x) || 0) * SCALE, y: (Number(n.y) || 0) * SCALE, fixed: false });
  }
  const list = nodes.map(n => at.get(n.id));
  // (The same spot: a little apart, the same way each time.)
  list.forEach((p, i) => {
    if ( p.fixed ) return;
    for ( let j = 0; j < i; j++ ) if ( Math.abs(list[j].x - p.x) < 0.5 && Math.abs(list[j].y - p.y) < 0.5 ) p.x += 7 * (i - j);
  });
  for ( let pass = 0; pass < 80; pass++ ) {
    let moved = false;
    for ( let i = 0; i < list.length; i++ ) {
      for ( let j = i + 1; j < list.length; j++ ) {
        const a = list[i];
        const b = list[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        if ( d >= ROOM ) continue;
        const push = (ROOM - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        if ( a.fixed && b.fixed ) continue;
        const share = a.fixed || b.fixed ? 2 : 1;
        if ( !a.fixed ) { a.x -= ux * push * share; a.y -= uy * push * share; }
        if ( !b.fixed ) { b.x += ux * push * share; b.y += uy * push * share; }
        moved = true;
      }
    }
    if ( !moved ) break;
  }
  return at;
}

/** The curve between two nodes (offset to one side by `bend`), trimmed to their edges: {d, mid, end, angle}. */
function curve(a, b, bend, ra, rb) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const c = { x: (a.x + b.x) / 2 + nx * bend, y: (a.y + b.y) / 2 + ny * bend };
  const trim = (p, toward, r) => {
    const tx = toward.x - p.x;
    const ty = toward.y - p.y;
    const tl = Math.hypot(tx, ty) || 1;
    return { x: p.x + (tx / tl) * r, y: p.y + (ty / tl) * r };
  };
  const s = trim(a, c, ra);
  const e = trim(b, c, rb + 6);
  const mid = { x: 0.25 * s.x + 0.5 * c.x + 0.25 * e.x, y: 0.25 * s.y + 0.5 * c.y + 0.25 * e.y };
  return { d: `M${s.x.toFixed(1)},${s.y.toFixed(1)} Q${c.x.toFixed(1)},${c.y.toFixed(1)} ${e.x.toFixed(1)},${e.y.toFixed(1)}`, mid, end: e, angle: Math.atan2(e.y - c.y, e.x - c.x) };
}

/** An arrowhead at a curve's end, pointing along it. */
function head(end, angle) {
  const size = 9;
  const p = (da, r) => `${(end.x + Math.cos(angle + da) * r).toFixed(1)},${(end.y + Math.sin(angle + da) * r).toFixed(1)}`;
  return `M${p(0, 6)} L${p(Math.PI * 0.82, size)} L${p(-Math.PI * 0.82, size)} Z`;
}

/** One less, one more: the buttons an intensity has (none where it can't go that way). */
function steps(item) {
  if ( !item.adjust ) return "";
  const data = escape(JSON.stringify(item.adjust));
  const less = item.lower ? `<a class="ff-net-step" data-adjust="${data}" data-step="-1" data-tooltip-text="${escape(item.lower)}"><i class="fa-solid fa-minus"></i></a>` : "";
  const more = item.raise ? `<a class="ff-net-step" data-adjust="${data}" data-step="1" data-tooltip-text="${escape(item.raise)}"><i class="fa-solid fa-plus"></i></a>` : "";
  return less || more ? `<span class="ff-net-steps">${less}${more}</span>` : "";
}

/**
 * The diagram, drawn into `root`. Returns {destroy}. `state` is kept by the caller between drawings: {pinned: Map
 * id -> {x, y}, view: {x, y, k} | null}; it's changed in place as the GM drags and zooms (onLayout says when).
 * @param {HTMLElement} root
 * @param {{nodes: object[], edges: object[]}} graph
 * @param {{state: object, focus: string|null, onFocus: Function, onAdjust: Function, onAdd: Function, onLayout: Function, words: object}} opts
 */
export function mountNetwork(root, graph, { state, focus = null, onFocus = () => {}, onAdjust = () => {}, onAdd = () => {}, onLayout = () => {}, words = {} }) {
  const at = layoutNodes(graph.nodes, state.pinned);
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const edges = graph.edges.filter(e => byId.has(e.from) && byId.has(e.to) && e.from !== e.to);
  // (Arrows between the same two, each a little to one side.)
  const pairs = new Map();
  for ( const e of edges ) {
    const key = [e.from, e.to].sort().join("|");
    if ( !pairs.has(key) ) pairs.set(key, []);
    pairs.get(key).push(e);
  }
  for ( const list of pairs.values() ) {
    list.forEach((e, i) => {
      const side = e.from < e.to ? 1 : -1;
      e.bend = (i - (list.length - 1) / 2) * SPREAD * side;
    });
  }
  const linked = id => !focus || id === focus;
  // (The selection: kept between drawings; only nodes still here.)
  state.selected = new Set([...(state.selected ?? [])].filter(id => byId.has(id)));
  const selected = state.selected;
  const lit = e => !focus || e.from === focus || e.to === focus;
  const near = e => !!focus && (e.from === focus || e.to === focus);

  root.innerHTML = `
    <div class="ff-net-world">
      <svg class="ff-net-edges" width="${2 * SHEET}" height="${2 * SHEET}" style="left:-${SHEET}px;top:-${SHEET}px" aria-hidden="true"><g transform="translate(${SHEET} ${SHEET})">
        ${edges.map(e => `<g class="ff-net-edge ${escape(e.cls)} ${lit(e) ? "" : "is-dim"}" data-edge="${escape(e.id)}"><path class="ff-net-hit" data-hit="${escape(e.id)}" data-tooltip-text="${escape(e.tip)}"/><path class="ff-net-line"/><path class="ff-net-head"/></g>`).join("")}
      </g></svg>
      ${edges.map(e => `<div class="ff-net-label ${escape(e.cls)} ${lit(e) ? "is-lit" : "is-dim"} ${near(e) ? "is-near" : ""}" data-label="${escape(e.id)}" data-tooltip-text="${escape(e.tip)}">
        <i class="${escape(e.icon)}"></i>${e.text ? `<span>${escape(e.text)}</span>` : ""}${steps(e)}</div>`).join("")}
      ${graph.nodes.map(n => {
        const marks = n.marks ?? [];
        return `<div class="ff-net-node is-${escape(n.type)} ${escape(n.cls ?? "")} ${n.id === focus ? "is-focus" : ""} ${selected.has(n.id) ? "is-selected" : ""} ${linked(n.id) ? "" : "is-dim"}" data-node="${escape(n.id)}"
          role="button" tabindex="0" data-tooltip-text="${escape(n.tip ?? n.name)}">
          <div class="ff-net-face">${n.img ? `<img src="${escape(n.img)}" alt="">` : `<i class="${escape(n.icon ?? "fa-solid fa-circle")}"></i>`}</div>
          <span class="ff-net-name">${escape(n.name)}</span>${n.status ? `<span class="ff-net-status">${escape(n.status)}</span>` : ""}
          ${marks.map((m, i) => {
            const angle = -Math.PI / 2 + (i - (marks.length - 1) / 2) * 0.62;
            const ring = MARK_RING + Math.floor(i / 9) * 22;
            return `<span class="ff-net-mark ${escape(m.cls ?? "")}" data-mark="${escape(`${n.id}|${m.id}`)}" style="left:${(Math.cos(angle) * ring).toFixed(1)}px;top:${(Math.sin(angle) * ring).toFixed(1)}px" data-tooltip-text="${escape(m.tip)}">
              <i class="${escape(m.icon)}"></i>${m.text ? `<b>${escape(m.text)}</b>` : ""}${steps(m)}</span>`;
          }).join("")}
        </div>`;
      }).join("")}
    </div>
    <div class="ff-net-tools">
      <button type="button" data-net="in" data-tooltip-text="${escape(words.zoomIn)}"><i class="fa-solid fa-magnifying-glass-plus"></i></button>
      <button type="button" data-net="out" data-tooltip-text="${escape(words.zoomOut)}"><i class="fa-solid fa-magnifying-glass-minus"></i></button>
      <button type="button" data-net="fit" data-tooltip-text="${escape(words.fit)}"><i class="fa-solid fa-expand"></i></button>
      <button type="button" data-net="reset" data-tooltip-text="${escape(words.reset)}"><i class="fa-solid fa-map-location-dot"></i></button>
    </div>`;

  const world = root.querySelector(".ff-net-world");
  const nodeEl = new Map([...root.querySelectorAll("[data-node]")].map(el => [el.dataset.node, el]));
  const edgeEl = new Map([...root.querySelectorAll("[data-edge]")].map(el => [el.dataset.edge, el]));
  const labelEl = new Map([...root.querySelectorAll("[data-label]")].map(el => [el.dataset.label, el]));
  const markEl = new Map([...root.querySelectorAll("[data-mark]")].map(el => [el.dataset.mark, el]));
  if ( focus ) root.classList.add("has-focus");
  else root.classList.remove("has-focus");

  const place = id => {
    const p = at.get(id);
    const el = nodeEl.get(id);
    if ( p && el ) el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
  };
  const draw = e => {
    const a = at.get(e.from);
    const b = at.get(e.to);
    const g = edgeEl.get(e.id);
    if ( !a || !b || !g ) return;
    const c = curve(a, b, e.bend, radiusOf(byId.get(e.from)), radiusOf(byId.get(e.to)));
    g.querySelector(".ff-net-line").setAttribute("d", c.d);
    g.querySelector(".ff-net-hit").setAttribute("d", c.d);
    g.querySelector(".ff-net-head").setAttribute("d", head(c.end, c.angle));
    const label = labelEl.get(e.id);
    if ( label ) label.style.transform = `translate(${c.mid.x.toFixed(1)}px, ${c.mid.y.toFixed(1)}px) translate(-50%, -50%)`;
  };
  for ( const n of graph.nodes ) place(n.id);
  for ( const e of edges ) draw(e);

  // The view: panned and zoomed, as it was (or everyone fitted in).
  const view = () => {
    const v = state.view;
    world.style.transform = `translate(${v.x.toFixed(1)}px, ${v.y.toFixed(1)}px) scale(${v.k.toFixed(3)})`;
  };
  const fit = () => {
    const pts = [...at.values()];
    const w = root.clientWidth || 600;
    const h = root.clientHeight || 400;
    if ( !pts.length ) {
      state.view = { x: w / 2, y: h / 2, k: 1 };
      return view();
    }
    const pad = 70;
    const minX = Math.min(...pts.map(p => p.x)) - pad;
    const maxX = Math.max(...pts.map(p => p.x)) + pad;
    const minY = Math.min(...pts.map(p => p.y)) - pad;
    const maxY = Math.max(...pts.map(p => p.y)) + pad;
    const k = Math.max(ZOOM.min, Math.min(1.4, w / (maxX - minX), h / (maxY - minY)));
    state.view = { k, x: w / 2 - ((minX + maxX) / 2) * k, y: h / 2 - ((minY + maxY) / 2) * k };
    view();
  };
  const zoomAt = (factor, cx, cy) => {
    const v = state.view;
    const k = Math.max(ZOOM.min, Math.min(ZOOM.max, v.k * factor));
    state.view = { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k };
    view();
    onLayout();
  };
  // (Fitted at once when it has a size; else as soon as it's drawn. Never without a view to pan and zoom.)
  if ( state.view ) view();
  else if ( root.clientWidth && root.clientHeight ) fit();
  else {
    state.view = { x: 0, y: 0, k: 1 };
    view();
    requestAnimationFrame(() => { if ( root.clientWidth ) fit(); });
  }

  // Dragging a node (its arrows with it), panning the rest; a press that doesn't move is a click.
  let press = null;
  const down = event => {
    if ( event.button !== 0 || event.target.closest(".ff-net-step, .ff-net-tools, .ff-net-menu, [data-hit], [data-label], [data-mark]") ) return;
    closeMenu();
    const el = event.target.closest("[data-node]");
    const id = el?.dataset.node ?? null;
    // (A selected one drags the whole selection with it.)
    const group = id && selected.has(id) ? [...selected] : id ? [id] : [];
    press = {
      id, x: event.clientX, y: event.clientY, moved: false, toggle: event.ctrlKey || event.metaKey,
      start: id ? { ...at.get(id) } : { ...state.view }, group: new Map(group.map(g => [g, { ...at.get(g) }]))
    };
    root.setPointerCapture(event.pointerId);
  };
  const move = event => {
    if ( !press ) return;
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    if ( !press.moved && Math.hypot(dx, dy) < CLICK ) return;
    press.moved = true;
    root.classList.add("is-dragging");
    if ( press.id ) {
      for ( const [g, start] of press.group ) {
        const p = at.get(g);
        p.x = start.x + dx / state.view.k;
        p.y = start.y + dy / state.view.k;
        p.fixed = true;
        place(g);
      }
      for ( const e of edges ) if ( press.group.has(e.from) || press.group.has(e.to) ) draw(e);
    } else {
      state.view = { ...state.view, x: press.start.x + dx, y: press.start.y + dy };
      view();
    }
  };
  const up = () => {
    if ( !press ) return;
    const { id, moved, toggle, group } = press;
    press = null;
    root.classList.remove("is-dragging");
    if ( !moved ) {
      // (Ctrl-click: in the selection or out of it. A plain click: in focus, the selection let go.)
      if ( toggle && id ) return setSelected(selected.has(id) ? [...selected].filter(x => x !== id) : [...selected, id]);
      if ( selected.size ) setSelected([], { quiet: true });
      return onFocus(id);
    }
    for ( const g of group?.keys() ?? [] ) {
      const p = at.get(g);
      state.pinned.set(g, { x: p.x, y: p.y });
    }
    onLayout();
  };
  /** The selection, as it is now (drawn on the nodes at once). */
  const setSelected = (ids, { quiet = false } = {}) => {
    selected.clear();
    for ( const id of ids ) if ( byId.has(id) ) selected.add(id);
    for ( const [id, el] of nodeEl ) el.classList.toggle("is-selected", selected.has(id));
    if ( !quiet ) onLayout();
  };

  // A creature's menu (right-click): select or unselect it, its team, its leader.
  let menu = null;
  const closeMenu = () => {
    menu?.remove();
    menu = null;
  };
  const openMenu = (event, id) => {
    closeMenu();
    const n = byId.get(id);
    if ( !n ) return;
    const team = graph.nodes.filter(o => o.type === "creature" && o.team && o.team === n.team).map(o => o.id);
    const items = [
      { act: "toggle", icon: selected.has(id) ? "fa-square-minus" : "fa-square-check", text: selected.has(id) ? words.unselect : words.select },
      ...(team.length > 1 ? [{ act: "team", icon: "fa-users", text: words.selectTeam }] : []),
      ...(n.leaderId && byId.has(n.leaderId) ? [{ act: "leader", icon: "fa-crown", text: words.selectLeader }] : [])
    ];
    const r = root.getBoundingClientRect();
    menu = document.createElement("menu");
    menu.className = "ff-net-menu";
    menu.style.left = `${event.clientX - r.left}px`;
    menu.style.top = `${event.clientY - r.top}px`;
    menu.innerHTML = items.map(i => `<li><button type="button" data-menu="${i.act}"><i class="fa-solid ${i.icon}"></i> ${escape(i.text)}</button></li>`).join("");
    menu.addEventListener("click", e => {
      const act = e.target.closest("[data-menu]")?.dataset.menu;
      if ( !act ) return;
      e.stopPropagation();
      if ( act === "toggle" ) setSelected(selected.has(id) ? [...selected].filter(x => x !== id) : [...selected, id]);
      else if ( act === "team" ) setSelected([...new Set([...selected, ...team])]);
      else if ( act === "leader" ) setSelected([...new Set([...selected, n.leaderId])]);
      closeMenu();
    });
    root.append(menu);
  };
  const context = event => {
    const el = event.target.closest("[data-node]");
    if ( !el ) return;
    event.preventDefault();
    openMenu(event, el.dataset.node);
  };
  const escapeKey = event => {
    if ( event.key === "Escape" ) closeMenu();
  };
  const wheel = event => {
    event.preventDefault();
    closeMenu();
    const r = root.getBoundingClientRect();
    zoomAt(event.deltaY < 0 ? ZOOM.step : 1 / ZOOM.step, event.clientX - r.left, event.clientY - r.top);
  };
  const click = event => {
    const step = event.target.closest(".ff-net-step");
    if ( step ) {
      event.stopPropagation();
      try {
        onAdjust(JSON.parse(step.dataset.adjust), Number(step.dataset.step));
      } catch ( err ) {
        console.error("fast-fighting | an intensity step", err);
      }
      return;
    }
    const tool = event.target.closest("[data-net]")?.dataset.net;
    if ( !tool ) return;
    const r = root.getBoundingClientRect();
    if ( tool === "in" ) zoomAt(ZOOM.step, r.width / 2, r.height / 2);
    else if ( tool === "out" ) zoomAt(1 / ZOOM.step, r.width / 2, r.height / 2);
    else if ( tool === "fit" ) { fit(); onLayout(); }
    else if ( tool === "reset" ) {
      state.pinned.clear();
      state.view = null;
      onLayout({ redraw: true });
    }
  };
  const key = event => {
    const el = event.target.closest?.("[data-node]");
    if ( el && (event.key === "Enter" || event.key === " ") ) {
      event.preventDefault();
      onFocus(el.dataset.node);
    }
  };
  // What the GM points at (or stepped to): it glows and says what it is, and the keys work on it. Only with a creature
  // in focus; kept across a redraw (one step after another), while it's still there.
  const marksOf = new Map(graph.nodes.map(n => [n.id, n.marks ?? []]));
  const edgeItem = id => {
    const e = edges.find(x => x.id === id);
    return e ? { kind: "edge", id, item: e } : null;
  };
  const markItem = key => {
    const at = key.indexOf("|");
    const item = marksOf.get(key.slice(0, at))?.find(m => m.id === key.slice(at + 1));
    return item ? { kind: "mark", id: key, item } : null;
  };
  const itemAt = el => {
    const line = el?.closest?.("[data-hit], [data-label]");
    if ( line ) return edgeItem(line.dataset.hit ?? line.dataset.label);
    const mark = el?.closest?.("[data-mark]");
    if ( mark ) return markItem(mark.dataset.mark);
    const node = el?.closest?.("[data-node]");
    return node && node.dataset.node === focus ? { kind: "node", id: focus } : null;
  };
  const looks = a => (a.kind === "edge" ? [edgeEl.get(a.id), labelEl.get(a.id)] : a.kind === "mark" ? [markEl.get(a.id)] : [nodeEl.get(a.id)]);
  const tipOf = a => (a.kind === "edge" ? labelEl.get(a.id) : a.kind === "mark" ? markEl.get(a.id) : nodeEl.get(a.id));
  let armed = null;
  const arm = (a, by) => {
    if ( armed ) for ( const el of looks(armed) ) el?.classList.remove("is-armed");
    armed = a;
    state.armed = a ? { kind: a.kind, id: a.id } : null;
    if ( !a ) return;
    for ( const el of looks(a) ) el?.classList.add("is-armed");
    // (Stepped to with a key: its words, as a hover would show them.)
    const el = tipOf(a);
    const text = a.item?.tip ?? el?.dataset.tooltipText;
    if ( by === "key" && el && text ) game.tooltip?.activate(el, { text });
  };
  if ( focus && state.armed ) {
    const a = state.armed.kind === "edge" ? edgeItem(state.armed.id) : state.armed.kind === "mark" ? markItem(state.armed.id) : state.armed.id === focus ? { kind: "node", id: focus } : null;
    arm(a, "redraw");
  } else state.armed = null;
  const over = event => {
    if ( !focus || press ) return;
    const a = itemAt(event.target);
    if ( a && (a.kind !== armed?.kind || a.id !== armed?.id) ) arm(a, "hover");
  };
  // (Tab and Shift+Tab: the next of the focused creature's lines and symbols; with nobody in focus, the next creature.)
  const cycle = dir => {
    const creatures = graph.nodes.filter(n => n.type === "creature").map(n => n.id);
    const items = focus ? [
      ...edges.filter(e => e.from === focus || e.to === focus).map(e => ({ kind: "edge", id: e.id, item: e })),
      ...(marksOf.get(focus) ?? []).map(m => ({ kind: "mark", id: `${focus}|${m.id}`, item: m }))
    ] : [];
    if ( !items.length ) {
      if ( !creatures.length ) return false;
      const i = creatures.indexOf(focus);
      onFocus(creatures[(i < 0 ? (dir > 0 ? 0 : creatures.length - 1) : i + dir + creatures.length) % creatures.length]);
      return true;
    }
    const i = armed ? items.findIndex(x => x.kind === armed.kind && x.id === armed.id) : -1;
    arm(items[(i < 0 ? (dir > 0 ? 0 : items.length - 1) : i + dir + items.length) % items.length], "key");
    return true;
  };
  root.addEventListener("pointerover", over);
  root.addEventListener("contextmenu", context);
  root.addEventListener("keydown", escapeKey);
  root.addEventListener("pointerdown", down);
  root.addEventListener("pointermove", move);
  root.addEventListener("pointerup", up);
  root.addEventListener("pointercancel", up);
  root.addEventListener("wheel", wheel, { passive: false });
  root.addEventListener("click", click);
  root.addEventListener("keydown", key);
  return {
    /** A key the GM pressed (Configure Controls): true if it was for the diagram. */
    act(action) {
      if ( action === "next" || action === "previous" ) return cycle(action === "next" ? 1 : -1);
      if ( !armed ) return false;
      if ( armed.kind === "node" ) {
        if ( action !== "raise" ) return false;
        onAdd(armed.id);
        return true;
      }
      const it = armed.item;
      if ( it.adjust && action === "raise" && it.raise ) onAdjust(it.adjust, 1);
      else if ( it.adjust && action === "lower" && it.lower ) onAdjust(it.adjust, -1);
      return true;
    },
    destroy() {
      closeMenu();
      root.removeEventListener("pointerover", over);
      root.removeEventListener("contextmenu", context);
      root.removeEventListener("keydown", escapeKey);
      root.removeEventListener("pointerdown", down);
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerup", up);
      root.removeEventListener("pointercancel", up);
      root.removeEventListener("wheel", wheel);
      root.removeEventListener("click", click);
      root.removeEventListener("keydown", key);
    }
  };
}
