import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InlineFeedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { toApiError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { getErrorFormatter } from "@/lib/i18n/server";
import { serverApi } from "@/lib/server-api";
import type { Group, Program, Room, Subject } from "@/lib/types";
import { AcademicManager, type RoomBookingLabels } from "./academic-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.academic");
  return { title: t("metaTitle") };
}

/** "2026-2027" from September on, "2025-2026" before (campus academic year). */
function currentAcademicYear(now = new Date()): string {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() >= 8 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

/** Labels of the two room booking fields (Module 5, "bookings" messages: the client only has "admin" here). */
async function roomBookingLabels(): Promise<RoomBookingLabels> {
  const t = await getTranslations("bookings.roomForm");
  return {
    bookable: t("bookable"),
    bookableHint: t("bookableHint"),
    requiresApproval: t("requiresApproval"),
    requiresApprovalHint: t("requiresApprovalHint"),
    notBookable: t("notBookable"),
    approval: t("approval"),
  };
}

export default async function AdminAcademicPage() {
  const [{ user, error }, t] = await Promise.all([requireRole(["ADMIN"], "/dashboard/admin/academic"), getTranslations("admin.academic")]);
  const errors = await getErrorFormatter();

  if (!user) {
    return (
      <div className="container space-y-6 py-6 sm:py-10">
        <PageHeader title={t("title")} />
        <InlineFeedback feedback={{ type: "error", message: errors.message(error) }} />
      </div>
    );
  }

  let data: { programs: Program[]; groups: Group[]; subjects: Subject[]; rooms: Room[] } | null = null;
  let loadError: string | null = null;
  try {
    const [programs, groups, subjects, rooms] = await Promise.all([
      serverApi<Program[]>("/academic/programs"),
      serverApi<Group[]>("/academic/groups"),
      serverApi<Subject[]>("/academic/subjects"),
      serverApi<Room[]>("/academic/rooms"),
    ]);
    data = { programs, groups, subjects, rooms };
  } catch (e) {
    loadError = errors.message(toApiError(e));
  }

  return (
    <div className="container space-y-6 py-6 sm:py-10">
      <PageHeader title={t("title")} description={t("subtitle")} />
      {data ? (
        <AcademicManager {...data} defaultAcademicYear={currentAcademicYear()} bookingLabels={await roomBookingLabels()} />
      ) : (
        <InlineFeedback feedback={{ type: "error", message: loadError ?? "" }} />
      )}
    </div>
  );
}
