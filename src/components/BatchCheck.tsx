"use client";

/**
 * Batch review.
 *
 * "During peak season, we get these big importers who dump 200, 300 label
 * applications on us at once. Right now we literally have to process them one
 * at a time." — this screen is that request.
 *
 * Two design decisions worth stating:
 *
 *   1. The queue runs in the BROWSER, not as a server-side batch job. Each
 *      label is an ordinary call to the same /api/verify endpoint the single
 *      screen uses. That keeps one code path for verification, gives per-item
 *      progress for free, survives one bad image without losing the run, and
 *      needs no job store or worker — appropriate for a prototype, and honestly
 *      noted in the README as the thing to revisit for a real deployment.
 *
 *   2. Concurrency is capped. Firing 300 requests at once would exhaust rate
 *      limits and make everything slower than a steady pipeline.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { downscaleImage } from "@/lib/downscale";
import { verifyLabel } from "@/lib/verifyClient";
import { normaliseHeader, parseCsvRecords, toCsv } from "@/lib/csv";
import { VerdictBadge } from "./verdict";
import { ReportView } from "./ReportView";
import type { Application, BeverageType, VerificationReport } from "@/lib/ttb/types";

/**
 * How many labels are in flight at once.
 *
 * Four is a compromise: enough that the wall-clock time for 300 labels is
 * dominated by throughput rather than round-trip latency, low enough to stay
 * under a free-tier rate limit and to keep any single agent from monopolising
 * a shared key.
 */
const CONCURRENCY = 4;

type ItemStatus = "queued" | "working" | "done" | "failed";

interface BatchItem {
  id: string;
  file: File;
  application: Application | null;
  status: ItemStatus;
  report?: VerificationReport;
  error?: string;
  elapsedMs?: number;
}

const BEVERAGE_ALIASES: Record<string, BeverageType> = {
  distilledspirits: "distilled_spirits",
  spirits: "distilled_spirits",
  distilled: "distilled_spirits",
  liquor: "distilled_spirits",
  wine: "wine",
  maltbeverage: "malt_beverage",
  malt: "malt_beverage",
  beer: "malt_beverage",
};

export function BatchCheck() {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [manifestName, setManifestName] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const cancelled = useRef(false);

  /** Filename → application, built from the manifest CSV. */
  const [manifest, setManifest] = useState<Map<string, Application>>(new Map());

  const addFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      const additions: BatchItem[] = Array.from(files)
        .filter((file) => file.type.startsWith("image/"))
        .map((file) => ({
          id: `${file.name}:${file.size}:${file.lastModified}`,
          file,
          application: manifest.get(file.name.toLowerCase()) ?? null,
          status: "queued" as const,
        }));

      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...additions.filter((item) => !seen.has(item.id))];
      });
    },
    [manifest],
  );

  const loadManifest = useCallback(async (file: File) => {
    const text = await file.text();
    const records = parseCsvRecords(text);
    const next = new Map<string, Application>();

    for (const record of records) {
      const filename = record[normaliseHeader("filename")] || record["file"] || record["image"];
      if (!filename) continue;

      const rawType = (record["beveragetype"] ?? record["type"] ?? "").toLowerCase().replace(/[\s_-]+/g, "");
      next.set(filename.trim().toLowerCase(), {
        applicationId: record["applicationid"] || undefined,
        beverageType: BEVERAGE_ALIASES[rawType] ?? "distilled_spirits",
        brandName: record["brandname"] ?? "",
        classType: record["classtype"] ?? "",
        alcoholContent: record["alcoholcontent"] || undefined,
        netContents: record["netcontents"] || undefined,
        bottlerName: record["bottlername"] || undefined,
        countryOfOrigin: record["countryoforigin"] || undefined,
        isImport: /^(true|yes|y|1)$/i.test(record["isimport"] ?? ""),
      });
    }

    setManifest(next);
    setManifestName(file.name);
    // Re-key anything already queued against the manifest just loaded.
    setItems((current) =>
      current.map((item) => ({
        ...item,
        application: next.get(item.file.name.toLowerCase()) ?? item.application,
      })),
    );
  }, []);

  const run = useCallback(async () => {
    cancelled.current = false;
    setRunning(true);

    const pending = items.filter((item) => item.status === "queued" && item.application);
    let cursor = 0;

    const worker = async () => {
      while (!cancelled.current) {
        /*
         * `cursor++` is safe here despite four concurrent workers: JavaScript
         * is single-threaded and there is no await between the read and the
         * write, so the increment cannot interleave. Any await inserted between
         * these two lines would introduce a genuine double-processing race.
         */
        const index = cursor++;
        if (index >= pending.length) return;
        const item = pending[index];

        setItems((current) =>
          current.map((c) => (c.id === item.id ? { ...c, status: "working" } : c)),
        );

        const started = Date.now();
        const { file } = await downscaleImage(item.file);
        // verifyLabel waits out 429s rather than failing: a rate limit is a
        // "wait" signal, and a 300-label run must not abandon 240 of them.
        const outcome = await verifyLabel(file, item.application as Application);
        const elapsedMs = Date.now() - started;

        setItems((current) =>
          current.map((c) =>
            c.id === item.id
              ? outcome.ok
                ? { ...c, status: "done", report: outcome.report, elapsedMs }
                : { ...c, status: "failed", error: outcome.message, elapsedMs }
              : c,
          ),
        );
      }
    };

    // One bad label must never take down the run.
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setRunning(false);
  }, [items]);

  const summary = useMemo(() => {
    const counts = { approve: 0, needs_review: 0, reject: 0, failed: 0, pending: 0 };
    for (const item of items) {
      if (item.status === "failed") counts.failed++;
      else if (item.report) counts[item.report.recommendation]++;
      else counts.pending++;
    }
    return counts;
  }, [items]);

  const visible = useMemo(
    () =>
      filter === "all"
        ? items
        : items.filter(
            (item) =>
              item.status === "failed" ||
              (item.report && item.report.recommendation !== "approve"),
          ),
    [items, filter],
  );

  const readyCount = items.filter((i) => i.application && i.status === "queued").length;
  const unmatched = items.filter((i) => !i.application).length;

  const exportCsv = useCallback(() => {
    const rows: (string | number)[][] = [
      [
        "File",
        "Application ID",
        "Brand name",
        "Recommendation",
        "Summary",
        "Failed checks",
        "Checks needing review",
        "Seconds",
      ],
    ];

    for (const item of items) {
      if (item.status === "failed") {
        rows.push([item.file.name, item.application?.applicationId ?? "", item.application?.brandName ?? "", "ERROR", item.error ?? "", "", "", ((item.elapsedMs ?? 0) / 1000).toFixed(1)]);
        continue;
      }
      if (!item.report) continue;

      const failed = item.report.checks.filter((c) => c.verdict === "fail");
      const review = item.report.checks.filter(
        (c) => c.verdict === "review" || c.verdict === "unreadable",
      );

      rows.push([
        item.file.name,
        item.application?.applicationId ?? "",
        item.application?.brandName ?? "",
        item.report.recommendation,
        item.report.headline,
        failed.map((c) => `${c.name}: ${c.explanation}`).join(" | "),
        review.map((c) => `${c.name}: ${c.explanation}`).join(" | "),
        ((item.elapsedMs ?? item.report.timing.totalMs) / 1000).toFixed(1),
      ]);
    }

    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "label-check-results.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }, [items]);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
        <h2 className="text-xl font-bold">1. Load the manifest</h2>
        <p className="mt-1 text-[15px] text-[var(--color-ink-soft)]">
          A CSV with one row per application. It must have a{" "}
          <strong>filename</strong> column matching each image, plus{" "}
          <strong>brandname</strong> and <strong>classtype</strong>. Optional:
          beveragetype, alcoholcontent, netcontents, bottlername, countryoforigin,
          isimport, applicationid.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <label className="inline-flex min-h-12 cursor-pointer items-center rounded-lg border-2 border-[var(--color-brand)] px-5 font-bold text-[var(--color-brand)] hover:bg-[var(--color-brand)] hover:text-white">
            Choose manifest CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void loadManifest(file);
                event.target.value = "";
              }}
            />
          </label>
          <a
            href="/samples/batch-manifest.csv"
            download
            className="font-semibold text-[var(--color-brand)] underline"
          >
            Download an example manifest
          </a>
          {manifestName && (
            <span className="text-[15px] font-semibold text-[var(--color-pass)]">
              ✓ {manifestName} — {manifest.size} application
              {manifest.size === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
        <h2 className="text-xl font-bold">2. Add the label images</h2>
        <p className="mt-1 text-[15px] text-[var(--color-ink-soft)]">
          Select as many as you like. Filenames are matched against the manifest.
        </p>
        <label className="mt-4 inline-flex min-h-12 cursor-pointer items-center rounded-lg border-2 border-[var(--color-brand)] px-5 font-bold text-[var(--color-brand)] hover:bg-[var(--color-brand)] hover:text-white">
          Choose label images
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="sr-only"
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>

        {items.length > 0 && (
          <p className="mt-4 text-[15px]">
            <strong>{items.length}</strong> image{items.length === 1 ? "" : "s"} loaded.{" "}
            {unmatched > 0 && (
              <span className="text-[var(--color-review)]">
                {unmatched} without a matching manifest row — these will be skipped.
              </span>
            )}
          </p>
        )}
      </section>

      {readyCount > 0 && (
        <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-center">
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="min-h-14 w-full max-w-md rounded-lg bg-[var(--color-brand)] px-8 text-xl font-bold text-white hover:bg-[var(--color-brand-dark)] disabled:bg-[var(--color-line)] disabled:text-[var(--color-ink-soft)]"
          >
            {running ? "Checking…" : `Check ${readyCount} label${readyCount === 1 ? "" : "s"}`}
          </button>
          {running && (
            <button
              type="button"
              onClick={() => {
                cancelled.current = true;
              }}
              className="mt-3 block w-full text-[15px] font-semibold underline"
            >
              Stop after the labels currently in progress
            </button>
          )}
        </section>
      )}

      {items.some((item) => item.report || item.status === "failed") && (
        <>
          <section className="grid gap-3 sm:grid-cols-4">
            <SummaryTile label="No problems" count={summary.approve} tone="pass" />
            <SummaryTile label="Needs eyes" count={summary.needs_review} tone="review" />
            <SummaryTile label="Problems" count={summary.reject} tone="fail" />
            <SummaryTile label="Errors" count={summary.failed} tone="muted" />
          </section>

          <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line)] px-5 py-4">
              <h2 className="text-xl font-bold">Results</h2>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-[15px] font-semibold">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={filter === "attention"}
                    onChange={(event) =>
                      setFilter(event.target.checked ? "attention" : "all")
                    }
                  />
                  Show only those needing attention
                </label>
                <button
                  type="button"
                  onClick={exportCsv}
                  className="min-h-11 rounded-lg border-2 border-[var(--color-brand)] px-4 font-bold text-[var(--color-brand)] hover:bg-[var(--color-brand)] hover:text-white"
                >
                  Export CSV
                </button>
              </div>
            </header>

            <ul>
              {visible.map((item) => (
                <li key={item.id} className="border-b border-[var(--color-line)] last:border-b-0">
                  <div className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <span className="min-w-0 flex-1 truncate font-mono text-[15px]">
                      {item.file.name}
                    </span>
                    <span className="text-[15px] text-[var(--color-ink-soft)]">
                      {item.application?.brandName}
                    </span>
                    {item.status === "working" && (
                      <span className="text-[15px] font-semibold">Checking…</span>
                    )}
                    {item.status === "queued" && (
                      <span className="text-[15px] text-[var(--color-ink-soft)]">
                        {item.application ? "Queued" : "No manifest row"}
                      </span>
                    )}
                    {item.status === "failed" && (
                      <span className="text-[15px] font-semibold text-[var(--color-fail)]">
                        {item.error}
                      </span>
                    )}
                    {item.report && (
                      <>
                        <span className="text-[15px] text-[var(--color-ink-soft)]">
                          {((item.elapsedMs ?? 0) / 1000).toFixed(1)}s
                        </span>
                        <RecommendationChip recommendation={item.report.recommendation} />
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded(expanded === item.id ? null : item.id)
                          }
                          className="min-h-11 rounded-lg border-2 border-[var(--color-line)] px-3 font-semibold hover:border-[var(--color-brand)]"
                        >
                          {expanded === item.id ? "Hide" : "Details"}
                        </button>
                      </>
                    )}
                  </div>
                  {expanded === item.id && item.report && (
                    <div className="border-t border-[var(--color-line)] bg-[var(--color-canvas)] p-5">
                      <ReportView report={item.report} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function SummaryTile({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "pass" | "review" | "fail" | "muted";
}) {
  const tones = {
    pass: "border-[var(--color-pass)] bg-[var(--color-pass-bg)] text-[var(--color-pass)]",
    review: "border-[var(--color-review)] bg-[var(--color-review-bg)] text-[var(--color-review)]",
    fail: "border-[var(--color-fail)] bg-[var(--color-fail-bg)] text-[var(--color-fail)]",
    muted: "border-[var(--color-line)] bg-[var(--color-muted-bg)] text-[var(--color-ink-soft)]",
  };
  return (
    <div className={`rounded-xl border-2 p-4 text-center ${tones[tone]}`}>
      <div className="text-3xl font-bold">{count}</div>
      <div className="text-[15px] font-semibold">{label}</div>
    </div>
  );
}

function RecommendationChip({
  recommendation,
}: {
  recommendation: VerificationReport["recommendation"];
}) {
  const verdict =
    recommendation === "approve" ? "pass" : recommendation === "reject" ? "fail" : "review";
  return <VerdictBadge verdict={verdict} />;
}
