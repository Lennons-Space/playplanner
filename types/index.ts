// ============================================================
// Play Planner — Core TypeScript types
// These match the Supabase database schema exactly.
// ============================================================

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

// ---- Lookup types ----

export interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string;
  color: string;
}

export interface Facility {
  id: string;
  name: string;
  slug: string;
  icon: string;
}

// ---- User / Profile ----

export type SubscriptionTier = 'free' | 'premium';

export interface Profile {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  is_business_owner: boolean;
  is_admin: boolean;
  subscription_tier: SubscriptionTier;
  subscription_expires_at: string | null;
  children_ages: string[] | null;   // age ranges e.g. '2-4', not exact ages (data minimisation)
  marketing_consent: boolean;
  terms_accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

// ---- Venue ----

export type PriceRange = 'free' | 'budget' | 'moderate' | 'premium';
export type ModerationStatus = 'pending' | 'approved' | 'rejected';

export interface Venue {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  category_id: string | null;
  category?: Category;           // joined
  // Address
  address_line1: string | null;
  address_line2: string | null;
  city: string;
  postcode: string;
  country: string;
  latitude: number;
  longitude: number;
  // Contact
  phone: string | null;
  email: string | null;
  website: string | null;
  // Details
  price_range: PriceRange | null;
  min_age: number;
  max_age: number;
  // Status
  is_published: boolean;
  is_verified: boolean;
  is_premium: boolean;
  featured_until: string | null;
  claimed_by: string | null;
  submitted_by: string | null;
  moderation_status: ModerationStatus;
  // Aggregates
  review_count: number;
  average_rating: number;
  // Joined relations
  photos?: VenuePhoto[];
  facilities?: Facility[];
  opening_hours?: OpeningHours[];
  distance_km?: number;          // calculated at query time
  created_at: string;
  updated_at: string;
}

export interface VenuePhoto {
  id: string;
  venue_id: string;
  uploaded_by: string | null;
  url: string;
  storage_path: string;
  is_cover: boolean;
  is_approved: boolean;
  caption: string | null;
  sort_order: number;
  created_at: string;
}

export interface OpeningHours {
  id: string;
  venue_id: string;
  day_of_week: 0 | 1 | 2 | 3 | 4 | 5 | 6;  // 0=Sun
  opens_at: string | null;   // "09:00"
  closes_at: string | null;  // "17:00"
  is_closed: boolean;
  notes: string | null;
}

// ---- Reviews ----

// Safe subset of Profile for displaying other users' public data.
// NEVER query the full Profile row for a different user — it would expose
// children_ages, is_admin, subscription_tier, subscription_expires_at,
// marketing_consent, and terms_accepted_at.
// (stripe_customer_id exists in the DB but is intentionally omitted from the
// Profile TS interface — it must never be selected client-side.)
// Use this type everywhere a reviewer / commenter's profile is joined.
export type PublicProfile = Pick<Profile,
  'id' | 'username' | 'full_name' | 'avatar_url' | 'bio' | 'is_business_owner'
>;

export interface Review {
  id: string;
  venue_id: string;
  user_id: string;
  profile?: PublicProfile;        // joined — safe columns only (never full Profile)
  rating: 1 | 2 | 3 | 4 | 5;
  title: string | null;
  body: string;
  visit_date: string | null;
  children_ages: string[] | null;
  moderation_status: ModerationStatus;
  helpful_count: number;
  photos?: ReviewPhoto[];
  created_at: string;
  updated_at: string;
}

export interface ReviewPhoto {
  id: string;
  review_id: string;
  url: string;
  storage_path: string;
  created_at: string;
}

// ---- Favourites ----

export interface Favourite {
  id: string;
  user_id: string;
  venue_id: string;
  venue?: Venue;                  // joined
  list_name: string;
  created_at: string;
}

// ---- Business ----

export type BusinessPlan = 'basic' | 'pro' | 'enterprise';
export type SubscriptionStatus = 'active' | 'cancelled' | 'past_due' | 'trialing';

export interface BusinessSubscription {
  id: string;
  profile_id: string;
  venue_id: string;
  plan: BusinessPlan;
  status: SubscriptionStatus;
  current_period_end: string | null;
  created_at: string;
}

export interface VenueOffer {
  id: string;
  venue_id: string;
  title: string;
  description: string | null;
  discount_text: string | null;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  created_at: string;
}

// ---- Filters (used in search/map) ----

export interface VenueFilters {
  categoryIds: string[];
  facilityIds: string[];
  minAge: number | null;
  maxAge: number | null;
  priceRange: PriceRange[];
  maxDistanceKm: number;
  openNow: boolean;
  premiumOnly: boolean;
}

export const DEFAULT_FILTERS: VenueFilters = {
  categoryIds: [],
  facilityIds: [],
  minAge: null,
  maxAge: null,
  priceRange: [],
  maxDistanceKm: 10,
  openNow: false,
  premiumOnly: false,
};

// ---- Location ----

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface MapRegion extends Coordinates {
  latitudeDelta: number;
  longitudeDelta: number;
}
