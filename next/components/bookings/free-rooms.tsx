"use client";

import { useState } from "react";
import { CalendarSearch, CloudOff, RefreshCw, SearchCheck, ShieldCheck, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { resourceIcon } from "@/components/bookings/resource-icon";
import { useBookingFormat } from "@/components/bookings/use-booking-format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SkeletonList } from "@/components/ui/skeleton";
import { dateKey, isDateKey, zonedTimeToUtc } from "@/lib/datetime";
import { useErrorFormatter } from "@/lib/i18n/client";
import { useOfflineQuery } from "@/lib/offline";
import { END_TIMES, keepDuration, lastBookableDay, minutesOf, START_TIMES, suggestSlot } from "@/lib/bookings/rules";
import { roomRequiresApproval, type BookableRoom } from "@/lib/bookings/types";
import { ROOM_TYPES, type Role, type RoomType } from "@/lib/types";
import type { PickedSlot } from "@/components/bookings/availability-panel";

type Criteria = { date: string; start: string; end: string; minCapacity: string; type: RoomType | "" };

function searchPath(criteria: Criteria): string {
  const params = new URLSearchParams({
    from: zonedTimeToUtc(criteria.date, criteria.start).toISOString(),
    to: zonedTimeToUtc(criteria.date, criteria.end).toISOString(),
  });
  const capacity = Number.parseInt(criteria.minCapacity, 10);
  if (Number.isInteger(capacity) && capacity > 0) params.set("minCapacity", String(capacity));
  if (criteria.type) params.set("type", criteria.type);
  return `/bookings/free-rooms?${params}`;
}

/** Problems of the search form (field -> message key). */
function validate(criteria: Criteria): Partial<Record<keyof Criteria, "required" | "END_BEFORE_START" | "capacity">> {
  const problems: Partial<Record<keyof Criteria, "required" | "END_BEFORE_START" | "capacity">> = {};
  if (!isDateKey(criteria.date)) problems.date = "required";
  if (!(minutesOf(criteria.end) > minutesOf(criteria.start))) problems.end = "END_BEFORE_START";
  if (criteria.minCapacity) {
    const capacity = Number(criteria.minCapacity);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) problems.minCapacity = "capacity";
  }
  return problems;
}

/**
 * "Find a free room": date, start / end time, minimum capacity and room type -> the bookable rooms free for
 * the whole interval (GET /bookings/free-rooms), each with "Book this room".
 */
export function FreeRooms({
  role,
  now,
  online,
  onBook,
}: {
  role: Role;
  now: number;
  online: boolean;
  onBook: (room: BookableRoom, slot: PickedSlot) => void;
}) {
  const t = useTranslations("bookings.free");
  const tRules = useTranslations("bookings.rules");
  const tRoomTypes = useTranslations("bookings.roomTypes");
  const tPicker = useTranslations("bookings.picker");
  const tStates = useTranslations("common.states");
  const tActions = useTranslations("common.actions");
  const errorsFormatter = useErrorFormatter();
  const fmt = useBookingFormat();
  const [criteria, setCriteria] = useState<Criteria>(() => ({ ...suggestSlot(now), minCapacity: "", type: "" }));
  const [submitted, setSubmitted] = useState<Criteria | null>(() => (Object.keys(validate(criteria)).length === 0 ? criteria : null));
  const [showErrors, setShowErrors] = useState(false);

  const problems = validate(criteria);
  const fieldError = (field: keyof Criteria) => {
    const problem = showErrors ? problems[field] : undefined;
    if (!problem) return undefined;
    if (problem === "END_BEFORE_START") return tRules("END_BEFORE_START");
    if (problem === "capacity") return t("capacityInvalid");
    return tRules("required");
  };

  const path = submitted ? searchPath(submitted) : null;
  const { data, isLoading, isValidating, error, refresh } = useOfflineQuery<BookableRoom[]>(
    ["bookings", "free", submitted?.date ?? "", submitted?.start ?? "", submitted?.end ?? "", submitted?.minCapacity ?? "", submitted?.type ?? ""],
    online ? path : null,
    { revalidateOnFocus: false, reportLastUpdated: false }
  );
  const rooms = Array.isArray(data) ? data : [];
  const today = dateKey(now);
  const inPast = submitted ? zonedTimeToUtc(submitted.date, submitted.end).getTime() <= now : false;

  const change = (patch: Partial<Criteria>) => setCriteria((current) => ({ ...current, ...patch }));

  let results: React.ReactNode = null;
  if (!online) {
    results = <EmptyState icon={CloudOff} headingLevel="h3" title={t("offline")} />;
  } else if (!submitted) {
    results = <EmptyState icon={CalendarSearch} headingLevel="h3" title={t("prompt")} />;
  } else if (isLoading) {
    results = <SkeletonList rows={3} label={tStates("loading")} />;
  } else if (!data && error) {
    results = (
      <EmptyState
        icon={RefreshCw}
        headingLevel="h3"
        title={t("loadError")}
        description={errorsFormatter.message(error)}
        action={
          <Button variant="outline" className="rounded-full" onClick={() => void refresh()} disabled={isValidating}>
            {tActions("tryAgain")}
          </Button>
        }
      />
    );
  } else if (rooms.length === 0) {
    results = <EmptyState icon={SearchCheck} headingLevel="h3" title={t("none")} description={t("noneHint")} />;
  } else {
    results = (
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rooms.map((room) => {
          const Icon = resourceIcon("ROOM");
          return (
            <li key={room.id} data-room-id={room.id} className="flex flex-col gap-3 rounded-3xl border bg-card p-4 text-card-foreground">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 space-y-1">
                  <h3 className="break-words text-base font-semibold leading-tight">{room.name}</h3>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>{[tRoomTypes(room.type), room.building].filter(Boolean).join(" · ")}</span>
                    {room.capacity ? (
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" aria-hidden="true" />
                        {tPicker("capacity", { count: room.capacity })}
                      </span>
                    ) : null}
                  </p>
                  {roomRequiresApproval(room) && (
                    <Badge variant="warning" className="px-2 py-0 text-[11px]">
                      <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                      {tPicker("needsApproval")}
                    </Badge>
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                className="mt-auto self-start rounded-full"
                aria-label={t("bookThisLabel", { name: room.name })}
                onClick={() =>
                  onBook(room, {
                    date: submitted.date,
                    start: submitted.start,
                    end: keepDuration(submitted.start, submitted.start, submitted.end, role),
                  })
                }
              >
                {t("bookThis")}
              </Button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="space-y-5">
      <form
        role="search"
        aria-label={t("title")}
        noValidate
        className="space-y-4 rounded-3xl border bg-card p-4 text-card-foreground sm:p-5"
        onSubmit={(event) => {
          event.preventDefault();
          setShowErrors(true);
          if (Object.keys(problems).length === 0) setSubmitted({ ...criteria });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Field id="free-date" label={t("date")} error={fieldError("date")}>
            {(props) => (
              <Input {...props} type="date" min={today} max={lastBookableDay(today)} value={criteria.date} onChange={(event) => change({ date: event.target.value })} />
            )}
          </Field>
          <Field id="free-start" label={t("start")} error={fieldError("start")}>
            {(props) => (
              <Select
                {...props}
                value={criteria.start}
                onChange={(event) => change({ start: event.target.value, end: keepDuration(event.target.value, criteria.start, criteria.end, "ADMIN") })}
              >
                {START_TIMES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="free-end" label={t("end")} error={fieldError("end")}>
            {(props) => (
              <Select {...props} value={criteria.end} onChange={(event) => change({ end: event.target.value })}>
                {END_TIMES.map((value) => (
                  <option key={value} value={value} disabled={minutesOf(value) <= minutesOf(criteria.start)}>
                    {value}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="free-capacity" label={t("minCapacity")} error={fieldError("minCapacity")}>
            {(props) => (
              <Input
                {...props}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={criteria.minCapacity}
                onChange={(event) => change({ minCapacity: event.target.value })}
              />
            )}
          </Field>
          <Field id="free-type" label={t("roomType")}>
            {(props) => (
              <Select {...props} value={criteria.type} onChange={(event) => change({ type: event.target.value as RoomType | "" })}>
                <option value="">{t("anyType")}</option>
                {ROOM_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {tRoomTypes(value)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="flex justify-end">
          <Button type="submit" className="w-full rounded-full sm:w-auto" disabled={!online || isValidating}>
            <SearchCheck className="h-4 w-4" aria-hidden="true" />
            {t("submit")}
          </Button>
        </div>
      </form>

      <section aria-labelledby="free-results" className="space-y-3">
        <h2 id="free-results" className="text-lg font-semibold">
          {submitted && online && data
            ? t("results", { count: rooms.length, when: fmt.when(zonedTimeToUtc(submitted.date, submitted.start).getTime(), zonedTimeToUtc(submitted.date, submitted.end).getTime()) })
            : t("resultsTitle")}
        </h2>
        {inPast && online && <p className="text-sm text-muted-foreground">{t("pastHint")}</p>}
        {results}
      </section>
    </div>
  );
}
