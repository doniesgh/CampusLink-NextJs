"use server";

import { getTranslations } from "next-intl/server";
import { ApiError, toApiError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { actionFailure, actionSuccess, serverApi, type ActionState } from "@/lib/server-api";
import { rollCallHref } from "@/lib/analytics/paths";
import { isAttendanceStatus, isObjectId, isRollCall, type RollCall, type RollCallChange } from "@/lib/analytics/types";

const MAX_RECORDS = 500;
const NOTE_MAX_LENGTH = 500;
const ROLL_CALL_REASONS = ["ROLL_CALL_NOT_OPEN", "ROLL_CALL_CLOSED", "EXCUSED_ADMIN_ONLY"] as const;

/** Keeps only well-formed entries (the backend validates again). */
function cleanRecords(input: unknown): RollCallChange[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_RECORDS) return null;
  const records: RollCallChange[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object") return null;
    const { student, status, note } = entry as Record<string, unknown>;
    if (!isObjectId(student)) return null;
    if (status !== null && !isAttendanceStatus(status)) return null;
    if (note !== undefined && (typeof note !== "string" || note.length > NOTE_MAX_LENGTH)) return null;
    records.push(note === undefined ? { student, status } : { student, status, note });
  }
  return records;
}

/**
 * "Save attendance": PUT /api/attendance/sessions/:id with the changed rows only. Returns the new roll call
 * (`data`) and a localised message; the roll-call rules of the backend (window, EXCUSED for admins only,
 * cancelled session) get their own messages.
 */
export async function saveRollCallAction(sessionId: string, input: RollCallChange[]): Promise<ActionState<RollCall>> {
  const { user, error } = await requireRole(["TEACHER", "ADMIN"], isObjectId(sessionId) ? rollCallHref(sessionId) : "/dashboard/attendance");
  if (!user) return actionFailure<RollCall>(error);

  const t = await getTranslations("analytics.attendance.rollCall");
  const records = cleanRecords(input);
  if (!isObjectId(sessionId) || !records) {
    return actionFailure<RollCall>(new ApiError(400, "VALIDATION_ERROR", "Invalid roll call."));
  }

  try {
    const data = await serverApi<RollCall>(`/attendance/sessions/${encodeURIComponent(sessionId)}`, { method: "PUT", body: { records } });
    if (!isRollCall(data)) throw new Error("Unexpected answer");
    return actionSuccess<RollCall>(t("saved", { count: data.changed ?? 0 }), { data });
  } catch (e) {
    const apiError = toApiError(e);
    const reason = (apiError.details as { reason?: unknown } | undefined)?.reason;
    let message: string | undefined;
    if (apiError.status === 403 && ROLL_CALL_REASONS.includes(reason as (typeof ROLL_CALL_REASONS)[number])) {
      message = t(`errors.${reason as (typeof ROLL_CALL_REASONS)[number]}`);
    } else if (apiError.status === 409 && apiError.code === "INVALID_STATE") {
      message = t("errors.CANCELLED");
    } else if (apiError.code === "VALIDATION_ERROR" && apiError.details && typeof apiError.details === "object") {
      const outside = Object.values(apiError.details as Record<string, unknown>).some(
        (value) => typeof value === "string" && value.includes("roster")
      );
      if (outside) message = t("errors.NOT_IN_ROSTER");
    }
    return actionFailure<RollCall>(e, message ? { message } : {});
  }
}
