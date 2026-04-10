-- ============================================================
-- Seed data — run after 001_initial_schema.sql
--
-- Idempotent: uses ON CONFLICT (slug) DO NOTHING so this file
-- can be run multiple times safely (e.g. after a DB reset in CI,
-- or if run by accident). Existing rows are left unchanged.
--
-- Display order: neither categories nor facilities has a sort_order
-- column in the current schema. The app MUST always use an explicit
-- ORDER BY (e.g. ORDER BY name) when querying these tables —
-- Postgres does not guarantee heap-storage insertion order.
-- ============================================================

-- -------------------------------------------------------
-- CATEGORIES
-- -------------------------------------------------------
insert into categories (name, slug, icon, color) values
  ('Soft Play',          'soft-play',      '🎠', '#FF6B6B'),
  ('Park & Playground',  'park',           '🌳', '#4ECDC4'),
  ('Cafe & Restaurant',  'cafe',           '☕', '#FFE66D'),
  ('Indoor Play',        'indoor-play',    '🎮', '#A8E6CF'),
  ('Swimming',           'swimming',       '🏊', '#74B9FF'),
  ('Trampoline Park',    'trampoline',     '🤸', '#FD79A8'),
  ('Farm & Animals',     'farm',           '🐄', '#FDCB6E'),
  ('Bowling & Arcades',  'bowling',        '🎳', '#6C5CE7'),
  ('Theatre & Arts',     'arts',           '🎭', '#E17055'),
  ('Sports & Classes',   'sports',         '⚽', '#00B894'),
  ('Library & Learning', 'library',        '📚', '#0984E3'),
  ('Sensory Play',       'sensory',        '🌈', '#E84393')
on conflict (slug) do nothing;

-- -------------------------------------------------------
-- FACILITIES / AMENITIES
-- -------------------------------------------------------
-- Note: 'Wheelchair Access' and 'Accessible Toilets' previously both
-- used '♿'. Accessible Toilets now uses '🚾' to distinguish them
-- visually in the app UI.
-- -------------------------------------------------------
insert into facilities (name, slug, icon) values
  ('Baby Changing',        'baby-changing',      '👶'),
  ('Wheelchair Access',    'wheelchair',         '♿'),
  ('Parking',              'parking',            '🅿️'),
  ('Outdoor Area',         'outdoor',            '🌿'),
  ('Indoor Area',          'indoor',             '🏠'),
  ('Cafe / Canteen',       'cafe-on-site',       '☕'),
  ('Party Rooms',          'party-rooms',        '🎉'),
  ('Lockers',              'lockers',            '🔒'),
  ('Toilets',              'toilets',            '🚻'),
  ('Accessible Toilets',   'accessible-toilets', '🚾'),
  ('First Aid',            'first-aid',          '🩺'),
  ('WiFi',                 'wifi',               '📶'),
  ('Buggy Friendly',       'buggy',              '🍼'),
  ('Dog Friendly',         'dog-friendly',       '🐕'),
  ('Birthday Packages',    'birthday',           '🎂'),
  ('Under 5s Sessions',    'under-5s',           '⭐'),
  ('Toddler Area',         'toddler-area',       '🧸'),
  ('Sensory Room',         'sensory-room',       '🌈'),
  ('Food & Snacks',        'food',               '🍕'),
  ('Breast-Feeding Area',  'breastfeeding',      '🤱')
on conflict (slug) do nothing;
