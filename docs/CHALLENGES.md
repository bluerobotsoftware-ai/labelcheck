# What was actually hard

A candid retrospective on building this prototype. Written because the
interesting parts of a take-home are the places where the brief and reality
disagreed, and the reasoning that resolved them — not the parts that went to
plan.

---

## 1. The brief contradicts itself, on purpose

Two stakeholders state requirements that cannot both be satisfied by the same
mechanism.

**Jenny Park:** the government warning must be exact. "Word-for-word, and the
'GOVERNMENT WARNING:' part has to be in all caps and bold." She rejected a label
last month over title case.

**Dave Morrison:** `STONE'S THROW` on the label against `Stone's Throw` in the
application is "obviously the same thing. You need judgment."

One says character-exact. The other says a character difference must not fail.
An implementation that picks a side is wrong either way: pure string equality
fails Dave's case, and fuzzy matching lets Jenny's rejection through.

**The resolution was to notice they are not talking about the same comparison.**
Dave's case is *label vs. application* — two humans describing one product, so
typographic difference is noise. Jenny's is *label vs. statute* — the applicant
does not get a vote on the wording, so any difference is signal.

That split became the architecture. Reports have two sections, driven by two
different sources of truth, and the government warning is never compared against
the application at all because it does not appear there. Once separated, the
contradiction dissolves — but the brief gives no hint that this is the move, and
building a single "does the label match?" comparator is the obvious first
instinct.

---

## 2. The domain had moved, and the brief hadn't

Three separate places where the authoritative facts differ from what any
reasonable person would assume.

**Standards of fill changed in January 2025.** T.D. TTB-200 (90 FR 1868) added
ten authorised container sizes for spirits. I seeded the list from pre-2025
knowledge and the app confidently rejected all ten — including 710 mL — as
unlawful containers, *with a CFR citation attached*. A wrong answer that arrives
formatted like a right one is the worst kind, and 115 tests passed the whole
time because every one of them compared against the same wrong constant.

The fix was not more tests. It was `tests/regulationSync.test.ts`, which parses
the size lists out of the research document and diffs them against the arrays
compiled into the app. A constant that is only ever checked against itself is
not checked at all.

**Alcohol content and net contents are not on the modern COLA form.** They were
Items 13 and 12 until roughly the 2015 revision and were removed. Verified
against the live public registry: a 2016 filing renders both, a 2025 filing
renders neither.

This directly contradicts the brief, which lists both under "Example Distilled
Spirits Label Fields" and says the app should handle them. Both are true — the
*label* carries them, the *application* no longer does — and the app now serves
both readings: when the application states a value it is matched, and when it
does not, the check reports `not_applicable` for matching while the label's own
obligations (mandatory presence, standards of fill, proof consistency) still
run. Failing a label because the application is silent would look obviously
wrong to any real agent.

**Capitalisation is narrower than it appears.** 27 CFR 16.22(a)(2) requires only
the two words `GOVERNMENT WARNING` in capitals and bold, and forbids the
*remainder* from being bold. It constrains the weight of the body text, not its
case. Nothing in part 16 prohibits an all-caps body. It would have been easy —
and wrong — to enforce sentence case on the whole statement.

**Method note.** `ecfr.gov`'s HTML front end serves a bot interstitial, so the
research went through the versioner API for raw XML instead. The eCFR also
contains an internal inconsistency: §4.72's source note dates T.D. TTB-200 to
20 January 2025 while §4.37 and §5.203 say 10 January. The Federal Register API
confirms the 10th.

---

## 3. Five seconds is a real constraint, and the warning sets the floor

The latency budget is the reason a previous vendor was abandoned, so it is not
negotiable. The obvious lever is to shrink the image before sending it — fewer
pixels, less upload, fewer tiles for the model, lower cost.

The complication is *which text sets the resolution floor*. The brand name is
enormous and survives aggressive downscaling. The government warning is the
smallest print on the label, and it is the one field that must be read
character-exact. So the compression target is set by the hardest field, not the
average one, and the tempting extra 30% of speed is not available.

Settled at a 1568px long edge — the point above which vision endpoints resize
internally anyway, so anything larger is upload time bought for nothing.
Combined with low reasoning effort and a single structured call. Every report
displays its own timing, split between reading and rules, so the claim is
falsifiable on every single use rather than asserted once in a README.

---

## 4. The firewall constraint fights the deployed-URL deliverable

Marcus states plainly that their network blocks outbound ML endpoints, and that
this is exactly how the last vendor pilot half-failed. Meanwhile the brief
requires a deployed URL that Treasury can access and test.

Taking Marcus literally — build something fully offline — means local OCR, which
cannot read ornate distillery typography through glare at an angle, which fails
Jenny's requirement. Ignoring him means walking into a stated constraint.

The resolution was to treat the vendor as a detail rather than a decision: a
`LabelReader` interface with three working implementations behind it, whichever
key is configured being the one that runs. Nothing above that interface imports
a vendor SDK. It is worth being honest that **an interface with one
implementation is just indirection** — the second provider is what makes the
claim testable, and it is why Gemini exists in the codebase alongside Claude
rather than as a README promise.

This also made the vendor choice defensible without inventing a technical
mandate. Any frontier vision model reads these labels competently; there is no
capability argument singling one out. The README says so.

---

## 5. No test data, and a real risk of marking my own homework

The brief supplies no label images and suggests generating some. That creates a
subtle problem: if the same process both generates the test labels and builds
the checker, a shared blind spot produces a green suite that proves nothing.

Mitigations applied: labels are rendered deterministically from SVG rather than
generated by an image model, so every defect is planted deliberately and every
expected outcome is known in advance; the generator *asserts its own defects are
real* (that the two ABV strings actually differ, that the title-case header
differs only in case, that the reworded warning genuinely lacks the dropped
clause), so a green generation run means the fixtures test what they claim; and
`tests/samples.test.ts` binds the manifest's ground truth to check ids the engine
actually emits, so the two cannot drift apart quietly.

**This is mitigated, not solved.** The samples and the app share an author. Real
bottle photographs from the COLA registry would be a stronger test set, and that
is the first thing I would add with more time.

---

## 6. A green test suite hid the most dangerous bug in the system

115 tests passed while a label transcribed at 5% confidence throughout returned
`approve`.

The confidence gate — the mechanism that says "I could not read this, get a
better photograph" — was written once, inside the text-comparison helper. Four
fields routed through that helper. Three did not: alcohol content, net contents,
and the government warning, each having its own control flow. Those three carry
the most absolute obligations in the product, and they were precisely the three
skipping the check.

The tests did not catch it because **the tests were written from the same mental
model as the code.** I believed the gate was global, so I tested it where I
believed it lived. More tests of the same kind would have added coverage without
adding a chance of finding this.

What found it was an adversarial audit, given one instruction that mattered:
*construct a label with a genuine defect that still returns "approve", and prove
it with running code.* That inverts the incentive. A test author asks "does this
work?"; an auditor asks "how do I make this lie?" — and those questions have
different blind spots.

Two audits ran, on non-overlapping scopes, and produced 40 findings. The other
two criticals were of the same family: a rate limiter that read a header the
caller supplies (300 requests, rotating values, zero rejections) and unbounded
input lengths feeding an O(n·m) algorithm on a single-threaded runtime. Both
were invisible from inside the design, obvious from outside it.

The lesson I would carry forward: past a certain point, confidence should come
from someone trying to break the thing, not from the author writing more tests
that agree with them.

---

## 7. Judging physical properties from a photograph

27 CFR 16.22 specifies the warning's requirements in millimetres of type size
and characters per inch. **No photograph can establish either.** A label shot at
an angle, cropped, or at unknown distance carries no scale.

So boldness and legibility are reported by the vision model as visual judgments,
and the app treats them as a prompt for an agent to look — never as a
measurement. They are documented as advisory in the README, in the in-app "How
it works" page, and in the regulatory notes' gaps section. The temptation was to
present them with the same authority as the word-level text diff, which is
genuinely measurable. Resisting that is the difference between a tool an agent
can trust and one that quietly overstates itself.

---

## 8. The easy implementation is the wrong one

The shortest path to a working demo is to hand a vision model both the label and
the application and ask "does this comply?" It would work, it would demo well,
and it would be finished in an afternoon.

It is also unauditable. When an applicant appeals a rejection — and they do —
the agent must be able to say which rule fired and which regulation it comes
from. "The model said so" does not survive that conversation, and a federal
compliance decision that cannot be explained is not a compliance decision.

So the model transcribes and nothing else, deterministic code decides, and every
verdict carries a rule id and a citation. The cost is real: far more code, a
normalisation ladder to hand-write, parsers for alcohol statements and volumes,
tolerance tables to research. The benefit is that the entire decision layer is
testable with no network and no API key, which is why the rules have 159 tests
rather than a handful of smoke tests against a live model.

---

## 9. Scope: TTB labelling is much larger than it looks

The regulations cover prohibited practices, health claims, appellations of
origin, formula approval, varietal labelling, vintage dating, and dozens of
class-and-type rules specific to individual products. A prototype that gestures
at all of it does none of it properly.

Settled on the mandatory core the brief names — brand name, class/type, alcohol
content, net contents, bottler, country of origin, health warning — implemented
thoroughly, with everything omitted listed explicitly in the README's
limitations table rather than left for a reviewer to discover.

Related judgment call: a real COLA carries front, back and neck labels, and
mandatory information may be split across them. This handles one image. Stated,
not hidden.

---

## 10. Friction that simply cost time

Recorded because it was a real part of the effort, not because it is
interesting.

- A killed scaffolder held Windows file handles open, wedging `npm install` with
  `ENOTEMPTY` until the process was found and stopped; `node_modules` had to be
  wiped and rebuilt. Transient `git` object-write permission errors on the same
  volume.
- In the sample generator, bare `serif` / `sans-serif` resolved to a *monospace*
  face under the available fontconfig, so the first batch of labels looked like
  wireframes rather than bottles.
- Simulated glare via a `screen` blend was invisible against cream label stock —
  the first attempt produced a "degraded" sample that tested nothing. An `over`
  blend with semi-opaque white destroys local contrast the way a real reflection
  does.
- The browser pane available during development could not composite frames, so
  UI verification went through the accessibility tree, page text and direct
  `curl` against the API rather than screenshots.

---

## What I would do next, in order

1. **Test against real artwork.** Pull label images from the public COLA
   registry with their filed applications and measure extraction accuracy
   against known-good data. Everything currently rests on generated samples.
2. **Measure, don't assume, the reader comparison.** Run both providers over the
   same corpus and publish per-field accuracy and latency. The seam exists; the
   evidence for choosing between them does not yet.
3. **Move the batch queue server-side.** Client-side is right for a prototype and
   wrong for 300 labels that must survive a closed tab.
4. **Replace the in-memory rate limiter** with something shared across
   instances. It is a speed bump, and the README says so.
5. **Multi-image applications**, so mandatory information split across front,
   back and neck labels is handled the way real filings work.
