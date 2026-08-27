# TTB COLA form and registry notes

Research backing the `Application` type and `tests/fixtures/applications.ts`.

Scope: this document covers the **application** side — what TTB F 5100.31 actually asks
for, what the Public COLA Registry actually stores, and therefore what we can meaningfully
match a label against. For the **label vs. federal law** side (health warning, ABV
tolerances, standards of fill, mandatory fields), see `REGULATORY-NOTES.md`. The two agree
on the distilled-spirits ABV tolerance of ±0.3 percentage points, reached independently.

Everything below is tagged:

- **[VERIFIED]** — read directly from a primary source: the TTB form PDF, TTB's own
  COLAs Online system, or a public COLA record. The source is named.
- **[INFERRED]** — a conclusion I drew. The evidence is stated so you can disagree.

Retrieved 2026-08-26.

---

## 1. Sources

| # | Source | URL |
|---|---|---|
| S1 | TTB F 5100.31, rev. 04/2023 — the current form + its full instructions | https://www.ttb.gov/system/files/images/pdfs/forms/f510031.pdf |
| S2 | TTB F 5100.31, rev. 01/2009 (superseded) — used to date the removal of fields | https://bevlaw.com/wp-content/uploads/2017/08/COLA-Form.pdf |
| S3 | Public COLA Registry — basic search | https://ttbonline.gov/colasonline/publicSearchColasBasic.do |
| S4 | Public COLA Registry — COLA detail (`&ttbid=<14-digit id>`) | https://ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay |
| S5 | COLAs Online product class/type code lookup | https://ttbonline.gov/colasonline/lookupProductClassTypeCode.do?action=search&display=all |
| S6 | COLAs Online origin code lookup | https://ttbonline.gov/colasonline/lookupOriginCode.do?action=search&display=all |
| S7 | TTB, "Using TTB's Public COLA Registry" | https://www.ttb.gov/public-information/news/using-cola-registry-search-certificates |
| S8 | Public COLA Registry user manual (PDF) | https://www.ttb.gov/system/files/images/pdfs/labeling/colas_ol_pcr_um.pdf |
| S9 | 27 CFR 5.65 — alcohol content statements, abbreviations and tolerance | https://www.law.cornell.edu/cfr/text/27/5.65 |

`ecfr.gov` returned a 302 to an interstitial and could not be read directly; S9 is the
Cornell LII mirror of the same section. Worth re-checking against eCFR when it is reachable.

**Accessibility note. [VERIFIED]** The Public COLA Registry (S3–S6) is *not* blocked and
*is* machine-readable. Plain `curl` with a cookie jar works: `GET` the search page for a
session, `POST` to `publicSearchColasBasicProcess.do?action=search`, then `GET`
`viewColaDetails.do`. No CAPTCHA, no API key, no rate limiting encountered. Label artwork
is served from `publicViewAttachment.do`. Every COLA cited in this document and in the
fixtures was retrieved that way, so every claim here is re-checkable.

One quirk worth knowing: `publicViewAttachment.do` appears to resolve the image from
**session state** (the last COLA detail page fetched), not reliably from its `filename`
parameter. Requesting a filename from COLA A while the session last viewed COLA B returned
B's image. Confirmed by byte-identical MD5 across two differently-parameterised requests.
Fetch the detail page immediately before the image.

---

## 2. The real form: TTB F 5100.31 (rev. 04/2023)

Full title: *Application for and Certification/Exemption of Label/Bottle Approval*.
OMB control number 1513-0020. **[VERIFIED, S1]**

### 2.1 Field inventory

Items marked "(Required)" carry that word on the form itself. **[VERIFIED, S1]**

| Item | Label on the form | Status | In our type? |
|---|---|---|---|
| — | TTB ID (upper-left, "FOR TTB USE ONLY") | TTB-assigned | added as `ttbId` |
| 1 | REP. ID. NO. (If any) | optional | no — third-party filer id, not label data |
| 2 | PLANT REGISTRY/BASIC PERMIT/BREWER'S NO. | **Required** | added as `plantRegistryNumber` |
| 3 | SOURCE OF PRODUCT — Domestic / Imported | **Required** | `isImport` |
| 4 | SERIAL NUMBER | **Required** | added as `serialNumber` |
| 5 | TYPE OF PRODUCT — Wine / Distilled Spirits / Malt Beverages | **Required** | `beverageType` |
| 6 | BRAND NAME | **Required** | `brandName` |
| 7 | FANCIFUL NAME (If any) | conditional | added as `fancifulName` |
| 8 | NAME AND ADDRESS OF APPLICANT … INCLUDE APPROVED DBA OR TRADENAME IF USED ON THE LABEL | **Required** | `bottlerName` + added `labelCompanyName` |
| 8a | MAILING ADDRESS, IF DIFFERENT | optional | no |
| 9 | FORMULA | conditional | added as `formulaId` |
| 10 | GRAPE VARIETAL(S) — Wine only | conditional | added as `grapeVarietals` |
| 11 | WINE APPELLATION (If on label) | conditional | added as `wineAppellation` |
| 12 | PHONE NUMBER | required in practice | no |
| 13 | EMAIL ADDRESS | optional | no |
| 14 | TYPE OF APPLICATION — a COLA / b exemption / c distinctive bottle / d resubmission | **must check a or b** | added as `applicationType`, `forSaleInState` |
| 15 | Information blown, branded or embossed on the container; translations of foreign-language text | conditional | added as `containerInfoNotOnLabels` |
| 16 | DATE OF APPLICATION | required | no |
| 17 | SIGNATURE OF APPLICANT OR AUTHORIZED AGENT | required | no |
| 18 | PRINT NAME OF APPLICANT OR AUTHORIZED AGENT | required | no |
| 19 | DATE ISSUED | TTB | no |
| 20 | AUTHORIZED SIGNATURE | TTB | no |
| — | QUALIFICATIONS (TTB use) | TTB | added as `qualifications` |

There are **no items 21+**. General Instruction 6 on the current form still says oversized
labels must be flagged "in Item 19" — a stale cross-reference to the old numbering, since
Item 19 is now TTB's own date-issued box. **[VERIFIED, S1]** Harmless, but it tells you
TTB renumbered the form and did not fully re-proof the instructions.

### 2.2 The finding that matters most: ABV and net contents are not on the form

**[VERIFIED, S1 + S2]** The 01/2009 revision had:

- **Item 12 NET CONTENTS**
- **Item 13 ALCOHOL CONTENT**
- Item 15 WINE VINTAGE DATE
- Item 10 FORMULA/SOP NO. and Item 11 LAB. NO. & DATE / PRE-IMPORT NO. & DATE (separate)
- Item 17 FAX NUMBER

The 04/2023 revision has **none of these**. Net contents, alcohol content, vintage and fax
were removed outright; formula and lab number were merged into a single Item 9.

Confirmed against live records **[VERIFIED, S4]**:

- COLA `16062001000172` (filed 2016, old form) renders "12. NET CONTENTS → 750 MILLILITERS"
  and "13. ALCOHOL CONTENT → 40".
- COLA `25014001000156` (filed 2025, current form) renders neither field at all.

**Consequence for this tool.** For any COLA filed in roughly the last decade there is *no
declared ABV and no declared net contents to match a label against*. "Does the label's ABV
match the application?" is an unanswerable question for a modern COLA. Those two checks
must degrade to:

1. `not_applicable` for the **match** category when the application does not carry the value; and
2. a pure **compliance** check against the class/type standard — e.g. spirits designated
   "rum" may not state less than 40% ABV; a wine designated "table wine" may not exceed
   14% ABV. Both examples are drawn verbatim from the form's own Allowable Revisions
   commentary. **[VERIFIED, S1]**

Returning `fail` because the application is silent would be wrong, and an agent would spot
it immediately.

### 2.3 Brand name vs fanciful name

**[VERIFIED, S1]** From the form's own instructions:

- **Item 6** — "A brand name is the name under which the product is sold. If the product is
  not sold under a brand name, enter the name of the bottler, packer, or importer, as
  applicable." Always required.
- **Item 7** — "A fanciful name is a name that further identifies the product and is
  required for some specialty products. It is optional for other products."

So: brand name identifies the *line*; fanciful name identifies *this particular product
within the line*. Both are printed on the label and both are legitimate match targets. On a
specialty product the fanciful name often carries the information a consumer actually reads
("WHISKEY & COLA", "THE CHICKEN WINE"), while the brand name is just the house name.

**[INFERRED]** The "specialty products" that require a fanciful name correspond to the
specialty class/type codes. Evidence: across the COLAs sampled, class 101 (STRAIGHT BOURBON
WHISKY) records had Item 7 blank or "N/A", while every class 641 (WHISKY SPECIALTIES),
649 (OTHER SPECIALTIES & PROPRIETARIES) and 906 (MALT BEVERAGES SPECIALITIES - FLAVORED)
record had a populated fanciful name — e.g. under brand MAKER'S MARK, the 101 filings had
none and the 641 filings had "Stave Profile No. 46", "SE4 X PR5", "FAE-01", "FAE-02".
A clean split in that sample, but I did not test it exhaustively.

**Trap. [VERIFIED, S4]** Applicants with no fanciful name frequently type the literal string
`"N/A"` into Item 7 rather than leaving it blank. Treat `"N/A"`, `"NA"` and `"NONE"` as
absent, or the tool will hunt for "N/A" on the artwork and report it missing.

### 2.4 Serial number

**[VERIFIED, S1]** Item 4 instruction, verbatim:

> You must assign a sequential serial number beginning with the last two digits of the
> current calendar year to each application and its duplicate, not to exceed 6 characters;
> e.g., 12-1, 12-2, etc.

Rules, therefore: applicant-assigned (not TTB-assigned); starts with the two-digit year;
max 6 characters; sequential within the applicant's own filings.

**It is alphanumeric.** Real examples **[VERIFIED, S3/S4]**: `240013`, `110017`, `12I060`,
`16P032`, `12VW01`, `20JD02`, `20BFC1`, `19R191`. Never parse a serial number as an integer
and never assume the `YY-N` form from the instruction's example — almost nobody uses the
hyphen. The year prefix is the only reliable structure.

### 2.5 TTB ID

Distinct from the serial number, and this is the one an agent searches on. TTB-assigned,
14 digits.

Structure — described in secondary sources, then **independently verified by me** against
12 real records: `YY` + `DDD` + `RRR` + `NNNNNN`, where `DDD` is the Julian day the
application was received, `RRR` is the receipt method (`001` = e-filed), and `NNNNNN` is a
per-day sequence.

**[VERIFIED, S4]** I checked digits 1–5 against each record's own Item 16 "DATE OF
APPLICATION" for all 12 COLAs retrieved. **12/12 exact matches**, including two leap-year
cases that would have broken a naive day-of-year mapping:

| TTB ID | decodes to | Item 16 on the record |
|---|---|---|
| `12061001000632` | 2012 day 61 → 1 Mar 2012 (leap) | 03/01/2012 |
| `16062001000172` | 2016 day 62 → 2 Mar 2016 (leap) | 03/02/2016 |
| `20126001000141` | 2020 day 126 → 5 May 2020 (leap) | 05/05/2020 |
| `24009001000244` | 2024 day 9 → 9 Jan 2024 | 01/09/2024 |

The `RRR` = receipt-method claim I could **not** verify: all 12 sampled records were `001`
and all 12 stated "(Application was e-filed)", which is consistent but is not a test —
I never observed a non-`001` value. **[INFERRED]**

### 2.6 Beverage type categories

**[VERIFIED, S1]** Item 5 offers exactly three: **WINE**, **DISTILLED SPIRITS**,
**MALT BEVERAGES**. Our `BeverageType` union matches one-for-one. The instruction adds one
rule worth encoding: *"For Sake, check the 'wine' box."*

Note these three are the *form's* categories, not the regulatory parts. Labelling rules
live in 27 CFR part 4 (wine), part 5 (spirits), part 7 (malt beverages) and part 16 (health
warning) — the form's own conditions clause cites all four. **[VERIFIED, S1]**

### 2.7 Formula and lab analysis

**[VERIFIED, S1]** Item 9 instruction, condensed:

> The term "Formula" encompasses the following pre-COLA product evaluations: domestic
> beverage alcohol formulas, pre-import approval letters, lab analyses, and submissions
> formerly known as statements of process (SOPs). … For any domestic or imported alcohol
> beverage product requiring formula approval, specify the TTB Formula ID/TTB ID number, or
> TTB lab number. A copy of the approved formula or pre-import approval letter must
> accompany this label application. If the formula approval was obtained electronically
> through Formulas Online, the system-generated TTB Formula ID number must be provided.

So Item 9 is a single free-text field holding *any one of* a Formula ID, a lab number, or a
pre-import approval number. On the old form these were two separate items (10 and 11), which
is why older COLAs in the registry render them separately.

Real example **[VERIFIED, S4]**: COLA `10236001000047` (Jack Daniel's "WHISKEY & COLA")
carries "10. FORMULA/SOP NO. → 393".

**[INFERRED]** Formula presence is a useful gate: a populated Item 9 implies a specialty /
non-standard product, which is also the situation in which Item 7 becomes mandatory. A
filing with a formula number and no fanciful name is worth flagging for review.

### 2.8 Allowable revisions — the regulatory basis for fuzzy matching

This is the single most useful thing I found for the rules engine, and it is printed on the
form itself. Section V, "Allowable Revisions to Approved Labels", item **3.b**
**[VERIFIED, S1]**, permitted for wine, distilled spirits and malt beverages alike:

> Change the type size and font, and make appropriate changes to the spelling (including
> punctuation marks, changing letters from upper case to lower case and vice versa, and
> abbreviations) of words

with the commentary:

> All changes must comply with applicable regulations, and changes in spelling must not
> change the meaning of the previously approved information.

That is TTB explicitly authorising a bottler to change case, punctuation and abbreviations
on an approved label **without refiling**. It means a label differing from its application
only in case, apostrophe style, or `ALC/VOL` vs `Alcohol by Volume` is *compliant by
construction* — not merely something we choose to tolerate. Cite this in the rule
explanations; it turns "our matcher is lenient" into "TTB permits this change".

The commentary's limit is equally important: spelling changes must not change **meaning**.
That is the principled boundary between `pass` and `review`.

**Reinforced by regulation. [VERIFIED, S9]** 27 CFR 5.65 does the same job for alcohol
content specifically. Paragraph (b)(3) authorises the abbreviations `alc`, `%`, `/` (in
place of "by") and `vol`; paragraph (b)(4) then lists all of the following as compliant
statements of the same fact:

> "40% alc/vol" · "Alc. 40 percent by vol." · "Alc 40% by vol" · "40% Alcohol by Volume"

So `ALC/VOL` and `Alcohol by Volume` are not merely tolerable variants — TTB names both as
correct. And paragraph (c) sets the numeric tolerance:

> A tolerance of plus or minus 0.3 percentage points is allowed for actual alcohol content
> that is above or below the labeled alcohol content.

Use **±0.3 percentage points**, cited to 27 CFR 5.65(c), as the spirits ABV tolerance.
(An earlier draft of these notes used 0.15 — that was wrong.)

Related allowable revisions that affect our checks **[VERIFIED, S1]**:

- **10.** Net contents statement may be changed without refiling (all three types).
- **11./12.** Alcohol content may be changed without refiling, provided it stays consistent
  with the labelled class/type — reinforcing §2.2 above: a stale filed ABV would be a bad
  thing to fail a label against even when one exists.
- **19.** The name or trade name may be changed to any other name already approved for that
  industry member, and the address may change within the same state.

---

## 3. Class/type and origin codes

**[VERIFIED, S5]** TTB's own lookup returns **530 class/type code → description pairs**.
Codes are grouped by commodity and, critically, **duplicated across domestic and imported
blocks with identical descriptions**:

| Code | Description | | Code | Description |
|---|---|---|---|---|
| 900 | MALT BEVERAGES | | 950 | MALT BEVERAGES |
| 901 | BEER | | 951 | BEER |
| 902 | ALE | | 952 | ALE |
| 903 | MALT LIQUOR | | 953 | MALT LIQUOR |
| 904 | STOUT | | 954 | STOUT |
| 905 | PORTER | | 955 | PORTER |
| 906 | MALT BEVERAGES SPECIALITIES - FLAVORED | | 956 | MALT BEVERAGES SPECIALITIES |

The 900-block is domestic, the 950-block imported. **[INFERRED]** — the descriptions are
identical so the split is not self-evident from the table, but every domestic malt COLA I
sampled used a 90x code and every imported one used a 95x code.

Two things to note:

- The **description alone is ambiguous** — "ALE" is both 902 and 952. The code is the
  canonical key. This is why `classTypeCode` was added to the type.
- TTB's table contains **"SPECIALITIES"**, a misspelling of "specialties", in codes 906 and
  956. It is in TTB's official data, it appears verbatim on real certificates, and it must
  not be "corrected" anywhere in our pipeline.

Other codes used by the fixtures **[VERIFIED, S5]**: 80 TABLE RED WINE · 80A ROSE WINE ·
81 TABLE WHITE WINE · 88 `DESSERT /PORT/SHERRY/(COOKING) WINE` (note the stray space and
the parenthesised alternative — real, verbatim) · 101 STRAIGHT BOURBON WHISKY ·
153 SINGLE MALT SCOTCH WHISKY · 641 WHISKY SPECIALTIES · 645 `LIQUEURS (WHISKY)` ·
649 OTHER SPECIALTIES & PROPRIETARIES.

**Every whisk(e)y code in TTB's table spells it "WHISKY".** **[VERIFIED, S5]** Meanwhile
real labels lawfully print "WHISKEY" — the Buffalo Trace back label reads "KENTUCKY
STRAIGHT BOURBON WHISKEY" against a filing of "STRAIGHT BOURBON WHISKY". The spelling
tolerance is not a nicety; without it the tool fails TTB's own data.

**[VERIFIED, S6]** The origin lookup returns **233 codes in a single namespace mixing US
states and foreign countries**: `00` AMERICAN, `01` CALIFORNIA, `19` INDIANA, `22` KENTUCKY,
`43` TENNESSEE, `51` FRANCE, `5E` IRELAND, `5K` SCOTLAND, `81` MEXICO. TTB does not model
"country of origin" as a separate concept — there is one Origin field, and whether it means
a state or a country is determined by Item 3 (Domestic/Imported).

---

## 4. Real COLA records used as fixtures

All ten **[VERIFIED, S4]**, transcribed verbatim. Retrieve any of them at
`https://ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid=<TTB ID>`.

| TTB ID | Brand | Class/type (code) | ABV | Net contents | Origin | Applicant → name on label |
|---|---|---|---|---|---|---|
| 11354001000132 | MAKER'S MARK | STRAIGHT BOURBON WHISKY (101) | `45` | `750 MILLILITERS` | KENTUCKY | MAKER'S MARK DISTILLERY, INC. |
| 12061001000632 | BAREFOOT | TABLE RED WINE (80) | `9` | `1.5 LITERS` | CALIFORNIA | E. & J. GALLO WINERY → BAREFOOT CELLARS |
| 11364001000198 | SIERRA NEVADA | ALE (902) | `7.5` | `5 GAL.` + `15.5 GAL. (1/2 BBL)` | CALIFORNIA | SIERRA NEVADA BREWING CO. |
| 16062001000172 | THE GLENLIVET | SINGLE MALT SCOTCH WHISKY (153) | `40` | `750 MILLILITERS` | SCOTLAND (import) | PERNOD RICARD USA, LLC → THE GLENLIVET DISTILLING COMPANY |
| 12019001000628 | MODELO ESPECIAL | BEER (951) | `3.2/wt` | `1 PT. 8 FL. OZ. (24 FL. OZ.)` | MEXICO (import) | CROWN IMPORTS LLC |
| 10236001000047 | JACK DANIEL'S | WHISKY SPECIALTIES (641) | `5%` | `355 MILLILITERS (METAL ONLY)` | INDIANA | PRI-PAK, INC. → JACK DANIEL DISTILLERY |
| 25014001000156 | LA VIEILLE FERME | TABLE WHITE WINE (81) | *not on form* | *not on form* | FRANCE (import) | (importer, permit AL-I-381) |
| 12027001000408 | KENDALL-JACKSON | DESSERT /PORT/SHERRY/(COOKING) WINE (88) | `15.0` | `750 MILLILITERS` | CALIFORNIA | JACKSON FAMILY WINES, INC. → KENDALL-JACKSON VINEYARDS & WINERY |
| 12181001000061 | GUINNESS | ALE (952) | `5.6` | `11.2 FL OZ` | IRELAND (import) | DIAGEO - GUINNESS USA INC. → DIAGEO-GUINNESS USA |
| 24009001000244 | BUFFALO TRACE | STRAIGHT BOURBON WHISKY (101) | *not on form* | *not on form* | KENTUCKY | BUFFALO TRACE DISTILLERY, INC. |

### 4.1 Messiness this real data contains, and what it forces

- **ABV format is wildly inconsistent** — `45`, `9`, `15.0`, `7.5`, `40`, `5%`, `5.6`,
  `3.2/wt`. Bare integers, trailing zeros, a percent sign, and one **alcohol-by-weight**
  value. `3.2/wt` (Modelo) is ≈4.0% ABV; parsing it as a volume percentage yields a
  confidently wrong answer. The parser must detect the unit and return `review` when it
  cannot be sure.
- **Net contents are never in label form** — `750 MILLILITERS` against a label's `750ML`;
  `1.5 LITERS` against `1.5 L`; a dual statement `1 PT. 8 FL. OZ. (24 FL. OZ.)`; and a
  **multi-size** filing (`5 GAL.` and `15.5 GAL. (1/2 BBL)` on one COLA) where the label
  legitimately shows only one. A label matching *any* filed size should pass.
- **Applicant name ≠ name on the label**, in **6 of 10** records — I counted the records
  carrying a distinct "(Used on label)" entry. `E. & J. GALLO WINERY` vs `BAREFOOT CELLARS`;
  `PERNOD RICARD USA, LLC` vs `THE GLENLIVET DISTILLING COMPANY`; `PRI-PAK, INC.` vs
  `JACK DANIEL DISTILLERY`; `VINWOOD, JACKSON FAMILY WINES, INC.` vs
  `KENDALL-JACKSON VINEYARDS & WINERY`. Comparing artwork against Item 8 alone produces
  false failures on a clear majority of this sample. Note also that the registry renders
  Item 8 as `"<DBA>, <legal entity>"` when both are recorded, so the field is not a clean
  single name even before the label name is considered.
- **A real corporate-name near-miss**: `DIAGEO - GUINNESS USA INC.` (spaced hyphen, with
  suffix) vs `DIAGEO-GUINNESS USA` (tight hyphen, no suffix). The Inc./whitespace case did
  not need inventing.
- **whisky/whiskey inside a single filing**: COLA `10236001000047` has class/type
  `WHISKY SPECIALTIES` and fanciful name `WHISKEY & COLA`.
- **Status is not always APPROVED.** `16062001000172` and `10236001000047` are
  **SURRENDERED**. A surrendered COLA authorises nothing regardless of how well the artwork
  matches, so status must be surfaced before any match result.
- **Multi-location bottling.** COLA `24009001000244` lists **eight** plant registry numbers
  in Item 2 (DSP-CA-63, DSP-IN-21057, DSP-KY-12, DSP-KY-24, DSP-KY-113, DSP-MD-11, DSP-ME-2,
  DSP-NH-21006) and carries the qualification "EACH CONTAINER MUST BE CODED TO INDICATE
  ACTUAL PLACE OF BOTTLING." The form's Item 2 instruction explicitly permits this for
  distilled spirits and malt beverages.

### 4.2 One end-to-end ground truth

I retrieved and read the actual back-label artwork for COLA `24009001000244`
(`Buffalo Trace KSBW 750ml 90P Back.jpg`). Provenance confirmed by byte-identical MD5 on a
second, correctly-scoped request. Transcribed from the image:

```
BUFFALO TRACE
KENTUCKY STRAIGHT BOURBON WHISKEY
45% ALC/VOL (90 PROOF) 750ML
DISTILLED, AGED & BOTTLED BY BUFFALO TRACE
DISTILLERY, FRANKFORT, KY
GOVERNMENT WARNING: (1) ACCORDING TO THE SURGEON GENERAL, …
```

Against the filing, in one artifact: class/type `STRAIGHT BOURBON WHISKY` vs printed
`KENTUCKY STRAIGHT BOURBON WHISKEY` (spelling **and** an added geographic prefix); ABV and
net contents printed on the label but **absent from the application**; bottler printed as a
trade name; and a `GOVERNMENT WARNING:` header rendered all-caps and bold, matching what
`WarningReading` models. Every hard case in the fixture set is present on one real label.

---

## 5. Recommended changes to the `Application` type

### 5.1 Applied

These are **additive and optional**, so nothing that compiles today breaks. `src/lib/ttb/types.ts`
now also defines `ApplicationType` and `ColaStatus`.

| Field | Form item | Why |
|---|---|---|
| `ttbId` | TTB use | The real 14-digit identifier. `applicationId` is a free-form applicant reference; an agent searches by TTB ID and will expect to see it. |
| `serialNumber` | 4 | **Mandatory on the form and we were missing it.** The most conspicuous omission — an agent reconciling a paper file works from brand + serial. Alphanumeric, max 6 chars. |
| `plantRegistryNumber` | 2 | **Mandatory on the form and we were missing it.** Also the strongest available signal of beverage type: `DSP-` spirits, `BW-`/`BWC-` wine, `BR-` brewery, `XX-I-` importer. |
| `fancifulName` | 7 | Printed on the label, mandatory for specialty products, and often the most prominent text after the brand. Without it, specialty labels have unmatchable text. |
| `classTypeCode` | TTB use | The registry's canonical key. Descriptions collide across domestic/import (902 vs 952 both "ALE"), so the description alone cannot identify a class/type. |
| `originCode` | TTB use | TTB's single origin namespace covering states and countries. |
| `labelCompanyName` | 8 (DBA) | **Behaviour-changing.** Differs from the legal applicant in 5 of 10 sampled records. Matching artwork against `bottlerName` alone produces false failures. |
| `formulaId` | 9 | Marks the product as a formula/specialty product, which is when Item 7 becomes mandatory. |
| `wineAppellation`, `wineVintage`, `grapeVarietals` | 11, —, 10 | Wine-only, mandatory-if-stated-on-label. Each is a checkable label element we currently cannot verify. |
| `applicationType`, `forSaleInState` | 14 | **Behaviour-changing.** A certificate of exemption additionally requires `"For sale in XX only"` printed on the container. Without this the tool cannot even know that rule applies. |
| `status` | TTB use | Non-approved COLAs (2 of 10 sampled were SURRENDERED) authorise nothing. |
| `containerInfoNotOnLabels` | 15 | **Behaviour-changing.** Net contents are often embossed rather than printed. Absent this, a label with no printed net contents looks like a violation when it is not — e.g. `16062001000172` records "GEORGE & J.G. SMITH LTD. IS EMBOSSED INTO THE BOTTLE." |
| `qualifications` | TTB use | Conditions TTB attached to the approval; an agent expects to see them. |

Also updated in place: the doc comments on `classType` (TTB always spells it "WHISKY"),
on `alcoholContent`/`netContents` (not on the current form — see §2.2), and on `bottlerName`
(legal applicant, not necessarily the label name).

### 5.2 Recommended but not applied

Deliberately left alone, since each is a breaking change or needs a product decision:

1. **`plantRegistryNumber` should be `string[]`.** Multi-location filings are real and
   common for spirits and malt beverages — `24009001000244` lists eight. Currently only the
   principal location can be stored.
2. **`netContents` should be `string[]`.** A single COLA may cover a range of sizes; the
   form explicitly permits it ("You may submit a range of sizes"). `11364001000198` filed
   two. The fixture currently joins them with `"; "`, which is a workaround, not a model.
3. **Reconsider `countryOfOrigin` + `isImport`.** TTB has one Origin field plus a
   Domestic/Imported flag, where Origin holds a US state for domestic products. Our
   `countryOfOrigin` name misleads: for `11354001000132` the correct value is "KENTUCKY".
   Renaming to `origin` would match TTB and remove the ambiguity.
4. **`alcoholContent` needs a parsed companion.** Real values include `3.2/wt` — alcohol by
   *weight*. A `{ value: number; unit: "abv" | "abw"; raw: string }` shape would stop the
   rules engine silently comparing incompatible units. Keeping only the raw string almost
   guarantees that bug.
5. **`beverageType` cannot be trusted as the sole rule selector.** `classTypeCode` is finer
   and is what actually determines the applicable standard — 641 (whisky specialty) and 101
   (straight bourbon) are both `distilled_spirits` but carry very different requirements.
6. **Consider a `formOfRecord` / revision marker.** Whether a COLA carries ABV and net
   contents depends on which form revision it was filed under. Recording that would let the
   engine explain *why* a check is `not_applicable` instead of merely asserting it.

### 5.3 Missing field a real agent would most notice

**Serial number (Item 4).** It is one of only six fields the form marks "(Required)", it is
how an industry member refers to their own filing, and it appeared nowhere in our model.
`plantRegistryNumber` (Item 2) is the same story. Of the six mandatory items, we previously
modelled brand name, type of product and source of product, and were missing serial number
and plant registry number outright, while representing applicant name in a form that
conflates the legal entity with the trade name shown on the label.
