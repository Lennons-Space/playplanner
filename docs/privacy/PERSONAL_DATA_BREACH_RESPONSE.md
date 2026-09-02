# Personal Data Breach Response Procedure — PlayPlanner

**Status:** DRAFT — **OWNER/LEGAL REVIEW REQUIRED**
**Date:** 2026-09-01
**Legal basis:** UK GDPR Art.33 (notification to the ICO) and Art.34 (notification to affected
individuals). **The legal test is risk-based throughout — not every incident must be reported to the
ICO, and this document does not say otherwise anywhere below.**

---

## The two thresholds — do not conflate them

| | Threshold | Who is told | Deadline |
|---|---|---|---|
| **ICO notification** (Art.33) | The breach is **"likely to result in a risk"** to individuals' rights and freedoms | The ICO | **"Without undue delay and, where feasible, within 72 hours"** of the controller becoming aware. If notification is later than 72 hours, the reasons must be recorded and given to the ICO. |
| **Individual notification** (Art.34) | A **higher** bar — the breach is **"likely to result in a HIGH risk"** | The affected individuals directly | "Without undue delay" — no fixed hour count |

**A breach can fail the ICO-notification threshold entirely** (assessed as unlikely to result in any
material risk) and require **no ICO report at all** — this must be a genuine, documented risk assessment
each time, not a default-to-report reflex, and not a default-to-skip reflex either.

## 1. Detection

Anyone (developer, admin, or a report from a user/researcher) who suspects a personal data breach must
report it immediately to the **incident owner** (currently: Liam, as sole developer/controller — see
`DPO` discussion in the governance-pass final report for who holds this accountability as the team
grows). "Breach" here means the UK GDPR definition: a security incident leading to the accidental or
unlawful destruction, loss, alteration, unauthorised disclosure of, or access to, personal data — this is
broader than just "someone hacked the database" and includes, for example, an accidental public exposure
of a private table, a misconfigured RLS policy (this project's own history includes at least one such
incident, per `065_restrict_profile_read_exposure.sql`'s documented pre-fix state), or a lost device with
cached personal data.

## 2. Containment

- Stop the ongoing exposure first (revoke a leaked key, fix a misconfigured policy, disable a compromised
  account) — containment takes priority over investigation depth in the first moments.
- **Preserve evidence before remediating where possible** — a fix that also destroys the evidence needed
  to assess scope (e.g. immediately truncating an affected table) can make the risk assessment impossible
  to do properly later. Where containment and evidence preservation conflict, containment wins for
  anything actively exploitable, but capture what can be captured first (a row count, a query log, a
  screenshot of the misconfigured state) before changing it.

## 3. Incident owner

One named person owns the incident end-to-end (currently Liam). As the team grows, this should be an
explicitly assigned role, not assumed by whoever happens to notice first.

## 4. Scope the breach

Identify and record:
- **Affected systems** (which table, which API endpoint, which storage bucket, which third-party
  processor if applicable)
- **Categories of individuals affected** (e.g. "authenticated users," "venue operators," "children" if
  `children_ages` data is implicated — this is exactly the kind of finding that should trigger heightened
  scrutiny given the Children's Code considerations elsewhere in this governance pass)
- **Approximate number of individuals affected** — an estimate is acceptable and expected in the early
  hours; refine it as the investigation proceeds
- **Categories of records affected** (e.g. "profile email addresses," "location consent timestamps,"
  "plaintext phone numbers from `venue_claims`" — see the finding in `ROPA.md` about that specific column)
- **Whether the breach involves any processor** (Supabase, Stripe, Expo) — if so, that processor's own
  breach-notification obligation to PlayPlanner (a standard Art.28(3)(f) DPA term) should be checked and
  invoked; see `PROCESSOR_AND_VENDOR_REGISTER.md` for which processor DPAs are confirmed vs. unverified

## 5. Risk assessment (the part that decides everything downstream)

Assess, and **write down the reasoning, not just the conclusion**:
- What harm could result (identity theft, financial loss, distress, discrimination, physical safety —
  the last being especially relevant if location or a child-relevant field were exposed)?
- How likely is that harm, given who could plausibly have accessed the data and what they could do with
  it?
- Are there mitigating factors (encryption, the data being pseudonymised/hashed already, the exposure
  window being very short, the recipient being a trusted party who has confirmed deletion)?

**Outcome A — no ICO notification required.** Document why (low/no likely risk) and **still log the
incident** — see §11, the log must be retained even when no ICO notification is made, so the reasoning is
available if ever questioned later.

**Outcome B — ICO notification required.** Proceed to §6.

**Outcome C — individual notification also required** (the higher bar). Proceed to §7 in addition to §6.

## 6. ICO notification (where required)

- Notify **without undue delay and, where feasible, within 72 hours** of the controller becoming aware
  (awareness, not the moment the breach began — the clock starts when PlayPlanner reasonably established
  that a breach has probably occurred, not merely suspected it).
- If notification happens after 72 hours, **record the reasons for the delay** — this is a specific,
  named requirement, not just good practice.
- Notification should cover: the nature of the breach, approximate categories/numbers of individuals and
  records, likely consequences, and measures taken/proposed.
- **International processors**: if a processor outside the UK is implicated (e.g. Stripe, Expo — see
  `INTERNATIONAL_TRANSFERS.md`), note this in the ICO notification and consider whether that processor's
  own jurisdiction's regulator also needs informing under its own rules — this is `LEGAL REVIEW REQUIRED`
  territory, not something to decide unassisted in the heat of an incident.

## 7. Individual (data subject) notification (higher bar — only if high risk)

- "Without undue delay" — get real information to affected people promptly, in clear and plain language.
- Should include: what happened, what data was involved, what PlayPlanner is doing about it, and what
  the individual can do to protect themselves.
- **Exception:** if PlayPlanner has since applied appropriate protective measures that render the data
  unintelligible to unauthorised parties (e.g. the data was properly encrypted and the key was not
  compromised), individual notification may not be required even for an otherwise high-risk breach — this
  is a genuine, documented exception, not a loophole to reach for by default.

## 8. Remediation

Fix the underlying cause — not just the symptom. If the breach was caused by a misconfigured RLS policy
or an over-broad grant (this project's own history has real examples — see the privilege-hardening
migrations from earlier sessions), confirm the fix with the same rigor this project has applied
throughout (re-run privilege probes, don't just trust that "it's fixed now").

## 9. Lessons learned

After closure, review: how was it detected, how quickly was it contained, was the risk assessment
accurate in hindsight, and does any process (code review, migration review, the gate-running discipline
this project already practises) need strengthening to catch this class of issue earlier.

## 10. Breach log — retained even when no ICO notification is made

**This is explicit in the legal framework and restated here because it is easy to skip**: Art.33(5)
requires the controller to **document every breach**, including the facts, effects, and remedial action
taken — **regardless of whether it met the ICO-notification threshold.** A breach assessed as "no report
needed" still gets logged. See the companion template:
`docs/privacy/PERSONAL_DATA_BREACH_LOG_TEMPLATE.md`.

## 11. What this procedure does NOT say

**It does not say every incident must be reported to the ICO.** The risk-based test in §5 is the actual
gate, and a genuine, well-reasoned "no" is a legitimate, expected, and legally correct outcome for many
incidents — the goal of this document is a consistent, evidenced process for reaching that conclusion
each time, not a bias toward over- or under-reporting.
