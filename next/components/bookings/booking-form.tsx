"use client";

import { useState, useTransition, type RefObject } from "react";
import { CloudOff, Info, ShieldCheck, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { createBookingAction } from "@/app/(back)/dashboard/bookings/actions";
import { useBookingFormat } from "@/components/bookings/use-booking-format";
import { SubmitButton } from "@/components/auth/submit-button";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { InlineFeedback, type Feedback } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { dateKey, type DateKey } from "@/lib/datetime";
import {
  checkBookingTimes,
  END_TIMES,
  keepDuration,
  lastBookableDay,
  MAX_DAYS_AHEAD,
  maxHoursFor,
  minutesOf,
  overlapping,
  PURPOSE_MAX,
  PURPOSE_MIN,
  START_TIMES,
  STUDENT_BOOKING_LIMIT,
  type BookingRule,
  type TimeProblems,
} from "@/lib/bookings/rules";
import { personName, type Booking, type BookingConflict, type BusySlot, type PickableResource } from "@/lib/bookings/types";
import type { Role } from "@/lib/types";

export type BookingFormState = { date: DateKey; start: string; end: string; purpose: string };

/** "Class 08:30–10:00", "Booked 17:00–19:00", "Your booking 17:00–19:00" (+ details for admins). */
export function useConflictLabel(isAdmin: boolean) {
  const t = useTranslations("bookings.conflict");
  const fmt = useBookingFormat();
  return (conflict: BookingConflict | BusySlot) => {
    const when = fmt.when(conflict.startsAt, conflict.endsAt);
    if (conflict.kind === "CLASS") {
      const subject = "subject" in conflict && conflict.subject?.name;
      return isAdmin && subject ? t("classOf", { when, subject }) : t("class", { when });
    }
    if (conflict.mine) return t("mine", { when });
    const who = "user" in conflict ? personName(conflict.user) : "";
    if (isAdmin && who) return t("bookingBy", { when, name: who });
    return conflict.status === "PENDING" ? t("pending", { when }) : t("booking", { when });
  };
}

/**
 * "Book it": date, start / end time (15-minute steps, 07:00-21:00), purpose. The rules are checked while
 * typing (after a first submit) and again by the Server Action and the API; conflicts come back as a list.
 */
export function BookingForm({
  role,
  resource,
  form,
  onChange,
  busy,
  upcomingCount,
  online,
  now,
  purposeRef,
  onBooked,
  onSeeMine,
}: {
  role: Role;
  resource: PickableResource;
  form: BookingFormState;
  onChange: (patch: Partial<BookingFormState>) => void;
  /** Busy times of the loaded week (overlap warning), null when the form's day is not loaded. */
  busy: readonly BusySlot[] | null;
  /** Upcoming PENDING / CONFIRMED bookings of a student (null for other roles or unknown). */
  upcomingCount: number | null;
  online: boolean;
  now: number;
  purposeRef: RefObject<HTMLTextAreaElement | null>;
  onBooked: (booking: Booking) => void;
  onSeeMine: () => void;
}) {
  const t = useTranslations("bookings");
  const fmt = useBookingFormat();
  const conflictLabel = useConflictLabel(role === "ADMIN");
  const [pending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<(Feedback & { conflicts?: BookingConflict[]; booked?: boolean }) | null>(null);

  const today = dateKey(now);
  const maxHours = maxHoursFor(role);
  const problems: TimeProblems = checkBookingTimes({ date: form.date, start: form.start, end: form.end, role, now });
  const purpose = form.purpose.trim();

  const ruleMessage = (rule: string) =>
    rule === "required"
      ? t("rules.required")
      : t(`rules.${rule as BookingRule}`, { maxHours, maxDaysAhead: MAX_DAYS_AHEAD });

  const clientErrors = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    for (const [field, rule] of Object.entries(problems)) if (rule) errors[field] = ruleMessage(rule);
    if (purpose.length < PURPOSE_MIN) errors.purpose = t("form.purposeRequired", { min: PURPOSE_MIN });
    else if (purpose.length > PURPOSE_MAX) errors.purpose = t("form.purposeTooLong", { max: PURPOSE_MAX });
    return errors;
  };
  const errors = { ...(submitted ? clientErrors() : {}), ...serverErrors };

  const overlaps = busy && Object.keys(problems).length === 0 ? overlapping(busy, form.date, form.start, form.end) : [];
  const duration = fmt.duration(form.start, form.end);
  const limitReached = upcomingCount !== null && upcomingCount >= STUDENT_BOOKING_LIMIT;

  const change = (patch: Partial<BookingFormState>) => {
    setServerErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key];
      return next;
    });
    onChange(patch);
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    const found = clientErrors();
    if (Object.keys(found).length > 0) {
      setFeedback((current) => ({ type: "error", message: [...new Set(Object.values(found))].join(" "), at: (current?.at ?? 0) + 1 }));
      return;
    }
    startTransition(async () => {
      const result = await createBookingAction({
        resourceType: resource.type,
        resource: resource.id,
        date: form.date,
        start: form.start,
        end: form.end,
        purpose,
      });
      if (result.ok) {
        setSubmitted(false);
        setServerErrors({});
        setFeedback({ type: "success", message: result.message ?? "", at: result.at, booked: true });
        if (result.data?.booking) onBooked(result.data.booking);
        return;
      }
      setServerErrors(result.fieldErrors ?? {});
      setFeedback({ type: "error", message: result.message ?? "", at: result.at, conflicts: result.data?.conflicts });
    });
  };

  const startOptions = START_TIMES;
  const endOptions = END_TIMES;

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-muted px-4 py-3 text-sm">
        <span className="font-medium">{t("form.resource")}</span>
        <span className="font-semibold">{resource.name}</span>
        {resource.requiresApproval && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            {t("picker.needsApproval")}
          </span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="booking-date" label={t("form.date")} error={errors.date}>
          {(props) => (
            <Input
              {...props}
              type="date"
              name="date"
              min={today}
              max={lastBookableDay(today)}
              value={form.date}
              required
              onChange={(event) => change({ date: event.target.value })}
            />
          )}
        </Field>
        <Field id="booking-start" label={t("form.start")} error={errors.start}>
          {(props) => (
            <Select
              {...props}
              name="start"
              value={form.start}
              onChange={(event) => change({ start: event.target.value, end: keepDuration(event.target.value, form.start, form.end, role) })}
            >
              {!startOptions.includes(form.start) && <option value={form.start}>{form.start}</option>}
              {startOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="booking-end" label={t("form.end")} error={errors.end} hint={duration ? t("form.duration", { duration }) : undefined}>
          {(props) => (
            <Select {...props} name="end" value={form.end} onChange={(event) => change({ end: event.target.value })}>
              {!endOptions.includes(form.end) && <option value={form.end}>{form.end}</option>}
              {endOptions.map((value) => (
                <option key={value} value={value} disabled={minutesOf(value) <= minutesOf(form.start)}>
                  {value}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <p id="booking-rules" className="text-xs text-muted-foreground">
        {t("form.rulesHint", { maxHours, maxDays: MAX_DAYS_AHEAD })}
      </p>

      {overlaps.length > 0 && (
        <div className="flex items-start gap-2 rounded-2xl border border-highlight/50 bg-highlight/15 px-4 py-3 text-sm text-foreground" aria-live="polite">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">{t("form.overlapWarning")}</p>
            <ul className="mt-1 list-disc pl-5">
              {overlaps.map((slot) => (
                <li key={`${slot.startsAt}-${slot.kind}`}>{conflictLabel(slot)}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <Field
        id="booking-purpose"
        label={t("form.purpose")}
        hint={t("form.purposeHint", { min: PURPOSE_MIN, max: PURPOSE_MAX, count: form.purpose.length })}
        error={errors.purpose}
      >
        {(props) => (
          <Textarea
            {...props}
            ref={purposeRef}
            name="purpose"
            rows={3}
            maxLength={PURPOSE_MAX}
            value={form.purpose}
            placeholder={t("form.purposePlaceholder")}
            onChange={(event) => change({ purpose: event.target.value })}
          />
        )}
      </Field>

      {resource.requiresApproval && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t("form.approvalNotice")}
        </p>
      )}
      {upcomingCount !== null && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {limitReached
            ? t("form.studentLimitReached", { limit: STUDENT_BOOKING_LIMIT })
            : t("form.studentLimit", { count: upcomingCount, limit: STUDENT_BOOKING_LIMIT })}
        </p>
      )}
      {!online && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t("form.offline")}
        </p>
      )}

      <InlineFeedback feedback={feedback}>
        {feedback?.conflicts && feedback.conflicts.length > 0 && (
          <ul className="list-disc pl-5">
            {feedback.conflicts.map((conflict) => (
              <li key={`${conflict.startsAt}-${conflict.kind}`}>{conflictLabel(conflict)}</li>
            ))}
          </ul>
        )}
        {feedback?.booked && (
          <Button type="button" variant="link" className="h-auto p-0 text-success underline" onClick={onSeeMine}>
            {t("form.seeMine")}
          </Button>
        )}
      </InlineFeedback>

      <div className="flex justify-end">
        <SubmitButton pending={pending} disabled={!online} className="h-11 w-full rounded-full px-6 shadow-none sm:w-auto">
          {resource.requiresApproval ? t("form.submitRequest") : t("form.submit")}
        </SubmitButton>
      </div>
    </form>
  );
}
