// Small set of interface building blocks (in the spirit of shadcn/ui), styled with Tailwind.
import Link from "next/link";
import { cloneElement, isValidElement, useId, type ComponentProps, type ReactElement, type ReactNode } from "react";

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const buttonStyles: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/50",
  secondary: "border border-stone-300 bg-white text-stone-800 hover:bg-stone-50 disabled:text-stone-400",
  danger: "bg-red-700 text-white hover:bg-red-800 disabled:bg-red-700/50",
  ghost: "text-brand-700 hover:bg-brand-50",
};

export function buttonClass(variant: ButtonVariant = "primary", size: "sm" | "md" = "md"): string {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed",
    size === "sm" ? "min-h-9 px-3 text-sm" : "min-h-11 px-4 text-sm",
    buttonStyles[variant],
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return <button className={cn(buttonClass(variant, size), className)} {...props} />;
}

export function LinkButton({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return <Link className={cn(buttonClass(variant, size), className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5", className)} {...props} />;
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold text-stone-900">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-stone-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

type Tone = "neutral" | "green" | "amber" | "red" | "blue" | "violet";
const tones: Record<Tone, string> = {
  neutral: "bg-stone-100 text-stone-700 ring-stone-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-900 ring-amber-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  violet: "bg-violet-50 text-violet-800 ring-violet-200",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone], className)}>
      {children}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">{children}</p>;
}

export function Alert({ tone = "amber", children }: { tone?: "amber" | "red" | "green" | "blue"; children: ReactNode }) {
  const styles = {
    amber: "border-amber-300 bg-amber-50 text-amber-950",
    red: "border-red-300 bg-red-50 text-red-900",
    green: "border-emerald-300 bg-emerald-50 text-emerald-900",
    blue: "border-sky-300 bg-sky-50 text-sky-900",
  };
  return (
    <div role={tone === "red" ? "alert" : "status"} className={cn("rounded-lg border px-3 py-2 text-sm", styles[tone])}>
      {children}
    </div>
  );
}

export function DefinitionList({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-stone-500">{k}</dt>
          <dd className="text-stone-900">{v || <span className="text-stone-400">–</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

const inputClass =
  "block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base text-stone-900 shadow-sm placeholder:text-stone-400 aria-[invalid=true]:border-red-600 sm:text-sm";

/**
 * A labelled form control. Gives the control a unique id (several forms can share a page)
 * and wires up the hint and error for screen readers.
 */
export function Field({
  label,
  name,
  hint,
  error,
  required,
  children,
}: {
  label: ReactNode;
  name: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  const id = `${name}-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })
    : children;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-stone-800">
        {label}
        {required && <span className="text-red-700"> *</span>}
      </label>
      {hint && (
        <p id={hintId} className="text-xs text-stone-500">
          {hint}
        </p>
      )}
      {control}
      {error && (
        <p id={errorId} className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ error, ...props }: ComponentProps<"input"> & { error?: string }) {
  return (
    <input
      aria-invalid={error ? true : undefined}
      className={cn(inputClass, props.className)}
      {...props}
    />
  );
}

export function Textarea({ error, ...props }: ComponentProps<"textarea"> & { error?: string }) {
  return (
    <textarea
      aria-invalid={error ? true : undefined}
      className={cn(inputClass, "min-h-24", props.className)}
      {...props}
    />
  );
}

export function Select({ error, options, placeholder, ...props }: ComponentProps<"select"> & {
  error?: string;
  options: readonly (readonly [string, string])[];
  placeholder?: string;
}) {
  return (
    <select
      aria-invalid={error ? true : undefined}
      className={cn(inputClass, props.className)}
      {...props}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}

export function CheckboxGroup({
  legend,
  name,
  options,
  defaultValues = [],
  error,
  required,
  hint,
  type = "checkbox",
}: {
  legend: ReactNode;
  name: string;
  options: readonly (readonly [string, string])[];
  defaultValues?: string[];
  error?: string;
  required?: boolean;
  hint?: ReactNode;
  type?: "checkbox" | "radio";
}) {
  return (
    <fieldset className="space-y-2" aria-describedby={error ? `${name}-error` : undefined}>
      <legend className="text-sm font-medium text-stone-800">
        {legend}
        {required && <span className="text-red-700"> *</span>}
      </legend>
      {hint && <p className="text-xs text-stone-500">{hint}</p>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map(([value, label]) => (
          <label
            key={value}
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50"
          >
            <input type={type} name={name} value={value} defaultChecked={defaultValues.includes(value)} className="size-4 accent-brand-600" />
            {label}
          </label>
        ))}
      </div>
      {error && (
        <p id={`${name}-error`} className="text-sm text-red-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function Checkbox({ name, children, defaultChecked, error, required }: {
  name: string;
  children: ReactNode;
  defaultChecked?: boolean;
  error?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="flex cursor-pointer items-start gap-3 text-sm text-stone-800">
        <input
          type="checkbox"
          name={name}
          defaultChecked={defaultChecked}
          required={required}
          aria-invalid={error ? true : undefined}
          className="mt-0.5 size-4 shrink-0 accent-brand-600"
        />
        <span>{children}</span>
      </label>
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}
