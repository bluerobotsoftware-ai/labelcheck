/**
 * Renders a verification report.
 *
 * The ordering is deliberate and reflects how an agent actually works: the
 * single recommendation first, then anything wrong, then everything that was
 * fine. Nobody needs to read a passing row, but they must not be hidden either
 * — an agent has to be able to confirm a check ran at all.
 *
 * Checks are grouped by what they were compared against, because those are two
 * genuinely different questions. "Does this match the paperwork?" is answered
 * by the application. "Is this legal?" is answered by the regulation, and the
 * applicant has no say in it.
 */

import type {
  CheckResult,
  DiffSegment,
  ImageQuality,
  VerificationReport,
} from "@/lib/ttb/types";
import { RECOMMENDATION_STYLES, VerdictBadge, VERDICT_STYLES } from "./verdict";

export function ReportView({ report }: { report: VerificationReport }) {
  const style = RECOMMENDATION_STYLES[report.recommendation];

  const matchChecks = report.checks.filter((c) => c.category === "match");
  const complianceChecks = report.checks.filter((c) => c.category === "compliance");
  const warningAltered = report.checks.some(
    (c) => c.id === "government_warning" && c.verdict === "fail" && c.rule === "warning-wording-altered",
  );

  return (
    <div className="space-y-6">
      <section
        className={`rounded-xl border-2 p-6 print-break-avoid ${style.background} ${style.border}`}
        aria-live="polite"
      >
        <div className="flex items-start gap-4">
          <span
            aria-hidden="true"
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 text-2xl font-bold ${style.border} ${style.text} bg-white`}
          >
            {style.glyph}
          </span>
          <div className="min-w-0">
            <h2 className={`text-2xl font-bold ${style.text}`}>{style.title}</h2>
            <p className="mt-1 text-[var(--color-ink)]">{report.headline}</p>
          </div>
        </div>

        <p className="mt-4 border-t border-current/20 pt-3 text-[15px] text-[var(--color-ink-soft)]">
          This is a recommendation, not a decision. A compliance agent signs off
          every application.
        </p>
      </section>

      <TimingBar report={report} />

      <ImageQualityPanel quality={report.imageQuality} />

      <CheckGroup
        title="Compared with the application"
        description="Does the artwork show what the applicant filed?"
        checks={matchChecks}
      />

      <CheckGroup
        title="Required by regulation"
        description="Does the label meet federal requirements, regardless of what was filed?"
        checks={complianceChecks}
      />

      {warningAltered && report.warningDiff && (
        <WarningDiffPanel diff={report.warningDiff} />
      )}

      {report.notes.length > 0 && (
        <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5 print-break-avoid">
          <h3 className="text-lg font-semibold">Other observations</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--color-ink-soft)]">
            {report.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * Response time, shown rather than hidden.
 *
 * TTB's previous vendor took 30-40 seconds and agents abandoned it. Making the
 * number visible on every single check is a standing claim that this one is
 * different, and an immediate signal if that ever stops being true.
 */
function TimingBar({ report }: { report: VerificationReport }) {
  const seconds = (report.timing.totalMs / 1000).toFixed(1);
  const withinBudget = report.timing.totalMs <= 5000;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-3 text-[15px]">
      <span className="font-semibold">
        Checked in {seconds} second{seconds === "1.0" ? "" : "s"}
        {withinBudget && (
          <span className="ml-2 font-normal text-[var(--color-pass)]">
            within the 5-second target
          </span>
        )}
      </span>
      <span className="text-[var(--color-ink-soft)]">
        Reading the label {(report.timing.extractionMs / 1000).toFixed(1)}s · Applying
        the rules {report.timing.rulesMs}ms
      </span>
      <span className="ml-auto font-mono text-[13px] text-[var(--color-ink-soft)]">
        {report.reader}
      </span>
    </div>
  );
}

function ImageQualityPanel({ quality }: { quality: ImageQuality }) {
  // A clean image needs no commentary; saying "image quality: fine" on every
  // report trains agents to skip the panel that matters when it is not fine.
  if (quality.issues.length === 0 && !quality.tooPoorToReview) return null;

  const severe = quality.tooPoorToReview;
  return (
    <section
      className={`rounded-xl border-2 p-5 print-break-avoid ${
        severe
          ? "border-[var(--color-fail)] bg-[var(--color-fail-bg)]"
          : "border-[var(--color-review)] bg-[var(--color-review-bg)]"
      }`}
    >
      <h3 className="text-lg font-semibold">
        {severe ? "This photograph cannot be reviewed" : "Photograph quality"}
      </h3>
      <p className="mt-1 text-[var(--color-ink)]">
        {severe
          ? "Ask the applicant for a clearer image before making any decision on this application."
          : "The label was readable, but these issues affected it:"}
      </p>
      {quality.issues.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {quality.issues.map((issue, index) => (
            <li key={index}>{issue}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CheckGroup({
  title,
  description,
  checks,
}: {
  title: string;
  description: string;
  checks: CheckResult[];
}) {
  if (checks.length === 0) return null;

  // Problems first, then things needing a look, then everything that passed.
  const order = { fail: 0, unreadable: 1, review: 2, pass: 3, not_applicable: 4 };
  const sorted = [...checks].sort((a, b) => order[a.verdict] - order[b.verdict]);

  return (
    <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] print-break-avoid">
      <header className="border-b border-[var(--color-line)] px-5 py-4">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-[15px] text-[var(--color-ink-soft)]">{description}</p>
      </header>
      <ul>
        {sorted.map((check) => (
          <CheckRow key={check.id} check={check} />
        ))}
      </ul>
    </section>
  );
}

function CheckRow({ check }: { check: CheckResult }) {
  const style = VERDICT_STYLES[check.verdict];
  const showComparison = check.expected !== undefined || check.found !== undefined;

  return (
    <li className="border-b border-[var(--color-line)] px-5 py-4 last:border-b-0 print-break-avoid">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h4 className="text-[17px] font-semibold">{check.name}</h4>
        <VerdictBadge verdict={check.verdict} />
      </div>

      {showComparison && (
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-[13px] font-semibold tracking-wide text-[var(--color-ink-soft)] uppercase">
              Application says
            </dt>
            <dd className="mt-0.5 font-mono text-[15px] break-words">
              {check.expected ?? <span className="text-[var(--color-ink-soft)]">— not stated —</span>}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] font-semibold tracking-wide text-[var(--color-ink-soft)] uppercase">
              Label shows
            </dt>
            <dd className={`mt-0.5 font-mono text-[15px] break-words ${check.verdict === "fail" ? style.text : ""}`}>
              {check.found ?? <span className="text-[var(--color-ink-soft)]">— not found —</span>}
            </dd>
          </div>
        </dl>
      )}

      <p className="mt-2 text-[var(--color-ink-soft)]">{check.explanation}</p>

      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--color-ink-soft)]">
        {check.citation && <span className="font-semibold">{check.citation}</span>}
        {/*
          The rule identifier is the audit trail. It is set small because an
          agent rarely needs it — but when an applicant appeals, "which rule
          decided this?" must have an answer, and it is right here.
        */}
        <span className="font-mono opacity-70">rule: {check.rule}</span>
        {check.confidence !== undefined && (
          <span>Reading confidence {Math.round(check.confidence * 100)}%</span>
        )}
      </p>
    </li>
  );
}

/**
 * Word-level comparison against the statutory text.
 *
 * "The warning is wrong" is useless to someone who has to write a rejection
 * letter. This shows exactly which words were dropped and which were added, so
 * the letter can quote them.
 */
function WarningDiffPanel({ diff }: { diff: DiffSegment[] }) {
  return (
    <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5 print-break-avoid">
      <h3 className="text-lg font-semibold">
        Where the warning departs from the required text
      </h3>
      <p className="mt-1 text-[15px] text-[var(--color-ink-soft)]">
        Compared word by word against 27 CFR 16.21. Capitalisation and spacing are
        ignored here — those are reported as separate checks above.
      </p>

      <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[15px]">
        <span>
          <span className="bg-[var(--color-fail-bg)] px-1 font-semibold text-[var(--color-fail)] line-through">
            struck through
          </span>{" "}
          = required but missing
        </span>
        <span>
          <span className="bg-[var(--color-pass-bg)] px-1 font-semibold text-[var(--color-pass)] underline">
            underlined
          </span>{" "}
          = on the label but not in the statute
        </span>
      </p>

      <p className="mt-3 rounded-lg bg-[var(--color-canvas)] p-4 font-mono text-[15px] leading-7">
        {diff.map((segment, index) => {
          if (segment.op === "equal") {
            return <span key={index}>{segment.text} </span>;
          }
          if (segment.op === "delete") {
            return (
              <span
                key={index}
                className="bg-[var(--color-fail-bg)] font-semibold text-[var(--color-fail)] line-through"
              >
                {segment.text}{" "}
              </span>
            );
          }
          return (
            <span
              key={index}
              className="bg-[var(--color-pass-bg)] font-semibold text-[var(--color-pass)] underline"
            >
              {segment.text}{" "}
            </span>
          );
        })}
      </p>
    </section>
  );
}
