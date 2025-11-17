// src/components/heatmap.js

// tiles: [{ symbol, label?, marketCap?, changePct1D, changePct1W }]
export function renderHeatmap(container, tiles, timeframe) {
  if (!container) return;

  container.innerHTML = '';

  // Filter out anything without a positive market cap
  const valid = tiles.filter(
    (t) => typeof t.marketCap === 'number' && t.marketCap > 0
  );

  if (!valid.length) {
    // Fallback: no market caps, nothing to draw
    return;
  }

  const totalCap = valid
    .map((t) => t.marketCap)
    .reduce((a, b) => a + b, 0);

  // Build nodes with weight = marketCap
  const nodes = valid.map((t) => ({
    tile: t,
    weight: t.marketCap,
  }));

  const rects = computeTreemap(nodes, 0, 0, 1, 1, 'vertical');

  rects.forEach(({ tile, x, y, w, h }) => {
    const el = document.createElement('div');
    const pct =
      timeframe === '1D' ? tile.changePct1D : tile.changePct1W;

    const colorClass = pctColorClass(pct);

    el.className = `heatmap-tile ${colorClass}`;
    el.style.left = `${x * 100}%`;
    el.style.top = `${y * 100}%`;
    el.style.width = `${w * 100}%`;
    el.style.height = `${h * 100}%`;

    const pctDisplay =
      pct != null && !Number.isNaN(pct) ? `${pct.toFixed(2)}%` : '--';

    el.innerHTML = `
      <div class="tile-symbol">${tile.symbol}</div>
      ${tile.label ? `<div class="tile-label">${tile.label}</div>` : ''}
      <div class="tile-pct">${pctDisplay}</div>
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
