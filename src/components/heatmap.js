// src/components/heatmap.js

// One heatmap instance (per container) needs to re-layout when:
// - the tab becomes visible (display: none -> block)
// - iOS Safari's viewport height changes (address bar show/hide)
// - orientation/resize happens
// We keep the last tiles/timeframe/options per container and re-render on resize.
const HEATMAP_STATE = new WeakMap();

// iOS Safari/WKWebView can report transient sizes during first paint (address bar settling).
// To avoid a brief wrong layout, only draw after the container size is stable for a couple frames.
const STABLE_FRAMES_REQUIRED = 2;
const SIZE_EPS_PX = 0.5;

// Default content-fit heuristics (in px, at scale=1). Conservative.
const DEFAULT_BASE_CONTENT_HEIGHT_PX = 46; // logo (<=16) + 2 text lines + gaps
const DEFAULT_BASE_CONTENT_WIDTH_PX = 70;  // enough for symbol + %

const DEFAULT_MIN_PRIORITY_TEXT_SCALE = 0.78;

// tiles: [{ symbol, label?, marketCap?, changePct1D, changePct1W, logoUrl? }]
// options (optional):
//  {
//    mode: 'default' | 'crypto',
//    prioritySymbols: string[] (crypto: symbols that should keep text visible when possible)
//    forceTopFullWidthSymbol: string (crypto: e.g., 'BTC')
//    minPriorityTextScale: number (0-1), default 0.78
//  }
export function renderHeatmap(container, tiles, timeframe, options = {}) {
  if (!container) return;

  const state = HEATMAP_STATE.get(container) || {};
  state.tiles = tiles;
  state.timeframe = timeframe;
  state.options = options;

  if (!state._installed) {
    state._installed = true;

    if (typeof ResizeObserver !== 'undefined') {
      state.ro = new ResizeObserver(() => scheduleDraw(container));
      state.ro.observe(container);
    }

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
  const options = state.options || {};
  const mode = options.mode === 'crypto' ? 'crypto' : 'default';

  const { width: pxW, height: pxH } = container.getBoundingClientRect();
  if (!pxW || !pxH || pxW < 2 || pxH < 2) return;

  // Wait for stable size (prevents iOS "skinny tiles" flash on first paint)
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

  // Always show tiles even if marketCap is missing (fallback weight=1).
  // This prevents "only half show up" during partial data fetch.
  const nodes = tiles
    .map((t) => {
      const cap =
        typeof t.marketCap === 'number' && t.marketCap > 0 ? t.marketCap : 1;
      return { tile: t, weight: cap };
    })
    .filter((n) => n && typeof n.weight === 'number' && n.weight > 0);

  if (!nodes.length) return;

  const cfg = getRenderConfig(container, state, options);

  const rects =
    mode === 'crypto'
      ? computeCryptoTreemap(nodes, pxW, pxH, cfg)
      : computeSquarifyTreemap(nodes, pxW, pxH, { forceFirstStripHorizontal: true });

  rects.forEach(({ tile, x, y, w, h }) => {
    const el = document.createElement('div');

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

    el.style.left = `${x * 100}%`;
    el.style.top = `${y * 100}%`;
    el.style.width = `${w * 100}%`;
    el.style.height = `${h * 100}%`;

    const tileWidthPx = w * pxW;
    const tileHeightPx = h * pxH;

    // Compute scale: area-based, clamped by content fit.
    const areaNorm = w * h;
    let scale = 0.42 + Math.sqrt(areaNorm) * 3;

    const fitScale = Math.min(
      tileHeightPx / cfg.baseContentHeightPx,
      tileWidthPx / cfg.baseContentWidthPx
    );
    if (Number.isFinite(fitScale)) scale = Math.min(scale, fitScale);

    if (scale < 0.32) scale = 0.32;
    if (scale > 3) scale = 3;

    el.style.setProperty('--tile-scale', scale.toString());

    const pctDisplay =
      pct != null && !Number.isNaN(pct) ? `${pct.toFixed(2)}%` : '--';

    const sym = String(tile.symbol || '').toUpperCase();
    const isPriority = cfg.prioritySymbols.has(sym);

    // CRYPTO CONTENT RULES:
    // - Priority coins: show text (symbol + %). Logo shown only if it won't cramp.
    // - Non-priority coins: logo-only by default; show text only if tile is genuinely big.
    let showText = false;
    if (mode === 'crypto') {
      if (isPriority) {
        showText = true;
      } else {
        showText =
          scale >= 1.05 &&
          tileHeightPx >= cfg.baseContentHeightPx * 0.95 &&
          tileWidthPx >= cfg.baseContentWidthPx * 0.95;
      }
    } else {
      showText = scale >= 0.6;
    }

    const hasLogo = !!tile.logoUrl;

    // Logo policy:
    // - Crypto priority: show logo only if there's comfortable room; otherwise text wins.
    // - Crypto non-priority: logo is the fallback content; show if it fits at all.
    let showLogo = false;
    if (hasLogo) {
      if (mode === 'crypto') {
        if (isPriority) {
          // Require a bit more height so logo doesn't steal the vertical budget
          showLogo =
            tileHeightPx >= cfg.baseContentHeightPx * 0.90 &&
            tileWidthPx >= 22 &&
            scale >= cfg.minPriorityTextScale;
        } else {
          showLogo = tileHeightPx >= 18 && tileWidthPx >= 18;
        }
      } else {
        showLogo = tileHeightPx >= 18 && tileWidthPx >= 18 && scale >= 0.5;
      }
    }

    const logoHtml =
      showLogo && tile.logoUrl
        ? `<img class="tile-logo" src="${tile.logoUrl}" alt="${sym} logo" />`
        : '';

    const symbolHtml = showText ? `<div class="tile-symbol">${sym}</div>` : '';
    const pctHtml = showText ? `<div class="tile-pct">${pctDisplay}</div>` : '';

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

function getRenderConfig(container, state, options) {
  const prioritySymbols = new Set(
    (options.prioritySymbols || []).map((s) => String(s || '').toUpperCase())
  );

  if (!state._baseContentHeightPx || !state._baseContentWidthPx) {
    const measured = measureBaseContentSize(container);
    state._baseContentHeightPx = measured?.h || DEFAULT_BASE_CONTENT_HEIGHT_PX;
    state._baseContentWidthPx = measured?.w || DEFAULT_BASE_CONTENT_WIDTH_PX;
  }

  const minPriorityTextScale =
    typeof options.minPriorityTextScale === 'number' &&
    options.minPriorityTextScale > 0 &&
    options.minPriorityTextScale <= 1
      ? options.minPriorityTextScale
      : DEFAULT_MIN_PRIORITY_TEXT_SCALE;

  const baseH = state._baseContentHeightPx || DEFAULT_BASE_CONTENT_HEIGHT_PX;
  const baseW = state._baseContentWidthPx || DEFAULT_BASE_CONTENT_WIDTH_PX;

  return {
    prioritySymbols,
    forceTopFullWidthSymbol: options.forceTopFullWidthSymbol
      ? String(options.forceTopFullWidthSymbol).toUpperCase()
      : null,
    baseContentHeightPx: baseH,
    baseContentWidthPx: baseW,
    minPriorityTextScale,
    minPriorityStripHeightPx: baseH * minPriorityTextScale,
    minPriorityStripWidthPx: baseW * minPriorityTextScale,
  };
}

// Measure intrinsic size of (logo + symbol + %) at scale=1.
function measureBaseContentSize(container) {
  try {
    const probe = document.createElement('div');
    probe.style.position = 'absolute';
    probe.style.left = '-9999px';
    probe.style.top = '-9999px';
    probe.style.visibility = 'hidden';
    probe.style.pointerEvents = 'none';
    probe.className = 'heatmap-tile pct-neutral';
    probe.style.setProperty('--tile-scale', '1');

    const svg = encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="16"></svg>`
    );

    probe.innerHTML = `
      <div class="tile-content" style="height:auto; width:auto; transform: scale(1);">
        <img class="tile-logo" src="data:image/svg+xml,${svg}" alt="" />
        <div class="tile-symbol">TEST</div>
        <div class="tile-pct">0.00%</div>
      </div>
    `;

    container.appendChild(probe);

    const content = probe.querySelector('.tile-content');
    const rect = content
      ? content.getBoundingClientRect()
      : probe.getBoundingClientRect();

    probe.remove();

    // Add a small safety margin for padding/gaps.
    return { w: rect.width + 8, h: rect.height + 6 };
  } catch (_) {
    return null;
  }
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
 * Squarify treemap (classic market heatmap look).
 */
function computeSquarifyTreemap(nodes, containerW, containerH, opts = {}) {
  const totalWeight = nodes.reduce((s, n) => s + (n.weight || 0), 0);
  if (!nodes.length || totalWeight <= 0) return [];

  const sorted = [...nodes].sort((a, b) => b.weight - a.weight);

  const totalArea = containerW * containerH;
  const items = sorted.map((n) => ({
    tile: n.tile,
    area: (n.weight / totalWeight) * totalArea,
  }));

  const rectsPx = [];
  let rect = { x: 0, y: 0, w: containerW, h: containerH };
  let row = [];
  let firstStrip = !!opts.forceFirstStripHorizontal;

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
    if (s <= 0 || rect.w <= 0 || rect.h <= 0) return;

    const horizontal = firstStrip || rect.w >= rect.h;

    if (horizontal) {
      const rowH = s / rect.w;
      let x = rect.x;
      for (let i = 0; i < arr.length; i++) {
        const it = arr[i];
        let w = it.area / rowH;
        if (i === arr.length - 1) w = Math.max(0, rect.x + rect.w - x);
        rectsPx.push({ tile: it.tile, x, y: rect.y, w, h: rowH });
        x += w;
      }
      rect = { x: rect.x, y: rect.y + rowH, w: rect.w, h: Math.max(0, rect.h - rowH) };
    } else {
      const rowW = s / rect.h;
      let y = rect.y;
      for (let i = 0; i < arr.length; i++) {
        const it = arr[i];
        let h = it.area / rowW;
        if (i === arr.length - 1) h = Math.max(0, rect.y + rect.h - y);
        rectsPx.push({ tile: it.tile, x: rect.x, y, w: rowW, h });
        y += h;
      }
      rect = { x: rect.x + rowW, y: rect.y, w: Math.max(0, rect.w - rowW), h: rect.h };
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
    }
  }

  if (row.length) layoutRow(row);

  return rectsPx.map((r) => ({
    tile: r.tile,
    x: r.x / containerW,
    y: r.y / containerH,
    w: r.w / containerW,
    h: r.h / containerH,
  }));
}

/**
 * Crypto treemap:
 * - Force BTC (or configured symbol) as full-width top strip.
 * - AFTER BTC, prefer VERTICAL COLUMNS when the remaining region is short vertically
 *   (this is the core fix for the "tiny last row" created by BTC dominance).
 * - If a strip containing a priority symbol would be too thin (row height or column width),
 *   flip orientation so priority coins get enough room for logo + symbol + %.
 *
 * The effect: BTC top row, then ETH tends to become the left anchor (column),
 * and smaller coins collect to the right instead of being forced into a thin bottom strip.
 */
function computeCryptoTreemap(nodes, containerW, containerH, cfg) {
  const totalWeight = nodes.reduce((s, n) => s + (n.weight || 0), 0);
  if (!nodes.length || totalWeight <= 0) return [];

  const totalArea = containerW * containerH;

  // Largest first
  const sorted = [...nodes].sort((a, b) => b.weight - a.weight);

  let items = sorted.map((n) => ({
    tile: n.tile,
    area: (n.weight / totalWeight) * totalArea,
  }));

  const rectsPx = [];
  let rect = { x: 0, y: 0, w: containerW, h: containerH };

  // Force BTC full-width top strip if present
  if (cfg.forceTopFullWidthSymbol) {
    const idx = items.findIndex(
      (it) => String(it.tile?.symbol || '').toUpperCase() === cfg.forceTopFullWidthSymbol
    );
    if (idx >= 0) {
      const btc = items[idx];
      items = [...items.slice(0, idx), ...items.slice(idx + 1)];

      const btcH = rect.w > 0 ? Math.min(rect.h, btc.area / rect.w) : rect.h;

      rectsPx.push({
        tile: btc.tile,
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: btcH,
      });

      rect = {
        x: rect.x,
        y: rect.y + btcH,
        w: rect.w,
        h: Math.max(0, rect.h - btcH),
      };
    }
  }

  if (rect.w <= 0 || rect.h <= 0 || items.length === 0) {
    return rectsPx.map((r) => ({
      tile: r.tile,
      x: r.x / containerW,
      y: r.y / containerH,
      w: r.w / containerW,
      h: r.h / containerH,
    }));
  }

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

  const stripHasPriority = (arr) =>
    arr.some((it) => cfg.prioritySymbols.has(String(it.tile?.symbol || '').toUpperCase()));

  // Greedy strip build (squarify rule)
  const buildStrip = (remaining, side) => {
    const strip = [];
    let i = 0;
    while (i < remaining.length) {
      const it = remaining[i];
      if (!strip.length) {
        strip.push(it);
        i += 1;
        continue;
      }
      const currentWorst = worst(strip, side);
      const nextWorst = worst([...strip, it], side);
      if (nextWorst <= currentWorst) {
        strip.push(it);
        i += 1;
      } else {
        break;
      }
    }
    return strip;
  };

  const layoutStrip = (strip, rectLocal, horizontal) => {
    const s = sumArea(strip);
    if (s <= 0 || rectLocal.w <= 0 || rectLocal.h <= 0) return rectLocal;

    if (horizontal) {
      const stripH = s / rectLocal.w;
      let x = rectLocal.x;
      for (let i = 0; i < strip.length; i++) {
        const it = strip[i];
        let w = it.area / stripH;
        if (i === strip.length - 1) w = Math.max(0, rectLocal.x + rectLocal.w - x);
        rectsPx.push({ tile: it.tile, x, y: rectLocal.y, w, h: stripH });
        x += w;
      }
      return {
        x: rectLocal.x,
        y: rectLocal.y + stripH,
        w: rectLocal.w,
        h: Math.max(0, rectLocal.h - stripH),
      };
    } else {
      const stripW = s / rectLocal.h;
      let y = rectLocal.y;
      for (let i = 0; i < strip.length; i++) {
        const it = strip[i];
        let h = it.area / stripW;
        if (i === strip.length - 1) h = Math.max(0, rectLocal.y + rectLocal.h - y);
        rectsPx.push({ tile: it.tile, x: rectLocal.x, y, w: stripW, h });
        y += h;
      }
      return {
        x: rectLocal.x + stripW,
        y: rectLocal.y,
        w: Math.max(0, rectLocal.w - stripW),
        h: rectLocal.h,
      };
    }
  };

  let remaining = items.slice();
  let safeGuard = 0;

  while (remaining.length && rect.w > 0 && rect.h > 0 && safeGuard < 300) {
    safeGuard += 1;

    // IMPORTANT CRYPTO HEURISTIC:
    // Prefer columns when the remaining region is short vertically (rect.h < rect.w).
    // This is what prevents "tiny last rows" after BTC dominates height.
    let horizontal = rect.h >= rect.w; // true => row, false => column

    const side = Math.min(rect.w, rect.h);
    let strip = buildStrip(remaining, side);
    if (!strip.length) strip = [remaining[0]];

    const hasPriority = stripHasPriority(strip);

    if (horizontal) {
      // Would-be row height
      const stripH = sumArea(strip) / rect.w;
      if (hasPriority && stripH < cfg.minPriorityStripHeightPx) {
        // Too short for priority content → use a column instead
        horizontal = false;
      }
    } else {
      // Would-be column width
      const stripW = sumArea(strip) / rect.h;
      if (hasPriority && stripW < cfg.minPriorityStripWidthPx) {
        // Too narrow for priority content → use a row instead
        horizontal = true;
      }
    }

    rect = layoutStrip(strip, rect, horizontal);
    remaining = remaining.slice(strip.length);

    if (rect.w <= 0 || rect.h <= 0) break;
  }

  return rectsPx.map((r) => ({
    tile: r.tile,
    x: r.x / containerW,
    y: r.y / containerH,
    w: r.w / containerW,
    h: r.h / containerH,
  }));
}
