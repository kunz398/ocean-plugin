function clamp01(v) { return Math.min(1, Math.max(0, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpRgb(a, b, t) {
  return [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];
}

function stopsColormap(stops) {
  return (t) => {
    const x = clamp01(t);
    for (let i = 1; i < stops.length; i++) {
      const [t1, c1] = stops[i];
      const [t0, c0] = stops[i - 1];
      if (x <= t1) return lerpRgb(c0, c1, (x - t0) / (t1 - t0));
    }
    return stops[stops.length - 1][1];
  };
}

function jet(t) {
  const x = clamp01(t);
  return [
    Math.round(clamp01(1.5 - Math.abs(4 * x - 3)) * 255),
    Math.round(clamp01(1.5 - Math.abs(4 * x - 2)) * 255),
    Math.round(clamp01(1.5 - Math.abs(4 * x - 1)) * 255),
  ];
}

function redBlue(t) {
  const x = clamp01(t);
  const blue = [0, 0, 255], white = [255, 255, 255], red = [255, 0, 0];
  return x <= 0.5 ? lerpRgb(blue, white, x / 0.5) : lerpRgb(white, red, (x - 0.5) / 0.5);
}

// X-SST colormap — desaturated mid-greens to reduce visual fatigue at 2–3 m
const X_SST_STOPS = [
  [0.0,  [8,   15,  120]],   // deep navy
  [0.1,  [10,  55,  210]],   // cobalt blue
  [0.2,  [0,   130, 225]],   // sky blue
  [0.3,  [20,  190, 200]],   // teal-cyan
  [0.4,  [45,  195, 145]],   // soft sea-green
  [0.5,  [90,  195, 70 ]],   // muted green (was pure [0,255,0])
  [0.6,  [175, 205, 35 ]],   // olive-lime
  [0.7,  [225, 195, 30 ]],   // golden yellow
  [0.8,  [230, 115, 20 ]],   // amber-orange
  [0.9,  [215, 40,  20 ]],   // crimson
  [1.0,  [130, 0,   5  ]],   // deep red
];

function xSst(t) {
  const x = clamp01(t);
  for (let i = 1; i < X_SST_STOPS.length; i++) {
    const [t1, c1] = X_SST_STOPS[i];
    const [t0, c0] = X_SST_STOPS[i - 1];
    if (x <= t1) {
      const f = (x - t0) / (t1 - t0);
      return lerpRgb(c0, c1, f);
    }
  }
  return X_SST_STOPS[X_SST_STOPS.length - 1][1];
}

// ColorBrewer 11-class Spectral — matches div-Spectral used on the WMS layer and sidebar legend
const spectral = stopsColormap([
  [0.0,  [158,   1,  66]],
  [0.1,  [213,  62,  79]],
  [0.2,  [244, 109,  67]],
  [0.3,  [253, 174,  97]],
  [0.4,  [254, 224, 139]],
  [0.5,  [255, 255, 191]],
  [0.6,  [230, 245, 152]],
  [0.7,  [171, 221, 164]],
  [0.8,  [102, 194, 165]],
  [0.9,  [ 50, 136, 189]],
  [1.0,  [ 94,  79, 162]],
]);

// Magma — kept for reference but period layers now use YlOrRd
const magma = stopsColormap([
  [0.0,   [  0,   0,   4]],
  [0.143, [ 40,  11,  84]],
  [0.286, [101,  21, 110]],
  [0.429, [159,  42,  99]],
  [0.571, [212,  72,  66]],
  [0.714, [245, 125,  32]],
  [0.857, [252, 194,  84]],
  [1.0,   [252, 253, 191]],
]);

// YlOrRd (ColorBrewer) — pale yellow → amber → orange → red → crimson.
// Used for wave period: short period = light, long energetic swell = deep red.
const ylOrRd = stopsColormap([
  [0.00, [255, 255, 178]],  // pale yellow    — 0 s
  [0.25, [254, 204,  92]],  // warm amber     — ~5 s
  [0.50, [253, 141,  60]],  // orange         — ~10 s
  [0.75, [240,  59,  32]],  // red-orange     — ~15 s
  [1.00, [189,   0,  38]],  // dark crimson   — 20 s+
]);

// Wave-height palette: light-blue (calm) → teal → amber → orange → red (dangerous).
// Perceptually uniform steps; distinguishable under deuteranopia/protanopia.
const waveHeight = stopsColormap([
  [0.00, [220, 240, 255]],  // near-white light blue  — 0 m (calm)
  [0.15, [100, 195, 230]],  // sky blue               — ~0.75 m
  [0.30, [ 30, 170, 200]],  // teal                   — ~1.5 m
  [0.45, [ 50, 190, 130]],  // teal-green             — ~2.25 m
  [0.60, [245, 200,  50]],  // amber                  — ~3 m
  [0.75, [240, 120,  20]],  // orange                 — ~3.75 m
  [0.90, [210,  40,  20]],  // red                    — ~4.5 m
  [1.00, [120,   0,  30]],  // dark crimson           — 5 m+
]);

// Wave-period palette: cream → gold → amber → rust → dark brick.
// Warm earth tones — instantly distinct from the cool wave-height blues.
const wavePeriod = stopsColormap([
  [0.00, [255, 250, 215]],  // pale cream             — 0 s (very short)
  [0.25, [255, 200,  50]],  // warm gold              — ~5 s
  [0.50, [240, 130,  15]],  // amber-orange           — ~10 s
  [0.75, [195,  60,  15]],  // rust                   — ~15 s
  [1.00, [110,  20,  10]],  // dark brick-red         — 20 s+
]);

function quantize(fn, bands) {
  const lut = Array.from({ length: bands }, (_, i) => fn(i / (bands - 1)));
  return (t) => lut[Math.min(bands - 1, Math.floor(clamp01(t) * bands))];
}

export function getColormap(name, numBands = null) {
  const n = (typeof name === 'string' ? name : '').trim().toLowerCase();
  let fn;
  if (n === 'red-blue' || n === 'redblue' || n === 'red_blue') fn = redBlue;
  else if (n === 'x-sst' || n === 'xsst') fn = xSst;
  else if (n === 'spectral') fn = spectral;
  else if (n === 'magma') fn = magma;
  else if (n === 'wave-height' || n === 'waveheight') fn = waveHeight;
  else if (n === 'wave-period' || n === 'waveperiod') fn = wavePeriod;
  else if (n === 'ylorrd' || n === 'yl-or-rd') fn = ylOrRd;
  else fn = jet;
  return numBands ? quantize(fn, numBands) : fn;
}
