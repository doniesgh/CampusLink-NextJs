"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Submit button that disables itself and shows a spinner while its form's action runs.
 * The label stays the same so the button keeps a stable accessible name.
 */
export function SubmitButton({
  children,
  pending: pendingProp,
  disabled,
  className,
  ...props
}: ButtonProps & { pending?: boolean }) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;

  return (
    <Button
      type="submit"
      size="lg"
      className={cn("h-11 w-full rounded-xl shadow-lg shadow-primary/20", className)}
      {...props}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </Button>
  );
}
