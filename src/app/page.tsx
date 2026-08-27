/**
 * Single-label review.
 *
 * A server component purely so reader availability is resolved on the server —
 * whether an API key exists must never be inferable from the browser bundle.
 */

import { SingleCheck } from "@/components/SingleCheck";
import { hasRealReader } from "@/lib/reader";

/**
 * Rendered per request, not prerendered at build time.
 *
 * Without this, Next.js statically prerenders this page and `hasRealReader()`
 * is evaluated once, during the build. The "no reader configured" banner then
 * reflects whether a key existed when the bundle was compiled rather than
 * whether one exists now — so adding the key to a deployment leaves the warning
 * frozen in place until something forces a rebuild, and removing the key leaves
 * the page falsely claiming a reader is present.
 *
 * That second direction is the dangerous one: a page insisting results are real
 * on a server that has lost its key. This banner is a safety notice, and a
 * safety notice compiled from stale state is worse than none.
 */
export const dynamic = "force-dynamic";

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
