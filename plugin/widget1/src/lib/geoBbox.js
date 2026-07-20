// geoBbox.js
// Small geographic helpers shared between the map UI and SuitabilityPDFExporter.js
// so both compute the same point-radius bbox and aspect ratio the same way.

const KM_PER_DEG_LAT = 111.32;

// Equirectangular approximation: fine at Niue's scale (500 m-few km bboxes).
export function bboxFromPointRadius(lon, lat, radiusKm) {
  const kmPerDegLon = KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const dLon = radiusKm / kmPerDegLon;
  return {
    lonMin: lon - dLon,
    lonMax: lon + dLon,
    latMin: lat - dLat,
    latMax: lat + dLat,
  };
}

export function bboxAspectRatio({ lonMin, lonMax, latMin, latMax }) {
  const latMidRad = ((latMin + latMax) / 2 * Math.PI) / 180;
  const lonSpan = (lonMax - lonMin) * Math.cos(latMidRad);
  const latSpan = latMax - latMin;
  return lonSpan / latSpan;
}
