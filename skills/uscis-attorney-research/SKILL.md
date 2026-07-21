---
name: uscis-attorney-research
description: Structured legal research workflows for immigration attorneys using the USCIS MCP (Policy Manual, 8 CFR regulations, precedential BIA/AG/AAO decisions, form requirements, processing times). Use this skill whenever an attorney or paralegal asks for help with an RFE or NOID response, a motion to reopen or reconsider (Form I-290B), an AAO or BIA appeal, removal defense precedent research, client intake screening or case strategy for a visa/green card/naturalization matter, verifying current USCIS policy before advising a client, or pre-filing quality assurance on an application package. Trigger even if the user doesn't name a workflow — e.g. "my client's I-140 was denied", "got an RFE on an O-1", "is this still USCIS policy?", "what do we need to file with the I-130?" all call for this skill.
---

# USCIS Attorney Research

Legal research workflows for immigration practitioners, built on the `uscis` MCP server. The server exposes five authoritative live sources: the USCIS Policy Manual, Title 8 CFR (via eCFR), precedential administrative decisions published in I&N Dec. (BIA, Attorney General, **and AAO**), official form requirement pages, and published processing times.

The value of these workflows over ad-hoc research: every claim ties to a verbatim primary source fetched live, with a pinpoint citation the attorney can verify. Never substitute memory of immigration law for a fetched source — policy and processing times change frequently, and a stale citation in a brief or client letter is worse than none.

## Ground rules for every workflow

1. **Fetch, don't recall.** Regulatory text, Policy Manual positions, holdings, fees, and processing times must come from tool output in this session. Trained knowledge is only for framing issues and choosing search terms.
2. **Citation integrity.** Cite decisions as *Matter of X*, [vol] I&N Dec. [page] ([body] [year]) and include the PDF URL returned by the tool. Cite regulations by full section and subsection (e.g., 8 CFR 204.5(g)(2)). Cite the Policy Manual by volume/part/chapter (e.g., USCIS Policy Manual, Vol. 6, Part F, Ch. 5). Note the publication date on any processing time.
3. **Quote sparingly, characterize accurately.** Quote the operative regulatory language or holding exactly; summarize the rest. Flag any tension between the regulation, the Policy Manual, and precedent rather than smoothing it over.
4. **Work product framing.** Output is research support for a licensed attorney's own judgment — organized authority, not a recommendation to a client. Do not produce advice directed at an unrepresented individual under this skill; that's a different audience with different duties.
5. **Know the corpus limits.** Say so explicitly when a question exceeds the sources: no federal circuit court caselaw (often controlling on appeal or in removal), no unpublished/non-precedential AAO decisions, no Visa Bulletin, no state court material. Recommend where to supplement (Westlaw/Lexis, circuit reporters, AAO non-precedent archive on uscis.gov).

## Tool cheat sheet

| Need | Tool | Notes |
|---|---|---|
| Find the right regulation | `search_regulations` | Free text; optionally restrict with `cfr_part` (e.g., "214" nonimmigrants, "204" immigrant petitions, "245" adjustment, "103" appeals/motions) |
| Full regulatory text | `get_visa_category_rules` | Accepts pinpoint citations like "8 CFR 214.2(h)" |
| Navigate the Policy Manual | `get_policy_manual_toc` | Filter by `volume` to keep output small; returns slugs |
| Policy Manual text | `get_policy_manual_section` | Chapter slugs give the most focused text |
| Find precedent | `search_bia_decisions` | Searches case names + holding summaries across I&N Dec. vols. 8–present. Covers BIA, AG, **and precedential AAO** decisions |
| Full decision text | `get_bia_decision` | Prefer the `id` from search results; long decisions truncate at 40k chars but the PDF URL is always returned |
| Evidence checklist, fees, where to file | `get_form_requirements` | Parses the official uscis.gov form page |
| Timeline estimate | `get_processing_time` | Call with `list_options: true` first when the form has sub-types/offices |

### Operational lessons (learned from live runs — follow these to avoid rework)

- **Precedent search cold cache.** The first `search_bia_decisions` call in a session crawls every I&N Dec. volume listing and can exceed client timeouts. Warm the cache early with a cheap one-word search (e.g., a case name) before you need results. If the first call times out, the crawl usually completes in the background: wait and retry rather than declaring the corpus unavailable — and never substitute remembered citations for a failed search. If retries keep failing, deliver the memo with the precedent section explicitly marked pending, listing the exact queries to run.
- **Oversized CFR sections.** Pinpoint citations subset only to a limited depth; some sections (8 CFR 214.2 especially, ~700k characters) return whole regardless. Large returns get stored to a file instead of context — extract the needed paragraph programmatically (grep/python for the operative phrase) rather than reading the whole return. Quote from the extracted text and keep the effective date from the envelope.
- **Processing time hygiene.** The tool may default to an arbitrary office (e.g., a single field office for N-400) and may attribute a third-party aggregator rather than USCIS's own portal. Always report the office code, publication date, and source attribution returned; for field-office-adjudicated forms (N-400, I-485 interviews), use `list_options: true` and select the client's actual office before quoting a timeline in client-facing material.
- **Policy Manual gaps.** Some parts exist in the TOC with no published chapters (e.g., Vol. 2 Part H, Specialty Occupation Workers). When the TOC shows an empty part, say so plainly: the regulation is then the primary source and interpretive guidance lives in policy memos/rule preambles outside this corpus. Don't hunt for chapter slugs that don't exist.

## Workflow selection

| Situation | Workflow |
|---|---|
| RFE or NOID received; drafting a response | RFE/NOID Response Research |
| New client consult; assessing viability and timeline | Intake & Case Strategy Screening |
| Denial received; considering I-290B motion or appeal; removal proceedings; brief-writing | Precedent Research (read `references/motions-appeals.md`) |
| "Is this still the policy?" / updating templates and practice advisories | Policy Verification |
| Package assembled; final check before filing | Pre-Filing QA |

Workflows combine naturally — a denial response often pairs Precedent Research with Policy Verification; an intake memo often borrows the Pre-Filing QA checklist.

---

## RFE/NOID Response Research

Goal: an issue-by-issue authority map the attorney can draft from.

1. **Parse the notice.** Identify: form and classification, each contested element, and every authority USCIS cited (CFR sections, Policy Manual chapters, precedent). If the user hasn't pasted the RFE, ask for the contested elements and cited authorities — the response must meet the notice on its own terms.
2. **Pull the cited authorities first.** `get_visa_category_rules` for each cited CFR section; `get_policy_manual_section` for cited chapters (use the TOC if you only know the topic). Read what USCIS is actually relying on before searching for counter-authority — RFE templates sometimes overstate or misapply the source.
3. **Find controlling and persuasive precedent** with `search_bia_decisions` on each contested element (search doctrinal phrases: "preponderance of the evidence", "ability to pay", "extraordinary ability", "national importance"). Pull full text with `get_bia_decision` for anything you'll rely on; verify the holding supports the point from the actual text, not the summary alone.
4. **Check the burden-of-proof framing.** *Matter of Chawathe*, 25 I&N Dec. 369 (AAO 2010) (preponderance standard) is relevant to nearly every RFE response; confirm its continued treatment in the Policy Manual (Vol. 1 covers general policies and evidence standards).
5. **Deliver a research memo** using this structure:

```
# RFE Response Research Memo — [Client/Matter], [Form] ([Classification])
## Notice summary
[Contested elements; authorities USCIS cited; response deadline if known]
## Issue 1: [element]
- What USCIS's cited authority actually requires (quoted operative language + citation)
- Supporting precedent (holding, citation, PDF URL)
- Policy Manual position (citation)
- Evidence that would satisfy the standard / gaps to address
- Tensions or misapplications in the notice, if any
## Issue 2: ...
## Authorities table
[Every source cited, with pinpoint cites and URLs]
## Corpus limitations
[E.g., relevant circuit law not searchable here]
```

## Intake & Case Strategy Screening

Goal: a screening memo with realistic eligibility assessment and timeline.

1. **Map facts to candidate classifications.** List each plausible category; don't anchor on the one the client asked about.
2. **Verify eligibility criteria from the current regulation** — `search_regulations` to locate, `get_visa_category_rules` for full text. Note elements the client clearly meets, clearly fails, or where evidence will be the fight.
3. **Check the Policy Manual** for interpretive gloss on the close elements (discretionary factors, evidentiary expectations).
4. **Pull real timelines**: `get_processing_time` for each form in the strategy (use `list_options: true` when sub-type/service center matters — employment vs. family I-485s differ substantially). Note the publication date.
5. **Pull filing burden**: `get_form_requirements` for fees and initial evidence, so cost and effort are part of the strategy conversation.
6. **Flag complexity signals** that change the analysis and may exceed this corpus: prior denials or removal orders, criminal history, unlawful presence, prior fraud/misrepresentation findings.
7. **Deliver**: comparison of candidate paths (elements, evidence burden, fees, timeline with as-of date, risks), recommended follow-up questions for the client, and open legal questions requiring sources beyond this MCP.

## Precedent Research — Removal Defense, BIA Appeals, and I-290B Motions

This workflow covers two distinct procedural worlds that share one research corpus. **Read `references/motions-appeals.md` before doing I-290B or AAO work** — it contains the regulatory framework (8 CFR 103.3/103.5), deadlines, the reopen-vs-reconsider distinction, and the key AAO precedents.

1. **Fix the procedural posture first.** USCIS denial → I-290B (appeal to AAO, or motion to reopen/reconsider with the deciding office)? Removal proceedings → immigration court/BIA? The posture determines which authorities are binding and what the motion must contain.
2. **Frame the doctrinal issue** in the vocabulary precedent actually uses (e.g., "crime involving moral turpitude", "particular social group", "national interest waiver", "successor in interest"), then `search_bia_decisions`. Run 2–3 query variants; the search matches case names and holding summaries, so synonyms matter. Restrict by `volume` when chasing a known-era decision.
3. **Read the full text** (`get_bia_decision`) of any decision you'll cite. Verify: the holding, whether later precedent in the results modifies or overrules it, and which body issued it (BIA/AG/AAO — all binding on USCIS adjudicators, per 8 CFR 103.3(c)).
4. **Triangulate against current law**: pull the governing regulation (`get_visa_category_rules`) and Policy Manual chapter. A motion to reconsider in particular lives or dies on showing the decision misapplied *binding* authority — regulation, precedent, or policy — as it existed at the time of decision.
5. **Deliver a precedent memo**: procedural posture and deadline; precedent table (case, citation, body, year, holding, how it helps/hurts, PDF URL); argument outline mapping each authority to an element of the motion/appeal/defense; explicit note on what circuit or unpublished authority should be checked elsewhere.

## Policy Verification

Goal: confirm what the Policy Manual and regulations say *today*, versus what the attorney remembers or has in templates.

1. Locate the section: `get_policy_manual_toc` (filter by volume) → `get_policy_manual_section` on the chapter slug.
2. Quote the current operative language exactly. If the user described a remembered position, state plainly whether the current text matches, differs, or is silent — differences are the entire point of this workflow.
3. Cross-check the regulation the policy interprets (`get_visa_category_rules`); note any daylight between them.
4. Where the user is monitoring for change over time, note that the tool returns current text only — no version history. Recommend the Policy Manual "Updates" page and Federal Register for change tracking, and offer to save today's fetched text as a dated snapshot for future comparison.

## Pre-Filing QA

Goal: a gap check of an assembled package against USCIS's own published requirements.

1. `get_form_requirements` for each form in the filing. Extract: initial evidence checklist, current fee, where to file, and special instructions.
2. Compare against what the user says is in the package, item by item. Output three lists: **present**, **missing**, **unclear/verify** (items where the requirement depends on facts, e.g., whether a fee waiver applies).
3. Flag anything in "special instructions" that commonly causes rejection (edition dates, signature requirements, fee combinations, direct filing addresses).
4. Add `get_processing_time` output (with as-of date) so the client expectation letter can be drafted from the same session.
5. Close with: filing fees total, where to file, and a reminder that lockbox rejection criteria and form edition dates should be re-verified on uscis.gov the day of mailing.

---

## Output conventions

- Markdown memos, concise and evidence-dense; tables for authorities and comparisons.
- Every memo ends with an **Authorities** section (pinpoint cites + URLs) and a **Corpus limitations** note where relevant.
- Include "as of [publication date]" on all processing times and "fetched [today's date]" on Policy Manual quotes.
- If a tool call fails or returns nothing on-point, say so and adjust strategy (different search terms, different CFR part) rather than filling the gap from memory.
