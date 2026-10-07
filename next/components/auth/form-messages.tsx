import { CircleAlert, CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/** The form's single role="alert" region. Renders nothing without a message. */
export function FormAlert({
  message,
  children,
  className,
}: {
  message?: string | null;
  children?: React.ReactNode;
  className?: string;
}) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive",
        className
      )}
    >
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        <p>{message}</p>
        {children}
      </div>
    </div>
  );
}

/** A role="status" confirmation message. Renders nothing without a message. */
export function FormStatus({ message, className }: { message?: string | null; className?: string }) {
  if (!message) return null;
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success",
        className
      )}
    >
      <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}

/** Inline error under an input; link it with aria-describedby={fieldErrorId(id)}. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={fieldErrorId(id)} className="text-sm text-destructive">
      {message}
    </p>
  );
}

export function fieldErrorId(id: string): string {
  return `${id}-error`;
}

/** aria-* props for an input that may have an inline error. */
export function errorProps(id: string, message?: string) {
  return message ? { "aria-invalid": true as const, "aria-describedby": fieldErrorId(id) } : {};
}
