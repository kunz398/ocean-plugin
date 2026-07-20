/**
 * Marine Data Color Schemes Utility
 * Centralized color functions for marine forecast visualization
 * 
 * These color schemes are ocean-harmonized to complement the blue app theme while maintaining
 * scientific accuracy and accessibility:
 * 
 * - Wave Height (hs): Ocean Viridis - deep blue to cyan/green, harmonizes with app theme
 * - Mean Wave Period (tm02): Ocean Harmony - blue through teal to emerald progression  
 * - Peak Wave Period (tpeak): Ocean Magma - deep blue through purple to coral warmth
 * - Wave Direction: Custom arrow-based visualization with compass directions
 * 
 * All palettes avoid harsh white backgrounds and maintain excellent contrast ratios
 * while creating a cohesive, professional marine forecasting interface.
 */

// Constants for better maintainability
const COLOR_INTERPOLATION = {
  SIX_HOUR_INTERVAL: 6,
  RANGE_PADDING_PERCENT: 0.1,
  BRIGHTNESS_THRESHOLD: 128
};

// Helper to interpolate between two colors
const lerpColor = (a, b, amount) => {
  const ar = a >> 16, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = b >> 16, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const rr = ar + amount * (br - ar);
  const rg = ag + amount * (bg - ag);
  const rb = ab + amount * (bb - ab);
  return `rgb(${Math.round(rr)}, ${Math.round(rg)}, ${Math.round(rb)})`;
};

// Enhanced color functions for marine data visualization matching WMS map palettes
export const jetColor = (value, min = 0, max = 4) => {
  let v = Math.max(min, Math.min(max, value));
  v = (v - min) / (max - min);
  let r = Math.floor(255 * Math.max(Math.min(1.5 - Math.abs(4 * v - 3), 1), 0));
  let g = Math.floor(255 * Math.max(Math.min(1.5 - Math.abs(4 * v - 2), 1), 0));
  let b = Math.floor(255 * Math.max(Math.min(1.5 - Math.abs(4 * v - 1), 1), 0));
  if ([r, g, b].some(x => isNaN(x))) return "rgb(127,127,127)";
  return `rgb(${r},${g},${b})`;
};

export const redColor = (value, min = 0, max = 20) => {
  let v = Math.max(min, Math.min(max, value));
  v = (v - min) / (max - min);
  // EXACT match to Niue: Light pink → Dark maroon
  const start = { r: 255, g: 229, b: 229 };  // Light pink (same as Niue)
  const end = { r: 127, g: 0, b: 0 };        // Dark maroon (same as Niue)
  const r = Math.round(start.r + (end.r - start.r) * v);
  const g = Math.round(start.g + (end.g - start.g) * v);
  const b = Math.round(start.b + (end.b - start.b) * v);
  return `rgb(${r},${g},${b})`;
};

export const blueColor = (value, min = 0, max = 5) => {
  let v = Math.max(min, Math.min(max, value));
  v = (v - min) / (max - min);
  // EXACT match to Niue: Light blue → Dark navy
  const start = { r: 232, g: 244, b: 255 };  // Light pastel blue (same as Niue)
  const end = { r: 0, g: 51, b: 102 };       // Dark navy (same as Niue)
  const r = Math.round(start.r + (end.r - start.r) * v);
  const g = Math.round(start.g + (end.g - start.g) * v);
  const b = Math.round(start.b + (end.b - start.b) * v);
  return `rgb(${r},${g},${b})`;
};

// OCEAN VIRIDIS palette for Wave Height (hs) - harmonized with blue app theme
export const viridisColor = (value, min = 0, max = 5) => {
  const v = Math.max(0, Math.min(1, (value - min) / (max - min)));
  
  // Ocean-harmonized Viridis: deep blue base blending to teal and warm highlights
  if (v <= 0.125) return lerpColor(0x1a365d, 0x2d5a87, v * 8);        // Deep ocean blue to darker blue
  if (v <= 0.25) return lerpColor(0x2d5a87, 0x3182ce, (v - 0.125) * 8); // Darker blue to ocean blue
  if (v <= 0.375) return lerpColor(0x3182ce, 0x38a169, (v - 0.25) * 8);  // Ocean blue to teal-green
  if (v <= 0.5) return lerpColor(0x38a169, 0x48bb78, (v - 0.375) * 8);   // Teal-green to seafoam
  if (v <= 0.625) return lerpColor(0x48bb78, 0x81c784, (v - 0.5) * 8);   // Seafoam to light green
  if (v <= 0.75) return lerpColor(0x81c784, 0xaed581, (v - 0.625) * 8);  // Light green to lime
  if (v <= 0.875) return lerpColor(0xaed581, 0xdce775, (v - 0.75) * 8);  // Lime to yellow-green
  return lerpColor(0xdce775, 0xffeb3b, (v - 0.875) * 8);                 // Yellow-green to golden yellow
};

// OCEAN HARMONY palette for Mean Wave Period - blends with blue app theme
export const ylgnbuColor = (value, min = 0, max = 20) => {
  const v = Math.max(0, Math.min(1, (value - min) / (max - min)));
  
  // Ocean-harmonized gradient from deep blue through teal to warm emerald
  if (v <= 0.125) return lerpColor(0x1e3a8a, 0x1e40af, v * 8);        // Deep blue to rich blue
  if (v <= 0.25) return lerpColor(0x1e40af, 0x2563eb, (v - 0.125) * 8); // Rich blue to bright blue
  if (v <= 0.375) return lerpColor(0x2563eb, 0x0891b2, (v - 0.25) * 8);  // Bright blue to cyan
  if (v <= 0.5) return lerpColor(0x0891b2, 0x0d9488, (v - 0.375) * 8);   // Cyan to teal
  if (v <= 0.625) return lerpColor(0x0d9488, 0x059669, (v - 0.5) * 8);   // Teal to emerald
  if (v <= 0.75) return lerpColor(0x059669, 0x16a34a, (v - 0.625) * 8);  // Emerald to green
  if (v <= 0.875) return lerpColor(0x16a34a, 0x65a30d, (v - 0.75) * 8);  // Green to lime
  return lerpColor(0x65a30d, 0xa3a322, (v - 0.875) * 8);                 // Lime to golden green
};

// ColorBrewer Spectral palette for Mean Wave Period.
// Matches the map/legend ramp: short periods red/orange, mid periods yellow/green,
// long energetic swell blue/purple.
export const spectralColor = (value, min = 0, max = 20) => {
  const v = Math.max(0, Math.min(1, (value - min) / (max - min)));

  if (v <= 0.1) return lerpColor(0x9e0142, 0xd53e4f, v * 10);
  if (v <= 0.2) return lerpColor(0xd53e4f, 0xf46d43, (v - 0.1) * 10);
  if (v <= 0.3) return lerpColor(0xf46d43, 0xfdae61, (v - 0.2) * 10);
  if (v <= 0.4) return lerpColor(0xfdae61, 0xfee08b, (v - 0.3) * 10);
  if (v <= 0.5) return lerpColor(0xfee08b, 0xffffbf, (v - 0.4) * 10);
  if (v <= 0.6) return lerpColor(0xffffbf, 0xe6f598, (v - 0.5) * 10);
  if (v <= 0.7) return lerpColor(0xe6f598, 0xabdda4, (v - 0.6) * 10);
  if (v <= 0.8) return lerpColor(0xabdda4, 0x66c2a5, (v - 0.7) * 10);
  if (v <= 0.9) return lerpColor(0x66c2a5, 0x3288bd, (v - 0.8) * 10);
  return lerpColor(0x3288bd, 0x5e4fa2, (v - 0.9) * 10);
};

// OCEAN MAGMA palette for Peak Wave Period - deep blue to warm coral harmony
export const magmaColor = (value, min = 0, max = 20) => {
  const v = Math.max(0, Math.min(1, (value - min) / (max - min)));
  
  // Ocean-harmonized magma: deep blue through purple to warm coral and gold
  if (v <= 0.125) return lerpColor(0x0f172a, 0x1e293b, v * 8);        // Very dark blue to dark slate
  if (v <= 0.25) return lerpColor(0x1e293b, 0x334155, (v - 0.125) * 8); // Dark slate to slate
  if (v <= 0.375) return lerpColor(0x334155, 0x6366f1, (v - 0.25) * 8);  // Slate to indigo
  if (v <= 0.5) return lerpColor(0x6366f1, 0x8b5cf6, (v - 0.375) * 8);   // Indigo to violet
  if (v <= 0.625) return lerpColor(0x8b5cf6, 0xd946ef, (v - 0.5) * 8);   // Violet to fuchsia
  if (v <= 0.75) return lerpColor(0xd946ef, 0xf97316, (v - 0.625) * 8);  // Fuchsia to orange
  if (v <= 0.875) return lerpColor(0xf97316, 0xfbbf24, (v - 0.75) * 8);  // Orange to amber
  return lerpColor(0xfbbf24, 0xfde047, (v - 0.875) * 8);                 // Amber to bright yellow
};

// Color function mapping - aligned with WMS map palettes
export const COLOR_FUNCTIONS = {
  jet: jetColor,
  rd: redColor,
  bu: blueColor,
  ylgnbu: ylgnbuColor,     // YlGnBu palette for wave periods
  viridis: viridisColor,   // Viridis palette for wave heights
  spectral: spectralColor,
  magma: magmaColor,
  magenta: magmaColor,     // Backward-compatible alias for peak periods
  plasma: jetColor,        // Keep jet as plasma fallback
  default: blueColor,
};

// Utility to determine if a color is dark (for text contrast)
export const isColorDark = (colorString) => {
  if (!colorString) return false;
  let r, g, b;
  const rgbMatch = colorString.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (rgbMatch) {
    [r, g, b] = rgbMatch.slice(1, 4).map(Number);
  } else {
    return false;
  }
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness < COLOR_INTERPOLATION.BRIGHTNESS_THRESHOLD;
};

// Get color function by type with fallback
export const getColorFunction = (type) => {
  return COLOR_FUNCTIONS[type?.toLowerCase()] || COLOR_FUNCTIONS.default;
};

export { COLOR_INTERPOLATION };
