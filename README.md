# TTB Label Check

Verifies alcohol beverage label artwork against a COLA application, and against
the federal labelling requirements that apply regardless of what was filed.

Built as a take-home prototype for the Alcohol and Tobacco Tax and Trade Bureau.

---

## The one decision everything else follows from

**The AI reads. Deterministic code decides.**

```
  label image
      │
      ▼
┌──────────────────────┐   Transcribes verbatim. Reports casing, boldness,
│  Vision model        │   legibility, and "I could not read this".
│  (swappable)         │   Never asked whether anything complies.
└──────────┬───────────┘
           │  LabelExtraction
           ▼
┌──────────────────────┐   Pure TypeScript. No network, no model, no I/O.
│  Rules engine        │   110 unit tests. Same input → same report, always.
│  src/lib/ttb/        │
└──────────┬───────────┘
           │  VerificationReport
           ▼
   per-field verdict + the rule that fired + the CFR citation
```

A label decision has to survive an applicant's appeal, and *"the model said so"*
does not. Every verdict this system produces carries the identifier of the rule
that produced it (`abv-outside-tolerance`, `normalised-match:case`,
`warning-header-not-caps`) and the regulation behind it. An agent can always
answer **"why did it say that?"**

It also means the entire decision layer is testable with no API key, no network
and no spend — which is why the test suite covers every rule rather than a
sample of them.

---

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. It runs without an API key in a clearly-labelled
demo mode; to read real images, add one of the keys below.

### Configuration

Create `.env.local`:

```
# Either one enables real label reading. Gemini has a free tier.
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=...

# Optional
LABEL_READER=gemini          # pin a specific reader
GEMINI_MODEL=gemini-2.5-flash
ANTHROPIC_MODEL=claude-opus-5
```

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm test` | Run the test suite (110 tests) |
| `npm run typecheck` | TypeScript, no emit |
| `npm run samples` | Regenerate the sample label images |

---

## Two kinds of check, deliberately separated

The report is split in two because these are genuinely different questions, and
conflating them is how tools like this go wrong.

**Compared with the application** — brand name, class/type, alcohol content, net
contents, bottler, country of origin. Needs both halves.

**Required by regulation** — the government health warning, its capitalisation
and prominence, standards of fill, proof consistency, and whether mandatory
fields are present at all. Needs only the label. *The applicant has no say in
these.* The warning appears nowhere on the application, so there is nothing to
match it against; it is compared word-for-word against 27 CFR 16.21. An 800 mL
spirits bottle is unlawful even though the application also says 800 mL.

---

## How judgement is encoded

> "I had one last week where the brand name was 'STONE'S THROW' on the label but
> 'Stone's Throw' in the application. Technically a mismatch? Sure. But it's
> obviously the same thing. You need judgment." — Dave Morrison, 28 years

Rather than leave that to a model's discretion, comparison walks a **ladder of
increasingly permissive normalisations** and reports the first rung at which two
strings agree:

| Rung | Tolerates |
|---|---|
| `exact` | nothing |
| `whitespace` | spacing and line breaks |
| `typography` | curly quotes, em dashes |
| `case` | capitalisation |
| `accents` | diacritics |
| `punctuation` | commas, full stops |
| `synonyms` | `Inc.`/`Incorporated`, `whisky`/`whiskey` |

So the report never just says "match". It says *matched apart from
capitalisation*. And this is not mere leniency — TTB Form 5100.31's own
allowable-revision list permits changing letters between upper and lower case
without refiling, for all three beverage types.

Anything that fails the whole ladder but is still ≥82% similar is marked **Check
by eye**, never failed. Sending an agent to look costs seconds; wrongly
rejecting a valid application costs a letter, an appeal and a resubmission. The
asymmetry always favours review.

---

## Meeting the 5-second bar

> "If we can't get results back in about 5 seconds, nobody's going to use it. We
> learned that the hard way." — Sarah Chen

| Lever | Effect |
|---|---|
| Browser-side downscale to 1568px before upload | Cuts upload time, model tiling and token cost. Biggest single lever. |
| One structured call, low reasoning effort | Transcription is perception, not reasoning. |
| Rules run locally | ~1 ms, measured. |

**Every report displays its own timing**, split between reading and rules. That
is a standing claim that the number is real, and an immediate signal if it ever
stops being true.

---

## The vendor-independence seam

> "Our network blocks outbound traffic to a lot of domains... half their features
> didn't work because our firewall blocked connections to their ML endpoints."
> — Marcus Williams

The right answer to that was never "pick a better vendor". It was to make the
vendor a detail:

```typescript
interface LabelReader {
  readonly id: string;
  readonly isOffline: boolean;
  isAvailable(): boolean;
  read(request: ReadRequest): Promise<ReadResult>;
}
```

Three implementations ship: `GeminiReader`, `AnthropicReader`, and `MockReader`
(used by the tests). Whichever key is configured is the one that runs. Nothing
above this interface — not the rules engine, not the API route, not the UI —
imports a vendor SDK.

**An interface with one implementation is just indirection.** Two working
providers is what makes this real: an on-premises deployment behind a
restricted network replaces one file and changes zero compliance rules.

---

## Batch review

> "During peak season, we get these big importers who dump 200, 300 label
> applications on us at once."

Load a manifest CSV (one row per application, keyed by filename) plus the
artwork. The queue runs **in the browser** at a concurrency of 4, calling the
same `/api/verify` endpoint the single-label screen uses — one code path, live
per-item progress, and one bad image cannot take down the run. Filter to items
needing attention, expand any row for the full report, export the lot as CSV.

An example manifest is at `/samples/batch-manifest.csv`.

---

## Designed for the actual users

> "We need something my mother could figure out — she's 73... Half our team is
> over 50. Clean, obvious, no hunting for buttons."

- 17px base type; nothing meaningful below 15px
- Every verdict carries a **colour, a shape and a word** — roughly one man in
  twelve cannot rely on red versus green
- 44px minimum touch targets, visible focus rings, skip link, `role="alert"` on
  errors, focus moved to results when they arrive
- One screen, top to bottom. No wizard, no tabs, no disclosure triangles
- Print stylesheet, because a report goes in a case file
- Errors say what to do — "add credit to the account", "try again in a moment",
  "ask the applicant for a clearer image" — not "an error occurred"

---

## Sample labels

11 generated labels in `public/samples/`, loadable from the UI in one click, so
the deployed app can be evaluated without sourcing bottle photographs.
Deterministic SVG artwork rather than AI-generated images, because we control
exactly which defects are present and every expected outcome is known in
advance.

Includes deliberate defects: a case-and-apostrophe variant that **must pass**, an
ABV mismatch, a title-case warning header, reworded warning text, missing net
contents — plus rotated, glared and blurred variants of the compliant bourbon
label to exercise image robustness. See `docs/SAMPLE-LABELS.md`.

---

## Two bugs worth reporting

Both were caught by the process rather than by luck, and both are now regression
tests.

**Standards of fill were out of date.** The first implementation was seeded from
a pre-2025 list. T.D. TTB-200 (10 January 2025) added ten container sizes to
27 CFR 5.203 — including 710 mL — so the app rejected ten lawful sizes as
unlawful. A false rejection that arrives with a citation attached is far more
dangerous than an obvious crash. Fixed; `tests/netContents.test.ts` pins all ten.

**ABV and net contents are not on the modern COLA form.** They were Items 13 and
12 until the ~2015 revision and were removed. Verified against the public
registry: a 2016 filing renders both, a 2025 filing renders neither. So the
application usually has nothing to compare against — those checks now report
`not_applicable` for matching while the label's own obligations (presence,
standards of fill, proof consistency) still run.

---

## Trade-offs and limitations

Stated plainly, because a prototype that oversells itself is worse than one that
says where it stops.

| Limitation | Why, and what production would need |
|---|---|
| **Rate limiting is in-memory** | A `Map` in the serverless instance. Resets on recycle, not shared across instances. A speed bump against casual abuse, not a security control. Production: Redis or edge middleware. |
| **Batch runs client-side** | No job store, no workers, no resume. Closing the tab loses the run. Correct for a prototype; a real deployment needs a queue and persistence. |
| **Boldness and type size are judged visually** | 27 CFR 16.22 specifies millimetres and characters per inch. No photograph can establish those. Treated as a prompt to look, not a measurement. |
| **Field coverage is the mandatory core** | No prohibited practices, health claims, appellations of origin, formula approval, or product-specific class/type rules. |
| **No persistence** | Images live in memory for one request. Nothing is stored — deliberate, given PII and retention considerations. |
| **Single label image per application** | Real COLAs carry front, back and neck labels. Mandatory information may be split across them. |
| **Vendor choice is pragmatic, not technical** | Any frontier vision model would read these labels competently. Gemini leads the resolution order because its free tier makes an unfunded pilot deployable. The seam is what matters, not the vendor. |
| **Not connected to COLA** | Explicitly out of scope per the brief. Standalone throughout. |

---

## Project layout

```
src/lib/ttb/          The rules engine. Pure, no I/O.
  types.ts            Domain contract
  normalize.ts        The normalisation ladder
  similarity.ts       Levenshtein + token-set scoring
  abv.ts              Alcohol parsing, tolerances, proof
  netContents.ts      Volume parsing, standards of fill
  warning.ts          27 CFR 16.21 text + word-level diff
  rules.ts            Every verdict in the system

src/lib/reader/       The vendor seam
  types.ts            LabelReader interface
  schema.ts           Shared extraction schema + prompt
  anthropic.ts        Claude vision
  gemini.ts           Gemini vision (REST)
  mock.ts             Deterministic, used by tests

src/app/api/verify/   Thin route: validate → read → verify
src/components/       UI
tests/                110 tests
docs/                 Regulatory research, with citations
```

`docs/REGULATORY-NOTES.md` and `docs/COLA-FORM-NOTES.md` record the research the
constants came from, with a CFR citation for every claim and an explicit list of
gaps and uncertainties.

---

## Tools used

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Vitest · `sharp` (sample
generation only) · Anthropic and Google vision APIs behind the reader interface.

## Assumptions

- One label image per application; the front label carries the mandatory copy.
- The application's typed fields are the source of truth for matching. The tool
  never judges whether the *application* is correct.
- Metric net contents for spirits and wine; malt beverages are US customary
  (27 CFR 7.70), so their standards-of-fill check is skipped — part 7 prescribes
  none.
- Every output is advisory. An agent decides.
