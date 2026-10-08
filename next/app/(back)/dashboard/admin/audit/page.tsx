import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toApiError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverApi, serverApiOr } from "@/lib/server-api";
import type { AuditLog, Paginated } from "@/lib/types";
import { ActionFilter } from "./action-filter";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.audit");
  return { title: t("metaTitle") };
}

/** Audited actions of the contract (section 5), offered in the "Action" filter. */
const AUDIT_ACTIONS = [
  "user.create",
  "user.update",
  "user.delete",
  "auth.password_reset",
  "auth.password_change",
  "academic.program.create",
  "academic.program.update",
  "academic.program.delete",
  "academic.group.create",
  "academic.group.update",
  "academic.group.delete",
  "academic.subject.create",
  "academic.subject.update",
  "academic.subject.delete",
  "academic.room.create",
  "academic.room.update",
  "academic.room.delete",
  "timetable.session.create",
  "timetable.session.update",
  "timetable.session.cancel",
  "timetable.session.delete",
  "timetable.import",
  "announcement.create",
  "announcement.publish",
  "announcement.schedule",
  "announcement.update",
  "announcement.delete",
  "equipment.create",
  "equipment.update",
  "equipment.delete",
  "booking.approve",
  "booking.reject",
  "booking.cancel",
  "forum.hide",
  "forum.unhide",
  "forum.delete",
  "attendance.update",
  "grades.assessment.create",
  "grades.assessment.update",
  "grades.assessment.delete",
  "grades.publish",
  "grades.update",
  "carpool.trip.cancel",
  "marketplace.approve",
  "marketplace.reject",
  "marketplace.unpublish",
  "alumni.export",
  "alumni.erase",
  "alumni.post.delete",
  "alumni.post.hide",
] as const;

/** Action codes with a readable label (`admin.audit.actionLabels.<code>`); other codes are shown as they are. */
const LABELLED_ACTIONS: ReadonlySet<string> = new Set([...AUDIT_ACTIONS, "timetable.calendar_link.reset"]);
type LabelledAction = (typeof AUDIT_ACTIONS)[number] | "timetable.calendar_link.reset";
const isLabelled = (action: string): action is LabelledAction => LABELLED_ACTIONS.has(action);

const ACTION_RE = /^[a-z0-9_.-]{1,64}$/i;
const PAGE_SIZE = 50;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

export default async function AdminAuditPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const [{ user, error }, t, format] = await Promise.all([
    requireRole(["ADMIN"], "/dashboard/admin/audit"),
    getTranslations("admin.audit"),
    getFormatter(),
  ]);
  const errors = await getErrorFormatter();

  if (!user) {
    return (
      <div className="container space-y-6 py-6 sm:py-10">
        <PageHeader title={t("title")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  const params = await searchParams;
  const actionParam = first(params.action).trim();
  const action = ACTION_RE.test(actionParam) ? actionParam : "";
  const page = Math.max(1, Number.parseInt(first(params.page), 10) || 1);
  const query = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (action) query.set("action", action);

  // Contract actions + any other action already present in the log (GET /api/audit/actions, when available).
  const present = await serverApiOr<unknown>("/audit/actions", []);
  const actionOptions = [
    ...new Set<string>([
      ...AUDIT_ACTIONS,
      ...(Array.isArray(present) ? present.filter((value): value is string => typeof value === "string" && ACTION_RE.test(value)) : []),
    ]),
  ].sort();

  let list: Paginated<AuditLog> | null = null;
  let loadError: string | null = null;
  try {
    list = await serverApi<Paginated<AuditLog>>(`/audit?${query}`);
  } catch (e) {
    loadError = errors.message(toApiError(e));
  }

  const actionLabel = (action: string): string | null => (isLabelled(action) ? t(`actionLabels.${action}`) : null);
  const filterOptions = actionOptions.map((value) => ({ value, label: actionLabel(value) ?? value }));

  const target = (entry: AuditLog) => {
    const label = entry.summary || [entry.targetType, entry.targetId].filter(Boolean).join(" ");
    return label || "—";
  };

  return (
    <div className="container space-y-6 py-6 sm:py-10">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <ActionFilter value={action} options={filterOptions} />

      {loadError ? (
        <InlineFeedback feedback={{ type: "error", message: loadError }} />
      ) : !list || list.items.length === 0 ? (
        <EmptyState icon={ScrollText} title={t("empty")} />
      ) : (
        <>
          <Table aria-label={t("title")}>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.date")}</TableHead>
                <TableHead>{t("columns.actor")}</TableHead>
                <TableHead>{t("columns.action")}</TableHead>
                <TableHead>{t("columns.target")}</TableHead>
                <TableHead>{t("columns.ip")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.items.map((entry) => {
                const label = actionLabel(entry.action);
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap">
                      <time dateTime={entry.createdAt}>{format.dateTime(new Date(entry.createdAt), "dateTime")}</time>
                    </TableCell>
                    <TableCell>
                      {entry.actor ? (
                        <>
                          <span className="font-medium">
                            {entry.actor.firstname} {entry.actor.lastname}
                          </span>
                          <span className="block text-xs text-muted-foreground">{entry.actor.email}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">{t("system")}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {label ? (
                        <>
                          <span className="font-medium">{label}</span>
                          <code className="block text-xs text-muted-foreground">{entry.action}</code>
                        </>
                      ) : (
                        <code className="rounded-lg bg-muted px-2 py-0.5 text-xs">{entry.action}</code>
                      )}
                    </TableCell>
                    <TableCell className="max-w-md">{target(entry)}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{entry.ip || "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <Pagination
            pathname="/dashboard/admin/audit"
            searchParams={{ action: action || undefined }}
            page={list.page ?? page}
            limit={list.limit ?? PAGE_SIZE}
            total={list.total ?? 0}
          />
        </>
      )}
    </div>
  );
}
