import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { toApiError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverApi, serverApiOr } from "@/lib/server-api";
import { ROLES, type Group, type Paginated, type Role, type User } from "@/lib/types";
import { UsersManager } from "./users-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.users");
  return { title: t("metaTitle") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const PAGE_SIZE = 20;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

export default async function AdminUsersPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const [{ user, error }, t] = await Promise.all([requireRole(["ADMIN"], "/dashboard/admin/users"), getTranslations("admin.users")]);
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
  const q = first(params.q).trim().slice(0, 100);
  const roleParam = first(params.role).toUpperCase();
  const role = ROLES.includes(roleParam as Role) ? (roleParam as Role) : "";
  const page = Math.max(1, Number.parseInt(first(params.page), 10) || 1);

  const query = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (q) query.set("q", q);
  if (role) query.set("role", role);

  let list: Paginated<User> | null = null;
  let loadError: string | null = null;
  try {
    list = await serverApi<Paginated<User>>(`/users?${query}`);
  } catch (e) {
    loadError = errors.message(toApiError(e));
  }
  const groups = await serverApiOr<Group[]>("/academic/groups", []);

  return (
    <div className="container space-y-6 py-6 sm:py-10">
      <UsersManager
        users={list?.items ?? []}
        total={list?.total ?? 0}
        groups={Array.isArray(groups) ? groups : []}
        currentUserId={user.id}
        filters={{ q, role }}
        loadError={loadError}
      />
      {list && (
        <Pagination
          pathname="/dashboard/admin/users"
          searchParams={{ q: q || undefined, role: role || undefined }}
          page={list.page ?? page}
          limit={list.limit ?? PAGE_SIZE}
          total={list.total ?? 0}
        />
      )}
    </div>
  );
}
