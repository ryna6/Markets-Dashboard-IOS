// src/components/heatmap.js

// One heatmap instance (per container) needs to re-layout when:
// - the tab becomes visible (display: none -> block)
// - iOS Safari's viewport height changes (address bar show/hide)
// - orientation/resize happens
// We keep the last tiles/timeframe per container and re-render on resize.
const HEATMAP_STATE = new WeakMap();

// iOS/WKWebView can report a transient viewport size during first paint.
// To avoid a brief "skinny tiles" flash, wait for stable size for 2 RAF frames.
const STABLE_FRAMES_REQUIRED = 2;
const SIZE_EPS_PX = 0.5;

// Content fitting (logo + symbol + %).
// This doesn't change tile area, but it prevents clipping by scaling content
// down when tiles are short.
const CONTENT_MIN_HEIGHT_PX = 46;
const CONTENT_MIN_WIDTH_PX = 70;

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
  // Don't render; ResizeObserver will trigger when it becomes visible.
  const { width: pxW, height: pxH } = container.getBoundingClientRect();
  if (!pxW || !pxH || pxW < 2 || pxH < 2) return;

  // Wait until the container size is stable across a couple RAF frames.
  // This avoids a wrong initial aspect on iOS during viewport settling.
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
  if (!tiles.length) return;

  // IMPORTANT: don't drop tiles if marketCap is missing.
  // On first open, Finnhub rate limits can temporarily prevent some market caps/logos
  // from loading. We fall back to weight=1 so every symbol still renders.
  const nodes = tiles
    .map((t) => {
      const cap =
        typeof t.marketCap === 'number' && t.marketCap > 0 ? t.marketCap : 1;
      return { tile: t, weight: cap };
    })
    .filter((n) => n && typeof n.weight === 'number' && n.weight > 0);

  if (!nodes.length) return;

  // Squarify treemap (keeps near-square rectangles and naturally avoids tiny-height rows).
  // Largest starts at top-left; we force the first strip horizontal so the biggest names
  // fill the top row left-to-right.
  const rects = computeSquarifyTreemap(nodes, pxW, pxH);

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

    const tileWidthPx = w * pxW;
    const tileHeightPx = h * pxH;

    // Area-based scale, but clamp by content-fit so we don't clip text on short tiles.
    const areaNorm = w * h; // normalized (0–1)
    let scale = 0.42 + Math.sqrt(areaNorm) * 3;
    const fitScale = Math.min(
      tileHeightPx / CONTENT_MIN_HEIGHT_PX,
      tileWidthPx / CONTENT_MIN_WIDTH_PX
    );
    if (Number.isFinite(fitScale)) scale = Math.min(scale, fitScale);

    // Clamp so it never gets too tiny or huge
    if (scale < 0.32) scale = 0.32;
    if (scale > 3) scale = 3;

    el.style.setProperty('--tile-scale', scale.toString());

    const pctDisplay =
      pct != null && !Number.isNaN(pct) ? `${pct.toFixed(2)}%` : '--';

    // Logos eat vertical space; only show when the tile can comfortably fit it.
    const showLogo =
      !!tile.logoUrl &&
      tileWidthPx >= 42 &&
      tileHeightPx >= 42 &&
      scale >= 0.55;

    const logoHtml = showLogo
      ? `<img class="tile-logo" src="${tile.logoUrl}" alt="${tile.symbol} logo" />`
      : '';

    const symbolHtml = `<div class="tile-symbol">${tile.symbol}</div>`;
    const pctHtml = `<div class="tile-pct">${pctDisplay}</div>`;

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
 * Squarify treemap.
 * - Preserves descending order (largest first) so the top-left starts with the biggest.
 * - Automatically alternates between horizontal/vertical strips based on remaining rectangle.
 * - First strip is forced horizontal so the largest names fill the top row left-to-right.
 *
 * nodes: [{ tile, weight }]
 * returns: [{ tile, x, y, w, h }] with x/y/w/h normalized (0–1)
 */
function computeSquarifyTreemap(nodes, containerW, containerH) {
  const totalWeight = nodes.reduce((s, n) => s + (n.weight || 0), 0);
  if (!nodes.length || totalWeight <= 0) return [];

  // Largest first
  const sorted = [...nodes].sort((a, b) => b.weight - a.weight);
  const totalArea = containerW * containerH;
  const items = sorted.map((n) => ({
    tile: n.tile,
    area: (n.weight / totalWeight) * totalArea,
  }));

  const rectsPx = [];
  let rect = { x: 0, y: 0, w: containerW, h: containerH };
  let row = [];
  let firstStrip = true;

  const sumArea = (arr) => arr.reduce((s, it) => s + it.area, 0);
  const worst = (arr, side) => {
    if (!arr.length) return Infinity;
    const s = sumArea(arr);
    let min = Infinity;
    let max = 0;
    for (const it of arr) {
      if (it.area < min) min = it.area;
      if (it.area > max) max = it.area;
    }
    const s2 = s * s;
    const side2 = side * side;
    return Math.max((side2 * max) / s2, s2 / (side2 * min));
  };

  const layoutRow = (arr) => {
    const s = sumArea(arr);
    if (s <= 0) return;

    // Force the first strip horizontal (top row), then squarify normally.
    const horizontal = firstStrip || rect.w >= rect.h;

    if (horizontal) {
      const rowH = s / rect.w;
      let x = rect.x;
      for (let i = 0; i < arr.length; i++) {
        const it = arr[i];
        let w = it.area / rowH;
        if (i === arr.length - 1) {
          // fill remainder to avoid rounding gaps
          w = Math.max(0, rect.x + rect.w - x);
        }
        rectsPx.push({ tile: it.tile, x, y: rect.y, w, h: rowH });
        x += w;
      }
      rect = {
        x: rect.x,
        y: rect.y + rowH,
        w: rect.w,
        h: Math.max(0, rect.h - rowH),
      };
    } else {
      const rowW = s / rect.h;
      let y = rect.y;
      for (let i = 0; i < arr.length; i++) {
        const it = arr[i];
        let h = it.area / rowW;
        if (i === arr.length - 1) {
          h = Math.max(0, rect.y + rect.h - y);
        }
        rectsPx.push({ tile: it.tile, x: rect.x, y, w: rowW, h });
        y += h;
      }
      rect = {
        x: rect.x + rowW,
        y: rect.y,
        w: Math.max(0, rect.w - rowW),
        h: rect.h,
      };
    }

    firstStrip = false;
  };

  let i = 0;
  while (i < items.length) {
    const it = items[i];
    if (!row.length) {
      row.push(it);
      i += 1;
      continue;
    }

    const side = Math.min(rect.w, rect.h);
    const currentWorst = worst(row, side);
    const nextWorst = worst([...row, it], side);

    if (nextWorst <= currentWorst) {
      row.push(it);
      i += 1;
    } else {
      layoutRow(row);
      row = [];
      // Don't increment i; retry adding it to the next row.
    }
  }

  if (row.length) layoutRow(row);

  // Normalize
  return rectsPx.map((r) => ({
    tile: r.tile,
    x: r.x / containerW,
    y: r.y / containerH,
    w: r.w / containerW,
    h: r.h / containerH,
  }));
}
