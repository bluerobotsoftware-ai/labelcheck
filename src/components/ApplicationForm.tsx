"use client";

/**
 * The application half of the comparison — the fields as filed on TTB Form
 * 5100.31.
 *
 * Written for someone who does this eighty times a day and for someone who has
 * never seen it before. Every field carries a visible example rather than a
 * placeholder: placeholder text vanishes the moment you type, which is exactly
 * when a hesitant user most wants to check they got the format right.
 */

import type { Application, BeverageType } from "@/lib/ttb/types";

const BEVERAGE_LABELS: Record<BeverageType, string> = {
  distilled_spirits: "Distilled spirits",
  wine: "Wine",
  malt_beverage: "Malt beverage (beer)",
};

export function ApplicationForm({
  value,
  onChange,
  disabled,
}: {
  value: Application;
  onChange: (next: Application) => void;
  disabled?: boolean;
}) {
  const set = <K extends keyof Application>(key: K, next: Application[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <fieldset disabled={disabled} className="space-y-5 disabled:opacity-60">
      <legend className="sr-only">Application details</legend>

      <Field
        label="Beverage type"
        hint="Determines which rules and tolerances apply."
        required
        wraps="group"
      >
        {/*
          Each radio gets its own <label htmlFor>, not a wrapping one. Nesting
          these inside the outer field <label> made the first radio inherit the
          whole group's text, so a screen reader announced a 90-character name
          for a three-word option.
        */}
        <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="Beverage type">
          {(Object.keys(BEVERAGE_LABELS) as BeverageType[]).map((type) => (
            <div
              key={type}
              className={`flex min-h-11 items-center gap-2 rounded-lg border-2 px-3 py-2 ${
                value.beverageType === type
                  ? "border-[var(--color-brand)] bg-[var(--color-brand)]/5 font-semibold"
                  : "border-[var(--color-line)] bg-white"
              }`}
            >
              <input
                id={`beverage-${type}`}
                type="radio"
                name="beverageType"
                className="h-4 w-4"
                checked={value.beverageType === type}
                onChange={() => set("beverageType", type)}
              />
              <label htmlFor={`beverage-${type}`} className="cursor-pointer">
                {BEVERAGE_LABELS[type]}
              </label>
            </div>
          ))}
        </div>
      </Field>

      <Field label="Brand name" hint="Example: OLD TOM DISTILLERY" required>
        <TextInput
          value={value.brandName}
          onChange={(v) => set("brandName", v)}
          autoComplete="off"
        />
      </Field>

      <Field
        label="Class / type designation"
        hint="Example: Kentucky Straight Bourbon Whiskey"
        required
      >
        <TextInput
          value={value.classType}
          onChange={(v) => set("classType", v)}
          autoComplete="off"
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Alcohol content" hint="Example: 45% Alc./Vol. (90 Proof)">
          <TextInput
            value={value.alcoholContent ?? ""}
            onChange={(v) => set("alcoholContent", v)}
            autoComplete="off"
          />
        </Field>

        <Field label="Net contents" hint="Example: 750 mL">
          <TextInput
            value={value.netContents ?? ""}
            onChange={(v) => set("netContents", v)}
            autoComplete="off"
          />
        </Field>
      </div>

      <Field
        label="Bottler / producer name"
        hint="Example: Old Tom Distillery. The label may add an address."
      >
        <TextInput
          value={value.bottlerName ?? ""}
          onChange={(v) => set("bottlerName", v)}
          autoComplete="off"
        />
      </Field>

      <div className="rounded-lg border border-[var(--color-line)] bg-white p-4">
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={value.isImport ?? false}
            onChange={(event) => set("isImport", event.target.checked)}
          />
          <span className="font-semibold">This is an imported product</span>
        </label>
        <p className="mt-1 text-[15px] text-[var(--color-ink-soft)]">
          Imports must state a country of origin on the label.
        </p>

        {value.isImport && (
          <div className="mt-4">
            <Field label="Country of origin" hint="Example: Scotland">
              <TextInput
                value={value.countryOfOrigin ?? ""}
                onChange={(v) => set("countryOfOrigin", v)}
                autoComplete="off"
              />
            </Field>
          </div>
        )}
      </div>

      <Field
        label="Application reference"
        hint="Optional. Carried onto the report so it can be filed."
      >
        <TextInput
          value={value.applicationId ?? ""}
          onChange={(v) => set("applicationId", v)}
          autoComplete="off"
        />
      </Field>
    </fieldset>
  );
}

/**
 * A labelled field.
 *
 * `wraps` distinguishes the two cases. A single input is wrapped by its own
 * <label>, which is the simplest correct association. A GROUP of controls
 * cannot be — nesting radios inside a label makes each one inherit the group's
 * entire text as its accessible name — so those render inside a plain <div>
 * and label their controls individually.
 */
function Field({
  label,
  hint,
  required,
  wraps = "single",
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  wraps?: "single" | "group";
  children: React.ReactNode;
}) {
  const Wrapper = wraps === "single" ? "label" : "div";
  return (
    <Wrapper className="block">
      <span className="text-[17px] font-semibold">
        {label}
        {required && (
          <span className="ml-1 text-[var(--color-fail)]" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </span>
      {hint && (
        <span className="mt-0.5 block text-[15px] text-[var(--color-ink-soft)]">
          {hint}
        </span>
      )}
      <span className="mt-1.5 block">{children}</span>
    </Wrapper>
  );
}

function TextInput({
  value,
  onChange,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <input
      {...rest}
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="min-h-11 w-full rounded-lg border-2 border-[var(--color-line)] bg-white px-3 py-2 text-[17px] focus:border-[var(--color-brand)]"
    />
  );
}
