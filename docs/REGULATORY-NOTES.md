# TTB Label Compliance — Regulatory Notes

Factual backbone for the COLA label-verification tool. Every claim below carries a CFR citation.

**Source currency.** All CFR text was pulled from the eCFR versioner API (raw XML, not scraped HTML) for
Title 27, **up to date as of 2026-08-25**. Where character-exact text matters, it was taken from the raw
XML bytes and cross-checked against a second source.

**Reading note.** Three separate regimes apply, and they are *not* symmetrical:

| Part | Commodity | Structure |
|---|---|---|
| 27 CFR part 4 | Wine | **Legacy** numbering (4.32, 4.36, 4.72). Not modernised. |
| 27 CFR part 5 | Distilled spirits | **Modernised** by T.D. TTB-176 (5.63, 5.65, 5.203). |
| 27 CFR part 7 | Malt beverages | **Modernised** by T.D. TTB-176 (7.63, 7.65). |
| 27 CFR part 16 | All three | Health warning statement. |
| 27 CFR part 13 | All three | COLA procedure. |

Do not assume a rule found in part 5 has a twin in part 4. Several do not — see **Gaps and uncertainties**.

---

## 1. The Government Health Warning

### 1.1 The exact text — 27 CFR 16.21

This is the canonical single-line form. Verified byte-for-byte as **pure ASCII** (no smart quotes, no
en/em dashes, no non-breaking spaces):

```
GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.
```

**Citation:** 27 CFR 16.21; statutory source Sec. 8001, Pub. L. 100-690, 102 Stat. 4181, **27 U.S.C. 215**.

**Verification performed.** The string above was confirmed identical across three independent sources:

1. eCFR raw XML for 27 CFR 16.21 (the `<EXTRACT>` block).
2. `uscode.house.gov` text of 27 U.S.C. 215.
3. `govinfo.gov` USCODE HTML of 27 U.S.C. 215.

Character-level details a diff engine must get right:

- `GOVERNMENT WARNING:` — one space after the colon, before `(1)`.
- Round parentheses around the bare digits: `(1)` and `(2)`. No period after the digit.
- `Surgeon General` — both words capitalised.
- Serial punctuation: `machinery, and may cause health problems.` — there **is** a comma before `and`.
- Both sentences end with a full stop; the statement ends with `problems.`
- Total length of the canonical single-line form: **283 characters** (verified by byte count of the
  string exactly as it appears in the fenced block above, excluding any trailing newline).

**Whitespace caveat.** In the eCFR, 16.21 renders as *two* paragraph elements — item (1) and item (2) are
separate `<P>` nodes. In the statute at 27 U.S.C. 215 the same text appears as one continuous quoted
string with a **single space** between `defects.` and `(2)`. Neither 16.21 nor 16.22 prescribes line
breaks or internal whitespace on an actual label. **Normalise all runs of whitespace to a single space
before diffing** (27 CFR 16.21; 27 CFR 16.22).

### 1.2 Where the warning must appear — 27 CFR 16.21

> "There shall be stated on the brand label or separate front label, or on a back or side label,
> **separate and apart from all other information**, the following statement:"

**Citation:** 27 CFR 16.21. So placement is flexible (brand/front/back/side), but the statement must be
segregated from other label copy.

### 1.3 Where mandatory capitalisation applies — 27 CFR 16.22(a)(2)

This is narrower than people assume. The regulation reads:

> "(2) The first two words of the statement required by § 16.21, i.e., "GOVERNMENT WARNING," shall appear
> in capital letters and in bold type. The remainder of the warning statement may not appear in bold type."

**Citation:** 27 CFR 16.22(a)(2).

Precisely:

- **`GOVERNMENT` and `WARNING` — and only those two words — must be in capital letters AND in bold type.**
- The **remainder** (everything from `(1) According...` onward) **may not appear in bold type.**
- The regulation constrains the **weight** (bold) of the remainder, **not its case**. There is no
  provision in part 16 requiring the remainder to be mixed-case, and none prohibiting the remainder from
  being set in capitals.

**Implementation guidance:** require `GOVERNMENT WARNING` to be uppercase; compare the remainder
**case-insensitively**. Failing a label because its warning body is in all caps is not supported by the
text of 16.22 (27 CFR 16.22(a)(2)). A vision model generally cannot reliably judge bold weight, so the
"may not appear in bold" clause is not a safe automated check — see **Gaps and uncertainties**.

### 1.4 Type size, contrast and legibility — 27 CFR 16.22

**Legibility and contrast — 27 CFR 16.22(a)(1):**

> "All labels shall be so designed that the statement required by § 16.21 is readily legible under
> ordinary conditions, and such statement shall be on a contrasting background."

**No compression — 27 CFR 16.22(a)(3):** letters and/or words "shall not be compressed in such a manner
that the warning statement is not readily legible."

**Maximum characters per inch — 27 CFR 16.22(a)(4)** (characters = letters, numbers, marks):

| Minimum required type size for warning statement | Maximum number of characters per inch |
|---|---|
| 1 millimeter | 40 |
| 2 millimeters | 25 |
| 3 millimeters | 12 |

**Minimum type size, by container volume — 27 CFR 16.22(b):**

| Container size | Minimum script/type/printing |
|---|---|
| 237 mL (8 fl. oz.) or less | 1 millimeter — 27 CFR 16.22(b)(1) |
| More than 237 mL (8 fl. oz.) up to 3 L (101 fl. oz.) | 2 millimeters — 27 CFR 16.22(b)(2) |
| More than 3 L (101 fl. oz.) | 3 millimeters — 27 CFR 16.22(b)(3) |

**Labels firmly affixed — 27 CFR 16.22(c):** a warning label that is not an integral part of the container
must be affixed so it "cannot be removed without thorough application of water or other solvents."

### 1.5 Scope and COLA linkage

- **Applies to all three commodities.** Part 16 covers "alcoholic beverages," defined as any beverage in
  liquid form containing **not less than one-half of one percent (.5%) alcohol by volume** intended for
  human consumption (27 CFR 16.10, definition of *Alcoholic beverage*).
- **Domestic and imported alike**, for product bottled on or after **November 18, 1989**
  (27 CFR 16.20(a) and 16.20(b)).
- **COLA gate:** TTB will not approve a COLA or certificate of exemption on Form 5100.31 for wine,
  distilled spirits or malt beverages bottled on/after November 18, 1989 unless the label bears the
  health warning statement (27 CFR 16.30).
- **Exports exempt**, except product for the U.S. Armed Forces (27 CFR 16.31).
- **State preemption:** no other alcohol-and-health statement may be required by State law
  (27 CFR 16.32).
- **Civil penalty:** not more than $10,000 per day as enacted, subject to cost-of-living adjustment; TTB
  publishes the current amount at its website rather than in the CFR (27 CFR 16.33(a)-(c)).

---

## 2. Alcohol Content Tolerances

### 2.1 Distilled spirits — 27 CFR part 5

**Tolerance — 27 CFR 5.65(c):**

> "A tolerance of plus or minus **0.3 percentage points** is allowed for actual alcohol content that is
> above or below the labeled alcohol content."

**Mandatory or optional:** **Always mandatory.** Alcohol content is required, and must appear **within the
same field of vision** as the brand name and the class/type designation (27 CFR 5.63(a)(3); field of
vision defined in 27 CFR 5.63(a) as a single side of the container — for a cylindrical container, 40% of
the circumference — where all the items can be viewed simultaneously without turning the container).

**How it must be expressed — 27 CFR 5.65(a) and 5.65(b):**

- Must be stated as a **percentage of alcohol by volume** (27 CFR 5.65(a), 5.65(b)(1)).
- Accepted formats (27 CFR 5.65(b)(2)(i)): `"Alcohol ____ percent by volume"`,
  `"____ percent alcohol by volume"`, or `"Alcohol by volume ____ percent."`
- Permitted abbreviations (27 CFR 5.65(b)(3)): `alcohol` → `alc`; `percent` → `%`; `by` → `/`
  (separating alcohol and volume); `volume` → `vol`. Periods optional; parentheses permitted; quotation
  marks not required (27 CFR 5.65(b)(2)(ii)).
- Regulation's own compliant examples (27 CFR 5.65(b)(4)): `40% alc/vol`, `Alc. 40 percent by vol.`,
  `Alc 40% by vol`, `40% Alcohol by Volume.`
- **Products with absorbent solids** (e.g. solid fruit that may absorb spirits after bottling) state
  alcohol content at time of bottling: `"Bottled at ____ percent alcohol by volume."` (27 CFR 5.65(a)).

**Rules on "Proof" — 27 CFR 5.65(b)(1)(i):**

- Proof is **never** the mandatory statement. ABV is. Degrees of proof are **optional additional**
  information.
- A degrees-of-proof statement **may** appear "as long as it appears in the same field of vision as the
  mandatory statement of alcohol content as a percentage of alcohol by volume."
- **Additional** proof statements may appear elsewhere on the label without the same-field-of-vision
  constraint (27 CFR 5.65(b)(1)(i), second sentence).
- Other truthful representations (e.g. alcohol by weight) are permitted only "together with, and as part
  of," the ABV statement (27 CFR 5.65(b)(1)(ii)).
- Conversion is the standard 1 % ABV = 2 degrees proof, evidenced in the regulations: "48 degrees of proof
  (24 percent alcohol by volume)" and "50 percent alcohol by volume (100 degrees of proof)"
  (27 CFR 5.1, definition of *Distilled spirits*; 27 CFR 5.143).
- `"produced at"` / `"distilled at"` with a specific proof mean composite proof **after distillation and
  before reduction in proof** (27 CFR 5.1).
- **"Barrel proof" / "cask strength"** may be used only when bottling proof is **not more than two degrees
  lower** than the proof when dumped from the barrels (27 CFR 5.87(a)). **"Original proof," "original
  barrel proof," "original cask strength," "entry proof"** require barrel-entry proof and bottling proof
  to be **the same** (27 CFR 5.87(b)).

**Minimum type size (all mandatory info) — 27 CFR 5.53:** 2 mm on containers of more than 200 mL;
1 mm on containers of 200 mL or less.

### 2.2 Wine — 27 CFR part 4

**Tolerances — 27 CFR 4.36(b)(1)** (direct statement of a single percentage):

| Wine | Tolerance, above or below the stated percentage |
|---|---|
| More than 14% ABV | **1 percent** |
| 14% ABV or less | **1.5 percent** |

**Tolerances — 27 CFR 4.36(b)(2)** (range statement, `"Alcohol __ % to __ % by volume"`):

| Wine | Maximum permitted range between minimum and maximum |
|---|---|
| More than 14% ABV | **2 percent** |
| 14% ABV or less | **3 percent** |

For range statements, "**no tolerances will be permitted either below such minimum or above such
maximum**" (27 CFR 4.36(b)(2)). The range endpoints are hard limits.

**The overriding constraint — 27 CFR 4.36(c).** This is the rule that actually decides borderline cases,
and it defeats the tolerance:

> "Regardless of the type of statement used and regardless of tolerances normally permitted ... alcoholic
> content statements, whether required or optional, shall definitely and correctly indicate the class,
> type and taxable grade of the wine so labeled..."

and nothing authorises a range that "overlaps a prescribed limitation on the alcoholic content of any
class, type, or taxable grade," nor a direct statement indicating the wine is within such a limitation
"when in fact it is not" (27 CFR 4.36(c)). **A tolerance may never be used to carry a wine across the
14% taxable-grade boundary or a class/type limit.**

**Mandatory or optional — 27 CFR 4.36(a):**

- **Mandatory** for wine containing **more than 14% ABV**.
- For wine at **14% or less**, the statement **may** be given but **need not** be, provided the type
  designation **"table" wine (or "light" wine)** appears on the brand label as prescribed in
  27 CFR 4.32(a)(2).

**How it must be expressed — 27 CFR 4.36(b):** "in terms of percentage of alcohol by volume, **and not
otherwise**." Format `"Alcohol __ % by volume"` or similar appropriate phrase; if abbreviated, `alcohol`
must be shown as `alc.`/`alc` and `volume` as `vol.`/`vol` (27 CFR 4.36(b)(1)).

**Type size for wine ABV — 27 CFR 4.38(b)(3):** the alcoholic content statement must be **no larger or
more conspicuous than 3 mm and no smaller than 1 mm** on containers of 5 litres or less, and must **not be
set off with a border or otherwise accentuated**. Note this is a *maximum as well as a minimum*, and it is
an explicit carve-out from the general 2 mm / 1 mm rule for other mandatory wine information
(27 CFR 4.38(b)(1), 4.38(b)(2)).

### 2.3 Malt beverages — 27 CFR part 7

**Tolerance — 27 CFR 7.65(c):**

> "a tolerance of **0.3 percentage points** will be permitted, either above or below the stated alcohol
> content, for malt beverages containing 0.5 percent or more alcohol by volume."

With two carve-outs in the same paragraph:

- **Hard floor:** "any malt beverage that is labeled as containing 0.5 percent or more alcohol by volume
  may not contain less than 0.5 percent alcohol by volume, **regardless of any tolerance**"
  (27 CFR 7.65(c)).
- The tolerance does **not** apply when determining compliance with 27 CFR 7.5 (percentage of alcohol
  derived from added nonbeverage flavours/ingredients) (27 CFR 7.65(c)).

**Additional no-tolerance / hard-limit cases:**

| Term | Rule | Citation |
|---|---|---|
| "low alcohol" / "reduced alcohol" | Only under 2.5% ABV; actual ABV may not equal or exceed 2.5%, **regardless of any tolerance** | 27 CFR 7.65(d) |
| "non-alcoholic" | Must be immediately adjacent to "contains less than 0.5 percent (or .5%) alcohol by volume"; **no tolerances permitted** | 27 CFR 7.65(e) |
| "alcohol free" | Only for malt beverages containing **no** alcohol; **no tolerances permitted** | 27 CFR 7.65(f) |
| "0.0 percent alcohol by volume" | May not be labelled as such unless also labelled "alcohol free" and containing no alcohol | 27 CFR 7.65(e) |

**Mandatory or optional — this is the asymmetric one.** Alcohol content on a malt beverage label is
**optional by default**:

> "Alcohol content and the percentage and quantity of the original gravity or extract **may** be stated on
> any malt beverage label, **unless prohibited by State law**." (27 CFR 7.65(a))

It becomes **mandatory** only where the malt beverage "contain[s] any alcohol derived from added
nonbeverage flavors or other added nonbeverage ingredients (other than hops extract) containing alcohol"
(27 CFR 7.63(a)(3)) — i.e. flavoured malt beverages. State law may also compel or dictate the manner of
the statement (27 CFR 7.65(a)).

**Precision — 27 CFR 7.65(b)(2):** for malt beverages at 0.5% ABV or more, the statement must be expressed
**to the nearest one-tenth of a percentage point**. Below 0.5% ABV, either one-tenth or one-hundredth, and
such statements are **not subject to any tolerance**.

**Format — 27 CFR 7.65(b)(3)(i):** `"Alcohol ___ percent by volume"`, `"___ percent alcohol by volume"`, or
`"Alcohol by volume: ___ percent."` Same abbreviations as spirits (27 CFR 7.65(b)(4)). Regulation's own
examples (27 CFR 7.65(b)(5)): `4.2% alc/vol`, `Alc. 4.0 percent by vol.`, `Alc 4% by vol`,
`5.9% Alcohol by Volume.`

**Type size — 27 CFR 7.53.** Malt beverages uniquely have a **maximum** as well as a minimum:

| | Rule | Citation |
|---|---|---|
| Minimum, containers > 1/2 pint | 2 mm | 27 CFR 7.53(a)(1) |
| Minimum, containers ≤ 1/2 pint | 1 mm | 27 CFR 7.53(a)(2) |
| Maximum ABV statement, containers > 40 fl. oz. | 4 mm | 27 CFR 7.53(b)(1) |
| Maximum ABV statement, containers ≤ 40 fl. oz. | 3 mm | 27 CFR 7.53(b)(2) |

The maxima apply to the alcohol content statement "whether required or optional" (27 CFR 7.53(b)).

### 2.4 Tolerance constants — summary

| Commodity | Tolerance | Citation |
|---|---|---|
| Distilled spirits | ± 0.3 percentage points | 27 CFR 5.65(c) |
| Wine, > 14% ABV (direct statement) | ± 1 percent | 27 CFR 4.36(b)(1) |
| Wine, ≤ 14% ABV (direct statement) | ± 1.5 percent | 27 CFR 4.36(b)(1) |
| Wine, > 14% ABV (range statement) | 2 percent max span, no tolerance beyond endpoints | 27 CFR 4.36(b)(2) |
| Wine, ≤ 14% ABV (range statement) | 3 percent max span, no tolerance beyond endpoints | 27 CFR 4.36(b)(2) |
| Malt beverage, ≥ 0.5% ABV | ± 0.3 percentage points | 27 CFR 7.65(c) |
| Malt beverage, < 0.5% ABV | none | 27 CFR 7.65(b)(2) |
| Malt beverage "non-alcoholic" / "alcohol free" | none | 27 CFR 7.65(e), 7.65(f) |

**All tolerances are subject to a class/type override.** Wine: 27 CFR 4.36(c). Spirits and malt: a change
in ABV must remain "consistent with the labeled class and type designation, and all other labeling
statements" (TTB F 5100.31, allowable revision item 11) — e.g. a product designated "rum" cannot be stated
below 40% ABV (TTB F 5100.31 item 11, Comments; standards of identity at 27 CFR 5.141-5.166).

---

## 3. Net Contents and Standards of Fill

### 3.1 Distilled spirits — 27 CFR 5.203

**Standards of fill are mandatory**, not merely available: no distiller, rectifier, importer, wholesaler,
bottler or warehouseman-bottler may introduce distilled spirits into interstate or foreign commerce, or
remove them from customs custody for consumption, "unless the distilled spirits are bottled in conformity
with §§ 5.202 and 5.203" (27 CFR 5.201).

**Authorized metric standards of fill, domestic and imported alike — 27 CFR 5.203(a)(1)-(a)(25):**

```
3.75 L, 3 L, 2 L, 1.8 L, 1.75 L, 1.5 L, 1.00 L,
945 mL, 900 mL, 750 mL, 720 mL, 710 mL, 700 mL, 570 mL, 500 mL,
475 mL, 375 mL, 355 mL, 350 mL, 331 mL, 250 mL, 200 mL, 187 mL, 100 mL, 50 mL
```

25 sizes. **Current as amended by T.D. TTB-200, 90 FR 1868, January 10, 2025** — this rule *added* many of
these (notably 945, 900, 720, 710, 570, 475, 355, 350, 331 and 250 mL). Older reference material and
pre-2025 cached lists are wrong; do not seed the app from them.

**Exceptions — 27 CFR 5.203(b):** imported spirits in original containers entered into customs custody
before January 1, 1980; and imported spirits bottled or packed before January 1, 1980 with a signed
foreign-government certification.

**How net contents must be expressed — 27 CFR 5.70(a):**

- Metric is the governing statement.
- `liter` may be spelled `litre` or abbreviated `L`.
- `milliliters` may be abbreviated `ml.`, `mL.`, or `ML.`
- U.S. customary equivalents and other metric equivalents (e.g. centiliters) **may** appear, and **if
  used, must appear in the same field of vision as the metric net contents statement**.
- Net contents may be blown, embossed or moulded into the container instead of printed on a label
  (27 CFR 5.63(b)(2)).

**Fill tolerances — 27 CFR 5.70(b)(1):** no numeric tolerance. Three qualitative allowances only —
errors in measuring under good commercial practice (5.70(b)(1)(i)); differences in container capacity from
unavoidable manufacturing difficulty (5.70(b)(1)(ii)); differences in atmospheric conditions including
ordinary evaporation, reasonableness judged case by case (5.70(b)(1)(iii)). A shortage in some containers
**may not** be offset against an overage in others in the same shipment (27 CFR 5.70(b)(2)).

### 3.2 Wine — 27 CFR 4.72

**Standards of fill are mandatory** for wine within scope: no producer, rectifier, blender, importer or
wholesaler may introduce wine into interstate or foreign commerce or remove it from customs custody
"unless such wine is bottled or packed in the standard wine containers herein prescribed"
(27 CFR 4.70(a)).

**Authorized metric standards of fill — 27 CFR 4.72(a)(1)-(a)(25):**

```
3 L, 2.25 L, 1.8 L, 1.5 L, 1 L,
750 mL, 720 mL, 700 mL, 620 mL, 600 mL, 568 mL, 550 mL, 500 mL, 473 mL,
375 mL, 360 mL, 355 mL, 330 mL, 300 mL, 250 mL, 200 mL, 187 mL, 180 mL, 100 mL, 50 mL
```

25 sizes. Also amended by **T.D. TTB-200 (2025)**.

**Above 3 litres — 27 CFR 4.72(b):** wine may be bottled or packed in containers of **4 litres or larger**
if filled and labelled in **even litres** (4 L, 5 L, 6 L, etc.).

**Scope exclusions — 27 CFR 4.70(b):** §§ 4.71 and 4.72 do **not** apply to **sake** (4.70(b)(1)); wine
packed in containers of **18 litres or more** (4.70(b)(2)); certain pre-1979 imported wine
(4.70(b)(3), 4.70(b)(4)); and certain wine bottled before October 24, 1943 (4.70(b)(5)).

**Fill tolerance — 27 CFR 4.72(c):** "The tolerances in fill are the same as are allowed by § 4.37 in
respect to statement of net contents on labels" — i.e. the same three qualitative allowances, no numeric
figure (27 CFR 4.37(d)(1)-(3)). Unreasonable shortages may not be compensated by overages in the same
shipment (27 CFR 4.37(e)).

**Headspace — 27 CFR 4.71(a)(3):** ≥187 mL labelled net contents, headspace must not exceed **6%** of total
capacity after closure (4.71(a)(3)(i)); <187 mL, not more than **10%** (4.71(a)(3)(ii)); wine in **clear**
containers with contents clearly visible and labelled net contents of **100 mL or less**, not more than
**30%** (4.71(a)(3)(iii)).

**How net contents must be expressed — 27 CFR 4.37(a):**

- For a wine with a prescribed standard of fill, net contents must be stated "in the same manner and form
  as set forth in the standard of fill" (27 CFR 4.37(a)).
- Where no standard of fill is prescribed: metric — **more than one litre** stated in litres and decimal
  portions **accurate to the nearest one-hundredth of a litre** (4.37(a)(1)); **less than one litre**
  stated in **millilitres (ml)** (4.37(a)(2)).
- U.S. equivalents are **optional**; if shown they must follow the conversion table at
  27 CFR 4.37(b)(1) (e.g. 750 mL = 25.4 fl. oz.; 1 L = 33.8 fl. oz.; 3 L = 101 fl. oz.; 473 mL = 16 fl. oz.;
  355 mL = 12.0 fl. oz.). Under 100 fl. oz. → nearest tenth (4.37(b)(2)); 100 fl. oz. or more → nearest
  whole ounce (4.37(b)(3)).
- Net contents need not be on a label at all if permanently marked into the bottle (blown, etched,
  sand-blasted, underglaze colouring, or another approved method) and plainly legible (27 CFR 4.37(c)).
- Placement wrinkle: if the net contents is a **non-authorised** standard of fill, the statement must
  appear on a label affixed to the **front** of the bottle (27 CFR 4.32(b)(2)).

### 3.3 Malt beverages — no standards of fill

**There is no standards-of-fill provision anywhere in 27 CFR part 7.** Confirmed by full-text search of
the part 7 XML: the phrase "standard of fill" does not occur, and part 7 contains no container/fill subpart
analogous to 27 CFR part 5 subpart I or part 4 subpart E. Malt beverages may be packaged in any size.

**How net contents must be expressed — 27 CFR 7.70(a).** Malt beverages are the odd one out: **U.S.
customary units govern, not metric.**

| Volume | Required expression | Citation |
|---|---|---|
| Less than one pint | fluid ounces, or fractions of a pint | 27 CFR 7.70(a)(1) |
| Exactly one pint, one quart, or one gallon | stated as such | 27 CFR 7.70(a)(2) |
| More than 1 pint, less than 1 quart | fractions of a quart, or pints and fluid ounces | 27 CFR 7.70(a)(3) |
| More than 1 quart, less than 1 gallon | fractions of a gallon, or quarts, pints and fluid ounces | 27 CFR 7.70(a)(4) |
| More than one gallon | gallons and fractions thereof | 27 CFR 7.70(a)(5) |

- All fractions must be expressed in their **lowest denominations** (27 CFR 7.70(b)).
- Metric measures "may be used **in addition to, but not in lieu of**, the U.S. customary units of
  measurement and must appear in the same field of vision" (27 CFR 7.70(c)).
- Net contents may be blown, embossed or moulded into the container (27 CFR 7.63(a)(5)).

---

## 4. Mandatory Label Fields by Beverage Type

`R` = required · `C` = conditionally required · `O` = optional / not TTB-mandated

| Field | Distilled spirits | Wine | Malt beverage |
|---|---|---|---|
| **Brand name** | **R** — 27 CFR 5.63(a)(1), 5.64(a) | **R** — 27 CFR 4.32(a)(1), 4.33(a) | **R** — 27 CFR 7.63(a)(1), 7.64(a) |
| **Class / type / other designation** | **R** — 27 CFR 5.63(a)(2) (subpart I, 5.141-5.166) | **R** — 27 CFR 4.32(a)(2), 4.34 | **R** — 27 CFR 7.63(a)(2) (subpart I, 7.141-7.147) |
| **Alcohol content** | **R** always — 27 CFR 5.63(a)(3), 5.65 | **C** — required >14% ABV; optional ≤14% if "table"/"light" on brand label — 27 CFR 4.32(b)(3), 4.36(a) | **C** — required only for malt beverages with alcohol from added nonbeverage flavours/ingredients other than hops extract — 27 CFR 7.63(a)(3); otherwise optional unless State law requires — 27 CFR 7.65(a) |
| **Net contents** | **R** — 27 CFR 5.63(b)(2), 5.70 | **R** — 27 CFR 4.32(b)(2), 4.37 | **R** — 27 CFR 7.63(a)(5), 7.70 |
| **Name & address — domestic bottler / distiller / producer** | **R** — 27 CFR 5.63(b)(1), 5.66 | **R** ("bottled by"/"packed by" + name + address) — 27 CFR 4.32(b)(1), 4.35(a)(1) | **R** — 27 CFR 7.63(a)(4), 7.66 |
| **Name & address — importer** | **R** "imported by" or similar + importer name/address — 27 CFR 5.63(b)(1), 5.68(b) | **R** "imported by" or similar + name + U.S. principal place of business — 27 CFR 4.35(b)(1)(i) | **R** "imported by" or similar + importer name/address — 27 CFR 7.63(a)(4), 7.68(b) |
| **Country of origin (imports)** | **Not independently TTB-mandated** — cross-referenced to CBP — 27 CFR 5.69 | **Not independently TTB-mandated** — cross-referenced to CBP — 27 CFR 4.35(e); "product of" + country per customs requirements referenced at 27 CFR 4.38(c) | **Not independently TTB-mandated** — cross-referenced to CBP — 27 CFR 7.69 |
| **Health warning statement** | **R** — 27 CFR 16.21 | **R** — 27 CFR 16.21 | **R** — 27 CFR 16.21 |
| **FD&C Yellow No. 5** | **C** — 27 CFR 5.63(c)(5) | **C** — 27 CFR 4.32(c) | **C** — 27 CFR 7.63(b)(1) |
| **Cochineal extract / carmine** | **C** — 27 CFR 5.63(c)(6) | **C** — 27 CFR 4.32(d) | **C** — 27 CFR 7.63(b)(2) |
| **Sulfites (≥10 ppm)** | **C** — 27 CFR 5.63(c)(7) | **C** — 27 CFR 4.32(e) | **C** — 27 CFR 7.63(b)(3) |
| **Aspartame** (all caps, separate and apart) | **C** — 27 CFR 5.63(c)(8) | not specified in part 4 | **C** — 27 CFR 7.63(b)(4) |
| **Neutral spirits / name of commodity** | **C** — 27 CFR 5.63(c)(1), 5.71 | n/a | n/a |
| **Colouring / treatment with wood** | **C** — 27 CFR 5.63(c)(2), 5.72, 5.73 | n/a | n/a |
| **Age statement** | **C** — 27 CFR 5.63(c)(3), 5.74 | n/a | n/a |
| **State of distillation** (certain whiskies) | **C** — 27 CFR 5.63(c)(4), 5.66(f) | n/a | n/a |
| **Appellation of origin** | n/a | **C** — required with varietal, varietal-significance, semi-generic, "Brand"-qualified, or vintage labelling — 27 CFR 4.34(b)(1)-(5) | n/a |

### 4.1 Country of origin — important nuance

Post-modernisation, **TTB does not itself impose a country-of-origin statement** on spirits or malt
beverages. 27 CFR 5.69 and 27 CFR 7.69 both consist solely of a cross-reference:

> "For U.S. Customs and Border Protection (CBP) rules regarding country of origin marking requirements,
> see the CBP regulations at 19 CFR parts 102 and 134."

Wine does the same at 27 CFR 4.35(e). The operative obligation therefore lives in CBP's rules: every
article of foreign origin (or its container) must be marked conspicuously, legibly, indelibly and
permanently with the **English name of the country of origin**, so as to indicate it to an ultimate
purchaser in the United States, unless excepted (19 CFR 134.11, implementing section 304, Tariff Act of
1930, as amended, 19 U.S.C. 1304).

**Implication for the tool:** country of origin should be treated as an **advisory/informational** check
for spirits and malt beverages, not a TTB pass/fail rule, because no TTB regulation prescribes its
wording, placement or type size.

### 4.2 Placement — the three regimes differ

| | Rule | Citation |
|---|---|---|
| Spirits | Brand name + class/type + alcohol content must be in the **same field of vision**; name/address and net contents may be **anywhere** on the container | 27 CFR 5.63(a), 5.63(b) |
| Wine | Brand name + class/type must be on the **brand label**; name/address, net contents and alcohol content may be on **any label affixed to the container** | 27 CFR 4.32(a), 4.32(b) |
| Malt | **No field-of-vision or brand-label constraint** — all mandatory items need only appear on "a label or labels" | 27 CFR 7.63(a) |

### 4.3 Legibility and contrast — general

| | Rule | Citation |
|---|---|---|
| Spirits | Readily legible; mandatory info (except brand names) separate and apart; contrasting colour | 27 CFR 5.52(a), 5.52(b), 5.52(c) |
| Wine | Readily legible; all statements on a contrasting background | 27 CFR 4.38(a) |
| Malt | Readily legible; mandatory info (except brand names) separate and apart; contrasting colour | 27 CFR 7.52(a), 7.52(b), 7.52(c) |

Acceptable contrast examples given by the regulations: black on white or cream, or white or cream on black
(27 CFR 5.52(c)(1)-(2); 27 CFR 7.52(c)(1)-(2)).

**English language:** wine mandatory information must be in English, except brand name, place of
production and the name of the manufacturer/producer/blender/bottler/packer/shipper, if "product of"
immediately precedes the country of origin (27 CFR 4.38(c)). Spirits and malt have parallel language
requirements at 27 CFR 5.55 and 27 CFR 7.55.

---

## 5. Brand Name and Class/Type — Correspondence with the Application

### 5.1 What a COLA actually authorises

The controlling standard is **"identical, or with authorised changes"** — not "byte-identical artwork":

> "An approved TTB Form 5100.31 authorizes the bottling of distilled spirits covered by the certificate of
> label approval (COLA), **as long as the container bears labels identical to the labels appearing on the
> face of the COLA, or labels with changes authorized by TTB on the COLA or otherwise (such as through the
> issuance of public guidance available on the TTB website** at https://www.ttb.gov)."

**Citation:** 27 CFR 5.22(a). The definition of *Certificate of label approval* in 27 CFR 13.11 says the
same for all three commodities: labels "identical to the labels affixed to the face of the certificate,
**or labels with changes authorized by the certificate**."

The phrase "or otherwise (such as through the issuance of public guidance available on the TTB website)"
in 27 CFR 5.22(a) is what gives TTB's published allowable-revisions list regulatory effect. It is not
merely informal guidance.

### 5.2 Case differences are expressly immaterial

**Two independent bases.**

**(a) The regulation itself, for spirits and malt beverages — 27 CFR 5.52(d):**

> "**Capitalization.** Except for the aspartame statement when required by § 5.63(c)(8), which must appear
> in all capital letters, mandatory information prescribed by this part **may appear in all capital
> letters, in all lower case letters, or in mixed-case using both capital and lower-case letters.**"

Identical provision for malt beverages at **27 CFR 7.52(d)**. The brand name **is** mandatory information
(27 CFR 5.63(a)(1); 27 CFR 7.63(a)(1)), so its capitalisation is unconstrained.

**(b) TTB's allowable-revisions list, for all three commodities.** Item 3.b of the list on pages 3-4 of
TTB Form 5100.31 (rev. 04/2023) — marked **YES for wine, YES for distilled spirits, YES for malt
beverage** — permits, without any new COLA:

> "**3.b.** Change the type size and font, and make appropriate changes to the spelling (including
> punctuation marks, **changing letters from upper case to lower case and vice versa**, and abbreviations)
> of words, in [compliance with the regulations]."

with the accompanying Comments for item 3: "All changes must comply with applicable regulations, and
changes in spelling **must not change the meaning** of the previously approved information. All mandatory
information must be readily legible and appear on a contrasting background."

**Conclusion — the STONE'S THROW case.** `STONE'S THROW` on the label versus `Stone's Throw` in the
application is **the same brand name and must not be failed**. Basis: 27 CFR 5.52(d) / 7.52(d) (case of
mandatory information is at the labeller's option) and TTB F 5100.31 item 3.b (upper↔lower case is an
allowable revision requiring no new COLA). **Compare brand name case-insensitively.**

The senior agent's instruction is correct and is regulation-backed, not merely a pragmatic concession.

### 5.3 Stylised typography is acceptable

Item **3.a** of the same list permits changing "the color(s) (background and text), shape and
proportionate size of labels," and item **3.b** permits changing "the type size and font." Items 3.d and
3.e permit dividing one approved label into multiple labels on a container, or combining separately
approved labels into one, subject to placement rules. All are marked YES for all three commodities
(TTB F 5100.31 (04/2023), item 3.a-3.e).

The only typographic constraints that survive are the substantive ones:

- Readily legible under ordinary conditions and on a contrasting background — 27 CFR 5.52(a), 5.52(c);
  4.38(a); 7.52(a), 7.52(c).
- Minimum type size — 27 CFR 5.53; 4.38(b); 7.53(a). Plus the wine ABV **maximum** (3 mm, 27 CFR 4.38(b)(3))
  and the malt ABV **maximum** (4 mm / 3 mm, 27 CFR 7.53(b)).
- The health warning's own type rules — 27 CFR 16.22.
- No compression of the health warning — 27 CFR 16.22(a)(3).

**Implication:** a decorative or stylised rendering of the brand name is not a compliance defect. Normalise
whitespace and case; do not penalise font, colour, size, label shape or arrangement.

### 5.4 What genuinely does require a new COLA

TTB states plainly that a new COLA is required when **changing**:

- the class/type statement
- **the brand name**
- the appellation of origin (wine only)
- the mandatory address statement (unless the new address is in the same State as the old address)
- the actual bottler or importer

and when **changing or adding**: new graphics/pictures/representations (except as specifically
authorised, e.g. holiday-themed graphics), and new wording/phrases/text/certifications (except as
specifically authorised, e.g. approved serving instructions).

**Citation:** TTB, "Allowable Changes Sample Label Generator" / "List of Allowable Changes to Approved
Labels," ttb.gov; and TTB F 5100.31 (04/2023) item 19 Comments, which states: "If the name or trade name
is also used as the brand name on the label, **resulting in a change of brand name, you must submit a new
application.**"

So the boundary the tool must implement is: **a change of brand name identity requires a new COLA; a
change in how that identical name is typeset, cased, punctuated or coloured does not.**

### 5.5 Brand name substantive rules

| | Rule | Citation |
|---|---|---|
| Spirits | Label must include a brand name; if not sold under one, the bottler/distiller/importer name in the name-and-address statement **is** the brand name | 27 CFR 5.64(a) |
| Wine | Same construction | 27 CFR 4.33(a) |
| Malt | Same construction | 27 CFR 7.64(a) |
| All | Brand name may not be misleading — must not create any erroneous impression or inference as to **age, origin, identity, or other characteristics**; may be cured by qualifying with "brand" or another qualification if the appropriate TTB officer so determines | 27 CFR 5.64(b); 4.33(b); 7.64(b) |
| Wine only | Preserved rights in certain pre-1935 foreign trade names, subject to locality qualification | 27 CFR 4.33(c) |
| Spirits, wine, malt | Trade or operating name on the label must be **identical with a name appearing on the basic permit** or other qualifying document | 27 CFR 4.35(d); 5.68(e); 5.66(d)(1) (address consistency); 7.68(b)(2) |

**Note the asymmetry:** the "identical with a name appearing on the basic permit" test at 27 CFR 4.35(d)
applies to the **trade/operating name in the name-and-address statement**, not to the brand name. There is
no regulation requiring the brand name to be identical to anything on the permit.

### 5.6 Class/type latitude

Class/type is materially stricter than brand name. It is a controlled vocabulary, not free text:

- Spirits: designations are prescribed by the standards of identity, 27 CFR 5.141 through 5.166; a product
  not falling in a defined class/type requires a statement of composition (27 CFR 5.156, 5.166).
- Wine: class must be stated in conformity with subpart C; if the class is not defined there, "a truthful
  and adequate statement of composition shall appear upon the brand label ... in lieu of a class
  designation" (27 CFR 4.34(a)). **All parts of the designation, mandatory or optional, must be "in direct
  conjunction and in lettering substantially of the same size and kind"** (27 CFR 4.34(a)) — this is a
  real typographic constraint specific to wine class/type.
- Malt: 27 CFR 7.141 through 7.147.
- A change to the class/type statement always requires a new COLA (TTB guidance, §5.4 above); and item 13
  (neutral spirits percentage) and item 14 (age statements) of TTB F 5100.31 are allowable **only** if
  they "must not result in a change to the class or type designation."

---

## Gaps and Uncertainties

Documented honestly rather than guessed. Each of these should be treated as a place where the tool must
either abstain, flag for human review, or make an explicitly-labelled policy choice.

1. **Wine has no capitalisation regulation.** 27 CFR part 4 contains **no** provision analogous to
   27 CFR 5.52(d) or 7.52(d). A full-text search of the part 4 XML for "capital" returns zero hits. For
   *wine*, the conclusion that case is immaterial therefore rests solely on TTB F 5100.31 item 3.b (which
   is marked YES for wine) and on 27 CFR 4.50 / 13.11's "identical or with authorized changes" standard —
   not on the text of part 4 itself. The conclusion is the same; the legal footing is thinner. Worth
   noting if the tool is ever challenged on a wine COLA.

2. **"1 percent" vs "1 percentage point" in 27 CFR 4.36(b)(1).** The wine tolerance is written as "a
   tolerance of 1 percent" and "1.5 percent," not "1 percentage point." Read literally as a *relative*
   tolerance, 1% of a 15% ABV wine would be 0.15 points; read as *percentage points* it is 1.00 point.
   Industry and TTB practice read these as **percentage points**, and the parallel construction in
   4.36(b)(2) ("a range of not more than 2 percent ... between the minimum and maximum percentages") only
   makes sense as percentage points. **I could not locate a TTB regulation or ruling that states this
   explicitly**, so it is an interpretation, not a verified citation. Contrast 27 CFR 5.65(c) and
   7.65(c), which say "percentage points" unambiguously. Recommend implementing as percentage points and
   documenting the assumption in code.

3. **Which wine tolerance band applies is ambiguous.** 27 CFR 4.36(b)(1) keys the band to "wines
   *containing* more than 14 percent" — i.e. the **actual** ABV — while the tolerance is measured against
   the **stated** percentage. When the label says 14.0% and the actual is 14.4%, it is not textually clear
   whether the ±1.5 or the ±1.0 band applies. In practice 27 CFR 4.36(c) resolves most such cases by
   forbidding any statement that misrepresents the taxable grade, but the band-selection question itself
   is unresolved on the face of the regulation. **Recommend flagging for human review rather than
   auto-failing anything within 1.5 points of the 14% boundary.**

4. **No numeric fill tolerance exists.** Neither 27 CFR 5.70(b) nor 27 CFR 4.37(d) gives a number. Both
   give only qualitative allowances ("good commercial practice," "unavoidable difficulties,"
   "reasonableness ... determined on the facts in each case"). **A deterministic net-contents fill check
   is not possible from the CFR.** The tool can verify that the *declared* size is an authorised standard
   of fill; it cannot verify actual fill.

5. **The health warning's "not bold" rule is not machine-checkable from a transcription.**
   27 CFR 16.22(a)(2) requires "GOVERNMENT WARNING" in bold and forbids the remainder from appearing in
   bold. A vision transcription typically does not carry reliable font-weight information. Likewise
   16.22(a)(1) contrast, 16.22(a)(3) compression, 16.22(a)(4) characters-per-inch and 16.22(b) millimetre
   type sizes all require physical measurement against a known container size. **Treat all of 16.22 as
   advisory/manual-review, and restrict the deterministic check to the 16.21 text itself.**

6. **Case of the warning body is unconstrained by the text.** 16.22(a)(2) constrains the *weight* of the
   remainder, not its *case*. Nothing in part 16 forbids setting the body of the warning in capitals.
   I found no TTB ruling resolving this. **Recommend case-insensitive comparison of the body, with an
   uppercase requirement enforced only on the two words `GOVERNMENT WARNING`** — and flagging, not
   failing, an all-caps body.

7. **Warning whitespace and line breaks are unspecified.** eCFR renders 16.21 as two paragraphs; the
   statute at 27 U.S.C. 215 renders it as one continuous string. No regulation prescribes where line
   breaks fall on a physical label. **Normalise whitespace before diffing.** Do not treat a line break
   between `defects.` and `(2)` as a defect.

8. **eCFR internal citation error at 27 CFR 4.72.** The source note on § 4.72 reads "T.D. TTB-200, 90 FR
   1875, **Jan. 20, 2025**," while the notes on § 4.37 and § 5.203 read "Jan. 10, 2025." The Federal
   Register API confirms T.D. TTB-200, "Standards of Fill for Wine and Distilled Spirits," was published
   **2025-01-10** at 90 FR 1868. The "Jan. 20" in § 4.72 is an error in the eCFR itself. Immaterial to the
   substance; noted so nobody chases it.

9. **The published count of allowable revisions is stale on TTB's website.** TTB's web copy states there
   are "34 allowable revisions." The current form, **TTB F 5100.31 (04/2023)**, actually enumerates
   **items 1 through 40** (with item 3 subdivided 3.a-3.e). Always read the count from the form, not the
   web page.

10. **Country of origin is out of TTB's hands.** 27 CFR 5.69, 7.69 and 4.35(e) are pure cross-references
    to 19 CFR parts 102 and 134. I verified the general CBP obligation at 19 CFR 134.11 but did **not**
    work through the 19 CFR part 134 exceptions (subpart D), the part 102 rules of origin, or how CBP
    marking interacts with the COLA form's country field. **If the app checks country of origin, that
    logic needs separate CBP research.**

11. **State law is outside the CFR.** 27 CFR 7.65(a) makes malt beverage alcohol content statements
    turn on State law ("unless prohibited by State law," "the manner of statement is not required under
    State law"), and allowable revision item 16 covers State-mandated statements. **Fifty-plus State
    regimes are not in scope of this research and cannot be resolved from the CFR.** Any malt beverage ABV
    mandatory/optional determination is therefore jurisdiction-dependent.

12. **Pending rulemaking could add mandatory fields.** TTB published NPRMs on **Alcohol Facts statements**
    and **major food allergen labeling** for wine, distilled spirits and malt beverages on January 17,
    2025, with the comment period extended through August 15, 2025. **As of the 2026-08-25 eCFR snapshot
    used here, neither has been finalised into 27 CFR parts 4, 5, 7 or 16**, and the mandatory-field
    matrix above reflects current law only. I did **not** verify the post-comment status of these
    proceedings; re-check before relying on the matrix long-term.

13. **No change to 27 CFR 16.21 was found**, but I searched only ttb.gov and federalregister.gov. The
    eCFR snapshot of part 16 (up to date 2026-08-25) still carries the 1990 text as amended through
    T.D. TTB-196 (Nov. 6, 2024), which touched only § 16.33 penalties. Given ongoing public discussion
    about alcohol and cancer warnings, **re-verify § 16.21 against the eCFR before each release** rather
    than hard-coding it once and forgetting it.

14. **Distinctive liquor bottles are an unhandled special case.** 27 CFR 5.205(b)(2) exempts certain
    distinctive liquor bottles from the placement requirements for certain mandatory information
    (cross-referenced at 27 CFR 5.63(d)). Field-of-vision checks under 5.63(a) may not apply to such
    bottles. Not researched further.

15. **Personalised labels** (27 CFR 5.29, 4.54, 7.29) permit certain per-customer variations under a
    single COLA. Not researched in detail; may matter if the app processes personalised-label COLAs.

---

## Sources

All CFR text retrieved from the eCFR versioner API as raw XML, Title 27 up to date as of **2026-08-25**.

**eCFR — primary regulatory text**

- 27 CFR part 16 (Alcoholic Beverage Health Warning Statement) — https://www.ecfr.gov/current/title-27/chapter-I/subchapter-A/part-16
- 27 CFR part 4 (Labeling and Advertising of Wine) — https://www.ecfr.gov/current/title-27/chapter-I/subchapter-A/part-4
- 27 CFR part 5 (Labeling and Advertising of Distilled Spirits) — https://www.ecfr.gov/current/title-27/chapter-I/subchapter-A/part-5
- 27 CFR part 7 (Labeling and Advertising of Malt Beverages) — https://www.ecfr.gov/current/title-27/chapter-I/subchapter-A/part-7
- 27 CFR part 13 (Labeling Proceedings) — https://www.ecfr.gov/current/title-27/chapter-I/subchapter-A/part-13
- 19 CFR 134.11 (CBP country of origin marking) — https://www.ecfr.gov/current/title-19/chapter-I/part-134/subpart-B/section-134.11

**eCFR API endpoints actually used (raw XML, reproducible)**

- `https://www.ecfr.gov/api/versioner/v1/full/2026-08-25/title-27.xml?part=16`
- `https://www.ecfr.gov/api/versioner/v1/full/2026-08-25/title-27.xml?part=4`
- `https://www.ecfr.gov/api/versioner/v1/full/2026-08-25/title-27.xml?part=5`
- `https://www.ecfr.gov/api/versioner/v1/full/2026-08-25/title-27.xml?part=7`
- `https://www.ecfr.gov/api/versioner/v1/full/2026-08-25/title-27.xml?part=13`
- `https://www.ecfr.gov/api/versioner/v1/full/2026-08-25/title-19.xml?part=134&subpart=B`
- `https://www.ecfr.gov/api/versioner/v1/titles.json` (currency check: `up_to_date_as_of: 2026-08-25`)

**Statute — used to cross-verify the health warning character-for-character**

- 27 U.S.C. 215 (Alcoholic Beverage Labeling Act of 1988) — https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title27-section215&num=0&edition=prelim
- 27 U.S.C. 215, govinfo — https://www.govinfo.gov/content/pkg/USCODE-2023-title27/html/USCODE-2023-title27-chap8-subchapII-sec215.htm
- 19 U.S.C. 1304 (section 304, Tariff Act of 1930) — referenced via 19 CFR 134.11

**TTB — forms and public guidance**

- TTB Form 5100.31 (rev. 04/2023), "Application For And Certification/Exemption Of Label/Bottle Approval" — allowable revisions list at pages 3-4 — https://www.ttb.gov/images/pdfs/forms/f510031.pdf
- TTB, "List of Allowable Changes to Approved Labels" — https://www.ttb.gov/regulated-commodities/labeling/allowable-revisions
- TTB, "Allowable Changes Sample Label Generator" — https://www.ttb.gov/regulated-commodities/labeling/allowable-revisions/allowable-changes-sample-label-generator

**Federal Register**

- T.D. TTB-200, "Standards of Fill for Wine and Distilled Spirits," 90 FR 1868, January 10, 2025 — https://www.federalregister.gov/documents/2025/01/10/2025-00271/standards-of-fill-for-wine-and-distilled-spirits
- "Alcohol Facts Statements ... and Major Food Allergen Labeling ...; Comment Period Extension" (pending, not final) — https://www.federalregister.gov/documents/2025/04/07/2025-05920/alcohol-facts-statements-in-the-labeling-of-wines-distilled-spirits-and-malt-beverages-and-major
