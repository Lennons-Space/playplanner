import {
  clampDedupeRadiusM,
  clampDedupeResultLimit,
  isValidLatLng,
  MAX_DEDUPE_RADIUS_M,
  MAX_DEDUPE_RESULT_LIMIT,
  MIN_DEDUPE_RADIUS_M,
  MIN_DEDUPE_RESULT_LIMIT,
} from '../spatialPrefilterPolicy';

describe('clampDedupeRadiusM', () => {
  it('passes through an in-range value unchanged', () => {
    expect(clampDedupeRadiusM(1500)).toBe(1500);
  });
  it('clamps negative values to the floor', () => {
    expect(clampDedupeRadiusM(-100)).toBe(MIN_DEDUPE_RADIUS_M);
  });
  it('clamps oversized values to the identity-appropriate ceiling (never consumer-search-wide)', () => {
    expect(clampDedupeRadiusM(80_000)).toBe(MAX_DEDUPE_RADIUS_M);
    expect(MAX_DEDUPE_RADIUS_M).toBeLessThan(80_000); // sanity: nowhere near get_nearby_venues' 80km consumer cap
  });
});

describe('clampDedupeResultLimit', () => {
  it('passes through an in-range value unchanged', () => {
    expect(clampDedupeResultLimit(50)).toBe(50);
  });
  it('clamps to at least 1', () => {
    expect(clampDedupeResultLimit(0)).toBe(MIN_DEDUPE_RESULT_LIMIT);
    expect(clampDedupeResultLimit(-5)).toBe(MIN_DEDUPE_RESULT_LIMIT);
  });
  it('clamps to the hard cap', () => {
    expect(clampDedupeResultLimit(10_000)).toBe(MAX_DEDUPE_RESULT_LIMIT);
  });
});

describe('isValidLatLng', () => {
  it('accepts valid UK-range coordinates', () => {
    expect(isValidLatLng(52.5, -1.5)).toBe(true);
  });
  it('rejects out-of-range latitude', () => {
    expect(isValidLatLng(91, 0)).toBe(false);
    expect(isValidLatLng(-91, 0)).toBe(false);
  });
  it('rejects out-of-range longitude', () => {
    expect(isValidLatLng(0, 181)).toBe(false);
    expect(isValidLatLng(0, -181)).toBe(false);
  });
  it('rejects null/undefined', () => {
    expect(isValidLatLng(null, 0)).toBe(false);
    expect(isValidLatLng(0, undefined)).toBe(false);
  });
});
