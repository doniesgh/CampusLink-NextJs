"use client";

import { startTransition as startBackgroundTransition, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import Link from "@/components/ui/app-link";
import { useRouter } from "next/navigation";
import { CalendarClock, FileUp, Loader2, Lock, Paperclip, Send, Users, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useFileSize } from "@/components/announcements/attachment-list";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { InlineFeedback, useFeedback } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { addDays, APP_TIMEZONE, dateKey, timeKey, todayKey, zonedTimeToUtc } from "@/lib/datetime";
import { useErrorFormatter } from "@/lib/i18n/client";
import { useOnlineStatus } from "@/lib/offline";
import { manageHref } from "@/lib/announcements/paths";
import type { AudienceOptions } from "@/lib/announcements/server";
import {
  ATTACHMENT_ACCEPT,
  BODY_MAX_LENGTH,
  hasAttachmentExtension,
  MAX_ATTACHMENTS,
  MAX_FILE_MB,
  PRIORITIES,
  TITLE_MAX_LENGTH,
  type Announcement,
  type AudienceInput,
  type Priority,
} from "@/lib/announcements/types";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import { previewAudienceAction, saveAnnouncementAction, type PreviewResult, type SaveIntent } from "@/app/(back)/dashboard/admin/announcements/actions";

const PREVIEW_DELAY_MS = 350;
const MIN_SCHEDULE_DELAY_MS = 60_000;

function toLocalInput(iso: string | null | undefined): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return "";
  return `${dateKey(iso)}T${timeKey(iso)}`;
}

function fromLocalInput(value: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const date = zonedTimeToUtc(match[1], match[2]);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toggle<T>(list: T[], value: T, on: boolean): T[] {
  return on ? (list.includes(value) ? list : [...list, value]) : list.filter((item) => item !== value);
}

/** Pill-shaped native checkbox (keyboard, screen readers and `getByLabel(...).check()` work as usual). */
function ChoiceChip({
  name,
  value,
  checked,
  onChange,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        "inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border border-input bg-background px-3 py-1.5 text-sm text-foreground transition-colors",
        "hover:bg-accent has-[:checked]:border-primary has-[:checked]:bg-accent has-[:checked]:font-semibold has-[:checked]:text-accent-foreground",
        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
        "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
      )}
    >
      <input
        id={id}
        type="checkbox"
        name={name}
        value={value}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 shrink-0 accent-primary focus-visible:outline-none"
      />
      {children}
    </label>
  );
}

/** One criterion of the audience: a fieldset (legend "Roles", "Programs", ...) of chips. */
function CriterionFieldset({ legend, empty, children }: { legend: string; empty?: string | null; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-foreground">{legend}</legend>
      {empty ? <p className="text-sm text-muted-foreground">{empty}</p> : <div className="flex flex-wrap gap-2">{children}</div>}
    </fieldset>
  );
}

function SectionCard({ title, icon: Icon, children, className }: { title?: string; icon?: typeof Users; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-5 rounded-3xl border bg-card p-5 text-card-foreground sm:p-6", className)}>
      {title && (
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          {Icon && <Icon className="h-5 w-5 text-primary" aria-hidden="true" />}
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}

type PreviewState = { key: string; result: PreviewResult } | null;

/**
 * Composer of /dashboard/admin/announcements/new and /[id]/edit (contract 9.4 labels): "Title", "Message",
 * "Priority", fieldset "Audience" ("Roles", "Programs", "Levels", "Groups") with a live "<n> recipients",
 * file input "Attachments", checkbox "Publish later" + "Publish at", buttons "Save draft", "Publish now"
 * (or "Schedule" when "Publish later" is checked). A published announcement only edits its title, message
 * and priority ("Save changes").
 */
export function AnnouncementForm({
  announcement,
  options,
  optionsError,
}: {
  announcement?: Announcement | null;
  options: AudienceOptions;
  optionsError?: string | null;
}) {
  const t = useTranslations("announcements.form");
  const tPriority = useTranslations("announcements.priority");
  const tAudience = useTranslations("announcements.audience");
  const tRoles = useTranslations("common.roles");
  const tActions = useTranslations("common.actions");
  const errors = useErrorFormatter();
  const fileSize = useFileSize();
  const router = useRouter();
  const online = useOnlineStatus();
  const [saving, startSaving] = useTransition();
  const [submitted, setSubmitted] = useState<SaveIntent | null>(null);
  const [feedback, setFeedback] = useFeedback();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Fixing a field clears its error; the form's alert goes away once every reported field is fixed.
  const clearError = (field: string) => {
    if (!(field in fieldErrors)) return;
    const next = { ...fieldErrors };
    delete next[field];
    setFieldErrors(next);
    if (Object.keys(next).length === 0) setFeedback(null);
  };

  const editing = !!announcement;
  const locked = announcement?.status === "PUBLISHED";

  const [title, setTitle] = useState(announcement?.title ?? "");
  const [body, setBody] = useState(announcement?.body ?? "");
  const [priority, setPriority] = useState<Priority>(announcement?.priority ?? "NORMAL");
  const [roles, setRoles] = useState<Role[]>(announcement?.audience?.roles ?? []);
  const [programs, setPrograms] = useState<string[]>((announcement?.audience?.programs ?? []).map((p) => p.id));
  const [levels, setLevels] = useState<number[]>(announcement?.audience?.levels ?? []);
  const [groups, setGroups] = useState<string[]>((announcement?.audience?.groups ?? []).map((g) => g.id));
  const [publishLater, setPublishLater] = useState(
    announcement?.status === "SCHEDULED" || (announcement?.status === "DRAFT" && !!announcement.publishAt)
  );
  const [publishAt, setPublishAt] = useState(toLocalInput(announcement?.publishAt));
  const [files, setFiles] = useState<File[]>([]);
  const [removeIds, setRemoveIds] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  // Options + what the announcement already targets (e.g. a group the teacher no longer teaches).
  const roleOptions = useMemo(() => [...new Set<Role>([...options.roles, ...(announcement?.audience?.roles ?? [])])], [options.roles, announcement]);
  const programOptions = useMemo(() => {
    const list = [...options.programs];
    for (const program of announcement?.audience?.programs ?? []) {
      if (!list.some((item) => item.id === program.id)) list.push({ id: program.id, name: program.name, code: program.code });
    }
    return list;
  }, [options.programs, announcement]);
  const levelOptions = useMemo(
    () => [...new Set([...options.levels, ...(announcement?.audience?.levels ?? [])])].sort((a, b) => a - b),
    [options.levels, announcement]
  );
  const groupOptions = useMemo(() => {
    const list = options.groups.map((group) => ({ id: group.id, name: group.name, detail: group.programCode }));
    for (const group of announcement?.audience?.groups ?? []) {
      if (!list.some((item) => item.id === group.id)) list.push({ id: group.id, name: group.name, detail: "" });
    }
    const counts = new Map<string, number>();
    for (const group of options.groups) counts.set(group.name, (counts.get(group.name) ?? 0) + 1);
    return list.map((group) => {
      const option = options.groups.find((item) => item.id === group.id);
      const duplicate = (counts.get(group.name) ?? 0) > 1 && option;
      return { ...group, label: duplicate ? `${group.name} (${option.academicYear})` : group.name };
    });
  }, [options.groups, announcement]);

  const existingFiles = announcement?.attachments ?? [];
  const keptCount = existingFiles.filter((file) => !removeIds.includes(file.id)).length;

  // ---------- live "<n> recipients" ----------
  const audience: AudienceInput = useMemo(() => ({ roles, programs, levels, groups }), [roles, programs, levels, groups]);
  const audienceKey = JSON.stringify(audience);
  const [preview, setPreview] = useState<PreviewState>(null);
  const previewSeq = useRef(0);

  useEffect(() => {
    if (locked || !online) return;
    const seq = ++previewSeq.current;
    const timer = setTimeout(() => {
      startBackgroundTransition(async () => {
        let result: PreviewResult;
        try {
          result = await previewAudienceAction(JSON.parse(audienceKey) as AudienceInput);
        } catch {
          result = { ok: false, reason: "ERROR" };
        }
        if (seq === previewSeq.current) setPreview({ key: audienceKey, result });
      });
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [audienceKey, locked, online]);

  const audienceEmpty = roles.length + programs.length + levels.length + groups.length === 0;
  let previewText: string;
  let previewPending = false;
  if (locked) {
    previewText = t("recipients", { count: announcement?.stats?.recipients ?? 0 });
  } else if (!online) {
    previewText = t("previewOffline");
  } else if (!preview || preview.key !== audienceKey) {
    previewPending = true;
    previewText = preview?.result.ok ? t("recipients", { count: preview.result.recipients }) : t("previewLoading");
  } else if (preview.result.ok) {
    previewText = t("recipients", { count: preview.result.recipients });
  } else if (preview.result.reason === "ERROR") {
    previewText = t("previewError");
  } else {
    previewText = t(`previewHints.${preview.result.reason}`);
  }

  // ---------- attachments ----------
  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const picked = [...list];
    const room = MAX_ATTACHMENTS - keptCount - files.length;
    const problems: string[] = [];
    const accepted: File[] = [];
    for (const file of picked) {
      if (!hasAttachmentExtension(file.name)) problems.push(t("errors.fileType", { name: file.name }));
      else if (file.size > MAX_FILE_MB * 1024 * 1024) problems.push(t("errors.fileTooLargeNamed", { name: file.name, max: MAX_FILE_MB }));
      else if (accepted.length >= room) {
        problems.push(t("errors.tooManyFiles", { max: MAX_ATTACHMENTS }));
        break;
      } else accepted.push(file);
    }
    setFiles((current) => [...current, ...accepted]);
    setFieldErrors((current) => {
      const next = { ...current };
      if (problems.length > 0) next.attachments = problems.join(" ");
      else delete next.attachments;
      return next;
    });
    if (fileInput.current) fileInput.current.value = "";
  };

  // ---------- submit ----------
  const validate = (intent: SaveIntent): Record<string, string> => {
    const problems: Record<string, string> = {};
    if (!title.trim()) problems.title = t("errors.titleRequired");
    else if (title.trim().length > TITLE_MAX_LENGTH) problems.title = t("errors.titleTooLong", { max: TITLE_MAX_LENGTH });
    if (!body.trim()) problems.body = t("errors.bodyRequired");
    else if (body.length > BODY_MAX_LENGTH) problems.body = t("errors.bodyTooLong", { max: BODY_MAX_LENGTH });
    if (intent === "schedule") {
      const date = fromLocalInput(publishAt);
      if (!date) problems.publishAt = t("errors.publishAtRequired");
      else if (date.getTime() < Date.now() + MIN_SCHEDULE_DELAY_MS) problems.publishAt = t("errors.publishAtPast");
    }
    if (options.teacherRestricted && intent !== "update" && intent !== "draft" && groups.length === 0) {
      problems.audience = t("errors.audience.GROUPS_REQUIRED");
    }
    return problems;
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const fallback: SaveIntent = locked ? "update" : "draft";
    const intent = (submitter?.value as SaveIntent | undefined) || fallback;

    const problems = validate(intent);
    setFieldErrors(problems);
    if (Object.keys(problems).length > 0) {
      setFeedback({ type: "error", message: Object.values(problems).join(" ") });
      const firstField = Object.keys(problems)[0];
      const target = document.getElementById(`announcement-${firstField}`);
      target?.focus();
      return;
    }
    if (!online) {
      setFeedback({ type: "error", message: t("offline") });
      return;
    }

    const formData = new FormData();
    formData.set("intent", intent);
    if (announcement) formData.set("id", announcement.id);
    formData.set("title", title);
    formData.set("body", body);
    formData.set("priority", priority);
    if (!locked) {
      roles.forEach((role) => formData.append("roles", role));
      programs.forEach((id) => formData.append("programs", id));
      levels.forEach((level) => formData.append("levels", String(level)));
      groups.forEach((id) => formData.append("groups", id));
      if (publishLater) {
        formData.set("publishLater", "on");
        formData.set("publishAt", publishAt);
      }
      removeIds.forEach((id) => formData.append("removeAttachments", id));
      formData.set("keptAttachments", String(keptCount));
      files.forEach((file) => formData.append("attachments", file, file.name));
    }

    setSubmitted(intent);
    setFeedback(null);
    startSaving(async () => {
      try {
        const result = await saveAnnouncementAction(formData);
        if (result?.ok && result.data?.href) {
          router.push(result.data.href);
          return;
        }
        setFieldErrors(result?.fieldErrors ?? {});
        setFeedback({ type: "error", message: result?.message || errors.forCode("GENERIC") });
      } catch {
        setFeedback({ type: "error", message: errors.forCode("NETWORK_ERROR") });
      }
    });
  };

  if (options.teacherRestricted && options.groups.length === 0 && !editing) {
    return (
      <InlineFeedback
        feedback={{ type: optionsError ? "error" : "info", message: optionsError ?? t("noTaughtGroups") }}
      />
    );
  }

  const busy = saving;
  const spinner = (intent: SaveIntent) =>
    busy && submitted === intent ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6" aria-busy={busy || undefined}>
      <SectionCard>
        <Field
          id="announcement-title"
          label={t("title")}
          hint={t("titleHint", { count: title.trim().length, max: TITLE_MAX_LENGTH })}
          error={fieldErrors.title}
        >
          {(props) => (
            <Input {...props} name="title" value={title} maxLength={TITLE_MAX_LENGTH} required autoComplete="off" onChange={(event) => {
                setTitle(event.target.value);
                clearError("title");
              }}
            />
          )}
        </Field>
        <Field id="announcement-body" label={t("message")} hint={t("messageHint")} error={fieldErrors.body}>
          {(props) => (
            <Textarea {...props} name="body" value={body} rows={9} maxLength={BODY_MAX_LENGTH} required onChange={(event) => {
                setBody(event.target.value);
                clearError("body");
              }}
            />
          )}
        </Field>
        <Field id="announcement-priority" label={t("priority")} hint={t("priorityHint")} error={fieldErrors.priority} className="sm:max-w-xs">
          {(props) => (
            <Select {...props} name="priority" value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>
              {[...PRIORITIES].reverse().map((value) => (
                <option key={value} value={value}>
                  {tPriority(value)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </SectionCard>

      <fieldset
        disabled={locked || busy}
        aria-describedby="announcement-audience-hint announcement-audience-count"
        className="space-y-5 rounded-3xl border bg-card p-5 text-card-foreground sm:p-6"
      >
        <legend className="sr-only">{t("audience")}</legend>
        <div aria-hidden="true" className="flex items-center gap-2 text-lg font-semibold">
          <Users className="h-5 w-5 text-primary" />
          {t("audience")}
        </div>
        <p id="announcement-audience-hint" className="-mt-3 text-sm text-muted-foreground">
          {locked ? t("audienceLocked") : options.teacherRestricted ? t("audienceHintTeacher") : t("audienceHint")}
        </p>
        {optionsError && <p className="text-sm text-destructive">{optionsError}</p>}

        <div className="grid gap-5 lg:grid-cols-2">
          <CriterionFieldset legend={t("roles")} empty={roleOptions.length === 0 ? t("noOptions") : null}>
            {roleOptions.map((role) => (
              <ChoiceChip key={role} name="roles" value={role} checked={roles.includes(role)} onChange={(on) => setRoles((list) => toggle(list, role, on))}>
                {tRoles(role)}
              </ChoiceChip>
            ))}
          </CriterionFieldset>
          <CriterionFieldset legend={t("levels")} empty={levelOptions.length === 0 ? t("noOptions") : null}>
            {levelOptions.map((level) => (
              <ChoiceChip
                key={level}
                name="levels"
                value={String(level)}
                checked={levels.includes(level)}
                onChange={(on) => setLevels((list) => toggle(list, level, on).sort((a, b) => a - b))}
              >
                {tAudience("levelLabel", { level })}
              </ChoiceChip>
            ))}
          </CriterionFieldset>
          <CriterionFieldset legend={t("programs")} empty={programOptions.length === 0 ? t("noOptions") : null}>
            {programOptions.map((program) => (
              <ChoiceChip
                key={program.id}
                name="programs"
                value={program.id}
                checked={programs.includes(program.id)}
                onChange={(on) => setPrograms((list) => toggle(list, program.id, on))}
              >
                <span>{program.code || program.name}</span>
                {program.code && program.name && <span className="sr-only"> · {program.name}</span>}
              </ChoiceChip>
            ))}
          </CriterionFieldset>
          <CriterionFieldset legend={t("groups")} empty={groupOptions.length === 0 ? t("noGroups") : null}>
            {groupOptions.map((group) => (
              <ChoiceChip key={group.id} name="groups" value={group.id} checked={groups.includes(group.id)} onChange={(on) => {
                  setGroups((list) => toggle(list, group.id, on));
                  clearError("audience");
                }}
              >
                {group.label}
              </ChoiceChip>
            ))}
          </CriterionFieldset>
        </div>

        <div className="flex flex-col gap-1 rounded-2xl bg-accent/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p id="announcement-audience-count" aria-live="polite" className="flex items-center gap-2 text-sm font-semibold text-accent-foreground">
            {previewPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            <span data-testid="audience-recipients">{previewText}</span>
          </p>
          {!locked && audienceEmpty && !options.teacherRestricted && <p className="text-sm text-muted-foreground">{t("everyoneNote")}</p>}
        </div>
        {fieldErrors.audience && (
          <p id="announcement-audience" tabIndex={-1} className="text-sm text-destructive">
            {fieldErrors.audience}
          </p>
        )}
      </fieldset>

      <SectionCard title={t("attachmentsSection")} icon={Paperclip}>
        {existingFiles.length > 0 && (
          <ul className="space-y-2">
            {existingFiles.map((file) => {
              const removed = removeIds.includes(file.id);
              return (
                <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border bg-background px-3 py-2">
                  <span className={cn("min-w-0 break-all text-sm", removed && "text-muted-foreground line-through")}>
                    {file.filename} <span className="text-xs text-muted-foreground">· {fileSize(file.size)}</span>
                  </span>
                  {!locked && (
                    <CheckboxField
                      id={`remove-attachment-${file.id}`}
                      label={t("removeFile", { name: file.filename })}
                      checked={removed}
                      disabled={busy}
                      onChange={(event) => setRemoveIds((list) => toggle(list, file.id, event.target.checked))}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {locked ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Lock className="h-4 w-4" aria-hidden="true" />
            {t("attachmentsLocked")}
          </p>
        ) : (
          <>
            <Field
              id="announcement-attachments"
              label={t("attachments")}
              hint={t("attachmentsHint", { max: MAX_ATTACHMENTS, size: MAX_FILE_MB })}
              error={fieldErrors.attachments}
            >
              {(props) => (
                <Input
                  {...props}
                  ref={fileInput}
                  type="file"
                  name="attachments"
                  multiple
                  accept={ATTACHMENT_ACCEPT}
                  disabled={busy || keptCount + files.length >= MAX_ATTACHMENTS}
                  className="h-auto cursor-pointer py-2 file:mr-3 file:cursor-pointer file:rounded-full file:bg-accent file:px-3 file:py-1 file:text-accent-foreground"
                  onChange={(event) => addFiles(event.target.files)}
                />
              )}
            </Field>
            {files.length > 0 && (
              <ul className="space-y-2" aria-label={t("newFiles")}>
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 rounded-2xl border bg-background px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                      <FileUp className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      <span className="break-all">{file.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">· {fileSize(file.size)}</span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 rounded-full"
                      disabled={busy}
                      onClick={() => setFiles((list) => list.filter((_, position) => position !== index))}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                      <span className="sr-only">{t("removeFile", { name: file.name })}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </SectionCard>

      {!locked && (
        <SectionCard title={t("publication")} icon={CalendarClock}>
          <CheckboxField
            id="announcement-publish-later"
            label={t("publishLater")}
            description={t("publishLaterHint")}
            checked={publishLater}
            disabled={busy}
            onChange={(event) => {
              const on = event.target.checked;
              setPublishLater(on);
              if (on && !publishAt) setPublishAt(`${addDays(todayKey(), 1)}T08:00`);
            }}
          />
          {publishLater && (
            <Field
              id="announcement-publishAt"
              label={t("publishAt")}
              hint={t("publishAtHint", { timezone: APP_TIMEZONE })}
              error={fieldErrors.publishAt}
              className="sm:max-w-xs"
            >
              {(props) => (
                <Input
                  {...props}
                  type="datetime-local"
                  name="publishAt"
                  value={publishAt}
                  required
                  disabled={busy}
                  onChange={(event) => {
                    setPublishAt(event.target.value);
                    clearError("publishAt");
                  }}
                />
              )}
            </Field>
          )}
        </SectionCard>
      )}

      <InlineFeedback feedback={feedback} />
      {!online && <p className="text-sm text-muted-foreground">{t("offline")}</p>}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
        <Button asChild variant="ghost" className="rounded-full">
          <Link href={manageHref}>{tActions("cancel")}</Link>
        </Button>
        {locked ? (
          <Button type="submit" name="intent" value="update" className="rounded-full px-6" disabled={busy || !online} aria-busy={busy || undefined}>
            {spinner("update")}
            {t("saveChanges")}
          </Button>
        ) : (
          <>
            <Button type="submit" name="intent" value="draft" variant="outline" className="rounded-full px-6" disabled={busy || !online}>
              {spinner("draft")}
              {t("saveDraft")}
            </Button>
            {publishLater ? (
              <Button type="submit" name="intent" value="schedule" className="rounded-full px-6" disabled={busy || !online}>
                {spinner("schedule") ?? <CalendarClock className="h-4 w-4" aria-hidden="true" />}
                {t("schedule")}
              </Button>
            ) : (
              <Button type="submit" name="intent" value="publish" variant="highlight" className="rounded-full px-6" disabled={busy || !online}>
                {spinner("publish") ?? <Send className="h-4 w-4" aria-hidden="true" />}
                {t("publishNow")}
              </Button>
            )}
          </>
        )}
      </div>
    </form>
  );
}
