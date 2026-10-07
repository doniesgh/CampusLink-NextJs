"use client";

import { useEffect, useState } from "react";
import { BellOff, BellRing, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { Feedback } from "@/components/ui/feedback";
import { BffError } from "@/lib/bff-client";
import { useErrorFormatter } from "@/lib/i18n/client";
import { disablePush, enablePush, getPushState, PushSetupError, type PushState } from "@/lib/offline/push";

/**
 * "Enable push notifications" / "Disable push notifications" for this device.
 * Needs the service worker (production build or NEXT_PUBLIC_ENABLE_SW=true) and VAPID keys on the backend.
 */
export function PushToggle({
  vapidPublicKey,
  onFeedback,
}: {
  vapidPublicKey: string | null;
  onFeedback: (feedback: Feedback | null) => void;
}) {
  const t = useTranslations("account.push");
  const errors = useErrorFormatter();
  const [state, setState] = useState<PushState | "checking">("checking");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getPushState().then((value) => {
      if (!cancelled) setState(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const subscribed = state === "subscribed";
  const unavailableReason =
    state === "unsupported"
      ? t("unsupported")
      : !vapidPublicKey
        ? t("unavailable")
        : state === "no-service-worker"
          ? t("noServiceWorker")
          : state === "denied"
            ? t("denied")
            : null;
  const disabled = pending || state === "checking" || (!subscribed && unavailableReason !== null);

  const toggle = async () => {
    setPending(true);
    onFeedback(null);
    try {
      if (subscribed) {
        await disablePush();
        setState("unsubscribed");
        onFeedback({ type: "success", message: t("disabled") });
      } else if (vapidPublicKey) {
        await enablePush(vapidPublicKey);
        setState("subscribed");
        onFeedback({ type: "success", message: t("enabled") });
      }
    } catch (e) {
      if (e instanceof PushSetupError && e.reason === "denied") {
        setState("denied");
        onFeedback({ type: "error", message: t("denied") });
      } else if (e instanceof BffError) {
        onFeedback({ type: "error", message: errors.message(e) });
      } else {
        onFeedback({ type: "error", message: t("failed") });
      }
      setState(await getPushState());
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant={subscribed ? "outline" : "default"}
        className="rounded-full"
        onClick={toggle}
        disabled={disabled}
        aria-describedby={unavailableReason && !subscribed ? "push-unavailable" : undefined}
        aria-busy={pending || undefined}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : subscribed ? (
          <BellOff className="h-4 w-4" aria-hidden="true" />
        ) : (
          <BellRing className="h-4 w-4" aria-hidden="true" />
        )}
        {subscribed ? t("disable") : t("enable")}
      </Button>
      {unavailableReason && !subscribed && state !== "checking" && (
        <p id="push-unavailable" className="text-sm text-muted-foreground">
          {unavailableReason}
        </p>
      )}
    </div>
  );
}
