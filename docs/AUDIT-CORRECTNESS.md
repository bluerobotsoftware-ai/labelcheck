# Correctness and Regulatory Audit

Adversarial audit of the rules engine, parsers and warning diff. Everything below was run
against the tree as committed on 2026-08-27. The existing suite is green (120 tests) both
before and after; no source file under `src/` or `tests/` was modified.

**How to read this.** Every finding is tagged **REPRODUCED** (I ran it and pasted the real
output) or **INFERRED** (I read the code and reasoned, but did not demonstrate it end to
end). Regulatory claims were re-verified independently against the eCFR versioner API
(`https://www.ecfr.gov/api/versioner/v1/full/2026-08-25/title-27.xml?part=…`), raw XML, not
the HTML front end.

**Reproduction harness.** Every snippet below is a standalone TypeScript file. Put it in
`scratch/` at the repo root and run `npx tsx scratch/<file>.ts`. Every snippet in this
document was extracted back out of this file verbatim and re-run, and the pasted output is
what it printed.

*Housekeeping note:* at the start of this audit `scratch/` was **not** ignored
(`git check-ignore scratch/` exited 1). It is ignored in the working tree now, but that
`.gitignore` change is uncommitted and was not made by this audit — confirm it before
relying on it.

Every repro uses this preamble, referred to below as `«preamble»`:

```typescript
import { verify } from "../src/lib/ttb/rules";
import { COMPLIANT_SPIRITS } from "../src/lib/reader/mock";
import type { Application, LabelExtraction } from "../src/lib/ttb/types";

const META = { extractionMs: 0, reader: "audit" };
const label = (o: Partial<LabelExtraction> = {}): LabelExtraction => ({
  ...structuredClone(COMPLIANT_SPIRITS), ...o,
});
const APP: Application = {
  beverageType: "distilled_spirits",
  brandName: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholContent: "45% Alc./Vol. (90 Proof)",
  netContents: "750 mL",
  bottlerName: "Old Tom Distillery",
  isImport: false,
};
```

---

## Summary

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **CRITICAL** | The low-confidence gate is skipped for alcohol content, net contents and the government warning — a reading the model admits it could not see becomes `approve` | REPRODUCED |
| 2 | **HIGH** | `subsetIsAcceptable` on class/type passes a label declaring a *different* class of product | REPRODUCED |
| 3 | **HIGH** | An empty application field cancels the label's own mandatory-presence obligation | REPRODUCED |
| 4 | **HIGH** | The warning header check uses raw `String.includes` — a line break inside "GOVERNMENT WARNING:" rejects a compliant label, and contradicts its own sibling check | REPRODUCED |
| 5 | **HIGH** | A US-customary net contents statement, expressly permitted by 27 CFR 5.70(a), fails the standard-of-fill check | REPRODUCED |
| 6 | **HIGH** | The `&` → `and` synonym is dead code; a lawful allowable revision is hard-failed as `mismatch` | REPRODUCED |
| 7 | MEDIUM | Proof-substring removal exposes a `100%` grain statement, which is then read as 100% ABV | REPRODUCED |
| 8 | MEDIUM | `12½%` parses as 2% | REPRODUCED |
| 9 | MEDIUM | `checkCountryOfOrigin` hard-fails on 27 CFR 5.69, which is a non-operative cross-reference, and cites it for all three beverage types | eCFR-VERIFIED |
| 10 | MEDIUM | An unparseable label volume silently deletes the standard-of-fill check with no trace in the report | REPRODUCED |
| 11 | MEDIUM | `ladderMatch` returns "matched" whenever both sides normalise to the empty string | REPRODUCED |
| 12 | MEDIUM | Warning prominence hard-fails on a vision model's guess at font weight, against the project's own documented policy | REPRODUCED |
| 13 | MEDIUM | Application fields have no length limit; `levenshtein` is O(n·m) | REPRODUCED (cost) / INFERRED (route reachability) |
| 14 | LOW | Sake is not exempted from the standards of fill (27 CFR 4.70(b)(1)) | REPRODUCED |
| 15 | LOW | Malt beverages below 0.5% ABV are given a tolerance 27 CFR 7.65(b)(2) denies them | REPRODUCED + eCFR-VERIFIED |
| 16 | LOW | Wine near the 14% boundary auto-fails, against the project's own gap #3 | REPRODUCED |
| 17 | LOW | `nearest` omits the 4 L even-litre option for wine between 3 L and 4 L | REPRODUCED |
| 18 | LOW | Code comment cites 27 CFR 5.65(a) for the spirits tolerance; it is 5.65(c) | eCFR-VERIFIED |
| 19 | LOW | `parseVolume` treats weight ounces as fluid ounces, drops minus signs, and reads `1e3 L` as 3 L | REPRODUCED |
| 20 | LOW | `tooPoorToReview` downgrades a genuine `reject` to `needs_review` | REPRODUCED |

---

## 1. CRITICAL — `MIN_USABLE_CONFIDENCE` is applied to four fields and skipped for three

**REPRODUCED.**
`src/lib/ttb/rules.ts:48` (the constant), `rules.ts:92-104` (the only place it is enforced),
`rules.ts:214-349` (`checkAlcoholContent`), `rules.ts:414-534` (`checkNetContents`),
`rules.ts:537-610` (`checkGovernmentWarning`).

The gate lives inside `preflight()`. Only `compareTextField()` calls `preflight()`.
`checkAlcoholContent`, `checkNetContents` and `checkGovernmentWarning` each implement their
own control flow and never read `reading.confidence` at all — they only *copy it into the
result object* for display. So the three fields that carry the system's most absolute
regulatory obligations — the mandatory ABV statement, the standards of fill, and the
27 CFR 16.21 health warning — are the three that will assert a `pass` on text the reader has
explicitly flagged as a guess.

```typescript
// scratch/gate.ts   «preamble» not used; this is self-contained
import { verify } from "../src/lib/ttb/rules";
import { COMPLIANT_SPIRITS } from "../src/lib/reader/mock";
import type { Application, LabelExtraction } from "../src/lib/ttb/types";

const META = { extractionMs: 0, reader: "audit" };
const BASE: LabelExtraction = {
  ...structuredClone(COMPLIANT_SPIRITS),
  countryOfOrigin: { text: "PRODUCT OF SCOTLAND", confidence: 0.95 },
};
const APP: Application = {
  beverageType: "distilled_spirits",
  brandName: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholContent: "45% Alc./Vol. (90 Proof)",
  netContents: "750 mL",
  bottlerName: "Old Tom Distillery",
  countryOfOrigin: "Scotland",
  isImport: true,
};
console.log("control (everything at full confidence):", verify(APP, BASE, META).recommendation);

const CONF = 0.2; // MIN_USABLE_CONFIDENCE is 0.4
function only(field: keyof LabelExtraction): LabelExtraction {
  const ext = structuredClone(BASE);
  (ext[field] as { confidence: number }).confidence = CONF;
  return ext;
}
const cases: Array<[keyof LabelExtraction, string]> = [
  ["brandName", "brand_name"], ["classType", "class_type"], ["bottlerName", "bottler"],
  ["countryOfOrigin", "country_of_origin"], ["alcoholContent", "alcohol_content"],
  ["netContents", "net_contents"], ["governmentWarning", "government_warning"],
];
console.log("\n  field                verdict          rule                              overall");
console.log("  " + "-".repeat(82));
for (const [field, id] of cases) {
  const r = verify(APP, only(field), META);
  const c = r.checks.find((x) => x.id === id)!;
  console.log(`  ${String(field).padEnd(20)} ${c.verdict.padEnd(16)} ${c.rule.padEnd(33)} ${r.recommendation}`);
}
```

Actual output. Each row drops exactly one field to confidence 0.2; the transcribed text is
still correct in every row, so the *only* difference between the rows is which field the
reader admitted it was guessing at:

```
control (everything at full confidence): approve

  field                verdict          rule                              overall
  ----------------------------------------------------------------------------------
  brandName            unreadable       low-transcription-confidence      needs_review
  classType            unreadable       low-transcription-confidence      needs_review
  bottlerName          unreadable       low-transcription-confidence      needs_review
  countryOfOrigin      unreadable       low-transcription-confidence      needs_review
  alcoholContent       pass             abv-exact                         approve
  netContents          pass             volume-equal                      approve
  governmentWarning    pass             warning-verbatim                  approve
```

And all three at once, at confidence 0.01:

```
=== A4 ABV + net contents + warning all near-zero confidence
  recommendation: approve
    pass            alcohol_content        abv-exact  (conf 0.01)
    pass            net_contents           volume-equal  (conf 0.01)
    pass            standard_of_fill       authorised-container-size
    pass            government_warning     warning-verbatim  (conf 0.01)
    pass            warning_capitalisation warning-header-caps
    pass            warning_prominence     warning-prominent
```

**Why it matters.** The extraction prompt (`src/lib/reader/schema.ts`, rule 2) instructs the
model that when text is present but illegible it must "return your best reading with a LOW
confidence value instead of null". This is the *designed* signal for "I am guessing" — and
for these three fields the engine consumes it and throws it away. A glared, curved or
angled bottle where the reader guesses "750 mL" at 0.05 confidence produces
`standard_of_fill: pass — 750 mL is an authorised container size`, a positive assertion
about federal law derived from characters nobody read. `imageQuality.tooPoorToReview` does
not save you: that flag is about the image as a whole, and a single unreadable region on an
otherwise clean photograph will not set it.

This is the exact failure mode `rules.ts:43-48` and `rules.ts:783-785` both name as the
worst thing the system could do. The comment is right; the code implements it for four of
seven fields.

**Fix.** Hoist the gate out of `preflight()` into a small helper and call it first in all
three functions, e.g.

```typescript
function tooUncertain(reading: FieldReading | null): boolean {
  return reading !== null && reading.confidence < MIN_USABLE_CONFIDENCE;
}
```

then emit an `unreadable` verdict before any comparison. For the warning it needs to
suppress all three sub-checks, not just wording. A regression test per field — the same
table as the repro above — would have caught this; `tests/rules.test.ts:98-108` writes it
for `brandName` only.

---

## 2. HIGH — class/type containment passes a genuinely different class of product

**REPRODUCED.** `src/lib/ttb/rules.ts:161-174` and `rules.ts:767-773`;
`src/lib/ttb/similarity.ts:81-85`.

`class_type` is compared with `subsetIsAcceptable: true`, so a label passes if its tokens
contain all of the application's tokens. That is the right rule for `bottler` (the label
adds a city and state) and for `country_of_origin` ("PRODUCT OF SCOTLAND" ⊇ "Scotland").
It is the wrong rule for class/type, because class/type designations are a controlled
vocabulary in which one designation is routinely a superset of another's words while naming
a completely different commodity.

```typescript
// scratch/classtype.ts   with «preamble»
for (const [app, lab] of [["GIN", "SLOE GIN"], ["BRANDY", "FLAVORED BRANDY"], ["VODKA", "VODKA LIQUEUR"]]) {
  const r = verify({ ...APP, classType: app }, label({ classType: { text: lab, confidence: 0.98 } }), META);
  const c = r.checks.find((x) => x.id === "class_type")!;
  console.log(`  application ${app.padEnd(8)} label ${lab.padEnd(16)} -> ${c.verdict}/${c.rule}  overall=${r.recommendation}`);
}
```

Actual output:

```
  application GIN      label SLOE GIN         -> pass/label-contains-application-value  overall=approve
  application BRANDY   label FLAVORED BRANDY  -> pass/label-contains-application-value  overall=approve
  application VODKA    label VODKA LIQUEUR    -> pass/label-contains-application-value  overall=approve
```

**Why it matters.** `docs/REGULATORY-NOTES.md` §5.4 states the boundary the tool is supposed
to implement: *"a change to the class/type statement always requires a new COLA."* Gin and
sloe gin are separate classes under the standards of identity (27 CFR subpart I); brandy and
flavored brandy likewise. The application authorises gin; the label says the bottle contains
sloe gin; the tool says approve. §5.6 of the same document explicitly notes class/type is
"materially stricter than brand name" — the code applies the *most* permissive matching in
the system to it.

**Fix.** Drop `subsetIsAcceptable` for `class_type`. Extra tokens on a class/type
designation are exactly the thing that needs an agent's eyes, so route them to `review`
(they will land there via the similarity tier) rather than `pass`. If containment must be
kept for cases like "STRAIGHT BOURBON WHISKY" vs "KENTUCKY STRAIGHT BOURBON WHISKEY", make
it directional and allow only tokens from a whitelist of qualifiers that do not change the
class (state names, "straight", age statements) — a much narrower rule than "any extra
words are fine".

---

## 3. HIGH — an empty application field cancels the label's own mandatory-presence check

**REPRODUCED.** `src/lib/ttb/rules.ts:65-90` (`preflight` ordering), `rules.ts:625-662`
(`checkBottler`), `src/app/api/verify/route.ts:167-177` (`bottlerName` is optional).

`preflight()` tests "the application field is empty" *before* it tests "the label field is
absent". So whenever the application half is blank, the check short-circuits to
`not_applicable` without ever looking at the label — and `not_applicable` contributes
nothing to `summarise()`, which means it contributes to `approve`.

For `brandName` and `classType` the API route rejects a blank value, so this is not
reachable over HTTP. For **`bottlerName` it is**: `parseApplication` maps a missing or blank
bottler to `undefined` and returns happily.

```typescript
// scratch/bottler.ts   with «preamble»
const r = verify(
  { beverageType: "distilled_spirits", brandName: "OLD TOM DISTILLERY",
    classType: "Kentucky Straight Bourbon Whiskey", isImport: false },   // no bottlerName
  label({ bottlerName: null }),                                          // and none on the label
  META,
);
console.log("recommendation:", r.recommendation);
for (const c of r.checks) console.log(`  ${c.verdict.padEnd(15)} ${c.id.padEnd(22)} ${c.rule}`);
```

Actual output:

```
recommendation: approve
  pass            brand_name             normalised-match:exact
  pass            class_type             normalised-match:exact
  not_applicable  alcohol_content        application-field-empty
  not_applicable  net_contents           application-field-empty
  pass            standard_of_fill       authorised-container-size
  not_applicable  bottler                application-field-empty
  not_applicable  country_of_origin      not-an-import
  pass            government_warning     warning-verbatim
  pass            warning_capitalisation warning-header-caps
  pass            warning_prominence     warning-prominent
```

Calling `verify()` directly (the exported contract of the rules engine, which the README
presents as the auditable decision layer) the degenerate case is total — blank the
application's brand, class and bottler and the engine approves a label carrying none of the
three:

```
recommendation: approve
  not_applicable  brand_name             application-field-empty
  not_applicable  class_type             application-field-empty
  not_applicable  bottler                application-field-empty
```

**Why it matters.** The name-and-address statement is mandatory on every container —
27 CFR 5.63(b)(1), 4.32(b)(1), 7.63(a)(4). The README's own framing is that the
"Required by regulation" half of the report "needs only the label" and that *"the applicant
has no say in these"*. Here the applicant does have a say: leaving a form field blank
deletes the check. The whole point of separating compliance checks from match checks is
defeated for this field, because bottler presence is only ever tested inside the match path.

**Fix.** Two parts. (a) In `preflight()`, test `!reading` before `!expected` — an absent
mandatory field on the label is a `fail` regardless of what the application says. (b) Better,
add a standalone `compliance`-category presence check for the mandatory fields
(brand name, class/type, name and address, net contents) that runs off the extraction alone,
mirroring how `checkGovernmentWarning` already works. That is the structure the README
describes; the code currently only implements it for the warning.

---

## 4. HIGH — the warning header check reads raw text, so a line break rejects a compliant label

**REPRODUCED.** `src/lib/ttb/warning.ts:166-167`:

```typescript
const headerAllCaps =
  reading.headerIsAllCaps && reading.text.includes(WARNING_HEADER);
```

`WARNING_HEADER` is the literal `"GOVERNMENT WARNING:"` with one ASCII space.
`reading.text` is, by design, the verbatim transcription including line breaks. The wording
diff in the same function normalises whitespace (`words()`, `warning.ts:54-64`); this line
does not.

```typescript
// scratch/hdr.ts
import { assessWarning, STATUTORY_WARNING } from "../src/lib/ttb/warning";
const base = (text: string) => ({ text, confidence: 0.95, headerIsAllCaps: true, headerIsBold: true, legibleSize: true });
for (const [t, text] of [
  ["one line", STATUTORY_WARNING],
  ["header wrapped to a second line", STATUTORY_WARNING.replace("GOVERNMENT WARNING:", "GOVERNMENT\nWARNING:")],
  ["two spaces inside the header", STATUTORY_WARNING.replace("GOVERNMENT WARNING:", "GOVERNMENT  WARNING:")],
  ["non-breaking spaces throughout", STATUTORY_WARNING.replace(/ /g, " ")],
] as const) {
  const a = assessWarning(base(text));
  console.log(`  ${t.padEnd(34)} wordingExact=${String(a.wordingExact).padEnd(5)} headerAllCaps=${a.headerAllCaps}`);
}
```

Actual output:

```
  one line                           wordingExact=true  headerAllCaps=true
  header wrapped to a second line    wordingExact=true  headerAllCaps=false
  two spaces inside the header       wordingExact=true  headerAllCaps=false
  non-breaking spaces throughout     wordingExact=true  headerAllCaps=false
```

Through the full engine (`scratch/engine2.ts`):

```
  header on one line                     approve   government_warning=pass/warning-verbatim  warning_capitalisation=pass/warning-header-caps
  'GOVERNMENT\nWARNING:'                 reject    government_warning=pass/warning-verbatim  warning_capitalisation=fail/warning-header-not-caps
  'GOVERNMENT  WARNING:' (two spaces)    reject    government_warning=pass/warning-verbatim  warning_capitalisation=fail/warning-header-not-caps
```

**Why it matters.** The report is internally contradictory: `government_warning` says the
text reproduces the statute *word for word*, and the sibling check on the same string says
the heading is not in capitals. The letters are unambiguously capitals — the model even
reported `headerIsAllCaps: true`. The only difference is a line break, and warnings on real
bottles wrap constantly; on a narrow back label "GOVERNMENT" and "WARNING:" landing on
separate lines is the common case, not the exotic one.

`docs/REGULATORY-NOTES.md` gap #7 is explicit: *"No regulation prescribes where line breaks
fall on a physical label. Normalise whitespace before diffing."* The wording check obeys
that; the capitalisation check does not. The result is a false rejection carrying a
27 CFR 16.21 citation — the failure class the README singles out as "far more dangerous than
an obvious crash".

**Fix.** Normalise before testing. Reuse the same folding the wording diff uses:

```typescript
const flat = reading.text.normalize("NFKC").replace(/\s+/g, " ");
const headerAllCaps = reading.headerIsAllCaps && flat.includes(WARNING_HEADER);
```

That also fixes the non-breaking-space and full-width variants, both of which currently
false-fail.

---

## 5. HIGH — a lawful US-customary net contents statement fails the standard-of-fill check

**REPRODUCED.** `src/lib/ttb/netContents.ts:49-59` (fl oz factor), `netContents.ts:62-63`
(`VOLUME_PATTERN` takes the leftmost match), `netContents.ts:146`
(`FILL_MATCH_TOLERANCE_ML = 1`), `rules.ts:505-531`.

27 CFR 5.70(a) permits US customary equivalents on a spirits label, and 27 CFR 4.37(b)(1)
publishes the conversion table TTB itself uses: **750 mL = 25.4 fl. oz.**, **3 L = 101 fl.
oz.** Converting those printed equivalents back through 29.5735 mL/fl oz does not land
within 1 mL of the authorised size.

```typescript
// scratch/floz.ts   with «preamble»
for (const [t, app, lab] of [
  ["spirits, label reads 750 mL", APP, "750 mL"],
  ["spirits, label reads 25.4 FL OZ", APP, "25.4 FL OZ"],
  ["spirits, label reads 25.4 FL OZ (750 mL)", APP, "25.4 FL OZ (750 mL)"],
] as const) {
  const r = verify(app, label({ netContents: { text: lab, confidence: 0.96 } }), META);
  const n = r.checks.find((x) => x.id === "net_contents")!;
  const f = r.checks.find((x) => x.id === "standard_of_fill");
  console.log(`  ${t.padEnd(42)} ${r.recommendation.padEnd(8)} net=${n.verdict}/${n.rule}  fill=${f ? f.verdict + "/" + f.rule : "ABSENT"}`);
}
```

Actual output (including a 3 L wine case from `scratch/engine2.ts`):

```
  spirits, label reads 750 mL                approve  net=pass/volume-equal  fill=pass/authorised-container-size
  spirits, label reads 25.4 FL OZ            reject   net=fail/volume-mismatch  fill=fail/unauthorised-container-size
  spirits, label reads 25.4 FL OZ (750 mL)   reject   net=fail/volume-mismatch  fill=fail/unauthorised-container-size
  3 L wine as '101 FL OZ' (= 3 L per 4.37(b)(1))  reject  net=fail/volume-mismatch  fill=fail/unauthorised-container-size
```

The arithmetic, from `scratch/parsers.ts`:

```
  25.4 FL OZ   -> 751.1668999999999    authorised=false  nearest 750 mL or 900 mL
  101 FL OZ    -> 2986.9235            authorised=false  nearest 2 L or 3 L
  33.8 FL OZ   -> 999.5842999999999    authorised=true
  16.9 FL OZ   -> 499.79214999999994   authorised=true
  12 FL OZ     -> 354.882              authorised=true
```

Note how arbitrary the outcome is: 33.8 fl oz and 16.9 fl oz happen to land inside the 1 mL
window and pass; 25.4 and 101 miss it and are declared unlawful containers.

**Why it matters.** The failing bottle is a perfectly ordinary, lawful 750 mL spirits bottle
whose label also prints the equivalent the CFR tells it to print. The report tells the agent
"751.2 mL is not an authorised container size for this class of product", cites
27 CFR 5.203, and recommends reject. It also fails the *match* check, telling the agent the
label and application disagree when they do not. This is precisely the "false rejection that
arrives with a citation attached" the README describes as the danger it already fixed once
for the standards-of-fill list.

**Fix.** Three things, in order of importance.
1. Prefer the metric quantity when a statement contains more than one. Metric is the
   governing statement for spirits and wine (27 CFR 5.70(a), 4.37(a)); the customary figure
   is an equivalent. `VOLUME_PATTERN` should collect all matches and choose the metric one,
   not take the leftmost.
2. When only a customary quantity is available, match it against the standards of fill via
   the CFR's own conversion table (27 CFR 4.37(b)(1)), not via a float conversion.
3. Widen `FILL_MATCH_TOLERANCE_ML` for customary-derived values — anything derived from a
   figure rounded to the nearest tenth of a fluid ounce carries ±1.5 mL of rounding error at
   750 mL. A conversion-derived near-miss should in any case be `review`, never `fail`.

---

## 6. HIGH — the `&` → `and` synonym can never fire, and the mismatch is a hard fail

**REPRODUCED.** `src/lib/ttb/normalize.ts:90` (the synonym), `normalize.ts:113-118`
(`tokenize`), `normalize.ts:55-57` (`stripPunctuation`).

`canonicalTokens()` calls `tokenize()`, which calls `stripPunctuation()` — which replaces
every non-letter, non-digit character with a space. `&` is destroyed before the synonym map
is ever consulted, so the entry `"&": "and"` is unreachable code.

```typescript
// scratch/amp.ts
import { canonicalTokens, ladderMatch } from "../src/lib/ttb/normalize";
console.log(canonicalTokens("Smith & Sons"));      // the "&" never survives to be mapped
console.log(canonicalTokens("Smith and Sons"));
console.log(ladderMatch("Smith & Sons", "Smith and Sons"));
```

Actual output:

```
[ 'smith', 'sons' ]
[ 'smith', 'and', 'sons' ]
{ matched: false }
```

Through the engine (`scratch/engine2.ts`):

```
  brand 'Smith & Sons' vs label 'SMITH AND SONS'            reject   brand_name=fail/mismatch
  brand 'Smith and Sons' vs label 'SMITH & SONS'            reject   brand_name=fail/mismatch
  brand 'Brown & Sons Co' vs label 'BROWN AND SONS COMPANY' reject   brand_name=fail/mismatch
```

For contrast, the other advertised synonym works:

```
  brand 'Acme Inc.' vs label 'ACME INCORPORATED'            approve  brand_name=pass/normalised-match:synonyms
```

**Why it matters.** Three separate places in the codebase promise this behaviour: the README
ladder table (`synonyms` tolerates "`Inc.`/`Incorporated`, `whisky`/`whiskey`"), the
`compareTextField` doc-comment which names "an ampersand" as the kind of difference that
should reach the review tier (`rules.ts:112-118`), and the synonym map itself. None of them
is true for `&`. Worse, the outcome is not even `review` — the pair scores below 0.82 and
lands on `fail: "These do not correspond."` TTB F 5100.31 item 3.b permits changing
"punctuation marks ... and abbreviations" without a new COLA, so `Smith & Sons` on the label
against `Smith and Sons` in the application is a *lawful* revision being hard-rejected.

**Fix.** Fold `&` to `and` (and `+` to `and`) in `foldTypography()` or in a step before
`stripPunctuation()`, so the token exists by the time `TOKEN_SYNONYMS` runs. A one-line
change:

```typescript
export function tokenize(input: string): string[] {
  return stripPunctuation(foldTypography(input).replace(/&/g, " and "))
    .toLowerCase().split(/\s+/).filter(Boolean);
}
```

Then delete the dead `"&"` map entry. Note the same class of bug is latent for any other
punctuation-bearing synonym anyone adds later; a unit test asserting
`canonicalTokens("A & B")` contains `"and"` would pin it.

---

## 7. MEDIUM — stripping the proof substring exposes a `100%` grain statement as the ABV

**REPRODUCED.** `src/lib/ttb/abv.ts:113-116`:

```typescript
const withoutProof = proofMatch ? text.replace(proofMatch[0], " ") : text;
```

The replacement itself is safe — `String.replace` with a string needle is literal, so no
regex-metacharacter corruption (I checked; see "Things that turned out to be fine"). The
defect is what it *uncovers*: removing "80 PROOF" leaves the rest of the label line
available to the percentage patterns, and label copy very often contains another percentage
that is not the ABV.

```typescript
// scratch/proof.ts
import { parseAlcohol, proofIsConsistent } from "../src/lib/ttb/abv";
for (const s of ["80 PROOF · DISTILLED FROM 100% CORN", "MADE FROM 100% AGAVE  ·  80 PROOF",
                 "100% GRAIN NEUTRAL SPIRITS 40% ALC/VOL", "BOTTLED IN 1990 PROOF 100"]) {
  const r = parseAlcohol(s);
  console.log(`  ${JSON.stringify(s).padEnd(42)} abv=${String(r.abv).padEnd(6)} proof=${String(r.proof).padEnd(6)} consistent=${proofIsConsistent(r)}`);
}
```

Actual output:

```
  "80 PROOF · DISTILLED FROM 100% CORN"      abv=100    proof=80     consistent=false
  "MADE FROM 100% AGAVE  ·  80 PROOF"        abv=100    proof=80     consistent=false
  "100% GRAIN NEUTRAL SPIRITS 40% ALC/VOL"   abv=100    proof=null   consistent=null
  "BOTTLED IN 1990 PROOF 100"                abv=995    proof=1990   consistent=true
```

Through the engine, against an application stating 40%:

```
  '80 PROOF - DISTILLED FROM 100% CORN'   reject   alcohol_content=fail/abv-outside-tolerance  proof_consistency=fail/proof-inconsistent-with-abv
```

**Why it matters.** "DISTILLED FROM 100% CORN", "100% AGAVE", "100% GRAIN NEUTRAL SPIRITS"
and "100% ESTATE GROWN" are ordinary label copy, and 27 CFR 5.63(c)(1) makes the neutral
spirits percentage a *conditionally mandatory* statement — so the interfering text is
sometimes required to be there. A compliant 80-proof bottle draws two simultaneous
failures: an ABV 60 points outside tolerance, and a fabricated "the label contradicts
itself" finding. The 1990/proof case is contrived, but it shows the same shape: nothing
constrains the matched number to be plausible as an ABV.

**Fix.** Two independent guards, both cheap.
1. Require the percentage to be adjacent to alcohol vocabulary. The bare
   `(\d*[.,]?\d+)\s*%` pattern at `abv.ts:74` should require a following
   `alc|alcohol|abv|vol` token, with the current permissive form kept only as a last resort
   for a field that contains nothing else (the third pattern at `abv.ts:78` already handles
   the bare-number application case).
2. Sanity-bound the result. An ABV outside roughly 0–95% is not a beverage; return `null`
   and let the engine report `alcohol-unparseable` → `review`, which is the honest answer.
   Same for a derived proof above ~200.

---

## 8. MEDIUM — `12½%` parses as 2%

**REPRODUCED.** `src/lib/ttb/abv.ts:103` (`normalize("NFKC")`) and `abv.ts:74`.

NFKC decomposes `½` (U+00BD) to `1⁄2` with a U+2044 FRACTION SLASH. `"12½%"` therefore
becomes `"121⁄2%"`, and the leftmost position at which `(\d*[.,]?\d+)\s*%` can match is the
final `2`.

```typescript
// scratch/frac.ts
import { parseAlcohol } from "../src/lib/ttb/abv";
for (const s of ["12½% ALC./VOL.", "ALC. 12½% BY VOL.", "12¼%", "12.5% ALC./VOL."])
  console.log(`  ${JSON.stringify(s).padEnd(22)} -> abv=${parseAlcohol(s).abv}`);
```

Actual output:

```
  "12½% ALC./VOL."       -> abv=2
  "ALC. 12½% BY VOL."    -> abv=2
  "12¼%"                 -> abv=4
  "12.5% ALC./VOL."      -> abv=12.5
```

Through the engine, wine application 12.5% against a label reading `ALC. 12½% BY VOL.`:

```
  wine label 'ALC. 12½% BY VOL.'    reject   alcohol_content=fail/abv-outside-tolerance
```

**Why it matters.** Vulgar fractions appear on wine and older spirits labels. The failure is
silent and confident: 2% is a well-formed number, so nothing reports low confidence or
"could not interpret" — the engine states flatly that the label says 2% when it says 12.5%,
and rejects. Note `¼` yielding 4 shows the general shape: the last digit of the decomposed
fraction wins.

**Fix.** Map the vulgar fractions to decimals before parsing (`½` → `.5`, `¼` → `.25`,
`¾` → `.75`, `⅓`, `⅔`, `⅛` …), or reject any match whose immediately preceding character is
a digit or U+2044. The sanity bound from finding 7 does not help here — 2% is a plausible
number.

---

## 9. MEDIUM — country of origin is failed on a citation that imposes no TTB requirement

**eCFR-VERIFIED**, code read but the regulatory point is the finding.
`src/lib/ttb/rules.ts:671` and `rules.ts:686-698`.

The citation is hard-coded as `"27 CFR 5.69"` for all three beverage types, and
`origin-absent-on-import` is a `fail`. I re-pulled 27 CFR 5.69 from the eCFR versioner API
(`.../full/2026-08-25/title-27.xml?part=5`). The section is one sentence in its entirety:

> § 5.69 Country of origin.
> For U.S. Customs and Border Protection (CBP) rules regarding country of origin marking
> requirements, see the CBP regulations at 19 CFR parts 102 and 134.

Two defects follow.

1. **It is a cross-reference, not a requirement.** It imposes no TTB duty and cannot support
   a failure verdict. The operative obligation is CBP's, at 19 CFR 134.11.
   `docs/REGULATORY-NOTES.md` §4.1 reaches exactly this conclusion and recommends country of
   origin be treated as *"an advisory/informational check for spirits and malt beverages,
   not a TTB pass/fail rule"*. The code hard-fails it.
2. **It is the wrong section for two of three commodities.** The parallel provisions are
   27 CFR 7.69 for malt beverages and 27 CFR 4.35(e) for wine (a paragraph of the
   name-and-address section, not a standalone section). A wine COLA rejected today is
   handed a spirits citation.

**Why it matters.** The README's central promise is that every verdict "carries the
identifier of the rule that produced it and the regulation behind it" so it survives an
applicant's appeal. A verdict of `fail` citing a pure cross-reference in the wrong part is
the one that will not survive.

**Fix.** Downgrade `origin-absent-on-import` to `review` with an explanatory note that the
requirement is CBP's under 19 CFR 134.11, and select the citation by beverage type
(5.69 / 7.69 / 4.35(e)). The same per-type citation selection is already done for ABV
(`rules.ts:221-222`) and net contents (`rules.ts:421-422`), so the pattern exists.

---

## 10. MEDIUM — an unparseable label volume silently deletes the standard-of-fill check

**REPRODUCED.** `src/lib/ttb/rules.ts:505-531`; the guard is
`if (!fill.notApplicable && printed.millilitres !== null)`.

When `parseVolume` cannot interpret the label's net contents, `printed.millilitres` is
`null` and the entire standard-of-fill block is skipped — producing no check at all, not
even a `review`. On a modern COLA (which carries no net contents to compare against), the
one remaining net-contents result is `not_applicable`, so the report contains no evidence
that the container size was never assessed.

```typescript
// scratch/nofill.ts   with «preamble»
const MODERN = { beverageType: "distilled_spirits" as const, brandName: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey", bottlerName: "Old Tom Distillery", isImport: false };
const r = verify(MODERN, label({ netContents: { text: "NET CONTENTS SEE BASE", confidence: 0.95 } }), META);
console.log("recommendation:", r.recommendation);
console.log("has standard_of_fill check:", r.checks.some((c) => c.id === "standard_of_fill"));
```

Actual output:

```
recommendation: approve
has standard_of_fill check: false
```

**Why it matters.** The README leans hard on this check — *"An 800 mL spirits bottle is
unlawful even though the application also says 800 mL"* — and the whole point is that it does
not depend on the application. But it does depend on the parser, and when the parser fails
the check vanishes rather than reporting that it could not run. `types.ts:135-141` even notes
that net contents is frequently *embossed* rather than printed, which is a common route to an
uninterpretable reading.

**Fix.** Emit a `review` result when `printed.millilitres === null` and the fill list applies
to this beverage type: "the container size could not be determined from the label, so it
could not be checked against the authorised standards of fill." An absent check and a check
that could not be performed must not look the same in an audit trail.

---

## 11. MEDIUM — `ladderMatch` matches any two strings that normalise to nothing

**REPRODUCED** (with contrived inputs — see the honesty note below).
`src/lib/ttb/normalize.ts:191-198`, `normalize.ts:164-174`.

The `punctuation` and `synonyms` rungs can both reduce a string to `""`, and the rung test is
plain `===`. Two strings that both reduce to empty therefore "agree".

```typescript
// scratch/empty.ts   with «preamble»
import { ladderMatch } from "../src/lib/ttb/normalize";
for (const [a, b] of [["!!!", "???"], ["🍺", "🥃"], ["***", "###"], ["The", "An"]])
  console.log(`  ${JSON.stringify(a)} vs ${JSON.stringify(b)} -> ${JSON.stringify(ladderMatch(a, b))}`);
const c = verify({ ...APP, brandName: "***" }, label({ brandName: { text: "###", confidence: 0.98 } }), META)
  .checks.find((x) => x.id === "brand_name")!;
console.log(`  engine: ${c.verdict}/${c.rule} — ${c.explanation}`);
```

Actual output:

```
  "!!!" vs "???" -> {"matched":true,"level":"punctuation","description":"matched apart from capitalisation and punctuation"}
  "🍺" vs "🥃" -> {"matched":true,"level":"punctuation","description":"matched apart from capitalisation and punctuation"}
  "***" vs "###" -> {"matched":true,"level":"punctuation","description":"matched apart from capitalisation and punctuation"}
  "The" vs "An" -> {"matched":true,"level":"synonyms","description":"matched after expanding abbreviations (e.g. 'Inc.' and 'Incorporated')"}
  engine: pass/normalised-match:punctuation — The label agrees with the application — matched apart from capitalisation and punctuation.
```

**Honesty note.** I could not construct a *realistic* COLA that hits this. Brand names made
entirely of punctuation, emoji or noise words are not something TTB sees. I am reporting it
because the guard is one line, because `stripPunctuation` deletes anything outside
`\p{L}\p{N}` (all emoji, all symbols, all CJK punctuation), and because a "pass" whose
evidence is two empty strings is the single least defensible verdict this system could
produce if it ever did occur.

**Fix.** In `ladderMatch`, skip any rung whose normalisation produces an empty string on
either side:

```typescript
for (const rung of NORMALISATION_LADDER) {
  const na = rung.apply(a), nb = rung.apply(b);
  if (!na || !nb) continue;
  if (na === nb) return { matched: true, level: rung.id, description: rung.describe() };
}
```

`containsAllTokens` already has the equivalent guard (`similarity.ts:82`), which is what
makes its absence here look like an oversight rather than a decision.

---

## 12. MEDIUM — warning prominence is a hard `fail` on a vision model's guess at font weight

**REPRODUCED.** `src/lib/ttb/rules.ts:586-607`.

`headerIsBold` and `legibleSize` come straight from the model
(`src/lib/reader/schema.ts`, `warningReading`). Either one being false produces
`verdict: "fail"`, which drives the whole report to `reject`.

```typescript
// scratch/prominence.ts   with «preamble»
for (const [bold, legible] of [[true, true], [false, true], [true, false]] as const) {
  const ext = structuredClone(COMPLIANT_SPIRITS);
  ext.governmentWarning!.headerIsBold = bold;
  ext.governmentWarning!.legibleSize = legible;
  const r = verify(APP, ext, META);
  const c = r.checks.find((x) => x.id === "warning_prominence")!;
  console.log(`  headerIsBold=${String(bold).padEnd(5)} legibleSize=${String(legible).padEnd(5)} -> ${c.verdict}/${c.rule}  overall=${r.recommendation}`);
}
```

Actual output:

```
  headerIsBold=true  legibleSize=true  -> pass/warning-prominent  overall=approve
  headerIsBold=false legibleSize=true  -> fail/warning-insufficiently-prominent  overall=reject
  headerIsBold=true  legibleSize=false -> fail/warning-insufficiently-prominent  overall=reject
```

**Why it matters.** This is the one place where a model opinion is promoted directly to a
compliance verdict, which is the exact thing the architecture exists to prevent. And the
project already knows it should not be. `docs/REGULATORY-NOTES.md` gap #5: *"A vision
transcription typically does not carry reliable font-weight information ... Treat all of
16.22 as advisory/manual-review."* The README's own limitations table: *"Treated as a prompt
to look, not a measurement."* The code makes it a reject. Font weight is exactly the
judgement vision models are least reliable at, so this will generate false rejections at some
non-trivial base rate on real photographs of compliant bottles.

**Fix.** Change the verdict to `review` and reword the explanation as a prompt
("the heading does not appear bold — confirm against 27 CFR 16.22(a)(2)"). That preserves
the signal, drives `needs_review` rather than `reject`, and brings the code in line with what
both documents say it does.

*Related, informational:* 27 CFR 16.22(a)(2) has a second sentence — *"The remainder of the
warning statement may not appear in bold type"* — which nothing in the schema or the engine
checks. Given gap #5 that is a defensible omission, but the check is currently described in
`warning.ts:20` as covering prominence, which overstates it.

---

## 13. MEDIUM — application fields have no length limit and `levenshtein` is quadratic

**REPRODUCED** for the cost; **INFERRED** for reachability through the HTTP route.
`src/app/api/verify/route.ts:150-185` (`parseApplication` validates type and emptiness, never
length), `src/lib/ttb/similarity.ts:18-43`, `rules.ts:177-182`.

`text()` trims and returns any string of any length. `combinedSimilarity` then runs
`levenshtein` over `expectedValue.toLowerCase()` and `found.text.toLowerCase()` at
O(n·m) time, synchronously, on the Node event loop.

```typescript
// scratch/dos.ts   with «preamble»
for (const [appLen, labLen] of [[5_000_000, 18], [1_000_000, 200], [200_000, 2_000], [120_000, 20_000], [50_000, 50_000]]) {
  const ext = { ...structuredClone(COMPLIANT_SPIRITS), brandName: { text: "B".repeat(labLen), confidence: 0.98 } };
  const t = Date.now();
  verify({ ...APP, brandName: "A".repeat(appLen) }, ext, META);
  console.log(`  application brandName ${String(appLen).padStart(9)} chars vs label reading ${String(labLen).padStart(6)} chars -> ${Date.now() - t} ms`);
}
```

Actual output:

```
  application brandName   5000000 chars vs label reading     18 chars -> 515 ms
  application brandName   1000000 chars vs label reading    200 chars -> 828 ms
  application brandName    200000 chars vs label reading   2000 chars -> 1643 ms
  application brandName    120000 chars vs label reading  20000 chars -> 9992 ms
  application brandName     50000 chars vs label reading  50000 chars -> 37868 ms
```

**What I demonstrated and what I did not.** The cost is real and measured. Reaching the worst
of it over HTTP additionally requires the *label* reading to be long, which is the model's
output rather than the attacker's — I did not demonstrate inducing a 20,000-character
transcription, and with a normal label it will be a few hundred characters. But the middle
row is the honest one: a 1 MB brand name against an ordinary 200-character reading already
costs **828 ms of blocking CPU**, against a README claim that the rules layer costs "~1 ms,
measured" inside a 5-second budget. Note also that the extraction schema
(`src/lib/reader/schema.ts`) puts no `.max()` on `text` either, so the label side is bounded
only by the model.

**Fix.** Cap the fields in `parseApplication` — nothing on TTB F 5100.31 is longer than a few
hundred characters:

```typescript
function text(value: unknown, max = 500): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error("That value is too long for this field.");
  return trimmed.length > 0 ? trimmed : undefined;
}
```

Add `.max(2000)` to `fieldReading.text` in the extraction schema, and consider a cheap length
guard in `editSimilarity` (if the lengths differ by more than the threshold allows, the
similarity cannot reach 0.82 — return early without running the matrix).

---

## 14–20. LOW

**14. Sake is not exempted from the standards of fill. REPRODUCED.**
`src/lib/ttb/netContents.ts:160-202`. 27 CFR 4.70(b)(1) excludes sake from §§ 4.71 and 4.72
entirely — I confirmed this against the part 4 XML. TTB classes sake as wine, so it arrives
with `beverageType: "wine"` and is checked against the wine list. 900 mL is a standard sake
size and is not on that list:

```
  sake   720 mL -> authorised=true   n/a=false
  sake   900 mL -> authorised=false  n/a=false     <-- false rejection
  sake  1800 mL -> authorised=true   n/a=false
```

`docs/REGULATORY-NOTES.md` §3.2 records the exclusion but the "Gaps and uncertainties" list
does not flag it as unimplemented. Fix: detect sake from the class/type designation and
return `notApplicable`, or at minimum add it to the documented gaps.

**15. Malt beverages below 0.5% ABV get a tolerance the regulation denies them. REPRODUCED +
eCFR-VERIFIED.** `src/lib/ttb/abv.ts:52`, `abv.ts:61-63`. 27 CFR 7.65(b)(2), verbatim from
the part 7 XML: *"For malt beverages containing less than 0.5 percent alcohol by volume ...
such statements are not subject to any tolerance."* The code applies a flat ±0.3 at every
strength. Observed: a malt application stating 0.4% against a label stating 0.6% yields
`review/abv-within-tolerance` where the regulation allows no tolerance at all. The verdict
lands in `review` rather than `pass`, so the consequence is under-strictness rather than a
false approval — which is why this is LOW. The same flat constant also misses 7.65(c)'s hard
floor (a label claiming ≥0.5% may never actually contain less, so the band is asymmetric),
and 7.65(d)/(e)/(f)'s zero-tolerance cases for "low alcohol", "non-alcoholic" and "alcohol
free". None of these is reachable today because ABV is not on the modern COLA form, but the
constant is wrong if it ever is.

**16. Wine near the 14% boundary auto-fails, against the project's own gap #3. REPRODUCED.**
`src/lib/ttb/abv.ts:56-58`, `rules.ts:287`. The tolerance *direction* is correct — I verified
27 CFR 4.36(b)(1) verbatim: 1 percent above 14%, 1.5 percent at or below, and
`abv <= 14 ? 1.5 : 1.0` implements that faithfully. The finding is band *selection*:

```
  wine application 13.9%, label 15.3%   needs_review  review/abv-within-tolerance
  wine application 14.0%, label 15.4%   needs_review  review/abv-within-tolerance
  wine application 14.1%, label 15.2%   reject        fail/abv-outside-tolerance
  wine application 14.1%, label 15.1%   needs_review  review/abv-within-tolerance
```

Gap #3 in the notes recommends *"flagging for human review rather than auto-failing anything
within 1.5 points of the 14% boundary"*, because 4.36(b)(1) keys the band to the *actual*
ABV while the tolerance is measured against the *stated* one. Row three auto-fails inside
that zone. Separately, 27 CFR 4.36(c) forbids any tolerance carrying a wine across the 14%
taxable-grade boundary — row one (13.9% stated, 15.3% on the label) is inside the arithmetic
band but crosses the boundary, and lands in `review`, which is a defensible outcome but
reached for the wrong reason. Fix: when either value is within 1.5 points of 14, force
`review` and cite 4.36(c).

**17. `nearest` omits the 4 L option for wine between 3 L and 4 L. REPRODUCED.**
`src/lib/ttb/netContents.ts:194-201`. A 3.5 L wine container reports "nearest permitted sizes
are 3 L" — the enumerated list is searched but the 4.72(b) even-litre allowance above it is
not, so the agent is told to move down when moving up is equally lawful. The comment at
`netContents.ts:191-193` says the purpose of `nearest` is to tell an agent "which way to
move". Minor advice defect.

**18. Wrong subsection in a code comment. eCFR-VERIFIED.** `src/lib/ttb/abv.ts:43` says
"27 CFR 5.65(a) — distilled spirits" for the 0.3 tolerance. 5.65(a) is *General*; the
tolerance is 5.65(c): *"A tolerance of plus or minus 0.3 percentage points is allowed for
actual alcohol content that is above or below the labeled alcohol content."* The figure is
right, the citation is not, and `docs/REGULATORY-NOTES.md` §2.4 already says 5.65(c).
Separately worth noting for the record: 5.65(c) governs *labeled vs actual product strength*,
not application-vs-label document agreement. The code's use of it to soften a
document disagreement to `review` rather than `pass` (`rules.ts:303-315`) is a reasonable
reading, and the explanation text says as much, but the tolerance is not strictly the
governing rule for that comparison.

**19. `parseVolume` unit and sign handling. REPRODUCED.** `src/lib/ttb/netContents.ts:56-63`.
`"SIZE: 12 OZ NET WT"` → 354.882 mL (weight ounces read as fluid); `"-750 mL"` → 750 (the
minus is outside the capture group); `"1e3 L"` → 3000 mL (matches the trailing `3`);
`"1 pint 9 fl oz"` → 473.176 mL (leftmost match only). None produces NaN or Infinity and none
is likely on a real label, but the same leftmost-match behaviour is the mechanism behind
finding 5, which is not benign.

**20. `tooPoorToReview` downgrades a genuine `reject` to `needs_review`. REPRODUCED.**
`src/lib/ttb/rules.ts:786-790`. The override is unconditional, so a label with an
unambiguously altered warning photographed badly returns `needs_review`:

```
  altered warning wording + unusable photograph   needs_review   government_warning=fail/warning-wording-altered
```

Arguably correct — you should not reject on evidence you could not read — but the comment
above it justifies the override solely as preventing a false *approval*, and widening a
reject is a different decision that is not stated anywhere. If it is intended, say so in the
comment; if not, apply the override only when `recommendation === "approve"`.

*Also noted:* the README states "110 tests" in three places; the suite is 115 committed plus 5
in the untracked `tests/regulationSync.test.ts`, for 120. The README treats its measured
numbers as standing claims, so this one should track.

---

## Things I tried that turned out to be fine

Negative results, so this ground does not get re-audited.

**The 27 CFR 16.21 warning text is byte-perfect.** I re-pulled part 16 from the eCFR
versioner API as raw XML and compared character by character. `STATUTORY_WARNING`
(`warning.ts:37-41`) is **identical** — same serial comma before "and may cause health
problems", same bare `(1)`/`(2)` parentheses with no trailing period, same capitalised
"Surgeon General", same single space after the colon. Confirmed **283 characters** and
**pure ASCII** (`/^[\x20-\x7e]+$/` is true). The doc's claim and the constant both hold.

**Both standards-of-fill lists are exactly right.** 27 CFR 5.203(a)(1)-(25) and
4.72(a)(1)-(25), re-enumerated from the parts 5 and 4 XML: 25 sizes each, and the code's
arrays match element for element with nothing missing, extra or wrong. The post-TTB-200
additions (945, 900, 720, 710, 570, 475, 355, 350, 331, 250 mL for spirits) are all present.
Part 7 genuinely contains no standards-of-fill provision — zero occurrences of the phrase in
the whole part — so skipping the check for malt beverages is correct, not an omission.

**The wine tolerance direction is correct.** 27 CFR 4.36(b)(1) verbatim: *"a tolerance of
1 percent, in the case of wines containing more than 14 percent ... and of 1.5 percent, in
the case of wines containing 14 percent or less"*. `abv <= 14 ? 1.5 : 1.0` is right. The
regulation does say "percent" rather than "percentage points" — the code implements
percentage points, which `docs/REGULATORY-NOTES.md` gap #2 already flags honestly as an
interpretation. I agree with the interpretation.

**The parsers do not crash, NaN, or go infinite.** 200,000 pseudo-random strings built from
an adversarial alphabet (digits, `e`/`E`, signs, `%`, `‰`, decimal points and commas,
zero-width and non-breaking spaces, BOM, unit words, regex metacharacters, combining marks,
RTL overrides, CJK, Greek, emoji, vulgar fractions) through `parseAlcohol`, `parseVolume` and
`proofIsConsistent`:

```
fuzz: 200,000 random strings -> threw=0 NaN=0 Infinity=0 negative=0
```

Empty strings, whitespace-only strings, null bytes, regex metacharacters (`.*`, `(a|b)+$`),
RTL overrides and 50,000-character values all pass through `compareTextField` without
throwing and produce sensible verdicts. Arabic-Indic digits (`١٢٫٥%`) correctly return
`null` → `review` rather than a wrong number.

**`text.replace(proofMatch[0], " ")` does not corrupt the remaining string.**
`String.prototype.replace` with a *string* first argument is a literal replacement, not a
pattern, so regex metacharacters in the matched proof text cannot misbehave. The `$`
substitution patterns only apply to the *replacement* string, which here is a constant `" "`.
The real defect in this area (finding 7) is about what the removal exposes, not about
corruption.

**`stripPunctuation`'s Unicode property escapes handle non-Latin scripts correctly.**
`\p{L}` covers Cyrillic, Greek and CJK, so those survive tokenisation and compare properly:
`"Крепкая"` vs `"Мягкая"` → no match; `"日本酒"` vs `"焼酎"` → no match; `"日本酒"` vs
`"日本酒"` → exact; `"Ούζο"` vs `"Ουζο"` → matched at the accents rung, which is the correct
rung. Only symbols and emoji are stripped, which is intended.

**The LCS word diff is correct on the hard cases.** Transposition
("drive a car" → "a car drive") produces a clean delete/insert pair around the moved word;
a repeated word ("the the") produces exactly one insert; the statutory text quoted twice
produces one equal run and one insert run of equal length. No spurious segments, no dropped
words, no crossing.

**I could not construct a non-compliant warning that `assessWarning` calls compliant.**
`wordingExact` is `insertions === 0 && deletions === 0`, which given the LCS walk is
equivalent to exact word-sequence equality — the only latitude is case, whitespace runs,
NFKC folding and curly-quote folding. Everything I tried was caught: reworded text, a
dropped `(2)`, a removed serial comma, a removed final full stop, transposed item numbers,
appended marketing copy, the statute printed twice, a zero-width space inside a word. The
two things that *do* pass — an all-capitals body and a lower-case "surgeon general" — pass by
documented design (`docs/REGULATORY-NOTES.md` gaps #6 and §1.3: 16.22(a)(2) constrains the
*weight* of the remainder, not its case), and I agree with that reading of the regulation.

**The `headerAllCaps` belt-and-braces only ever errs safe.**
`reading.headerIsAllCaps && reading.text.includes(WARNING_HEADER)` requires both the model's
flag and the literal text, so a model wrongly reporting `headerIsAllCaps: true` over a
"Government Warning:" transcription is still caught. It produces false *negatives*
(finding 4), never false positives.

**`summarise()` precedence is correct.** `fail` > `unreadable` > `review` > `approve`
(`rules.ts:710-744`). `checks` is never empty — `verify()` always pushes at least seven
results, and `checkAlcoholContent`/`checkNetContents`/`checkGovernmentWarning` each return at
least one on every path, so the "empty array falls through to approve" hazard is not
reachable. I checked every early return.

**Wine large-format handling is right.** 27 CFR 4.72(b) authorises "4 liters or larger ...
in quantities of even liters (4 liters, 5 liters, 6 liters, etc.)" — the parenthetical makes
plain that "even" means *whole*, including odd integers like 5. `Math.abs(litres -
Math.round(litres)) < 0.001` implements whole litres, so 5 L passes where a naive
`% 2 === 0` reading would have wrongly rejected it. 3.5 L is correctly unauthorised (neither
(a) nor (b) covers it), 18 L and above correctly reports out of scope per 4.70(b)(2), and
spirits above 3.75 L are correctly unauthorised — part 5 has no analogue of 4.72(b).

**The `checkBottler` trade-name fallback is sound.** I specifically tried to make it produce
a misleading `expected` or mask a failure. It does neither: the fallback only runs when the
legal-name comparison did not pass, it only *upgrades* to `pass`, and when it does the report
says `expected: "Old Tom Distillery (trade name; applicant is Pernod Ricard USA, LLC)"` with
rule `…:trade-name`, which tells an agent strictly more than a bare tick. When the reading is
low-confidence, both comparisons return `unreadable` and the `unreadable` is what surfaces.
Its one weakness is finding 3, which is `preflight`'s ordering rather than anything in
`checkBottler`.

**The `Inc.`/`Incorporated`, `whisky`/`whiskey` and company-suffix synonyms work as
advertised** — it is specifically the punctuation-bearing `&` entry that is dead (finding 6).

**Determinism holds.** `verify()` is pure apart from the `Date.now()` timing fields; repeated
calls on identical input produce identical reports, as `tests/rules.test.ts` already asserts.
Nothing I fuzzed introduced order-dependence or mutation of the input extraction.

---

## What the existing 120 tests do not cover

Offered as a checklist rather than a finding, since every item corresponds to something above.

- Low confidence on **any field other than `brandName`**. `tests/rules.test.ts:98-108` tests
  exactly one field, and it happens to be one of the four that work.
- Any `subsetIsAcceptable` case where the extra tokens **change the meaning** — the two tests
  that exist (`bottler` + address, `country_of_origin` + "PRODUCT OF") are both cases where
  containment is genuinely correct.
- An application with a **blank optional field** against a label that is also missing it.
- Warning text whose **whitespace differs from the canonical single-line form** — every
  warning fixture is one line with single spaces.
- Net contents in **US customary units** for spirits or wine (only "75 cL" and "1 L" appear).
- Net contents that **parses to `null`**.
- Any input containing a **vulgar fraction, a `100%` ingredient claim, or proof without ABV**
  alongside other numbers.
- `headerIsBold: false` / `legibleSize: false` — the prominence check has no test at all.
- Field values **longer than a few dozen characters**.
