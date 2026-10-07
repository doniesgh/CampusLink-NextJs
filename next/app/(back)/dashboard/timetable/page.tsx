import type { Metadata } from "next";
import { headers } from "next/headers";
import { userAgent } from "next/server";
import { getTranslations } from "next-intl/server";
import { TimetableView, type InitialTimetable } from "@/components/timetable/timetable-view";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { todayKey } from "@/lib/datetime";
import { getCurrentUser } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverSnapshot } from "@/lib/server-api";
import { myTimetableRange, parseTimetableParams, timetableQuery } from "@/lib/timetable/range";
import type { TimetableResponse } from "@/lib/timetable/types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("timetable");
  return { title: t("metaTitle") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Milliseconds since epoch at render time (kept out of the component body). */
function renderedAt(): number {
  return Date.now();
}

/**
 * Personal timetable (students: their group's classes, teachers: the classes they teach).
 * The first period is rendered on the server (no API request from the browser on page load);
 * the client view then changes period/view through the URL and the offline data layer.
 */
export default async function TimetablePage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const [{ user, error }, t, params, headerList] = await Promise.all([
    getCurrentUser(),
    getTranslations("timetable"),
    searchParams,
    headers(),
  ]);

  if (!user) {
    const errors = await getErrorFormatter();
    return (
      <div className="container space-y-6 py-6 sm:py-10">
        <PageHeader title={t("title")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  const urlState = parseTimetableParams(params);
  // Phones get the day view by default (the client corrects this guess with a media query).
  const narrowGuess = userAgent({ headers: headerList }).device.type === "mobile";
  const view = urlState.view ?? (narrowGuess ? "day" : "week");
  const date = urlState.date ?? todayKey();
  const personal = user.role === "STUDENT" || user.role === "TEACHER";

  let initial: InitialTimetable | null = null;
  if (personal) {
    const range = myTimetableRange(view, date);
    const snapshot = await serverSnapshot<TimetableResponse | null>(range.path, null);
    initial = { id: range.id, data: Array.isArray(snapshot.data?.items) ? snapshot.data : null, savedAt: snapshot.savedAt };
  }

  return (
    <div className="container py-6 sm:py-10">
      <TimetableView
        role={user.role}
        serverSearch={timetableQuery(urlState)}
        serverNow={initial?.savedAt ?? renderedAt()}
        narrowGuess={narrowGuess}
        initial={initial}
      />
    </div>
  );
}
