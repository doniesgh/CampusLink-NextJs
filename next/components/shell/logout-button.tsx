"use client";

import { useFormStatus } from "react-dom";
import { Loader2, LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { logoutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { clearOfflineData } from "@/lib/offline/cleanup";
import { cn } from "@/lib/utils";

function LogoutSubmit({ className }: { className?: string }) {
  const t = useTranslations("common.actions");
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="ghost"
      disabled={pending}
      aria-busy={pending || undefined}
      className={cn("w-full justify-start gap-3 rounded-xl px-3 text-foreground hover:bg-accent hover:text-accent-foreground", className)}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
      {t("logout")}
    </Button>
  );
}

/**
 * "Log out": first removes everything personal from the device (IndexedDB, Cache Storage, push
 * subscription — while the session can still authorise the unsubscribe), then ends the session.
 */
export function LogoutButton({ className }: { className?: string }) {
  async function logout() {
    await clearOfflineData();
    await logoutAction();
  }

  return (
    <form action={logout}>
      <LogoutSubmit className={className} />
    </form>
  );
}
