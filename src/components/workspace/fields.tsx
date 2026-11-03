"use client";

// Form fields in the workspace style (as in the settings pop-ups): plain labels, neutral borders, errors in red.

import { useId, type ReactNode } from "react";
import { cn } from "../ui";

const control =
  "min-h-10 w-full rounded-md border bg-white px-3 text-sm focus:border-neutral-900 focus:outline-none disabled:bg-neutral-50 disabled:text-neutral-500";

function Label({ htmlFor, children, required }: { htmlFor?: string; children: ReactNode; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm text-neutral-800">
      {children}
      {required && <span className="text-neutral-400"> *</span>}
    </label>
  );
}

function ErrorText({ id, error }: { id: string; error?: string }) {
  return error ? (
    <p id={id} className="mt-1 text-xs text-red-800">
      {error}
    </p>
  ) : null;
}

export function TextField({
  label,
  name,
  error,
  required,
  hint,
  className,
  ...props
}: { label: string; name: string; error?: string; hint?: string } & Omit<React.ComponentProps<"input">, "name">) {
  const id = useId();
  return (
    <div className={className}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      <input
        id={id}
        name={name}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-e` : undefined}
        className={cn(control, "mt-1", error ? "border-red-400" : "border-neutral-300")}
        {...props}
      />
      {hint && !error && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
      <ErrorText id={`${id}-e`} error={error} />
    </div>
  );
}

export function TextareaField({
  label,
  name,
  error,
  required,
  hint,
  className,
  ...props
}: { label: string; name: string; error?: string; hint?: string } & Omit<React.ComponentProps<"textarea">, "name">) {
  const id = useId();
  return (
    <div className={className}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      <textarea
        id={id}
        name={name}
        rows={3}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-e` : undefined}
        className={cn(control, "mt-1 py-2", error ? "border-red-400" : "border-neutral-300")}
        {...props}
      />
      {hint && !error && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
      <ErrorText id={`${id}-e`} error={error} />
    </div>
  );
}

export function SelectField({
  label,
  name,
  options,
  error,
  required,
  placeholder = "Choose…",
  defaultValue,
  className,
}: {
  label: string;
  name: string;
  options: readonly (readonly [string, string])[];
  error?: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue ?? ""}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-e` : undefined}
        className={cn(control, "mt-1", error ? "border-red-400" : "border-neutral-300")}
      >
        <option value="">{placeholder}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <ErrorText id={`${id}-e`} error={error} />
    </div>
  );
}

/** Checkboxes (or radios) in a grid. */
export function ChoiceGroup({
  legend,
  name,
  options,
  type = "checkbox",
  defaultValues = [],
  error,
  required,
}: {
  legend: string;
  name: string;
  options: readonly (readonly [string, string])[];
  type?: "checkbox" | "radio";
  defaultValues?: string[];
  error?: string;
  required?: boolean;
}) {
  const id = useId();
  return (
    <fieldset aria-describedby={error ? `${id}-e` : undefined}>
      <legend className="text-sm text-neutral-800">
        {legend}
        {required && <span className="text-neutral-400"> *</span>}
      </legend>
      <div className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {options.map(([v, l]) => (
          <label key={v} className="flex items-center gap-2 text-sm text-neutral-700">
            <input type={type} name={name} value={v} defaultChecked={defaultValues.includes(v)} className="size-4" />
            {l}
          </label>
        ))}
      </div>
      <ErrorText id={`${id}-e`} error={error} />
    </fieldset>
  );
}

export function CheckField({ name, children, error, defaultChecked }: { name: string; children: ReactNode; error?: string; defaultChecked?: boolean }) {
  const id = useId();
  return (
    <div>
      <label className="flex items-start gap-2 text-sm text-neutral-700">
        <input type="checkbox" name={name} defaultChecked={defaultChecked} aria-describedby={error ? `${id}-e` : undefined} className="mt-0.5 size-4 shrink-0" />
        <span>{children}</span>
      </label>
      <ErrorText id={`${id}-e`} error={error} />
    </div>
  );
}

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-400">{title}</h3>
      {children}
    </section>
  );
}
