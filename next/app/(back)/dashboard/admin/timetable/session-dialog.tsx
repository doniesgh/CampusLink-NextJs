"use client";

import { useState, useTransition } from "react";
import { Ban, CircleAlert, Loader2, Repeat, RotateCcw, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Feedback } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup } from "@/components/ui/radio-group";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { dateKey, formatTimeRange, timeKey } from "@/lib/datetime";
import { SESSION_TYPES, type ClassSession, type SessionConflict, type SessionScope } from "@/lib/timetable/types";
import type { Group, Room, Subject } from "@/lib/types";
import {
  createSessionAction,
  deleteSessionAction,
  setSessionStatusAction,
  updateSessionAction,
  type SessionActionState,
  type SessionFormField,
  type SessionFormValues,
} from "./actions";
import type { ManagerTeacher } from "./timetable-manager";

export type SessionDefaults = { teacher: string; groups: string[]; room: string; date: string };

const EDITABLE: readonly SessionFormField[] = ["subject", "teacher", "groups", "room", "date", "start", "end", "type", "notes"];

function valuesOf(session: ClassSession | null, defaults: SessionDefaults): SessionFormValues {
  if (!session) {
    return {
      subject: "",
      teacher: defaults.teacher,
      groups: defaults.groups,
      room: defaults.room,
      date: defaults.date,
      start: "08:30",
      end: "10:00",
      type: "LECTURE",
      notes: "",
      repeat: false,
      until: "",
    };
  }
  return {
    subject: session.subject?.id ?? "",
    teacher: session.teacher?.id ?? "",
    groups: session.groups.map((group) => group.id),
    room: session.room?.id ?? "",
    date: dateKey(session.startsAt),
    start: timeKey(session.startsAt),
    end: timeKey(session.endsAt),
    type: session.type,
    notes: session.notes ?? "",
    repeat: false,
    until: "",
  };
}

function sameValue(a: SessionFormValues, b: SessionFormValues, field: SessionFormField): boolean {
  if (field === "groups") return [...a.groups].sort().join(",") === [...b.groups].sort().join(",");
  if (field === "notes") return a.notes.trim() === b.notes.trim();
  return a[field] === b[field];
}

/** role="alert" in the dialog: the error, and for SESSION_CONFLICT ("Conflict: …") the sessions in the way. */
function DialogAlert({ state }: { state: SessionActionState | null }) {
  const t = useTranslations("timetable.manage.conflict");
  const tSession = useTranslations("timetable.session");
  const format = useFormatter();
  if (!state || state.ok || !state.message) return null;
  const conflicts: SessionConflict[] = state.data?.conflicts ?? [];
  return (
    <div
      key={state.at}
      role="alert"
      className="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="space-y-2">
        <p className="font-medium">{state.message}</p>
        {conflicts.length > 0 && (
          <>
            <ul className="list-disc space-y-1 pl-4 text-foreground">
              {conflicts.map((conflict, index) => (
                <li key={`${conflict.sessionId}-${conflict.reason}-${index}`}>
                  {t("item", {
                    reason: t(`reasons.${conflict.reason}`),
                    subject: conflict.subject?.name ?? tSession("unknownSubject"),
                    when:
                      conflict.startsAt && conflict.endsAt
                        ? `${format.dateTime(new Date(conflict.startsAt), "weekdayDayMonth")}, ${formatTimeRange(conflict.startsAt, conflict.endsAt)}`
                        : "",
                  })}
                </li>
              ))}
            </ul>
            <p className="text-foreground">{t("hint")}</p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * "Add session" / edit dialog. Add: "Save session" (+ "Repeat weekly" / "Until"). Edit: "Save changes"
 * (only the changed fields are sent), "Cancel session" -> "Confirm cancellation" (or "Restore session"),
 * "Delete" -> "Confirm delete"; for a series, the radios "This session only" / "This and following
 * sessions" choose the scope of all three. Conflicts stay in the dialog (role="alert" containing
 * "Conflict"); successes close it and are reported in the page (`onDone`).
 */
export function SessionDialog({
  open,
  onOpenChange,
  session,
  defaults,
  subjects,
  teachers,
  groups,
  rooms,
  onDone,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: ClassSession | null;
  defaults: SessionDefaults;
  subjects: Subject[];
  teachers: ManagerTeacher[];
  groups: Group[];
  rooms: Room[];
  onDone: (feedback: Feedback, date?: string) => void;
  /** Where focus goes when the dialog closes (it has no Radix trigger). */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useTranslations("timetable.manage");
  const tTypes = useTranslations("timetable.session.types");
  const [initial] = useState(() => valuesOf(session, defaults));
  const [values, setValues] = useState<SessionFormValues>(initial);
  const [scope, setScope] = useState<SessionScope>("occurrence");
  const [state, setState] = useState<SessionActionState | null>(null);
  const [pending, startTransition] = useTransition();
  const editing = session !== null;
  const series = editing && session.seriesId !== null;
  const cancelled = session?.status === "CANCELLED";
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  const set = <K extends keyof SessionFormValues>(field: K, value: SessionFormValues[K]) =>
    setValues((current) => ({ ...current, [field]: value }));

  const finish = (result: SessionActionState) => {
    if (result.ok) {
      onOpenChange(false);
      onDone({ type: "success", message: result.message ?? "" }, result.data?.date);
    } else {
      setState(result);
    }
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      const result = editing
        ? await updateSessionAction(
            session.id,
            values,
            EDITABLE.filter((field) => !sameValue(values, initial, field)),
            scope
          )
        : await createSessionAction(values);
      finish(result);
    });
  };

  const changeStatus = async (status: "CANCELLED" | "SCHEDULED") => {
    if (!session) return;
    finish(await setSessionStatusAction(session.id, status, scope));
  };

  const remove = async () => {
    if (!session) return;
    finish(await deleteSessionAction(session.id, scope));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-w-2xl" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{editing ? t("form.editTitle") : t("form.addTitle")}</DialogTitle>
          <DialogDescription>{t("form.addDescription")}</DialogDescription>
        </DialogHeader>

        {(series || cancelled) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
            {series && (
              <p className="inline-flex items-center gap-2">
                <Repeat className="h-4 w-4 text-primary" aria-hidden="true" />
                {t("form.seriesInfo")}
              </p>
            )}
            {cancelled && (
              <p className="inline-flex items-center gap-2">
                <Ban className="h-4 w-4 text-destructive" aria-hidden="true" />
                {t("form.cancelledInfo")}
              </p>
            )}
          </div>
        )}

        <form onSubmit={submit} className="space-y-4" noValidate aria-busy={pending || undefined}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="session-subject" label={t("form.subject")} error={errors.subject}>
              {(props) => (
                <Select {...props} value={values.subject} onChange={(event) => set("subject", event.target.value)} required>
                  <option value="">{t("form.chooseSubject")}</option>
                  {subjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name} ({subject.code})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="session-teacher" label={t("form.teacher")} error={errors.teacher}>
              {(props) => (
                <Select {...props} value={values.teacher} onChange={(event) => set("teacher", event.target.value)} required>
                  <option value="">{t("form.chooseTeacher")}</option>
                  {teachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.firstname} {teacher.lastname}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="session-groups" label={t("form.groups")} hint={t("form.groupsHint")} error={errors.groups}>
              {(props) => (
                <Select
                  {...props}
                  multiple
                  value={values.groups}
                  onChange={(event) => set("groups", Array.from(event.target.selectedOptions, (option) => option.value))}
                  required
                >
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name} · {group.program?.code}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="session-room" label={t("form.room")} error={errors.room}>
              {(props) => (
                <Select {...props} value={values.room} onChange={(event) => set("room", event.target.value)}>
                  <option value="">{t("form.noRoom")}</option>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.building ? `${room.name} · ${room.building}` : room.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="session-date" label={t("form.date")} error={errors.date}>
              {(props) => <Input {...props} type="date" value={values.date} onChange={(event) => set("date", event.target.value)} required />}
            </Field>
            <Field id="session-start" label={t("form.start")} error={errors.start}>
              {(props) => (
                <Input {...props} type="time" step={300} value={values.start} onChange={(event) => set("start", event.target.value)} required />
              )}
            </Field>
            <Field id="session-end" label={t("form.end")} error={errors.end}>
              {(props) => (
                <Input {...props} type="time" step={300} value={values.end} onChange={(event) => set("end", event.target.value)} required />
              )}
            </Field>
          </div>

          <Field id="session-type" label={t("form.type")} error={errors.type} className="sm:max-w-xs">
            {(props) => (
              <Select {...props} value={values.type} onChange={(event) => set("type", event.target.value)}>
                {SESSION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {tTypes(type)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field id="session-notes" label={t("form.notes")} error={errors.notes}>
            {(props) => (
              <Textarea {...props} rows={2} maxLength={1000} value={values.notes} onChange={(event) => set("notes", event.target.value)} />
            )}
          </Field>

          {!editing && (
            <div className="space-y-4 rounded-2xl border p-4">
              <CheckboxField
                id="session-repeat"
                label={t("form.repeat")}
                description={t("form.repeatHint")}
                checked={values.repeat}
                onChange={(event) => set("repeat", event.target.checked)}
              />
              {values.repeat && (
                <Field id="session-until" label={t("form.until")} hint={t("form.untilHint")} error={errors.until} className="sm:max-w-xs">
                  {(props) => (
                    <Input {...props} type="date" min={values.date} value={values.until} onChange={(event) => set("until", event.target.value)} required />
                  )}
                </Field>
              )}
            </div>
          )}

          {series && (
            <RadioGroup
              legend={t("form.scope")}
              name="scope"
              value={scope}
              onValueChange={(value) => setScope(value as SessionScope)}
              className="rounded-2xl border p-4"
              options={[
                { value: "occurrence", label: t("form.scopeOccurrence") },
                { value: "series", label: t("form.scopeSeries") },
              ]}
            />
          )}

          <DialogAlert state={state} />

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            {editing ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <ConfirmDialog
                  trigger={
                    <Button type="button" variant="outline" className="rounded-full text-destructive hover:text-destructive" disabled={pending}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      {t("form.delete")}
                    </Button>
                  }
                  title={t("confirmDelete.title")}
                  description={scope === "series" ? t("confirmDelete.seriesDescription") : t("confirmDelete.description")}
                  confirmLabel={t("confirmDelete.confirm")}
                  onConfirm={remove}
                />
                {cancelled ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full"
                    disabled={pending}
                    onClick={() => startTransition(() => changeStatus("SCHEDULED"))}
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    {t("form.restoreSession")}
                  </Button>
                ) : (
                  <ConfirmDialog
                    trigger={
                      <Button type="button" variant="outline" className="rounded-full" disabled={pending}>
                        <Ban className="h-4 w-4" aria-hidden="true" />
                        {t("form.cancelSession")}
                      </Button>
                    }
                    title={t("confirmCancel.title")}
                    description={scope === "series" ? t("confirmCancel.seriesDescription") : t("confirmCancel.description")}
                    confirmLabel={t("confirmCancel.confirm")}
                    cancelLabel={t("confirmCancel.keep")}
                    onConfirm={() => changeStatus("CANCELLED")}
                  />
                )}
              </div>
            ) : (
              <span />
            )}
            <Button type="submit" className="rounded-full px-6" disabled={pending} aria-busy={pending || undefined}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {editing ? t("form.saveChanges") : t("form.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
