"use client";

import { InlineFeedback, type Feedback } from "@/components/ui/feedback";

/**
 * InlineFeedback on an opaque page surface: the dashboard content area is `bg-muted`, on which the translucent
 * success tint of InlineFeedback falls just under the 4.5:1 text contrast; on `bg-background` it passes (light and
 * dark). Same roles (status / alert) and behaviour as InlineFeedback.
 */
export function PageFeedback({ feedback }: { feedback: Feedback | null | undefined }) {
  if (!feedback?.message) return null;
  return (
    <div className="rounded-2xl bg-background">
      <InlineFeedback feedback={feedback} />
    </div>
  );
}
