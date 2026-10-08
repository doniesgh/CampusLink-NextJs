import type { Metadata } from "next";
import { BarChart3, ClipboardList, Hourglass, Package } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { AllBookings, type AllBookingsFilters } from "@/components/bookings/admin/all-bookings";
import { EquipmentManager } from "@/components/bookings/admin/equipment-manager";
import { PendingApprovals } from "@/components/bookings/admin/pending-approvals";
import { UsageStats } from "@/components/bookings/admin/usage-stats";
import Link from "@/components/ui/app-link";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { toApiError } from "@/lib/api";
import { addDays, isDateKey, todayKey, zonedTimeToUtc } from "@/lib/datetime";
import { requireRole } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverApi, serverApiOr } from "@/lib/server-api";
import { isObjectId } from "@/lib/bookings/rules";
import {
  BOOKING_STATUSES,
  type BookableRoom,
  type Booking,
  type BookingList,
  type BookingStats,
  type BookingStatus,
  type Equipment,
} from "@/lib/bookings/types";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("bookings");
  return { title: t("adminMetaTitle") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type AdminTab = "pending" | "all" | "equipment" | "stats";
const TABS: readonly AdminTab[] = ["pending", "all", "equipment", "stats"];
const PATH = "/dashboard/admin/bookings";
const PAGE_SIZE = 20;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Milliseconds since epoch at render time (kept out of the component body). */
function renderedAt(): number {
  return Date.now();
}

function shiftMonth(month: string, amount: number): string {
  const [year, value] = month.split("-").map(Number);
  const index = year * 12 + (value - 1) + amount;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** "Pending approvals (3)" / "All bookings" / "Equipment" / "Statistics" as links (each section is its own render). */
async function SectionsNav({ tab, pendingTotal }: { tab: AdminTab; pendingTotal: number | null }) {
  const t = await getTranslations("bookings.admin.sections");
  const icons = { pending: Hourglass, all: ClipboardList, equipment: Package, stats: BarChart3 } as const;
  return (
    <nav aria-label={t("label")}>
      <ul className="flex flex-wrap gap-2">
        {TABS.map((value) => {
          const Icon = icons[value];
          const active = value === tab;
          return (
            <li key={value}>
              <Link
                href={value === "pending" ? PATH : `${PATH}?tab=${value}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background text-foreground hover:bg-accent"
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {t(value)}
                {value === "pending" && pendingTotal !== null && pendingTotal > 0 && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-xs font-semibold tabular-nums",
                      active ? "bg-primary-foreground text-primary" : "bg-highlight text-highlight-foreground"
                    )}
                  >
                    <span className="sr-only">(</span>
                    {pendingTotal}
                    <span className="sr-only">)</span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Bookings & resources (ADMIN): pending approvals (approve / reject with a note), every booking with filters,
 * equipment management and usage statistics. URL: `?tab=pending|all|equipment|stats` (+ `booking=<id>` from
 * a notification, the filters of "all" and `month=YYYY-MM` of the statistics). Never saved for offline use.
 */
export default async function AdminBookingsPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const [{ user, error }, t, params] = await Promise.all([requireRole(["ADMIN"]), getTranslations("bookings"), searchParams]);
  const errors = await getErrorFormatter();

  if (!user) {
    return (
      <div className="container space-y-6 py-6 sm:py-10">
        <PageHeader title={t("adminTitle")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  const tabParam = first(params.tab);
  const tab: AdminTab = TABS.includes(tabParam as AdminTab) ? (tabParam as AdminTab) : "pending";
  const bookingParam = first(params.booking);
  const highlight = isObjectId(bookingParam) ? bookingParam : null;
  const now = renderedAt();

  let loadError: string | null = null;
  let content: React.ReactNode = null;
  let pendingTotal: number | null = null;

  try {
    if (tab === "pending") {
      const pending = await serverApi<BookingList>("/bookings?status=PENDING&order=asc&limit=100");
      pendingTotal = pending.total ?? pending.items.length;
      const inList = highlight ? pending.items.some((booking) => booking.id === highlight) : false;
      const linked = highlight && !inList ? await serverApiOr<Booking | null>(`/bookings/${highlight}`, null) : null;
      content = (
        <PendingApprovals
          bookings={pending.items}
          total={pendingTotal}
          highlight={highlight}
          linked={linked && typeof linked === "object" && "id" in linked ? linked : null}
          now={now}
        />
      );
    } else {
      const count = await serverApiOr<BookingList | null>("/bookings?status=PENDING&limit=1", null);
      pendingTotal = typeof count?.total === "number" ? count.total : null;
    }

    if (tab === "all") {
      const statusParam = (first(params.status) ?? "").toUpperCase();
      const status = BOOKING_STATUSES.includes(statusParam as BookingStatus) ? (statusParam as BookingStatus) : "";
      const resourceParam = first(params.resource) ?? "";
      const [resourceType, resourceId] = resourceParam.split(":");
      const resource = (resourceType === "ROOM" || resourceType === "EQUIPMENT") && isObjectId(resourceId) ? resourceParam : "";
      // Without ?from: from today (upcoming first); "from=all" (cleared field): no lower bound, newest first.
      const fromParam = first(params.from);
      const from = fromParam === undefined ? todayKey() : isDateKey(fromParam) ? fromParam : "";
      const toParam = first(params.to) ?? "";
      const to = isDateKey(toParam) && (!from || toParam >= from) ? toParam : "";
      const page = Math.max(1, Number.parseInt(first(params.page) ?? "", 10) || 1);

      const query = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), order: from ? "asc" : "desc" });
      if (status) query.set("status", status);
      if (resource) {
        query.set("resourceType", resourceType);
        query.set("resource", resourceId);
      }
      if (from) query.set("from", zonedTimeToUtc(from, "00:00").toISOString());
      // "To" is inclusive: bookings starting before the next day.
      if (to) query.set("to", zonedTimeToUtc(addDays(to, 1), "00:00").toISOString());

      const [list, rooms, equipment] = await Promise.all([
        serverApi<BookingList>(`/bookings?${query}`),
        serverApiOr<BookableRoom[]>("/academic/rooms", []),
        serverApiOr<Equipment[]>("/resources/equipment", []),
      ]);
      const filters: AllBookingsFilters = { status, resource, from, to };
      content = (
        <>
          <AllBookings
            bookings={list.items}
            total={list.total}
            filters={filters}
            rooms={Array.isArray(rooms) ? rooms : []}
            equipment={Array.isArray(equipment) ? equipment : []}
            now={now}
          />
          <Pagination
            pathname={PATH}
            searchParams={{ tab: "all", status: status || undefined, resource: resource || undefined, from: from || "all", to: to || undefined }}
            page={list.page ?? page}
            limit={list.limit ?? PAGE_SIZE}
            total={list.total ?? 0}
          />
        </>
      );
    }

    if (tab === "equipment") {
      const items = await serverApi<Equipment[]>("/resources/equipment");
      content = <EquipmentManager items={Array.isArray(items) ? items : []} />;
    }

    if (tab === "stats") {
      const monthParam = first(params.month) ?? "";
      const month = MONTH_RE.test(monthParam) ? monthParam : todayKey().slice(0, 7);
      const from = `${month}-01`;
      const to = `${shiftMonth(month, 1)}-01`;
      const [stats, format] = await Promise.all([serverApi<BookingStats>(`/bookings/stats?from=${from}&to=${to}`), getFormatter()]);
      content = (
        <UsageStats
          stats={stats}
          periodLabel={format.dateTime(zonedTimeToUtc(`${month}-15`, "12:00"), { month: "long", year: "numeric" })}
          previousHref={`${PATH}?tab=stats&month=${shiftMonth(month, -1)}`}
          nextHref={`${PATH}?tab=stats&month=${shiftMonth(month, 1)}`}
        />
      );
    }
  } catch (e) {
    loadError = errors.message(toApiError(e));
  }

  return (
    <div className="container space-y-6 py-6 sm:py-10">
      <PageHeader title={t("adminTitle")} description={t("adminDescription")} />
      <SectionsNav tab={tab} pendingTotal={pendingTotal} />
      {loadError ? <InlineFeedback feedback={{ type: "error", message: loadError }} /> : content}
    </div>
  );
}
