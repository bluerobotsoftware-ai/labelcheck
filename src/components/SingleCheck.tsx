"use client";

/**
 * Single-label review: the screen an agent spends their day in.
 *
 * Flow is top to bottom with no hidden state — pick or fill the application,
 * add the artwork, press one button. The previous modernisation attempt at TTB
 * failed partly on navigation ("nobody could figure out how to navigate it"),
 * so there are no tabs, no wizard steps and no disclosure triangles between a
 * user and the thing they came to do.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApplicationForm } from "./ApplicationForm";
import { ReportView } from "./ReportView";
import { downscaleImage } from "@/lib/downscale";
import { verifyLabel } from "@/lib/verifyClient";
import type { Application, VerificationReport } from "@/lib/ttb/types";

interface Sample {
  id: string;
  file: string;
  title: string;
  description: string;
  kind: string;
  /** When true, this sample is pre-loaded so the page arrives ready to run. */
  isDefault?: boolean;
  application: Application;
  defects: unknown[];
}

const EMPTY_APPLICATION: Application = {
  beverageType: "distilled_spirits",
  brandName: "",
  classType: "",
  alcoholContent: "",
  netContents: "",
  bottlerName: "",
  isImport: false,
};

type Status =
  | { phase: "idle" }
  | { phase: "working"; startedAt: number }
  | { phase: "done"; report: VerificationReport; isDemoReader: boolean }
  | { phase: "error"; message: string; retryable: boolean };

export function SingleCheck({ hasRealReader }: { hasRealReader: boolean }) {
  const [application, setApplication] = useState<Application>(EMPTY_APPLICATION);
  const [image, setImage] = useState<File | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [status, setStatus] = useState<Status>({ phase: "idle" });
  const resultRef = useRef<HTMLDivElement>(null);

  /*
   * The preview URL is DERIVED from the file, not stored alongside it. Holding
   * it in state meant the effect had to setState on every change, which cascades
   * an extra render and lets the two drift out of step. The effect that remains
   * does only what an effect is for: releasing an external resource.
   */
  const previewUrl = useMemo(
    () => (image ? URL.createObjectURL(image) : null),
    [image],
  );

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const loadSample = useCallback(async (sample: Sample) => {
    setStatus({ phase: "idle" });
    setApplication({ ...EMPTY_APPLICATION, ...sample.application });
    try {
      const response = await fetch(`/samples/${sample.file}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      setImage(new File([blob], sample.file, { type: blob.type || "image/png" }));
    } catch {
      setStatus({
        phase: "error",
        message: "That sample label could not be loaded. Please try another.",
        retryable: false,
      });
    }
  }, []);

  // Declared after loadSample so the effect can call it.
  useEffect(() => {
    let cancelled = false;

    fetch("/samples/manifest.json")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return;
        const loaded: Sample[] = data?.samples ?? [];
        setSamples(loaded);

        /*
         * Pre-load the sample marked as default, so the page arrives ready to
         * run rather than as an empty form. A reviewer opening the link can
         * press one button and see a real result immediately.
         */
        const preset = loaded.find((sample) => sample.isDefault);
        if (preset) void loadSample(preset);
      })
      // Samples are a convenience; the app is fully usable without them.
      .catch(() => {
        if (!cancelled) setSamples([]);
      });

    return () => {
      cancelled = true;
    };
  }, [loadSample]);

  const submit = useCallback(async () => {
    if (!image) return;
    setStatus({ phase: "working", startedAt: Date.now() });

    // Shrink before upload — the largest single lever on response time.
    const { file } = await downscaleImage(image);
    const outcome = await verifyLabel(file, application);

    if (outcome.ok) {
      setStatus({
        phase: "done",
        report: outcome.report,
        isDemoReader: outcome.isDemoReader,
      });
    } else {
      setStatus({
        phase: "error",
        message: outcome.message,
        retryable: outcome.retryable,
      });
    }
  }, [application, image]);

  // Move focus to the result so a screen-reader user is told the answer arrived.
  useEffect(() => {
    if (status.phase === "done") {
      resultRef.current?.focus({ preventScroll: false });
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [status.phase]);

  const canSubmit =
    Boolean(image) &&
    application.brandName.trim() !== "" &&
    application.classType.trim() !== "" &&
    status.phase !== "working";

  return (
    <div className="space-y-8">
      {!hasRealReader && <DemoModeWarning />}

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
          <h2 className="text-xl font-bold">1. What the application says</h2>
          <p className="mt-1 mb-5 text-[15px] text-[var(--color-ink-soft)]">
            Type these from the COLA application, or load a sample above.
          </p>
          <ApplicationForm
            value={application}
            onChange={setApplication}
            disabled={status.phase === "working"}
          />
        </section>

        <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
          <h2 className="text-xl font-bold">2. The label artwork</h2>
          <p className="mt-1 mb-5 text-[15px] text-[var(--color-ink-soft)]">
            A photograph or scan. Angled or glared images are usually still fine.
          </p>
          <ImageDrop
            image={image}
            previewUrl={previewUrl}
            onSelect={setImage}
            onClear={() => setImage(null)}
            disabled={status.phase === "working"}
          />
        </section>
      </div>

      <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-center">
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="min-h-14 w-full max-w-md rounded-lg bg-[var(--color-brand)] px-8 text-xl font-bold text-white hover:bg-[var(--color-brand-dark)] disabled:cursor-not-allowed disabled:bg-[var(--color-line)] disabled:text-[var(--color-ink-soft)]"
        >
          {status.phase === "working" ? "Checking…" : "Check this label"}
        </button>
        {!canSubmit && status.phase !== "working" && (
          <p className="mt-3 text-[15px] text-[var(--color-ink-soft)]">
            {!image
              ? "Add a label image to continue."
              : "Fill in the brand name and class/type to continue."}
          </p>
        )}
        {status.phase === "working" && <ElapsedTimer startedAt={status.startedAt} />}
      </section>

      {/*
        Below the action, not above it. The samples are a way to try the tool,
        not a step in using it — an agent with a real application in front of
        them should reach the form and the button without scrolling past a demo.
      */}
      {samples.length > 0 && (
        <SamplePicker samples={samples} onPick={loadSample} />
      )}

      <div ref={resultRef} tabIndex={-1} className="outline-none">
        {status.phase === "error" && (
          <ErrorPanel
            message={status.message}
            onRetry={status.retryable ? submit : undefined}
          />
        )}
        {status.phase === "done" && (
          <>
            {status.isDemoReader && <DemoResultWarning />}
            <ReportView report={status.report} />
            {image && (
              <SaveCaseFile
                report={status.report}
                application={application}
                image={image}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Live elapsed time during the request.
 *
 * Not decoration. Agents abandoned the last system because it was slow, so the
 * cost of waiting should be visible and honest rather than hidden behind an
 * indeterminate spinner that gives no sense of whether to keep waiting.
 */
function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 100);
    return () => clearInterval(id);
  }, [startedAt]);

  const seconds = (elapsed / 1000).toFixed(1);
  return (
    <p className="mt-3 text-[15px] text-[var(--color-ink-soft)]" aria-hidden="true">
      Reading the label — {seconds}s
      {elapsed > 8000 && " · taking longer than usual"}
    </p>
  );
}

function ImageDrop({
  image,
  previewUrl,
  onSelect,
  onClear,
  disabled,
}: {
  image: File | null;
  previewUrl: string | null;
  onSelect: (file: File) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (image && previewUrl) {
    return (
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewUrl}
          alt={`Label artwork: ${image.name}`}
          className="max-h-96 w-full rounded-lg border border-[var(--color-line)] object-contain"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[15px] text-[var(--color-ink-soft)]">
            {image.name} · {(image.size / 1024).toFixed(0)} KB
          </span>
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            className="min-h-11 rounded-lg border-2 border-[var(--color-line)] px-4 font-semibold hover:border-[var(--color-brand)]"
          >
            Choose a different image
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const dropped = event.dataTransfer.files?.[0];
        if (dropped?.type.startsWith("image/")) onSelect(dropped);
      }}
      className={`rounded-lg border-4 border-dashed p-8 text-center ${
        dragging
          ? "border-[var(--color-brand)] bg-[var(--color-brand)]/5"
          : "border-[var(--color-line)]"
      }`}
    >
      <p className="text-lg font-semibold">Drag a label image here</p>
      <p className="mt-1 mb-4 text-[var(--color-ink-soft)]">or</p>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="min-h-12 rounded-lg border-2 border-[var(--color-brand)] px-6 text-lg font-bold text-[var(--color-brand)] hover:bg-[var(--color-brand)] hover:text-white"
      >
        Choose a file
      </button>
      <p className="mt-4 text-[15px] text-[var(--color-ink-soft)]">
        JPEG, PNG, GIF or WebP · up to 8 MB
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          if (chosen) onSelect(chosen);
          event.target.value = "";
        }}
      />
    </div>
  );
}

function SamplePicker({
  samples,
  onPick,
}: {
  samples: Sample[];
  onPick: (sample: Sample) => void;
}) {
  return (
    <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6 no-print">
      <h2 className="text-xl font-bold">Try it with a sample label</h2>
      <p className="mt-1 mb-4 text-[15px] text-[var(--color-ink-soft)]">
        Each one loads its own application data. Some are deliberately
        non-compliant — the descriptions say which.
      </p>
      {/*
        One per row, and each kept to a single line. Thirteen samples in a
        three-column grid pushed the form nearly two thousand pixels down the
        page — an agent scrolled past the demo every time they used the tool.
        The descriptions are long and belong in the docs, not in a picker.
      */}
      <ul className="divide-y divide-[var(--color-line)] rounded-lg border-2 border-[var(--color-line)]">
        {samples.map((sample) => (
          <li key={sample.id}>
            <button
              type="button"
              onClick={() => onPick(sample)}
              title={sample.description}
              className="flex min-h-11 w-full items-baseline gap-3 px-4 py-2.5 text-left hover:bg-[var(--color-brand)]/5"
            >
              <span className="font-semibold whitespace-nowrap">{sample.title}</span>
              <span className="truncate text-[15px] text-[var(--color-ink-soft)]">
                {sample.description}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ErrorPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <section
      role="alert"
      className="rounded-xl border-2 border-[var(--color-fail)] bg-[var(--color-fail-bg)] p-6"
    >
      <h2 className="text-xl font-bold text-[var(--color-fail)]">
        This label could not be checked
      </h2>
      <p className="mt-2">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 min-h-12 rounded-lg bg-[var(--color-fail)] px-6 font-bold text-white"
        >
          Try again
        </button>
      )}
    </section>
  );
}

function DemoModeWarning() {
  return (
    <section className="rounded-xl border-2 border-[var(--color-review)] bg-[var(--color-review-bg)] p-5">
      <h2 className="text-lg font-bold">Demo mode — no label reader configured</h2>
      <p className="mt-1">
        This server has no vision-model API key, so uploaded images are{" "}
        <strong>not actually read</strong>. Results below come from fixed sample
        data and mean nothing about the image you supplied. Set{" "}
        <code className="font-mono">GEMINI_API_KEY</code> or{" "}
        <code className="font-mono">ANTHROPIC_API_KEY</code> to enable real
        reading.
      </p>
    </section>
  );
}

function DemoResultWarning() {
  return (
    <section className="mb-4 rounded-xl border-2 border-[var(--color-fail)] bg-[var(--color-fail-bg)] p-5">
      <p className="font-bold text-[var(--color-fail)]">
        This report was NOT produced from your image.
      </p>
      <p className="mt-1">
        No reader is configured, so fixed demo data was used. Do not treat any of
        it as a finding about the label you uploaded.
      </p>
    </section>
  );
}

/**
 * Save the report and the artwork it was drawn from, as one archive.
 *
 * Offered on every outcome, not only on a clean pass. A rejection is the record
 * an agent needs *most* — it is what a rejection letter is written from, and
 * what an appeal is argued against six months later. Withholding the file
 * exactly when the decision is contested would be the wrong way round.
 *
 * The wording changes with the verdict so the button describes what the agent
 * is actually filing.
 */
function SaveCaseFile({
  report,
  application,
  image,
}: {
  report: VerificationReport;
  application: Application;
  image: File;
}) {
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");

  const save = useCallback(async () => {
    setState("working");
    try {
      const bytes = new Uint8Array(await image.arrayBuffer());
      const { buildCaseFile } = await import("@/lib/caseFile");
      const file = buildCaseFile(report, application, {
        filename: image.name,
        bytes,
      });

      const blob = new Blob([file.bytes as unknown as BlobPart], {
        type: "application/zip",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setState("idle");
    } catch {
      setState("failed");
    }
  }, [application, image, report]);

  const wording =
    report.recommendation === "approve"
      ? "Save this result for the file"
      : report.recommendation === "reject"
        ? "Save this result for the rejection file"
        : "Save this result for review";

  return (
    <section className="mt-6 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6 no-print">
      <h3 className="text-lg font-semibold">{wording}</h3>
      <p className="mt-1 text-[15px] text-[var(--color-ink-soft)]">
        Downloads a single zip containing a printable report, the same report as
        data, and the label image this decision was made from. A decision without
        its evidence is not a record.
      </p>
      <button
        type="button"
        onClick={save}
        disabled={state === "working"}
        className="mt-4 min-h-12 rounded-lg border-2 border-[var(--color-brand)] px-6 font-bold text-[var(--color-brand)] hover:bg-[var(--color-brand)] hover:text-white disabled:opacity-60"
      >
        {state === "working" ? "Preparing…" : "Download report and image (.zip)"}
      </button>
      {state === "failed" && (
        <p role="alert" className="mt-3 text-[15px] font-semibold text-[var(--color-fail)]">
          The file could not be prepared. Please try again.
        </p>
      )}
    </section>
  );
}
