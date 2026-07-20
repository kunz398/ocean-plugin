// canvasRaster.js — colors a regular-grid array of values onto a <canvas>,
// either via a continuous colormap or discrete threshold bands. Shared by
// ZarrOverlay (wave/wind layers) and SfincsRasterOverlay (inundation),
// so both raster overlays produce pixels identically.

// Row-major values below this are treated as transparent/no-data — mirrors
// the SFINCS backend's `masked = where(v >= vmin, v, nan)` floor.
const DEFAULT_MIN_VISIBLE = Number.MIN_VALUE; // effectively "v > 0", matching legacy `v <= 0` cutoff

export function renderToCanvas(values, rows, cols, colormap, vmin, vmax, opacity, thresholds, minVisible = DEFAULT_MIN_VISIBLE) {
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(cols, rows);
  const px = imgData.data;
  const span = vmax - vmin || 1;
  const alpha = Math.round(opacity * 255);
  const hasThresholds = thresholds?.length > 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = values[r * cols + c];
      const pxIdx = (r * cols + c) * 4;
      if (!Number.isFinite(v) || v < minVisible) { px[pxIdx + 3] = 0; continue; }
      let color;
      if (hasThresholds) {
        // find which threshold band this value falls in
        color = null;
        for (let t = thresholds.length - 1; t >= 0; t--) {
          if (v >= thresholds[t].value) { color = thresholds[t].color; break; }
        }
        if (!color) { px[pxIdx + 3] = 0; continue; }
      } else {
        const t = Math.max(0, Math.min(1, (v - vmin) / span));
        color = colormap(t);
      }
      px[pxIdx] = color[0];
      px[pxIdx + 1] = color[1];
      px[pxIdx + 2] = color[2];
      px[pxIdx + 3] = alpha;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

// SFINCS/backend rendering always flips vertically when latitude is stored
// ascending (south→north), so row 0 of the output image is north — matching
// the MapLibre image-source coordinate convention (top-left = north-west).
export function flipRowsVertically(values, rows, cols) {
  const out = new values.constructor(values.length);
  for (let r = 0; r < rows; r++) {
    out.set(values.subarray(r * cols, (r + 1) * cols), (rows - 1 - r) * cols);
  }
  return out;
}
