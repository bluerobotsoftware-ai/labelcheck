import { BatchCheck } from "@/components/BatchCheck";

export const metadata = { title: "Batch review — TTB Label Check" };

export default function Page() {
  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Check a batch of labels</h1>
        <p className="mt-2 max-w-3xl text-lg text-[var(--color-ink-soft)]">
          For importers who file hundreds at once. Load a manifest of applications
          and the matching artwork, and every label is checked in turn while you
          watch. Filter to the ones needing attention and export the lot.
        </p>
      </div>
      <BatchCheck />
    </>
  );
}
