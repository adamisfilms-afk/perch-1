"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button, cn } from "./ui";

export interface ActionState {
  ok?: boolean;
  values?: Record<string, unknown>;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
}

export type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function SubmitButton({
  children,
  pendingText = "Saving…",
  variant,
  size,
  className,
  name,
  value,
}: {
  children: ReactNode;
  pendingText?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-disabled={pending} variant={variant} size={size} className={className} name={name} value={value}>
      {pending ? pendingText : children}
    </Button>
  );
}

/**
 * A form wired to a server action, showing success or error messages.
 * `children` can be a function receiving the latest state (for field errors).
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  confirm,
}: {
  action: FormAction;
  children: ReactNode | ((state: ActionState) => ReactNode);
  className?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={ref}
      action={formAction}
      className={cn("space-y-4", className)}
      noValidate
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {typeof children === "function" ? children(state) : children}
      {state.error && <Alert tone="red">{state.error}</Alert>}
      {state.ok && state.message && <Alert tone="green">{state.message}</Alert>}
    </form>
  );
}

/** A single button that runs a server action (with an optional "are you sure?"). */
export function SimpleActionButton({ action, label, variant = "primary", confirm }: {
  action: FormAction;
  label: string;
  variant?: "primary" | "secondary" | "danger";
  confirm?: string;
}) {
  return (
    <ActionForm action={action} confirm={confirm}>
      <SubmitButton variant={variant} pendingText="Working…">
        {label}
      </SubmitButton>
    </ActionForm>
  );
}
