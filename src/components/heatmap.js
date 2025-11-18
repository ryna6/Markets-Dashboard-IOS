// src/components/heatmap.js

// tiles: [{ symbol, label?, marketCap?, changePct1D, changePct1W, logoUrl? }]
export function renderHeatmap(container, tiles, timeframe) {
  if (!container) return;

  container.innerHTML = '';

  // Filter out anything without a positive market cap
  const valid = tiles.filter(
    (t) => typeof t.marketCap === 'number' && t.marketCap > 0
  );

  if (!valid.length) {
    return;
  }

  // Normalize market caps into weights
  const totalCap = valid
    .map((t) => t.marketCap)
    .reduce((a, b) => a + b, 0);

  if (!totalCap) return;

  const nodes = valid.map((t) => ({
    tile: t,
    weight: t.marketCap,
  }));

  // Choose an initial orientation based on the container aspect ratio.
  // On tall screens (like phones in portrait), start with a horizontal split
  // so we fill top-to-bottom instead of left-to-right, which produces
  // squarer tiles and avoids super-tall columns.
  const { clientWidth, clientHeight } = container;
  let initialOrientation = 'vertical';
  if (clientHeight > clientWidth) {
    initialOrientation = 'horizontal';
  }

  const rects = computeTreemap(nodes, 0, 0, 1, 1, initialOrientation);

  rects.forEach(({ tile, x, y, w, h }) => {
    const el = document.createElement('div');

    // Prefer timeframe-specific pct, but fall back to whichever exists
    const primary =
      timeframe === '1D' ? tile.changePct1D : tile.changePct1W;
    const fallback =
      timeframe === '1D' ? tile.changePct1W : tile.changePct1D;

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
    let scale = 0.5 + Math.sqrt(area) * 3;

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
    // If scale < 0.8 → only logo; otherwise logo + symbol + %
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
 * Simple binary slice treemap:
 * - nodes: [{ tile, weight }]
 * - x, y, w, h: numbers in [0,1] representing the rectangle
 * - orientation: 'vertical' or 'horizontal'
 *
 * Returns: [{ tile, x, y, w, h }]
 */
function computeTreemap(nodes, x, y, w, h, orientation) {
  const totalWeight = nodes
    .map((n) => n.weight)
    .reduce((a, b) => a + b, 0);

  if (!nodes.length || totalWeight <= 0) return [];

  if (nodes.length === 1) {
    return [
      {
        tile: nodes[0].tile,
        x,
        y,
        w,
        h,
      },
    ];
  }

  // Sort descending by weight
  const sorted = [...nodes].sort((a, b) => b.weight - a.weight);

  // Partition into two groups with roughly equal total weight
  const groupA = [];
  const groupB = [];
  let sumA = 0;
  const half = totalWeight / 2;

  for (const node of sorted) {
    if (sumA < half) {
      groupA.push(node);
      sumA += node.weight;
    } else {
      groupB.push(node);
    }
  }

  const weightA = groupA
    .map((n) => n.weight)
    .reduce((s, v) => s + v, 0);
  const weightB = totalWeight - weightA;

  let rects = [];

  if (orientation === 'vertical') {
    const wA = (weightA / totalWeight) * w;
    const wB = w - wA;

    rects = rects
      .concat(
        computeTreemap(groupA, x, y, wA, h, 'horizontal'),
      )
      .concat(
        computeTreemap(groupB, x + wA, y, wB, h, 'horizontal'),
      );
  } else {
    const hA = (weightA / totalWeight) * h;
    const hB = h - hA;

    rects = rects
      .concat(
        computeTreemap(groupA, x, y, w, hA, 'vertical'),
      )
      .concat(
        computeTreemap(groupB, x, y + hA, w, hB, 'vertical'),
      );
  }

  return rects;
}
