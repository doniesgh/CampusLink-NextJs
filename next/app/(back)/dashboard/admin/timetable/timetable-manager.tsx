"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, CircleAlert, FileUp, SearchX } from "lucide-react";
import { useTranslations } from "next-intl";
import { NoClasses, useWeekLabel, WeekGrid } from "@/components/timetable/period-views";
import { PeriodToolbar } from "@/components/timetable/timetable-view";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback, useFeedback, type Feedback } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addDays, startOfWeek, type DateKey } from "@/lib/datetime";
import type { ClassSession } from "@/lib/timetable/types";
import type { Group, Room, Subject } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ImportDialog } from "./import-dialog";
import { SessionDialog, type SessionDefaults } from "./session-dialog";

export type TargetKind = "group" | "teacher" | "room";
export type ManagerTeacher = { id: string; firstname: string; lastname: string; email: string };

const TARGET_KINDS: readonly TargetKind[] = ["group", "teacher", "room"];

type DialogState = { open: boolean; session: ClassSession | null; key: number };

export function groupLabel(group: Group): string {
  return [group.name, group.program?.code, group.academicYear].filter(Boolean).join(" · ");
}

export function roomLabel(room: Room): string {
  return room.building ? `${room.name} · ${room.building}` : room.name;
}

export function TimetableManager({
  by: serverBy,
  targetId: serverTargetId,
  date: serverDate,
  today,
  groups,
  subjects,
  rooms,
  teachers,
  sessions,
  weekError,
}: {
  by: TargetKind;
  targetId: string | null;
  date: DateKey;
  today: DateKey;
  groups: Group[];
  subjects: Subject[];
  rooms: Room[];
  teachers: ManagerTeacher[];
  sessions: ClassSession[];
  weekError: string | null;
}) {
  const t = useTranslations("timetable");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // The tab, target and week show the new choice at once, while the server renders its week.
  const [current, setCurrent] = useOptimistic({ by: serverBy, targetId: serverTargetId, date: serverDate });
  const { by, targetId, date } = current;
  const [feedback, setFeedback] = useFeedback();
  const [dialog, setDialog] = useState<DialogState>({ open: false, session: null, key: 0 });
  const [importKey, setImportKey] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  // The dialogs are opened from several places (no Radix trigger): focus goes back to the opener on close.
  const opener = useRef<HTMLElement | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const rememberOpener = () => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    const target = opener.current?.isConnected ? opener.current : addButton.current;
    target?.focus();
  };

  const monday = startOfWeek(date);
  const targets: { id: string; label: string }[] =
    by === "group"
      ? groups.map((group) => ({ id: group.id, label: groupLabel(group) }))
      : by === "teacher"
        ? teachers.map((teacher) => ({ id: teacher.id, label: `${teacher.firstname} ${teacher.lastname}` }))
        : rooms.map((room) => ({ id: room.id, label: roomLabel(room) }));

  const go = (patch: { by?: TargetKind; id?: string | null; date?: DateKey }) => {
    const next = {
      by: patch.by ?? by,
      targetId: patch.id === undefined ? targetId : patch.id,
      date: patch.date ?? date,
    };
    const params = new URLSearchParams({ by: next.by });
    if (next.targetId) params.set("id", next.targetId);
    params.set("date", next.date);
    startTransition(() => {
      setCurrent(next);
      router.push(`/dashboard/admin/timetable?${params}`, { scroll: false });
    });
  };

  const firstTargetOf = (kind: TargetKind) =>
    (kind === "group" ? groups[0]?.id : kind === "teacher" ? teachers[0]?.id : rooms[0]?.id) ?? null;

  const defaults: SessionDefaults = {
    teacher: by === "teacher" && targetId ? targetId : "",
    groups: by === "group" && targetId ? [targetId] : [],
    room: by === "room" && targetId ? targetId : "",
    date: today >= monday && today < addDays(monday, 7) ? today : monday,
  };

  const openSession = (session: ClassSession | null) => {
    rememberOpener();
    setDialog((d) => ({ open: true, session, key: d.key + 1 }));
  };

  const onSaved = (result: Feedback, savedDate?: string) => {
    setFeedback(result);
    if (savedDate && startOfWeek(savedDate) !== monday) go({ date: savedDate });
  };

  const weekLabel = useWeekLabel()(monday);

  const panel = (
    <div className="space-y-5">
      {targets.length === 0 ? (
        <EmptyState icon={SearchX} title={t(`manage.noTargets.${by}`)} headingLevel="h2" />
      ) : (
        <>
          <div className="max-w-md space-y-1.5">
            <label htmlFor="timetable-target" className="block text-sm font-medium">
              {t("manage.showFor")}
            </label>
            <Select id="timetable-target" value={targetId ?? ""} onChange={(event) => go({ id: event.target.value })}>
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label}
                </option>
              ))}
            </Select>
          </div>

          <PeriodToolbar
            view="week"
            periodLabel={weekLabel}
            onPrevious={() => go({ date: addDays(date, -7) })}
            onToday={() => go({ date: today })}
            onNext={() => go({ date: addDays(date, 7) })}
          />

          <div aria-busy={pending || undefined} className={cn("transition-opacity", pending && "opacity-60")}>
            {pending && <span className="sr-only">{t("manage.loading")}</span>}
            {weekError ? (
              <EmptyState icon={CircleAlert} title={t("loadError")} description={weekError} />
            ) : sessions.length === 0 ? (
              <NoClasses />
            ) : (
              <WeekGrid monday={startOfWeek(serverDate)} sessions={sessions} allSessions={sessions} today={today} onOpen={openSession} />
            )}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("managementTitle")}
        description={t("managementSubtitle")}
        actions={
          <>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => {
                rememberOpener();
                setImportKey((key) => key + 1);
                setImportOpen(true);
              }}
            >
              <FileUp className="h-4 w-4" aria-hidden="true" />
              {t("manage.import")}
            </Button>
            <Button ref={addButton} className="rounded-full" onClick={() => openSession(null)}>
              <CalendarPlus className="h-4 w-4" aria-hidden="true" />
              {t("manage.add")}
            </Button>
          </>
        }
      />

      <InlineFeedback feedback={feedback} />

      <Tabs value={by} activationMode="manual" onValueChange={(value) => go({ by: value as TargetKind, id: firstTargetOf(value as TargetKind) })}>
        <TabsList aria-label={t("manage.tabsLabel")}>
          {TARGET_KINDS.map((kind) => (
            <TabsTrigger key={kind} value={kind}>
              {t(`manage.tabs.${kind}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {TARGET_KINDS.map((kind) => (
          <TabsContent key={kind} value={kind}>
            {kind === by && panel}
          </TabsContent>
        ))}
      </Tabs>

      <SessionDialog
        key={dialog.key}
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        session={dialog.session}
        defaults={defaults}
        subjects={subjects}
        teachers={teachers}
        groups={groups}
        rooms={rooms}
        onDone={onSaved}
        onCloseAutoFocus={restoreFocus}
      />
      <ImportDialog
        key={`import-${importKey}`}
        open={importOpen}
        onOpenChange={setImportOpen}
        onDone={setFeedback}
        onCloseAutoFocus={restoreFocus}
      />
    </div>
  );
}
