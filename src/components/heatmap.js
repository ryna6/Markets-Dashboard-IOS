// src/components/heatmap.js

// One heatmap instance (per container) needs to re-layout when:
// - the tab becomes visible (display: none -> block)
// - iOS Safari's viewport height changes (address bar show/hide)
// - orientation/resize happens
// We keep the last tiles/timeframe per container and re-render on resize.
const HEATMAP_STATE = new WeakMap();

// iOS/WKWebView can report a transient viewport size during first paint
// (address bar settling). To prevent a brief "skinny tiles" flash, only
// draw after the container size is stable for a couple RAF frames.
const STABLE_FRAMES_REQUIRED = 2;
const SIZE_EPS_PX = 0.5;

// tiles: [{ symbol, label?, marketCap?, changePct1D, changePct1W, logoUrl? }]
export function renderHeatmap(container, tiles, timeframe) {
  if (!container) return;

  // Persist the latest data so we can re-render on resize/visibility changes.
  const state = HEATMAP_STATE.get(container) || {};
  state.tiles = tiles;
  state.timeframe = timeframe;

  // Install observers/listeners once per container.
  if (!state._installed) {
    state._installed = true;

    // ResizeObserver fires when the element gains a real size (e.g., tab shown)
    // and when iOS updates layout after viewport changes.
    if (typeof ResizeObserver !== 'undefined') {
      state.ro = new ResizeObserver(() => scheduleDraw(container));
      state.ro.observe(container);
    }

    // iOS Safari: visualViewport resize/scroll can change layout without a full window resize.
    if (window.visualViewport) {
      state.vvHandler = () => scheduleDraw(container);
      window.visualViewport.addEventListener('resize', state.vvHandler);
      window.visualViewport.addEventListener('scroll', state.vvHandler);
    }

    state.winHandler = () => scheduleDraw(container);
    window.addEventListener('resize', state.winHandler);
    window.addEventListener('orientationchange', state.winHandler);
  }

  HEATMAP_STATE.set(container, state);
  scheduleDraw(container);
}

function scheduleDraw(container) {
  const state = HEATMAP_STATE.get(container);
  if (!state) return;
  if (state.rafId) return;

  state.rafId = requestAnimationFrame(() => {
    state.rafId = null;
    draw(container);
  });
}

function draw(container) {
  const state = HEATMAP_STATE.get(container);
  if (!state) return;

  const tiles = Array.isArray(state.tiles) ? state.tiles : [];
  const timeframe = state.timeframe;

  // If the container is hidden (display:none) or not laid out yet, it will be 0x0.
  // Don't render (avoids the "long tile" bug); ResizeObserver will trigger when it becomes visible.
  const { width: pxW, height: pxH } = container.getBoundingClientRect();
  if (!pxW || !pxH || pxW < 2 || pxH < 2) return;

  // Wait until the container size is stable across a couple RAF frames.
  // This avoids a brief wrong aspect layout on iOS during initial viewport settling.
  const prevW = state._lastW;
  const prevH = state._lastH;
  const changed =
    prevW == null ||
    prevH == null ||
    Math.abs(pxW - prevW) > SIZE_EPS_PX ||
    Math.abs(pxH - prevH) > SIZE_EPS_PX;

  if (changed) {
    state._lastW = pxW;
    state._lastH = pxH;
    state._stableFrames = 0;
    state._stabilizeTries = (state._stabilizeTries || 0) + 1;

    // Cap the wait so we always render even if the viewport jitters.
    if (state._stabilizeTries < 12) {
      scheduleDraw(container);
      return;
    }
  } else {
    state._stableFrames = (state._stableFrames || 0) + 1;
    state._stabilizeTries = 0;

    if (state._stableFrames < STABLE_FRAMES_REQUIRED) {
      scheduleDraw(container);
      return;
    }
  }

  container.innerHTML = '';

  // Filter out anything without a positive market cap
  const valid = tiles.filter(
    (t) => typeof t.marketCap === 'number' && t.marketCap > 0
  );

  if (!valid.length) {
    return;
  }

  const totalCap = valid
    .map((t) => t.marketCap)
    .reduce((a, b) => a + b, 0);

  if (!totalCap) return;

  const nodes = valid.map((t) => ({
    tile: t,
    weight: t.marketCap,
  }));

  // Ordered "row" treemap:
  // - largest tiles start at top-left
  // - fill left-to-right across the top row
  // - then move to the next row (top-to-bottom)
  // This matches typical market heatmaps and avoids super-tall columns in portrait.
  const rects = computeRowTreemap(nodes, pxW, pxH);

  rects.forEach(({ tile, x, y, w, h }) => {
    const el = document.createElement('div');

    // Prefer timeframe-specific pct, but fall back to whichever exists
    const primary = timeframe === '1D' ? tile.changePct1D : tile.changePct1W;
    const fallback = timeframe === '1D' ? tile.changePct1W : tile.changePct1D;

    const pct =
      primary != null && !Number.isNaN(primary)
        ? primary
        : fallback != null && !Number.isNaN(fallback)
        ? fallback
        : null;

    const colorClass = pctColorClass(pct);
    el.className = `heatmap-tile ${colorClass}`;

    // Map normalized (0–1) rect coordinates into percentages of the container
    el.style.left = `${x * 100}%`;
    el.style.top = `${y * 100}%`;
    el.style.width = `${w * 100}%`;
    el.style.height = `${h * 100}%`;

    // Use area as a proxy for how much content we can safely show inside
    const area = w * h; // normalized area (0–1)
    let scale = 0.4 + Math.sqrt(area) * 3;

    // Clamp so it never gets too tiny or huge
    if (scale < 0.4) scale = 0.4;
    if (scale > 3) scale = 3;

    // Expose to CSS as a custom property (used by .tile-content)
    el.style.setProperty('--tile-scale', scale.toString());

    const pctDisplay =
      pct != null && !Number.isNaN(pct) ? `${pct.toFixed(2)}%` : '--';

    const logoHtml = tile.logoUrl
      ? `<img class="tile-logo" src="${tile.logoUrl}" alt="${tile.symbol} logo" />`
      : '';

    // Decide whether to show text based on tile scale
    // If scale < 0.6 → only logo; otherwise logo + symbol + %
    const showText = scale >= 0.8;

    const symbolHtml = showText
      ? `<div class="tile-symbol">${tile.symbol}</div>`
      : '';

    const pctHtml = showText
      ? `<div class="tile-pct">${pctDisplay}</div>`
      : '';

    el.innerHTML = `
      <div class="tile-content">
        ${logoHtml}
        ${symbolHtml}
        ${pctHtml}
      </div>
    `;

    container.appendChild(el);
  });
}

function pctColorClass(pct) {
  if (pct == null || Number.isNaN(pct)) return 'pct-neutral';
  if (pct > 3) return 'pct-strong-pos';
  if (pct > 0.5) return 'pct-pos';
  if (pct < -3) return 'pct-strong-neg';
  if (pct < -0.5) return 'pct-neg';
  return 'pct-neutral';
}

/**
 * Ordered "row" treemap (a squarify-style row builder, but with a fixed
 * top-to-bottom / left-to-right scan order).
 *
 * - nodes: [{ tile, weight }]
 * - containerW/H are in pixels
 *
 * Returns: [{ tile, x, y, w, h }] where x/y/w/h are normalized (0–1).
 */
function computeRowTreemap(nodes, containerW, containerH) {
  const totalWeight = nodes
    .map((n) => n.weight)
    .reduce((a, b) => a + b, 0);
  if (!nodes.length || totalWeight <= 0) return [];

  // Sort descending so biggest tiles start at top-left.
  const sorted = [...nodes].sort((a, b) => b.weight - a.weight);

  const totalArea = containerW * containerH;
  const items = sorted.map((n) => ({
    tile: n.tile,
    area: (n.weight / totalWeight) * totalArea,
  }));

  const rectsPx = [];
  let row = [];
  let y = 0;

  const w = containerW;

  function rowArea(r) {
    return r.reduce((s, it) => s + it.area, 0);
  }

  function worstAspect(r) {
    if (!r.length) return Infinity;
    const sum = rowArea(r);
    let min = Infinity;
    let max = 0;
    for (const it of r) {
      if (it.area < min) min = it.area;
      if (it.area > max) max = it.area;
    }
    // Same formula as classic squarify, but with fixed strip width = containerW.
    const sum2 = sum * sum;
    const w2 = w * w;
    return Math.max((w2 * max) / sum2, sum2 / (w2 * min));
  }

  function layoutRow(r, isLastRow) {
    const sum = rowArea(r);
    if (sum <= 0) return;

    // Nominal row height from area.
    let rowH = sum / w;
    if (isLastRow) {
      // Avoid tiny floating-point gaps at the bottom.
      rowH = Math.max(0, containerH - y);
      if (!rowH) return;
    }

    let x = 0;
    for (let i = 0; i < r.length; i++) {
      const it = r[i];
      let rectW = it.area / rowH;

      // Make the last tile in the row fill any rounding remainder.
      if (i === r.length - 1) {
        rectW = Math.max(0, w - x);
      }

      rectsPx.push({
        tile: it.tile,
        x,
        y,
        w: rectW,
        h: rowH,
      });
      x += rectW;
    }
    y += rowH;
  }

  for (const it of items) {
    if (!row.length) {
      row.push(it);
      continue;
    }

    const currentWorst = worstAspect(row);
    const nextWorst = worstAspect([...row, it]);

    if (nextWorst <= currentWorst) {
      row.push(it);
    } else {
      layoutRow(row, false);
      row = [it];
    }
  }

  if (row.length) layoutRow(row, true);

  // Convert px rects -> normalized coordinates.
  return rectsPx.map((r) => ({
    tile: r.tile,
    x: r.x / containerW,
    y: r.y / containerH,
    w: r.w / containerW,
    h: r.h / containerH,
  }));
}
