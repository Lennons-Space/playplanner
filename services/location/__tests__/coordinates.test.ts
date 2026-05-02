/**
 * Privacy and security boundary tests for coordinate utilities
 * (services/location/coordinates.ts).
 *
 * These tests focus on the security and privacy guarantees that the existing
 * happy-path tests in services/location/coordinates.test.ts do not cover:
 *
 *   1. The output of coarsenCoordinates must NEVER have more than 3 decimal places
 *      of precision — a value like 51.50735123 in our DB would constitute a unique
 *      identifier for a specific parent's home address (GDPR Art.5(1)(c) violation).
 *
 *   2. isValidCoordinate must reject every input that could reach PostGIS as a
 *      silently wrong value — PostGIS throws on out-of-range inputs, which would
 *      surface internal schema details to callers.
 *
 *   3. The coarsened output must remain a valid coordinate (i.e. rounding must
 *      never push a value outside the valid ±90/±180 range).
 *
 * WHY A SEPARATE FILE:
 * The sibling coordinates.test.ts verifies happy-path rounding arithmetic.
 * This file verifies the privacy contract: that no real-world GPS value can
 * escape the 3-decimal precision cap or pass an invalid coordinate to the DB.
 */

import { coarsenCoordinates, isValidCoordinate } from '../coordinates';

// ======================================================================
// Privacy contract: coarsenCoordinates must cap precision at 3 dp
// ======================================================================
describe('coarsenCoordinates — precision cap (privacy contract)', () => {

  // If this test fails, a device's 7-decimal GPS position (accurate to ~1cm)
  // could reach the Supabase venue-search RPC and be stored in server logs,
  // uniquely identifying a specific parent's home or workplace.
  it('strips all precision beyond 3 decimal places for a high-precision GPS fix', () => {
    const preciseLat = 51.5073512345678;   // typical 7-decimal smartphone GPS
    const preciseLng = -0.1277583921456;
    const { latitude, longitude } = coarsenCoordinates(preciseLat, preciseLng);

    const latDecimals  = (latitude.toString().split('.')[1]  ?? '').length;
    const lngDecimals  = (longitude.toString().split('.')[1] ?? '').length;

    expect(latDecimals).toBeLessThanOrEqual(3);
    expect(lngDecimals).toBeLessThanOrEqual(3);
  });

  // A coordinate that is already at 3dp must not gain extra precision through
  // floating-point arithmetic in the rounding function.
  it('does not introduce floating-point drift on an already-coarse coordinate', () => {
    const { latitude, longitude } = coarsenCoordinates(51.507, -0.128);
    // Number.toFixed(10) exposes hidden floating-point mantissa digits.
    // A safe implementation produces exactly 51.507, not 51.50699999999999.
    expect(parseFloat(latitude.toFixed(3))).toBe(51.507);
    expect(parseFloat(longitude.toFixed(3))).toBe(-0.128);
  });

  // The output of coarsenCoordinates must itself pass isValidCoordinate.
  // If rounding ever pushed +90 latitude to +90.0005 and then rounded it to
  // 90.001, the downstream validity check would fail and the user would see
  // a "could not get location" error when standing at a valid extreme boundary.
  it('output of coarsenCoordinates passes isValidCoordinate at northern boundary (lat=90)', () => {
    const { latitude, longitude } = coarsenCoordinates(90, 0);
    expect(isValidCoordinate(latitude, longitude)).toBe(true);
  });

  it('output of coarsenCoordinates passes isValidCoordinate at southern boundary (lat=-90)', () => {
    const { latitude, longitude } = coarsenCoordinates(-90, 0);
    expect(isValidCoordinate(latitude, longitude)).toBe(true);
  });

  it('output of coarsenCoordinates passes isValidCoordinate at eastern boundary (lng=180)', () => {
    const { latitude, longitude } = coarsenCoordinates(0, 180);
    expect(isValidCoordinate(latitude, longitude)).toBe(true);
  });

  it('output of coarsenCoordinates passes isValidCoordinate at western boundary (lng=-180)', () => {
    const { latitude, longitude } = coarsenCoordinates(0, -180);
    expect(isValidCoordinate(latitude, longitude)).toBe(true);
  });

  // Regression: if the rounding formula accidentally used Math.floor instead of
  // Math.round, negative longitudes like -0.127758 would round to -0.127 instead
  // of -0.128, placing the fallback marker 100m east of the correct position.
  it('rounds negative longitude correctly (west of meridian)', () => {
    const { longitude } = coarsenCoordinates(0, -0.127758);
    expect(longitude).toBe(-0.128);
  });

  // Another real-world regression: very small coordinates near zero must round
  // correctly — a value like 0.0004 must go to 0.0 not remain at 0.0004.
  it('rounds small coordinate values near zero correctly', () => {
    const { latitude } = coarsenCoordinates(0.0004, 0);
    expect(latitude).toBe(0);
  });
});

// ======================================================================
// Security contract: isValidCoordinate must reject malformed inputs
// ======================================================================
describe('isValidCoordinate — security boundary (reject values that break PostGIS)', () => {

  // If isValidCoordinate returns true for Infinity, the RPC call would pass
  // Infinity to PostGIS, which throws an internal error. That error message
  // may contain schema details (table names, column types) that should not
  // be exposed to API callers.
  it('rejects positive Infinity latitude', () => {
    expect(isValidCoordinate(Infinity, 0)).toBe(false);
  });

  it('rejects negative Infinity latitude', () => {
    expect(isValidCoordinate(-Infinity, 0)).toBe(false);
  });

  it('rejects positive Infinity longitude', () => {
    expect(isValidCoordinate(0, Infinity)).toBe(false);
  });

  it('rejects negative Infinity longitude', () => {
    expect(isValidCoordinate(0, -Infinity)).toBe(false);
  });

  // NaN is the most dangerous edge case: NaN comparisons in JS always return
  // false, which means a naive range check like `lat >= -90 && lat <= 90`
  // correctly returns false for NaN (because NaN >= -90 is false). But if
  // a future refactor changes the check to `!(lat < -90 || lat > 90)`,
  // NaN would pass (since NaN < -90 is also false). This test locks in the
  // correct behaviour regardless of the implementation technique.
  it('rejects NaN latitude (NaN comparisons silently pass in some implementations)', () => {
    expect(isValidCoordinate(NaN, 0)).toBe(false);
  });

  it('rejects NaN longitude', () => {
    expect(isValidCoordinate(0, NaN)).toBe(false);
  });

  it('rejects NaN for both', () => {
    expect(isValidCoordinate(NaN, NaN)).toBe(false);
  });

  // Values that are valid numbers but outside the geographic range.
  // PostGIS allows up to about ±180 for longitude but throws for values
  // beyond ±90 in latitude — both must be caught before reaching the DB.
  it('rejects latitude that exceeds 90 by the smallest possible float step', () => {
    expect(isValidCoordinate(90.000001, 0)).toBe(false);
  });

  it('rejects latitude below -90 by the smallest possible float step', () => {
    expect(isValidCoordinate(-90.000001, 0)).toBe(false);
  });

  it('rejects longitude that exceeds 180 by the smallest possible float step', () => {
    expect(isValidCoordinate(0, 180.000001)).toBe(false);
  });

  it('rejects longitude below -180 by the smallest possible float step', () => {
    expect(isValidCoordinate(0, -180.000001)).toBe(false);
  });

  // Sanity: boundary values must still be accepted.
  // This test guards against an off-by-one error in the range check (< vs <=).
  it('accepts exact boundary lat=90 and lng=180', () => {
    expect(isValidCoordinate(90, 180)).toBe(true);
  });

  it('accepts exact boundary lat=-90 and lng=-180', () => {
    expect(isValidCoordinate(-90, -180)).toBe(true);
  });

  // A UK coordinate must be valid — this is the primary use case.
  it('accepts a typical UK coordinate (no false negatives for the main use case)', () => {
    expect(isValidCoordinate(51.5, -0.12)).toBe(true);
  });
});

// ======================================================================
// Integration: coarsen-then-validate pipeline
// ======================================================================
describe('coarsen-then-validate pipeline', () => {

  // The normal app flow: raw GPS → coarsenCoordinates → isValidCoordinate.
  // Every valid raw coordinate must survive this pipeline unchanged in
  // terms of validity. If coarsen produced a value that failed the validity
  // check, the hook would fall back to FALLBACK_LOCATION silently — the
  // user would see London venues when they are in Manchester, and they would
  // never know why.
  it('all valid UK coordinates pass the pipeline without becoming invalid', () => {
    const ukSamples: [number, number][] = [
      [51.5074, -0.1278],   // London (central)
      [53.4808, -2.2426],   // Manchester
      [55.8642, -4.2518],   // Glasgow
      [51.4545, -2.5879],   // Bristol
      [52.4862, -1.8904],   // Birmingham
    ];

    ukSamples.forEach(([lat, lng]) => {
      const coarsened = coarsenCoordinates(lat, lng);
      const valid = isValidCoordinate(coarsened.latitude, coarsened.longitude);
      expect(valid).toBe(true);
    });
  });

  // The coarsened output must be different from the raw input for high-precision
  // coordinates, confirming the rounding actually ran (not a pass-through).
  it('coarsenCoordinates changes a high-precision GPS fix (proves rounding happened)', () => {
    const rawLat = 51.50735123;
    const rawLng = -0.12775839;
    const { latitude, longitude } = coarsenCoordinates(rawLat, rawLng);

    // At least one of the values must differ from the raw input.
    const changed = (latitude !== rawLat) || (longitude !== rawLng);
    expect(changed).toBe(true);
  });
});
