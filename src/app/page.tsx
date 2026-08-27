/**
 * Single-label review.
 *
 * A server component purely so reader availability is resolved on the server —
 * whether an API key exists must never be inferable from the browser bundle.
 */

import { SingleCheck } from "@/components/SingleCheck";
import { hasRealReader } from "@/lib/reader";

export default function Page() {
  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Check a label against its application</h1>
        <p className="mt-2 max-w-3xl text-lg text-[var(--color-ink-soft)]">
          Upload the artwork and the details filed on the application. You will get
          a field-by-field comparison, plus the federal requirements that apply
          whatever the application says.
        </p>
      </div>
      <SingleCheck hasRealReader={hasRealReader()} />
    </>
  );
}
