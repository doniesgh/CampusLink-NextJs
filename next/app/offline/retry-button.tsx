"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Reloads the page the user wanted (the service worker served /offline in its place). */
export function RetryButton({ label }: { label: string }) {
  return (
    <Button type="button" variant="highlight" size="lg" className="rounded-full" onClick={() => window.location.reload()}>
      <RefreshCw className="h-4 w-4" aria-hidden="true" />
      {label}
    </Button>
  );
}
