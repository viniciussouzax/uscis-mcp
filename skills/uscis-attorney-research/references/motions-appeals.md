# Motions, Appeals, and the I&N Dec. Corpus

Reference for the Precedent Research workflow. Read this before researching an I-290B motion, AAO appeal, or BIA matter. Verify every regulatory statement below against live text (`get_visa_category_rules` on the cited section) before relying on it in work product — this file frames the research; it is not itself a citable source.

## Two procedural tracks

**Track A — USCIS denials (affirmative benefits side).** Most USCIS denials are challenged on **Form I-290B**, which covers three distinct vehicles:

1. **Appeal to the AAO** (Administrative Appeals Office) — available for most employment-based petitions and many other benefit types. Governed by **8 CFR 103.3**.
2. **Motion to reopen** — filed with the office that made the decision. Must state **new facts** and be supported by documentary evidence. Governed by **8 CFR 103.5**.
3. **Motion to reconsider** — filed with the deciding office. Must establish the decision was based on an **incorrect application of law or policy** *at the time of the decision*, supported by **citations to appropriate statutes, regulations, or precedent decisions**. Also 8 CFR 103.5.

Some denials do not go to the AAO: notably, denied **I-130s are appealed to the BIA** (a common trap). Certain decisions (e.g., many I-485 denials) have **no administrative appeal** — motion practice or renewal in removal proceedings is the path. Always verify the appeal route stated in the denial notice itself and in 8 CFR 103.3.

**Track B — Removal proceedings.** Immigration court decisions are appealed to the **BIA**; BIA precedent may then be reviewed by the Attorney General or federal circuit courts. Circuit law is **not in this corpus** — flag it every time it matters.

## Deadlines (verify against current 8 CFR 103.3/103.5 and the denial notice)

- I-290B appeals and motions: generally **30 calendar days** from the decision (**33 if the decision was mailed**). Some categories differ (e.g., revocations at 15/18 days). The denial notice controls; treat these numbers as a prompt to check, not an answer.
- Untimely appeals may be treated as motions in limited circumstances (8 CFR 103.3(a)(2)(v)(B)) — worth researching when a deadline was blown.

## Why reconsider-vs-reopen matters for research strategy

- A **motion to reopen** is an *evidence* project: the research task is identifying what new, previously unavailable facts would satisfy the standard the office applied — so pull the regulation and Policy Manual chapter defining that standard.
- A **motion to reconsider** is a *citation* project: it succeeds only by showing the adjudicator misapplied **binding** authority. This is exactly what the MCP retrieves — the regulation as written (`get_visa_category_rules`), the Policy Manual position (`get_policy_manual_section`), and precedent decisions (`search_bia_decisions` → `get_bia_decision`). Build the motion around direct quotes from these with pinpoint cites.
- Both can be filed together on one I-290B; research both theories when the record supports it.

## Scenario: abandonment denial where the RFE was never received

A recurring fact pattern: USCIS denies for **abandonment**, asserting an RFE went unanswered — but neither the client nor counsel ever received the RFE. Handle this as its own sub-workflow because the procedural rules are unusual (regulatory statements below were verified against live eCFR text in testing, but re-verify in each engagement — that is the point of the skill):

1. **No appeal lies from an abandonment denial.** Under 8 CFR 103.2(b)(15), a denial due to abandonment "may not be appealed, but an applicant or petitioner may file a motion to reopen under § 103.5." An I-290B checking the "appeal" box here is a fatal drafting error.
2. **8 CFR 103.5(a)(2) enumerates the winning theories** for reopening an abandonment denial: (i) the requested evidence was not material to eligibility; (ii) the required evidence was submitted, or the request was complied with during the allotted period; or (iii) the request was "sent to an address other than that on the application, petition, **or notice of representation**," or a written change of address/representation was not honored. Non-receipt cases usually turn on (ii) and (iii) — and note that ground (iii)'s own text makes the **G-28 an address of record**.
3. **The dual-notice regulation strengthens the motion.** 8 CFR 103.2(b)(19)(ii)(A): when a petitioner is represented, USCIS sends original notices **both** to the petitioner **and** to the attorney/accredited representative of record. With a G-28 on file, the argument is not merely "we didn't get it" — it is that USCIS's own binding rule required service on two addresses, and non-receipt at both independently maintained addresses makes proper mailing improbable. Also note 8 CFR 103.2(b)(8)(iv): RFEs go by regular or electronic mail, and regular mail carries the weakest delivery presumption in the administrative caselaw.
4. **Address-of-record forensics is the core factual research.** Reconstruct: the address on the underlying form, any AR-11/change of address, and the G-28 address. Recommend a FOIA request for the record of proceeding to see whether the RFE exists, what addresses it bears, and whether it returned undeliverable; 8 CFR 103.2(b)(16)(i) entitles the petitioner to inspect the record constituting the basis of the decision.
5. **Mailing-presumption precedent.** Search the corpus for the notice/presumption-of-delivery line of BIA cases (query terms: "presumption of delivery", "notice regular mail", "motion to reopen notice"; e.g., *Matter of M-R-A-*, 24 I&N Dec. 665 (BIA 2008)). These arise in the removal/hearing-notice context but their framework — a weaker, rebuttable presumption for regular mail, rebuttable with affidavits of non-receipt, diligence, and incentive to respond — is the closest on-point administrative authority. Fetch full text and characterize the posture honestly.
6. **Evidence package**: sworn declarations of non-receipt (client and counsel); form and G-28 copies proving the addresses of record; proof both addresses were valid and monitored (other USCIS mail received there); office mail log; USPS Informed Delivery/forwarding records; proof of responsiveness to every other notice (diligence and incentive); the FOIA return.
7. **Deadline pressure**: the 30-day clock under 8 CFR 103.5(a)(1)(i) runs from the denial, which may itself have gone astray for the same mail reasons. The same paragraph allows late filing of a motion to *reopen* where "the delay was reasonable and was beyond the control of the applicant or petitioner" — document the discovery timeline carefully. (No parallel excuse exists for motions to reconsider.)
8. **Fallback framing**: 103.2(b)(15) permits refiling with a new fee, but the priority/processing date of the abandoned filing does not carry over — compare motion timeline vs. refiling cost (`get_processing_time`, `get_form_requirements`) as a strategic note; the attorney decides.

## Second-order motions: when USCIS denies the motion itself

If USCIS denies the motion to reopen (e.g., asserting the facts fit no enumerated ground), the procedural geometry matters more than ever:

- **The motion denial inherits the appealability of the original decision.** Under 8 CFR 103.5(a)(6), a decision made on a motion may be appealed to the AAO *only if the original decision was appealable there*. In abandonment cases the original denial was not appealable — so the motion denial isn't either. The entire administrative fight proceeds through **successive motions**, each with its own 30-day clock from the latest decision (103.5(a)(1)(ii): jurisdiction lies with the official who made the latest decision).
- **The vehicle is a motion to reconsider the motion denial** under 103.5(a)(3) — a pure citation project. Frame the error as textual misapplication of the enumerated grounds (e.g., reading the "notice of representation" clause out of ground (iii)) and of the dual-notice duty in 103.2(b)(19)(ii)(A), quoting both verbatim. The factual predicate (whether/where the RFE was sent) is governed by preponderance per *Matter of Chawathe*.
- **Invite a service motion.** 103.5(a)(5)(i) lets the officer reopen sua sponte and combine the motion with a favorable decision in one action — say so expressly in the filing.
- **Useful standards precedent** (removal-context; persuasive by analogy, fetch full text and frame candidly): *Matter of L-O-G-*, 21 I&N Dec. 413 (BIA 1996) (reopening requires "a reasonable likelihood of success," not a conclusive showing); anticipate *Matter of Coelho*, 20 I&N Dec. 464 (BIA 1992) ("heavy burden") and distinguish it — once an enumerated 103.5(a)(2) ground is established, the decision "was in error" by the regulation's own terms; general reopening discretion is not the operative standard.
- **The exit ramp is federal court.** With no administrative appeal available, the motion denial is final agency action; APA review is the judicial path. Reviewability and the discretionary-bar doctrine are **circuit-law questions outside this corpus** — flag them, don't resolve them. CIS Ombudsman and congressional liaison inquiries can run in parallel without prejudice.
- **Always price the refile** against continuing the fight; for petitions where the priority date is the client's place in line, its loss is usually what justifies motion practice.

## The I&N Dec. corpus includes AAO precedent

`search_bia_decisions` searches published I&N Dec. volumes, which contain precedential decisions of the **BIA, the Attorney General, and the AAO**. Per 8 CFR 103.3(c), designated precedent decisions bind all DHS employees — so AAO and BIA precedent alike are binding authority in a motion to reconsider or AAO appeal brief.

Frequently load-bearing precedents on the benefits side (verify currency and treatment before citing):

- ***Matter of Chawathe***, 25 I&N Dec. 369 (AAO 2010) — preponderance of the evidence is the standard of proof in benefits adjudications. Relevant to nearly every denial that demanded more certainty than the law requires.
- ***Matter of Dhanasar***, 26 I&N Dec. 884 (AAO 2016) — the three-prong EB-2 national interest waiver framework.
- ***Matter of Ho***, 19 I&N Dec. 582 (BIA 1988) — inconsistencies and derogatory evidence; doubt cast by discrepancies.
- ***Matter of Soriano***, 19 I&N Dec. 764 (BIA 1988) and ***Matter of Obaigbena***, 19 I&N Dec. 533 (BIA 1988) — evidence submitted for the first time on appeal/after an RFE opportunity.
- ***Matter of Skirball Cultural Center***, 25 I&N Dec. 799 (AAO 2012) — P-3 culturally unique analysis; example of AAO precedent on artist classifications.

Do not cite these from this list — run `search_bia_decisions` / `get_bia_decision` to fetch the actual text, confirm the holding, and capture the PDF URL.

## Search technique for this corpus

- Search matches **case names and holding summaries**, not full text. Use the doctrinal phrase a headnote would use ("motion to reconsider", "ability to pay", "specialty occupation", "particular social group"), plus a second pass with synonyms.
- When a decision is known by name (client says "the Dhanasar factors"), search the case name directly.
- Use `volume` to bracket eras when tracing doctrinal evolution (e.g., pre/post a known AG referral).
- For anything you'll cite, always fetch full text — holding summaries compress away qualifications, concurrences, and remand postures that change how a decision can be used.

## Standing limitations to state in work product

- **No circuit court caselaw** — often controlling in removal and on judicial review of AAO/BIA decisions.
- **No unpublished AAO decisions** — persuasive-only material on uscis.gov's non-precedent archive; useful for adjudication trends, not retrievable here.
- **No version history** — all sources are current-text-only; for the law "as of" a past decision date (the reconsider standard), note that the fetched text is current and check the eCFR point-in-time viewer or Federal Register when an intervening amendment is suspected.
