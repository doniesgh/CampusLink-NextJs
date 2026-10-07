"use client";

import * as React from "react";
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Inline feedback: role="status" (success/info) or role="alert" (error). Renders nothing
 * without a message. Keep at most ONE status and ONE alert inside <main> at a time (tests look them
 * up with `getByRole('main').getByRole('status' | 'alert')`): use one `useFeedback()` per page.
 *
 *   const [feedback, setFeedback] = useFeedback();
 *   setFeedback({ type: "success", message: t("saved") });
 *   <InlineFeedback feedback={feedback} />
 *
 * With a Server Action's ActionState: <InlineFeedback feedback={fromActionState(state)} />.
 */
export type Feedback = {
  type: "success" | "error" | "info";
  message: string;
  /** Changes on every report so the same message is announced again. */
  at?: number;
};

export function InlineFeedback({
  feedback,
  className,
  children,
}: {
  feedback: Feedback | null | undefined;
  className?: string;
  children?: React.ReactNode;
}) {
  if (!feedback?.message) return null;
  const isError = feedback.type === "error";
  const Icon = isError ? CircleAlert : feedback.type === "success" ? CircleCheck : Info;
  return (
    <div
      key={feedback.at}
      role={isError ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm",
        isError && "border-destructive/30 bg-destructive/10 text-destructive",
        feedback.type === "success" && "border-success/30 bg-success/10 text-success",
        feedback.type === "info" && "border-primary/20 bg-accent text-accent-foreground",
        className
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        <p>{feedback.message}</p>
        {children}
      </div>
    </div>
  );
}

export function useFeedback(): [Feedback | null, (feedback: Feedback | null) => void] {
  const [feedback, setFeedbackState] = React.useState<Feedback | null>(null);
  const setFeedback = React.useCallback((value: Feedback | null) => {
    setFeedbackState(value ? { ...value, at: value.at ?? Date.now() } : null);
  }, []);
  return [feedback, setFeedback];
}

/** Maps a Server Action state ({ ok, message, at }) to a Feedback. */
export function fromActionState(state: { ok?: boolean; message?: string; at?: number } | null | undefined): Feedback | null {
  if (!state?.message) return null;
  return { type: state.ok ? "success" : "error", message: state.message, at: state.at };
}
