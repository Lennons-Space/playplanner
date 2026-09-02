# Data Protection Complaints Procedure — PlayPlanner

**Status:** DRAFT — **OWNER/LEGAL REVIEW REQUIRED**
**Date:** 2026-09-01
**Legal basis:** DPA 2018 **s.164A**, inserted by the Data (Use and Access) Act 2025 s.103, **LAW**, in
force **19 June 2026**. Text confirmed by direct fetch of legislation.gov.uk this session, not a
secondary summary.

---

## The two clocks — do not confuse them

**s.164A creates two separate obligations with two separate timeframes. This document treats them as
distinct throughout, per Liam's explicit instruction.**

| | Deadline | What it covers |
|---|---|---|
| **Acknowledgement** | **Within 30 days** of receiving the complaint (a fixed statutory clock) | A simple confirmation that the complaint was received |
| **Investigation and outcome** | **"Without undue delay"** — no fixed number of days | Actually looking into the complaint, making appropriate enquiries, and telling the complainant the outcome |

A complaint that is acknowledged on day 29 and resolved on day 90 has **fully met the acknowledgement
duty** and separately needs its own "was 90 days undue delay for a complaint of this complexity"
assessment — the two are never combined into one figure.

---

## Channels for submitting a complaint

- **Email:** `privacy@playplanner.app` (the existing controller-contact address per `docs/privacy.html`)
- **In-app:** `UNKNOWN — MUST VERIFY / NOT YET BUILT` — per `PRIVACY_NOTICE_GAP_ANALYSIS.md`, no in-app
  complaint-submission form currently exists; the only route today is the email address. **s.164A's
  "facilitate the making of complaints" duty is most straightforwardly read as requiring an accessible
  channel to exist — email alone likely satisfies the letter of this for a service PlayPlanner's size, but
  an in-app form would be a stronger, more accessible implementation** and is recommended as a follow-up
  (not built in this documentation-only pass).

## Complaint log

Every complaint must be logged with, at minimum:

| Field | Purpose |
|---|---|
| Unique complaint ID | Tracking |
| Date/time received | Starts the 30-day acknowledgement clock |
| Channel | Email, in-app (if built), or other |
| Complainant identity/contact | To respond; verify proportionately (see below) |
| Complaint summary | What was raised |
| Related data subject request(s) | If this complaint accompanies or arises from a separate Art.15/17/21 request, link them (see interaction section below) — they are governed by different statutory clocks and must not be conflated |
| Date acknowledged | Must be ≤30 days from receipt |
| Investigation notes | Ongoing record of enquiries made |
| Progress updates sent | Dates and content, for anything taking longer than a quick resolution |
| Outcome | What was decided/done |
| Date outcome communicated | Must be "without undue delay" — record the reasoning if this takes an extended period, so the reasonableness of the delay can be shown later |
| Escalation offered | Confirm the complainant was told they can escalate to the ICO (see below) |
| Closure date | |
| Root-cause category | For trend review (see below) |

**Where this log should live:** a simple structured record (a spreadsheet or a dedicated table) is
sufficient for PlayPlanner's current scale — this document does not prescribe implementing a new database
table in this pass; a lightweight, consistently-used log beats an unbuilt "proper" system.

## Procedure

1. **Receipt.** Log the complaint immediately with a timestamp — this starts the acknowledgement clock.
2. **Acknowledge within 30 days.** A simple, prompt acknowledgement is better than a delayed
   comprehensive one — acknowledge quickly, investigate afterward.
3. **Verify identity/authority proportionately.** For a complaint that requires accessing or discussing a
   specific account's data, confirm the complainant is who they say they are (or is authorised to act for
   the data subject) — proportionate to the sensitivity of what's being discussed, not a blanket
   heavyweight ID-check for every complaint (many complaints are about policy/practice generally and need
   no identity verification at all).
4. **Investigate without undue delay.** Make appropriate enquiries — this may mean checking logs, code
   behaviour, or relevant database records. **Preserve evidence** relevant to the complaint (do not let
   routine log rotation or the retention purges discussed elsewhere in this governance pass destroy
   evidence relevant to an open complaint — see the retention/suppression interaction principle already
   established in the enrichment remediation work, applied here by analogy).
5. **Send progress updates** if the investigation will take longer than a prompt resolution — this is
   good practice supporting the "without undue delay" standard, not a separate statutory requirement with
   its own clock.
6. **Communicate the outcome without undue delay**, including: what was found, what (if anything) will
   change as a result, and **the right to escalate to the ICO** if the complainant is not satisfied.
7. **Close the complaint** — record the closure date and outcome in the log.
8. **Root-cause and trend review.** Periodically (e.g. quarterly, or whenever a complaint reveals a
   systemic issue) review the complaint log for patterns — a data-protection accountability practice, not
   a statutory line-item, but directly supports demonstrating Art.5(2) accountability.

## Interaction with data-subject rights requests

A complaint and a rights request (access, erasure, objection, etc.) are **legally distinct** and can
arrive together or separately:
- A person might complain **and** simultaneously exercise a right (e.g. "I'm unhappy you did X, and I
  want you to delete my data") — log both, track both against their own respective clocks (s.164A for the
  complaint; the relevant Article's own timeframe, generally one month, for the rights request — see
  `DATA_SUBJECT_RIGHTS_PROCEDURE.md`), and do not let progress on one create the impression the other has
  also been handled.
- A person might complain **about how a previous rights request was handled** — this is a s.164A
  complaint about the earlier request, not a new rights request itself.

## Escalation — what to tell people

Every outcome communication should state plainly:
> "If you are not satisfied with our response, you have the right to complain to the Information
> Commissioner's Office (ICO): ico.org.uk or 0303 123 1113."

(This exact form already appears in the live-fetched `docs/privacy.html` — reuse it consistently here for
the s.164A-specific complaints flow too, rather than inventing separate wording.)

## What must be added to the public privacy page/UI

Per `PRIVACY_NOTICE_GAP_ANALYSIS.md`, the current privacy page does not yet explicitly describe **this
specific complaints procedure** (as distinct from the general ICO-escalation line it already carries).
Recommended additions (not implemented in this pass):
- A short, plain-language section: "How to complain," naming the email channel, stating the 30-day
  acknowledgement commitment, and stating that resolution timing depends on complexity but will be
  "without undue delay."
- Do not promise a fixed resolution timeframe beyond the 30-day acknowledgement — promising, say, "we
  will resolve within 14 days" would create a self-imposed obligation stricter than the law requires and
  risks being an inaccurate promise for a complex complaint.
