// src/components/heatmap.js

// tiles: [{ symbol, label?, marketCap?, changePct1D, changePct1W, logoUrl? }]
export function renderHeatmap(container, tiles, timeframe) {
  if (!container) return;

  container.innerHTML = '';

  // Filter to valid market caps
  const valid = tiles.filter(
    (t) => typeof t.marketCap === 'number' && t.marketCap > 0
  );
  if (!valid.length) return;

  // 👉 Sort descending by market cap so largest is always left-most
  const sorted = [...valid].sort((a, b) => b.marketCap - a.marketCap);

  const totalCap = sorted
    .map((t) => t.marketCap)
    .reduce((a, b) => a + b, 0);
  if (!totalCap) return;

  let xCursor = 0; // fraction of container width [0,1]

  sorted.forEach((tile) => {
    const weight = tile.marketCap;
    const frac = weight / totalCap;

    // Skip insanely tiny fractions to avoid 0-width tiles
    if (frac <= 0) {
      return;
    }

    const el = document.createElement('div');

    // Pick the right % change based on timeframe, fallback if missing
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
    el.style.left = `${xCursor * 100}%`;
    el.style.top = `0%`;
    el.style.width = `${frac * 100}%`;
    el.style.height = `100%`;

    const pctDisplay =
      pct != null && !Number.isNaN(pct) ? `${pct.toFixed(2)}%` : '--';

    const logoHtml = tile.logoUrl
      ? `<img class="tile-logo" src="${tile.logoUrl}" alt="${tile.symbol} logo" />`
      : '';

    el.innerHTML = `
      <div class="tile-header">
        ${logoHtml}
        <div class="tile-symbol">${tile.symbol}</div>
      </div>
      ${tile.label ? `<div class="tile-label">${tile.label}</div>` : ''}
      <div class="tile-pct">${pctDisplay}</div>
    `;

    container.appendChild(el);

    xCursor += frac;
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
