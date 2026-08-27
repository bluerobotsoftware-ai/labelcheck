export const metadata = { title: "How it works — TTB Label Check" };

/**
 * Written for the reviewer who opens the deployed link without the repository
 * to hand. It explains the one design decision the whole product rests on, and
 * is candid about the limits — a prototype that oversells itself is worse than
 * one that says where it stops.
 */
export default function Page() {
  return (
    <article className="max-w-3xl space-y-8">
      <header>
        <h1 className="text-3xl font-bold">How it works</h1>
        <p className="mt-2 text-lg text-[var(--color-ink-soft)]">
          What this tool does, what it deliberately does not do, and where it
          stops.
        </p>
      </header>

      <Section title="The AI reads. It does not decide.">
        <p>
          A vision model looks at the artwork and does exactly one job:
          transcribe what is printed, verbatim, along with how it is printed —
          whether a heading is in capitals, whether it is bold, whether the
          photograph was legible at all. It is explicitly instructed not to
          correct, tidy or complete anything, and it is never asked whether a
          label complies.
        </p>
        <p>
          Every pass, fail and flag on this site is then produced by ordinary
          TypeScript, from that transcription. That code is deterministic and
          unit-tested; the same inputs always give the same report.
        </p>
        <p>
          This split exists because a compliance decision has to be explainable.
          An applicant can appeal, and &ldquo;the model said so&rdquo; is not an
          answer that survives one. Every row of every report carries the
          identifier of the rule that produced it and the regulation it comes
          from.
        </p>
      </Section>

      <Section title="Two different questions">
        <p>
          Reports are split in two because the questions are genuinely different.
        </p>
        <p>
          <strong>Compared with the application</strong> asks whether the artwork
          shows what the applicant filed — brand name, class and type, alcohol
          content, net contents, bottler. Both halves are needed.
        </p>
        <p>
          <strong>Required by regulation</strong> asks whether the label is
          lawful, whatever was filed. The government health warning is the clear
          case: it appears nowhere on the application, so there is nothing to
          match it against. It is compared word for word against the text
          prescribed by 27 CFR 16.21. Container sizes work the same way — an
          800 mL spirits bottle is not an authorised standard of fill even
          though the application says 800 mL too.
        </p>
      </Section>

      <Section title="Judgement, written down">
        <p>
          A label reading <span className="font-mono">STONE&rsquo;S THROW</span>{" "}
          against an application reading{" "}
          <span className="font-mono">Stone&apos;s Throw</span> is obviously the
          same product. Rather than leaving that to a model&rsquo;s discretion,
          the comparison walks a ladder of increasingly permissive
          normalisations — spacing, then typographic quotes, then case, then
          accents, then punctuation, then abbreviations — and reports the first
          rung at which the two agree. So the report does not merely say
          &ldquo;match&rdquo;; it says <em>matched apart from capitalisation</em>.
        </p>
        <p>
          Anything that fails the ladder but is still close is marked{" "}
          <strong>Check by eye</strong> rather than failed. Sending an agent to
          look costs seconds; wrongly rejecting a valid application costs a
          letter, an appeal and a resubmission.
        </p>
      </Section>

      <Section title="Speed">
        <p>
          The target was five seconds, because a previous system took thirty to
          forty and was abandoned. Three things buy that: images are downscaled
          in your browser before upload, the model is asked for one compact
          structured response rather than a conversation, and the rules run
          locally in about a millisecond. Every report shows its own timing, so
          if that ever stops being true it is visible immediately.
        </p>
      </Section>

      <Section title="What this prototype does not do">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            It does not connect to COLA, and nothing submitted here is stored.
            Images are held in memory for the length of a single request.
          </li>
          <li>
            It checks the fields listed above. It does not assess prohibited
            practices, health claims, appellations of origin, formula approval,
            or the many class-and-type rules specific to individual products.
          </li>
          <li>
            Boldness and type size are judged visually by the model from a
            photograph. They should be treated as a prompt to look, not as a
            measurement — 27 CFR 16.22 sets requirements in millimetres and
            characters per inch that no photograph can establish.
          </li>
          <li>
            It is advisory throughout. It recommends; an agent decides.
          </li>
        </ul>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
      <h2 className="text-xl font-bold">{title}</h2>
      <div className="mt-3 space-y-3 text-[var(--color-ink-soft)]">{children}</div>
    </section>
  );
}
