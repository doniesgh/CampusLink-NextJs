import type { Metadata } from "next";
import { headers } from "next/headers";
import { userAgent } from "next/server";
import { getTranslations } from "next-intl/server";
import { BookingsView, type InitialAvailability } from "@/components/bookings/bookings-view";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { todayKey } from "@/lib/datetime";
import { requireRole } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverApiOr, serverSnapshot } from "@/lib/server-api";
import { availabilityRange, bookingsQuery, myBookingsQuery, parseBookingsParams } from "@/lib/bookings/rules";
import { isRoomBookable, type Availability, type BookableRoom, type BookingList, type Equipment } from "@/lib/bookings/types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("bookings");
  return { title: t("metaTitle") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Room and equipment bookings (Module 5) for students, teachers and admins (ALUMNI are sent to /dashboard).
 * The server renders the resources, the first page of upcoming bookings and, when the URL names a resource,
 * its week of availability, so the page makes no API request from the browser when it loads; the client view
 * then works through the URL and the offline data layer (My bookings stay readable offline).
 */
export default async function BookingsPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const [{ user, error }, t, params, headerList] = await Promise.all([
    requireRole(["STUDENT", "TEACHER", "ADMIN"]),
    getTranslations("bookings"),
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

  const url = parseBookingsParams(params);
  const narrowGuess = userAgent({ headers: headerList }).device.type === "mobile";
  const mineQuery = myBookingsQuery("upcoming", 1);

  const [rooms, equipment, mine] = await Promise.all([
    serverApiOr<BookableRoom[]>("/academic/rooms", []),
    serverApiOr<Equipment[]>("/resources/equipment?active=true", []),
    serverSnapshot<BookingList | null>(mineQuery.path, null),
  ]);
  const roomList = Array.isArray(rooms) ? rooms : [];
  const equipmentList = Array.isArray(equipment) ? equipment : [];

  // Availability of the resource named in the URL (only a known, bookable one: no 404 to show).
  let initialAvailability: InitialAvailability | null = null;
  if (url.resource) {
    const room = roomList.find((item) => item.id === url.resource && isRoomBookable(item));
    const item = equipmentList.find((entry) => entry.id === url.resource && entry.active !== false);
    const type = url.type ?? (room ? "ROOM" : item ? "EQUIPMENT" : null);
    if (type && ((type === "ROOM" && room) || (type === "EQUIPMENT" && item))) {
      const range = availabilityRange(type, url.resource, url.date ?? todayKey());
      const snapshot = await serverSnapshot<Availability | null>(range.path, null);
      initialAvailability = { id: range.id, data: Array.isArray(snapshot.data?.busy) ? snapshot.data : null, savedAt: snapshot.savedAt };
    }
  }

  return (
    <div className="container space-y-6 py-6 sm:py-10">
      <PageHeader title={t("title")} description={t("description")} />
      <BookingsView
        role={user.role}
        serverSearch={bookingsQuery(url)}
        serverNow={mine.savedAt}
        narrowGuess={narrowGuess}
        rooms={roomList}
        equipment={equipmentList}
        initialMine={{ data: Array.isArray(mine.data?.items) ? mine.data : null, savedAt: mine.savedAt }}
        initialAvailability={initialAvailability}
      />
    </div>
  );
}
