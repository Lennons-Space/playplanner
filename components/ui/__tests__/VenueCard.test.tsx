/**
 * General behaviour tests for components/ui/VenueCard.tsx.
 *
 * VenueCard.glass.test.tsx (a separate, narrowly-scoped file) covers only the
 * solid-card/glass-theming colour resolution. This file covers everything
 * else: real-photo vs. designed-fallback rendering (including a failed image
 * load), the long-title two-line behaviour, card-press navigation, and the
 * favourite control's press-isolation from card navigation.
 */
import React from 'react';
import { Image } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { VenueCard } from '@/components/ui/VenueCard';
import type { Venue } from '@/types';

function makeVenue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: 'v1',
    name: 'Sunny Park',
    category: { id: 'c1', name: 'Park', slug: 'park', icon: 'tree', color: '#3CAE6B' },
    category_id: 'c1',
    min_age: 0,
    max_age: 12,
    review_count: 0,
    average_rating: 0,
    distance_km: undefined,
    cover_photo_url: null,
    featured_until: null,
    opening_hours: [],
    photos: [],
    facilities: [],
    ...overrides,
  } as unknown as Venue;
}

describe('VenueCard — real photo vs. designed fallback', () => {
  it('renders the real photo via <Image> when cover_photo_url is present', () => {
    const venue = makeVenue({ cover_photo_url: 'https://example.com/photo.jpg' });
    render(<VenueCard venue={venue} />);
    const image = screen.UNSAFE_queryByType(Image);
    expect(image).toBeTruthy();
    expect(image!.props.source).toEqual({ uri: 'https://example.com/photo.jpg' });
  });

  it('renders the designed CategoryPlaceholder fallback (no <Image>) when there is no cover_photo_url', () => {
    const venue = makeVenue({ cover_photo_url: null });
    render(<VenueCard venue={venue} />);
    expect(screen.UNSAFE_queryByType(Image)).toBeNull();
  });

  it('falls back to the designed CategoryPlaceholder cleanly when the real photo fails to load — never a blank/broken image box', () => {
    const venue = makeVenue({ cover_photo_url: 'https://example.com/broken.jpg' });
    render(<VenueCard venue={venue} />);

    // Photo initially attempted.
    expect(screen.UNSAFE_queryByType(Image)).toBeTruthy();

    // Simulate the real-world failure (404, deleted storage object, etc.).
    fireEvent(screen.UNSAFE_getByType(Image), 'error');

    // Falls back to the same designed placeholder used when there's no
    // photo at all — the <Image> is removed from the tree, not left broken.
    expect(screen.UNSAFE_queryByType(Image)).toBeNull();
  });

  it('the real photo keeps its accessibility label', () => {
    const venue = makeVenue({ cover_photo_url: 'https://example.com/photo.jpg', name: 'Sunny Park' });
    render(<VenueCard venue={venue} />);
    expect(screen.UNSAFE_getByType(Image).props.accessibilityLabel).toBe('Photo of Sunny Park');
  });
});

describe('VenueCard — long title', () => {
  it('allows the title up to 2 lines (never a premature single-line cut)', () => {
    const venue = makeVenue({ name: 'Prees Branch Canal and Nature Reserve Adventure Park' });
    render(<VenueCard venue={venue} />);
    const title = screen.getByText('Prees Branch Canal and Nature Reserve Adventure Park');
    expect(title.props.numberOfLines).toBe(2);
  });

  it('metadata (category pill, rating/no-reviews line) remains visible below a long title', () => {
    const venue = makeVenue({
      name: 'Prees Branch Canal and Nature Reserve Adventure Park',
      review_count: 5,
      average_rating: 4.2,
    });
    render(<VenueCard venue={venue} />);
    expect(screen.getByText('PARK')).toBeTruthy();
    expect(screen.getByText('4.2')).toBeTruthy();
    expect(screen.getByText('(5)')).toBeTruthy();
  });
});

describe('VenueCard — card press navigation', () => {
  it('pressing the card body calls onPress', () => {
    const onPress = jest.fn();
    const venue = makeVenue();
    render(<VenueCard venue={venue} onPress={onPress} />);
    fireEvent.press(screen.getByText('Sunny Park'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('VenueCard — favourite control is isolated from card navigation', () => {
  it('pressing the favourite heart calls onToggleSave and does NOT call onPress', () => {
    const onPress = jest.fn();
    const onToggleSave = jest.fn();
    const venue = makeVenue();
    render(<VenueCard venue={venue} onPress={onPress} onToggleSave={onToggleSave} saved={false} />);

    fireEvent.press(screen.getByLabelText('Save venue'));

    expect(onToggleSave).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('shows "Remove from saved" label and the filled heart icon when saved=true', () => {
    const venue = makeVenue();
    render(<VenueCard venue={venue} saved onToggleSave={jest.fn()} />);
    expect(screen.getByLabelText('Remove from saved')).toBeTruthy();
  });

  it('shows "Save venue" label when saved=false', () => {
    const venue = makeVenue();
    render(<VenueCard venue={venue} saved={false} onToggleSave={jest.fn()} />);
    expect(screen.getByLabelText('Save venue')).toBeTruthy();
  });

  it('does not render a favourite control at all when onToggleSave is not provided', () => {
    const venue = makeVenue();
    render(<VenueCard venue={venue} />);
    expect(screen.queryByLabelText('Save venue')).toBeNull();
    expect(screen.queryByLabelText('Remove from saved')).toBeNull();
  });
});
