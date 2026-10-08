import { cache } from "react";
import type { Metadata } from "next";
import { CalendarX } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { RollCallEditor } from "@/components/analytics/roll-call-editor";
import Link from "@/components/ui/app-link";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { toApiError, type ApiError } from "@/lib/api";
import { ATTENDANCE_HREF, rollCallHref } from "@/lib/analytics/paths";
import { isObjectId, isRollCall, type RollCall } from "@/lib/analytics/types";
import { requireRole } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverApi } from "@/lib/server-api";
import { cn } from "@/lib/utils";
import { saveRollCallAction } from "../actions";

type Params = Promise<{ sessionId: string }>;
type Loaded = { data: RollCall; error?: undefined } | { data?: undefined; error: ApiError };

// One backend call per request, shared by generateMetadata and the page.
const loadRollCall = cache(async (id: string): Promise<Loaded> => {
  try {
    const data = await serverApi<RollCall>(`/attendance/sessions/${encodeURIComponent(id)}`);
    if (!isRollCall(data)) return { error: toApiError(new Error("Unexpected answer")) };
    return { data };
  } catch (e) {
    return { error: toApiError(e) };
  }
});

/** Milliseconds since epoch at render time (kept out of the component body). */
function renderedAt(): number {
  return Date.now();
}

export async function generateMetadata({ params }: Readonly<{ params: Params }>): Promise<Metadata> {
  const { sessionId } = await params;
  const t = await getTranslations("analytics");
  if (!isObjectId(sessionId)) return { title: t("attendanceMetaTitle") };
  const loaded = await loadRollCall(sessionId);
  const subject = loaded.data?.session.subject?.name;
  return { title: subject ? t("attendance.rollCall.metaTitle", { subject }) : t("attendanceMetaTitle") };
}

/** Roll call of one session (its teacher inside the window, or ADMIN at any time). */
export default async function RollCallPage({ params }: Readonly<{ params: Params }>) {
  const { sessionId } = await params;
  const [{ user, error }, t, tRoot] = await Promise.all([
    requireRole(["TEACHER", "ADMIN"], isObjectId(sessionId) ? rollCallHref(sessionId) : ATTENDANCE_HREF),
    getTranslations("analytics.attendance.rollCall"),
    getTranslations("analytics"),
  ]);
  const errors = await getErrorFormatter();

  if (!user) {
    return (
      <div className="container space-y-6 py-6 sm:py-10">
        <PageHeader title={tRoot("attendanceTitle")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  const loaded = isObjectId(sessionId) ? await loadRollCall(sessionId) : null;
  if (!loaded?.data) {
    const missing = !loaded || [400, 403, 404].includes(loaded.error.status);
    return (
      <div className="container space-y-6 py-6 sm:py-10">
        <PageHeader title={tRoot("attendanceTitle")} />
        <EmptyState
          icon={CalendarX}
          headingLevel="h2"
          title={missing ? t("notFound") : errors.message(loaded.error)}
          action={
            <Link href={ATTENDANCE_HREF} className={cn(buttonVariants({ variant: "outline" }), "rounded-full")}>
              {t("back")}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="container max-w-5xl py-6 sm:py-10">
      <RollCallEditor initial={loaded.data} saveAction={saveRollCallAction} now={renderedAt()} />
    </div>
  );
}
