import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { toApiError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverApi } from "@/lib/server-api";
import type { Paginated } from "@/lib/types";
import { manageHref } from "@/lib/announcements/paths";
import { isStatus, type Announcement } from "@/lib/announcements/types";
import { ManagementView, type DoneKey } from "./management-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("announcements");
  return { title: t("managementTitle") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const PAGE_SIZE = 20;
const DONE_KEYS: readonly DoneKey[] = ["draft", "published", "scheduled", "updated", "deleted"];

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** /dashboard/admin/announcements (ADMIN: every announcement, TEACHER: their own), with stats. */
export default async function AnnouncementsManagementPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const [{ user, error }, t] = await Promise.all([requireRole(["ADMIN", "TEACHER"], manageHref), getTranslations("announcements")]);
  const errors = await getErrorFormatter();

  if (!user) {
    return (
      <div className="container space-y-6 py-6 sm:py-10">
        <PageHeader title={t("managementTitle")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  const params = await searchParams;
  const statusParam = first(params.status).toUpperCase();
  const status = isStatus(statusParam) ? statusParam : "";
  const page = Math.max(1, Number.parseInt(first(params.page), 10) || 1);
  const doneParam = first(params.done) as DoneKey;
  const done = DONE_KEYS.includes(doneParam) ? doneParam : null;
  const recipients = Number.parseInt(first(params.recipients), 10);

  const query = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (status) query.set("status", status);

  let list: Paginated<Announcement> | null = null;
  let loadError: string | null = null;
  try {
    list = await serverApi<Paginated<Announcement>>(`/announcements/manage?${query}`);
  } catch (e) {
    loadError = errors.message(toApiError(e));
  }

  return (
    <div className="container space-y-6 py-6 sm:py-10">
      <ManagementView
        items={Array.isArray(list?.items) ? list.items : []}
        total={list?.total ?? 0}
        status={status}
        isAdmin={user.role === "ADMIN"}
        loadError={loadError}
        done={done ? { key: done, recipients: Number.isNaN(recipients) ? null : recipients } : null}
      />
      {list && (
        <Pagination
          pathname={manageHref}
          searchParams={{ status: status || undefined }}
          page={list.page ?? page}
          limit={list.limit ?? PAGE_SIZE}
          total={list.total ?? 0}
        />
      )}
    </div>
  );
}
