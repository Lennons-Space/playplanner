/**
 * Tests for coordinate utilities (services/location/coordinates.ts).
 *
 * These functions enforce GDPR data minimisation by rounding coordinates
 * to ~111m precision and rejecting invalid inputs before they reach the database.
 */

import { roundCoordinate, coarsenCoordinates, isValidCoordinate } from './coordinates';

// ======================================================================
// roundCoordinate
// ======================================================================
describe('roundCoordinate', () => {
  // Rounds a normal latitude to 3 decimal places
  it('rounds to 3 decimal places', () => {
    expect(roundCoordinate(51.507351)).toBe(51.507);
  });

  // Rounds a negative longitude correctly
  it('handles negative values (west / south hemispheres)', () => {
    expect(roundCoordinate(-0.127758)).toBe(-0.128);
  });

  // Zero should stay zero
  it('returns 0 for zero input', () => {
    expect(roundCoordinate(0)).toBe(0);
  });

  // Values already at 3 decimal places should not change
  it('does not change a value that already has 3 decimal places', () => {
    expect(roundCoordinate(51.508)).toBe(51.508);
  });

  // Very precise inputs get reduced (privacy — removes identifying precision)
  it('strips precision beyond 3 decimals (data minimisation)', () => {
    const precise = 51.5073512345;
    const rounded = roundCoordinate(precise);
    // The string representation should have at most 3 decimal digits
    const decimalPart = rounded.toString().split('.')[1] || '';
    expect(decimalPart.length).toBeLessThanOrEqual(3);
  });

  // Whole numbers have no decimal part to round
  it('handles whole numbers', () => {
    expect(roundCoordinate(52)).toBe(52);
  });

  // Rounding at the 0.0005 midpoint — banker's rounding is NOT used by Math.round,
  // so 0.5 rounds up (standard JS behaviour)
  it('rounds 0.0005 up (standard JS Math.round)', () => {
    expect(roundCoordinate(51.5075)).toBe(51.508);
  });
});

// ======================================================================
// coarsenCoordinates
// ======================================================================
describe('coarsenCoordinates', () => {
  // Applies rounding to both lat and lng at once (London example)
  it('rounds both latitude and longitude for a London coordinate', () => {
    const result = coarsenCoordinates(51.50735, -0.12776);
    expect(result).toEqual({ latitude: 51.507, longitude: -0.128 });
  });

  // Output keys must be "latitude" and "longitude" (matches the Coordinates type)
  it('returns an object with latitude and longitude keys', () => {
    const result = coarsenCoordinates(0, 0);
    expect(result).toHaveProperty('latitude');
    expect(result).toHaveProperty('longitude');
  });

  // Southern and eastern hemisphere coordinates (e.g. Sydney)
  it('handles southern/eastern hemisphere coordinates', () => {
    const result = coarsenCoordinates(-33.8688, 151.2093);
    expect(result).toEqual({ latitude: -33.869, longitude: 151.209 });
  });

  // Boundary: the extreme corners of the valid coordinate range
  it('handles extreme boundary coordinates (90, 180)', () => {
    const result = coarsenCoordinates(90, 180);
    expect(result).toEqual({ latitude: 90, longitude: 180 });
  });

  it('handles extreme negative boundary coordinates (-90, -180)', () => {
    const result = coarsenCoordinates(-90, -180);
    expect(result).toEqual({ latitude: -90, longitude: -180 });
  });
});

// ======================================================================
// isValidCoordinate
// ======================================================================
describe('isValidCoordinate', () => {
  // A normal London coordinate should be valid
  it('accepts valid London coordinates', () => {
    expect(isValidCoordinate(51.5074, -0.1278)).toBe(true);
  });

  // Zero/zero (Gulf of Guinea) is technically valid
  it('accepts (0, 0)', () => {
    expect(isValidCoordinate(0, 0)).toBe(true);
  });

  // Exact boundary values must be accepted (inclusive range)
  it('accepts exact boundary: lat=90, lng=180', () => {
    expect(isValidCoordinate(90, 180)).toBe(true);
  });

  it('accepts exact boundary: lat=-90, lng=-180', () => {
    expect(isValidCoordinate(-90, -180)).toBe(true);
  });

  // Latitude just outside the valid range
  it('rejects latitude > 90', () => {
    expect(isValidCoordinate(90.001, 0)).toBe(false);
  });

  it('rejects latitude < -90', () => {
    expect(isValidCoordinate(-90.001, 0)).toBe(false);
  });

  // Longitude just outside the valid range
  it('rejects longitude > 180', () => {
    expect(isValidCoordinate(0, 180.001)).toBe(false);
  });

  it('rejects longitude < -180', () => {
    expect(isValidCoordinate(0, -180.001)).toBe(false);
  });

  // NaN is not a valid coordinate — this is the most dangerous edge case
  // because NaN comparisons silently return false in JS, so the function
  // must explicitly handle it (currently it does via the >= / <= checks
  // which return false for NaN)
  it('rejects NaN latitude', () => {
    expect(isValidCoordinate(NaN, 0)).toBe(false);
  });

  it('rejects NaN longitude', () => {
    expect(isValidCoordinate(0, NaN)).toBe(false);
  });

  it('rejects both NaN', () => {
    expect(isValidCoordinate(NaN, NaN)).toBe(false);
  });

  // Infinity should be rejected
  it('rejects Infinity latitude', () => {
    expect(isValidCoordinate(Infinity, 0)).toBe(false);
  });

  it('rejects -Infinity longitude', () => {
    expect(isValidCoordinate(0, -Infinity)).toBe(false);
  });
});
