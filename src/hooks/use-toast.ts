/**
 * ONE TOAST SYSTEM.
 *
 * The app mounted two: Radix's <Toaster/> (this hook's old reducer) and
 * sonner. Two stacks, two positions, two looks, and a toast from one could sit
 * on top of a toast from the other. Sonner stays. This module keeps the old
 * API, toast({ title, description, variant }) and useToast(), so none of its
 * importers changed, and hands every call to sonner.
 *
 * A destructive toast becomes sonner's error toast (its icon and colour).
 * It is NOT announced assertively: sonner (1.7.4 here) renders one live
 * region, aria-live="polite", for every toast, so an error is announced
 * politely -- as it was under the Radix toaster, whose toasts were
 * role="status". On a phone the stack sits at the bottom of the screen; the
 * Radix one sat at the top. A test reads sonner's bundle and fails if either
 * of those changes, so this note cannot go stale in silence.
 */
import type * as React from "react";
import { toast as sonner, type ExternalToast } from "sonner";

export interface ToastOptions {
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: "default" | "destructive" | null;
  /** Milliseconds on screen; sonner's default when absent. */
  duration?: number;
  /** A button inside the toast. Plain {label, onClick}; a Radix element is not supported any more. */
  action?: { label: React.ReactNode; onClick: () => void } | React.ReactNode;
  className?: string;
}

export interface ToastHandle {
  id: string;
  dismiss: () => void;
  update: (next: ToastOptions) => void;
}

function isAction(a: unknown): a is { label: React.ReactNode; onClick: () => void } {
  return !!a && typeof a === "object" && "onClick" in (a as Record<string, unknown>) && "label" in (a as Record<string, unknown>);
}

function show(opts: ToastOptions, id?: string | number): string | number {
  const { title, description, variant, duration, action, className } = opts;
  const headline = title ?? description ?? "";
  const extra: ExternalToast = {
    description: title != null ? description : undefined,
    duration,
    className,
    id,
  };
  if (isAction(action)) extra.action = { label: action.label, onClick: () => action.onClick() };
  return variant === "destructive" ? sonner.error(headline, extra) : sonner(headline, extra);
}

function toast(opts: ToastOptions): ToastHandle {
  const id = show(opts);
  return {
    id: String(id),
    dismiss: () => sonner.dismiss(id),
    update: (next: ToastOptions) => {
      show({ ...opts, ...next }, id);
    },
  };
}

/** The old hook's shape. `toasts` is always empty: sonner holds the stack. */
function useToast() {
  return {
    toasts: [] as Array<ToastOptions & { id: string }>,
    toast,
    dismiss: (toastId?: string) => {
      sonner.dismiss(toastId);
    },
  };
}

export { useToast, toast };
