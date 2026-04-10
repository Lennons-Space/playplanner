/**
 * Coordinate utilities — privacy and safety helpers.
 *
 * Data minimisation (GDPR Art.5(1)(c)): we round coordinates to 3 decimal
 * places (~111m precision) before sending to the server. Exact GPS precision
 * is never needed for venue discovery and is unnecessarily identifying.
 */

/** Round a coordinate value to 3 decimal places (~111m precision). */
export function roundCoordinate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Apply coordinate rounding to a lat/lng pair. */
export function coarsenCoordinates(
  lat: number,
  lng: number,
): { latitude: number; longitude: number } {
  return {
    latitude: roundCoordinate(lat),
    longitude: roundCoordinate(lng),
  };
}

/**
 * Basic bounds check — rejects clearly invalid coordinates before they
 * reach PostGIS (which would throw an internal error we don't want leaking).
 */
export function isValidCoordinate(lat: number, lng: number): boolean {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
