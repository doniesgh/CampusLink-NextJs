import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { api } from "@/lib/api";
import { getCurrentUser } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { AccountView } from "./account-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account");
  return { title: t("metaTitle") };
}

/** The backend's VAPID public key, or null when push is not configured (503 PUSH_DISABLED). */
async function vapidPublicKey(): Promise<string | null> {
  try {
    const body = await api<{ publicKey?: string }>("/api/push/vapid-public-key");
    return typeof body?.publicKey === "string" && body.publicKey ? body.publicKey : null;
  } catch {
    return null;
  }
}

export default async function AccountPage() {
  const [{ user, error }, t] = await Promise.all([getCurrentUser("/dashboard/account"), getTranslations("account")]);

  if (!user) {
    const errors = await getErrorFormatter();
    return (
      <div className="container max-w-3xl space-y-6 py-6 sm:py-10">
        <PageHeader title={t("title")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  return (
    <div className="container max-w-3xl space-y-8 py-6 sm:py-10">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <AccountView
        user={{
          firstname: user.firstname,
          lastname: user.lastname,
          email: user.email,
          role: user.role,
          twoFactorEnabled: user.twoFactorEnabled,
          group: user.group ? `${user.group.name} · ${user.group.program.code}` : null,
        }}
        vapidPublicKey={await vapidPublicKey()}
      />
    </div>
  );
}
