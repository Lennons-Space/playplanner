# Website-Enrichment Pilot — Reviewer Worksheet (5 venues)

**Use:** after the gated `--propose --limit=5` run inserts `pending` proposals, a human reviews each one
here BEFORE any `apply_venue_proposal`. This worksheet is planning/review tooling only — **nothing is
applied from it.** Facts below are pre-populated from the hardened dry-run report
(`scripts/enrich/out/run_hardened.json`); re-confirm each against the actual `pending` rows after the real
`--propose` run, since live values can differ.

- **Pilot venues file:** `scripts/enrich/pilot_venue_ids.json` · **Proposals to review:** 17 across 5 venues.
- **Apply is separate, admin-only, stale-guarded.** Descriptions must be REWRITTEN on apply (the DB raises
  `description_not_rewritten` if the applied text equals the evidence). `booking_url` has no target column
  yet (apply raises `no_target_column`) — so booking_url is review-only, never applied in this pilot.

---

## Decision guidance (apply to every row)

- **phone / email / opening_hours** — **Accept only when** the source page identity is verified to be *this*
  venue (right name, right town) AND the value looks valid (UK number format / email domain matches the
  venue's real domain / hours are complete & sane). Otherwise Reject.
- **descriptions** — **Always Rewrite.** Never Accept verbatim: copying the site's text is a copyright risk and
  the DB blocks it. Write an original 1–2 sentence summary in "Final rewritten value".
- **website canonicalisation conflicts** (`conflict = yes`, only a `www`/trailing-slash/scheme difference) —
  **Reject** unless the *stored* URL is genuinely wrong (dead/incorrect domain). A cosmetic canonical change is
  not worth a write.
- **booking_url / price_range** — **Reject unless explicitly verified** as the official booking/pricing for this
  venue. (Also: booking_url cannot be applied in this pilot — no target column.)
- **Any wrong-entity / template / parked-domain / spam signal on a venue → Reject ALL proposals for that venue**
  and note it. (The 5 here were pre-screened clean, but re-verify each source page.)

**Decision values:** `Accept` · `Rewrite` (descriptions) · `Reject`. Fill notes for every Reject/Rewrite.

---

## 1. Hollywood Bowl (Stockton) — `0f81079d-3b6d-4ad8-8e88-57acac17aafd`
Source site: `https://www.hollywoodbowl.co.uk/stockton` · outcome: extracted (2 pages). Identity check: confirm this is the **Stockton** centre.

### 1.1 phone
- Proposed: `08448261469` · Current: `(none)` · Method: `jsonld` · Confidence: **high** · Conflict/stale: no
- Source: `https://www.hollywoodbowl.co.uk/stockton` · Evidence: `[phone]` (scrubbed)
- Guidance: accept only if source+identity verified (0844 is a valid HB number).
- **Decision:** ☐ Accept ☐ Reject → `__________`
- Reviewer notes: `__________` · Rejection reason: `__________`

### 1.2 opening_hours
- Proposed: `Su 09:00-23:00; Mo–Th 10:00-23:00; Fr 10:00-24:00; Sa 09:00-24:00` (7-day, complete) · Current: `(none)`
- Method: `jsonld` · Confidence: **high** · Conflict/stale: no · Source: `https://www.hollywoodbowl.co.uk/stockton`
- Evidence: `Su 09:00-23:00; Mo 10:00-23:00; … Fr 10:00-24:00; Sa 09:00-24:00`
- Guidance: accept only if verified; check Fri/Sat midnight (24:00) close is correct.
- **Decision:** ☐ Accept ☐ Reject → `__________`
- Reviewer notes: `__________` · Rejection reason: `__________`

### 1.3 description  *(always rewrite)*
- Proposed (DO NOT use verbatim): `Hollywood Bowl is the UK's best ten pin bowling alley. With a delicious food & drink menu and arcade games – there's something for everyone!`
- Current: `(none)` · Method: `jsonld` · Confidence: medium · Conflict: no · Source: `https://www.hollywoodbowl.co.uk/stockton`
- **Decision:** ☐ Rewrite ☐ Reject → `__________`
- Final rewritten value: `__________________________________________`
- Reviewer notes: `__________`

---

## 2. The Real Mary King's Close — `02b458e6-456c-4f2c-96a9-5547f92d48e3`
Source site: `https://www.realmarykingsclose.com/` · outcome: extracted (3 pages). Identity check: Edinburgh underground attraction.

### 2.1 phone
- Proposed: `01312250672` · Current: `(none)` · Method: `jsonld` · Confidence: **high** · Conflict/stale: no
- Source: `https://www.realmarykingsclose.com/` · Evidence: `[phone]` (0131 = Edinburgh ✓)
- **Decision:** ☐ Accept ☐ Reject → `__________`
- Reviewer notes: `__________` · Rejection reason: `__________`

### 2.2 email
- Proposed: `info@realmarykingsclose.com` · Current: `(none)` · Method: `jsonld` · Confidence: **high** · Conflict/stale: no
- Source: `https://www.realmarykingsclose.com/` · Evidence: `info@realmarykingsclose.com` (role mailbox; domain matches ✓)
- **Decision:** ☐ Accept ☐ Reject → `__________`
- Reviewer notes: `__________` · Rejection reason: `__________`

### 2.3 description  *(always rewrite)*
- Proposed (DO NOT use verbatim): `Historic underground attraction in Edinburgh offering guided tours through preserved 17th-century streets beneath the Royal Mile, revealing the city's hidden past and stories of former residents.`
- Current: `(none)` · Method: `jsonld` · Confidence: medium · Conflict: no · Source: `https://www.realmarykingsclose.com/`
- **Decision:** ☐ Rewrite ☐ Reject → `__________`
- Final rewritten value: `__________________________________________`
- Reviewer notes: `__________`

### 2.4 booking_url  *(review-only; not applicable in this pilot)*
- Proposed: `https://bookings.realmarykingsclose.com/book` · Current: `(none)` · Method: `heuristic` · Confidence: low · Conflict: no
- Source: `https://www.realmarykingsclose.com/plan-your-visit/opening-times/` · Evidence: `booking calendar → https://bookings.realmarykingsclose.com/book`
- Guidance: reject unless explicitly verified as official booking (and note: no target column → cannot apply).
- **Decision:** ☐ Reject ☐ (verified, hold for future) → `__________`
- Reviewer notes: `__________` · Rejection reason: `__________`

---

## 3. Rascals Softplay Epsom — `056402c7-6349-431a-8ca8-5909d97fbae5`
Source site: `https://rascalssoftplay.co.uk/` · outcome: extracted (2 pages). Identity check: Epsom, Surrey soft play.

### 3.1 phone
- Proposed: `07880213062` · Current: `(none)` · Method: `jsonld` · Confidence: **high** · Conflict/stale: no
- Source: `https://rascalssoftplay.co.uk/` · Evidence: `07880213062` (UK mobile)
- Guidance: accept only if verified; mobile number for a venue is plausible but confirm.
- **Decision:** ☐ Accept ☐ Reject → `__________`
- Reviewer notes: `__________` · Rejection reason: `__________`

### 3.2 email
- Proposed: `rascalsplaycafe@gmail.com` · Current: `(none)` · Method: `jsonld` · Confidence: **high** · Conflict/stale: no
- Source: `https://rascalssoftplay.co.uk/` · Evidence: `rascalsplaycafe@gmail.com`
- Guidance: gmail (not domain-matched) — accept only if it's genuinely the venue's published contact.
- **Decision:** ☐ Accept ☐ Reject → `__________`
- Reviewer notes: `__________` · Rejection reason: `__________`

### 3.3 description  *(always rewrite)*
- Proposed (DO NOT use verbatim; this is a title/strapline, not prose): `The Ultimate Fun-Filled Soft Play in Epsom for Under 5's | Play & Party Everyday with your Kids| Rascals Softplay Epsom | Surrey`
- Current: `(none)` · Method: `jsonld` · Confidence: medium · Conflict: no · Source: `https://rascalssoftplay.co.uk/`
- Guidance: the proposed text is a pipe-delimited page title — rewrite into a clean sentence.
- **Decision:** ☐ Rewrite ☐ Reject → `__________`
- Final rewritten value: `__________________________________________`
- Reviewer notes: `__________`

### 3.4 booking_url  *(review-only; not applicable in this pilot)*
- Proposed: `https://bookedit.licklist.co.uk/iframe/payment/bookings/form/15890?...` · Current: `(none)` · Method: `heuristic` · Confidence: low · Conflict: no
- Source: `https://rascalssoftplay.co.uk/` · Evidence: `Book Play Sessions → https://bookedit.licklist.co.uk/iframe/payment/bookings/form/15890?...`
- Guidance: third-party iframe booking URL with query params — reject unless verified (and cannot apply).
- **Decision:** ☐ Reject ☐ (verified, hold) → `__________`
- Reviewer notes: `__________` · Rejection reason: `__________`

---

## 4. Thacka Beck Nature Reserve — `0074d23b-3d41-49af-a7ed-a819d9234806`
Source site: `https://www.cumbriawildlifetrust.org.uk/nature-reserves/thacka-beck` · outcome: extracted (1 page). Identity check: Cumbria Wildlife Trust reserve (Penrith).

### 4.1 phone
- Proposed: `01228829570` · Current: `(none)` · Method: `microdata` · Confidence: **high** · Conflict/stale: no
- Source: `https://www.cumbriawildlifetrust.org.uk/nature-reserves/thacka-beck` · Evidence: `[phone]` (01228 = Carlisle ✓)
- Note: this is the Trust's central number, not a reserve-specific line — confirm that is acceptable.
- **Decision:** ☐ Accept ☐ Reject → `__________`
- Reviewer notes: `__________` · Rejection reason: `__________`

### 4.2 description  *(always rewrite)*
- Proposed (DO NOT use verbatim): `Hay meadows, wet grassland, scrub, hedges, ponds and the beck provide homes for a wealth of wildlife. Although small in size, the nature reserve has a remarkable number of birds.`
- Current: `(none)` · Method: `microdata` · Confidence: medium · Conflict: no · Source: as above
- **Decision:** ☐ Rewrite ☐ Reject → `__________`
- Final rewritten value: `__________________________________________`
- Reviewer notes: `__________`

### 4.3 email  ⚠ FLAG
- Proposed: `mail@cumbriawildifetrust.org.uk` · Current: `(none)` · Method: `heuristic` · Confidence: low · Conflict: no
- Source: `https://www.cumbriawildlifetrust.org.uk/nature-reserves/thacka-beck` · Evidence: `mailto: mail@cumbriawildifetrust.org.uk`
- ⚠ **Domain typo:** proposed domain `cumbriawildifetrust.org.uk` (missing an "l") ≠ the site domain
  `cumbriawildlifetrust.org.uk`. Likely a typo in the site's own `mailto:`. **Reject** unless verified to deliver.
- **Decision:** ☐ Reject ☐ Accept(only if verified-correct) → `__________`
- Reviewer notes: `__________` · Rejection reason: `__________`

---

## 5. Hillview Animal Park — `06bd1910-fe23-48ff-be38-268b0bbfb619`
Source site: `https://www.hillviewanimalpark.co.uk/` · outcome: extracted (1 page). Identity check: animal park near Fife/Stirling.

### 5.1 email
- Proposed: `hillviewanimalparkltd@gmail.com` · Current: `(none)` · Method: `jsonld` · Confidence: **high** · Conflict/stale: no
- Source: `https://www.hillviewanimalpark.co.uk/` · Evidence: `hillviewanimalparkltd@gmail.com`
- Guidance: gmail (not domain-matched) — accept only if it's the genuine published contact.
- **Decision:** ☐ Accept ☐ Reject → `__________`
- Reviewer notes: `__________` · Rejection reason: `__________`

### 5.2 website  ⚠ canonicalisation conflict
- Proposed: `https://hillviewanimalpark.co.uk` · Current: `https://www.hillviewanimalpark.co.uk/`
- Method: `jsonld` · Confidence: medium · **Conflict: YES** (bare vs `www` + trailing slash) · Source: `https://www.hillviewanimalpark.co.uk/`
- Guidance: **Reject** — the stored URL is valid; this is a cosmetic canonicalisation only.
- **Decision:** ☐ Reject ☐ Accept(only if stored URL is genuinely wrong) → `__________`
- Reviewer notes: `__________` · Rejection reason: `__________`

### 5.3 description  *(always rewrite)*
- Proposed (DO NOT use verbatim): `Hillview Animal Park has alpacas, goats, sheep, deer, donkeys, wallabies and many more animals. Open days. Near Fife, Clackamannanshire, Falkirk, Stirling.`
- Current: `(none)` · Method: `meta` · Confidence: medium · Conflict: no · Source: `https://www.hillviewanimalpark.co.uk/`
- **Decision:** ☐ Rewrite ☐ Reject → `__________`
- Final rewritten value: `__________________________________________`
- Reviewer notes: `__________`

---

## Sign-off

**Tally (fill after review — 17 proposals total):**

| Outcome | Count |
|---|---|
| Accepted (apply as-is) | `____` |
| Rewritten (descriptions; apply rewritten text) | `____` |
| Rejected | `____` |
| Held / review-only (e.g. booking_url) | `____` |
| **Total** | **17** |

Per-field reference (proposed): phone ×4 · email ×4 · opening_hours ×1 · description ×5 · booking_url ×2 · website ×1.

**Unresolved concerns / follow-ups:**
- `____________________________________________________________`
- `____________________________________________________________`

**Reviewer:** name `____________`  ·  date `____________`

**Approval to proceed to apply:** ☐ Approved ☐ Not approved
- Approver (if different): `____________`  ·  date `____________`
- Note: each Accept/Rewrite is applied individually via the admin-only, stale-guarded
  `apply_venue_proposal` RPC **only after** this sign-off. `booking_url` rows cannot be applied (no target
  column). Re-run is unnecessary unless source pages changed.
