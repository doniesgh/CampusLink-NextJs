import Link from "next/link";
import { ArrowRight, CalendarCog, GraduationCap, UsersRound } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { TodayWidgetView } from "@/components/timetable/today-widget-view";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { todayKey } from "@/lib/datetime";
import { serverSnapshot } from "@/lib/server-api";
import { currentWeekRange } from "@/lib/timetable/range";
import type { TimetableResponse } from "@/lib/timetable/types";
import type { User } from "@/lib/types";

const linkClass =
  "mt-auto inline-flex items-center gap-1.5 self-start rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Card without data (admins, alumni, students without a group). */
async function InfoCard({ icon: Icon, text, href, linkLabel }: { icon: typeof UsersRound; text: string; href: string; linkLabel: string }) {
  const t = await getTranslations("timetable.widget");
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
          <p>{text}</p>
        </div>
        <Link href={href} className={linkClass}>
          {linkLabel}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  );
}

/**
 * Dashboard widget "Today's classes" (Server Component). The current week is fetched on the server,
 * so the dashboard makes no timetable request from the browser on load; the client view keeps it
 * fresh (focus / reconnect) and readable offline. It shares its offline query with the timetable
 * page's week view.
 */
export async function TodayWidget({ user }: Readonly<{ user: User }>) {
  const t = await getTranslations("timetable.widget");

  if (user.role === "ADMIN") {
    return <InfoCard icon={CalendarCog} text={t("adminText")} href="/dashboard/admin/timetable" linkLabel={t("adminLink")} />;
  }
  if (user.role === "ALUMNI") {
    return <InfoCard icon={GraduationCap} text={t("alumniText")} href="/dashboard/timetable" linkLabel={t("viewAll")} />;
  }

  const today = todayKey();
  const range = currentWeekRange(today);
  const snapshot = await serverSnapshot<TimetableResponse | null>(range.path, null);
  const data = Array.isArray(snapshot.data?.items) ? snapshot.data : null;

  return <TodayWidgetView initial={data} renderedAt={snapshot.savedAt} showGroups={user.role === "TEACHER"} />;
}
