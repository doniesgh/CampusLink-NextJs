"use client";

import { useState, useTransition } from "react";
import { FileUp, Loader2, Send, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useFileSize } from "@/components/marketplace/use-market-format";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useErrorFormatter } from "@/lib/i18n/client";
import { useOnlineStatus } from "@/lib/offline";
import {
  DESCRIPTION_MAX_LENGTH,
  DOCUMENT_TYPES,
  FILE_ACCEPT,
  LEVELS,
  MAX_PRICE,
  MIN_PRICE,
  PROFESSOR_MAX_LENGTH,
  recentAcademicYears,
  TITLE_MAX_LENGTH,
  type MarketDocument,
} from "@/lib/marketplace/types";
import {
  DOCUMENT_FIELDS,
  hasValidationErrors,
  validateDocument,
  validateFile,
  type DocumentField,
  type DocumentInput,
  type MarketValidationErrors,
} from "@/lib/marketplace/validation";
import type { Subject } from "@/lib/types";

export type FormResult = { ok?: boolean; message?: string; fieldErrors?: Record<string, string>; data?: MarketDocument };

/** Fields the author may change: every field before publication, only the price once published (ADMIN: every field). */
export function editableFields(document: MarketDocument, isAdmin: boolean): readonly DocumentField[] {
  if (isAdmin) return DOCUMENT_FIELDS;
  if (document.status === "PUBLISHED") return ["price"];
  if (document.status === "UNPUBLISHED") return [];
  return DOCUMENT_FIELDS;
}

function initialValues(document: MarketDocument | undefined, currentYear: string, defaults: Partial<DocumentInput>): DocumentInput {
  if (!document) {
    return {
      title: "",
      description: "",
      subject: defaults.subject ?? "",
      type: defaults.type || "COURSE_NOTES",
      level: defaults.level ?? "",
      academicYear: currentYear,
      professor: "",
      price: "0",
    };
  }
  return {
    title: document.title,
    description: document.description,
    subject: document.subject?.id ?? "",
    type: document.type,
    level: document.level === null ? "" : String(document.level),
    academicYear: document.academicYear ?? currentYear,
    professor: document.professor ?? "",
    price: String(document.price),
  };
}

/**
 * "Share a document" (upload: every field + the file) and "Edit" (author: the fields the status allows). Checked in
 * the browser first, then by the Server Action and the API; errors are shown under the fields (the first invalid
 * field is focused) and the summary goes to the page through `onFailure`.
 */
export function DocumentForm({
  idPrefix,
  document,
  subjects,
  currentYear,
  maxUploadMb,
  isAdmin,
  defaults = {},
  submit,
  onDone,
  onFailure,
  onCancel,
}: {
  idPrefix: string;
  /** Edit mode when given. */
  document?: MarketDocument;
  subjects: Subject[];
  currentYear: string;
  maxUploadMb: number;
  isAdmin: boolean;
  /** Upload: values picked in the filters (subject, type, level). */
  defaults?: Partial<DocumentInput>;
  /** Calls the Server Action: FormData (upload) or the fields to save (edit). */
  submit: (payload: { formData?: FormData; values: DocumentInput; fields: readonly DocumentField[] }) => Promise<FormResult>;
  onDone: (document: MarketDocument | undefined, message: string | undefined) => void;
  onFailure: (message: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("marketplace");
  const tForm = useTranslations("marketplace.form");
  const tValidation = useTranslations("marketplace.validation");
  const errors = useErrorFormatter();
  const online = useOnlineStatus();
  const fileSize = useFileSize();
  const editing = !!document;
  const fields = document ? editableFields(document, isAdmin) : DOCUMENT_FIELDS;
  const [values, setValues] = useState<DocumentInput>(() => initialValues(document, currentYear, defaults));
  const [file, setFile] = useState<File | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const id = (field: string) => `${idPrefix}-${field}`;
  const locked = (field: DocumentField) => !fields.includes(field);
  const years = recentAcademicYears(currentYear);
  const yearOptions = values.academicYear && !years.includes(values.academicYear) ? [values.academicYear, ...years] : years;

  const clearError = (field: string) =>
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });

  const set = (field: DocumentField) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const value = event.target.value;
    setValues((current) => ({ ...current, [field]: value }));
    clearError(field);
  };

  const translate = (problems: MarketValidationErrors) =>
    Object.fromEntries(Object.entries(problems).map(([field, error]) => [field, tValidation(error.key, error.values)]));

  const showErrors = (messages: Record<string, string>, summary?: string) => {
    setFieldErrors(messages);
    onFailure(summary || Object.values(messages).join(" ") || errors.forCode("GENERIC"));
    const first = [...DOCUMENT_FIELDS, "file"].find((field) => messages[field]);
    if (first) requestAnimationFrame(() => window.document.getElementById(id(first))?.focus());
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const problems = validateDocument(values, fields).errors;
    if (!editing) {
      const fileError = validateFile(file, maxUploadMb);
      if (fileError) problems.file = fileError;
    }
    if (hasValidationErrors(problems)) {
      showErrors(translate(problems));
      return;
    }
    if (!online) {
      onFailure(tForm("offline"));
      return;
    }
    let formData: FormData | undefined;
    if (!editing && file) {
      formData = new FormData();
      for (const field of DOCUMENT_FIELDS) formData.set(field, values[field]);
      formData.set("file", file, file.name);
    }
    startTransition(async () => {
      try {
        const result = await submit({ formData, values, fields });
        if (result.ok) {
          onDone(result.data, result.message);
          return;
        }
        showErrors(result.fieldErrors ?? {}, result.message);
      } catch {
        onFailure(errors.forCode("NETWORK_ERROR"));
      }
    });
  };

  const submitLabel = !editing
    ? isAdmin
      ? tForm("publish")
      : tForm("sendForReview")
    : document.status === "REJECTED" && !isAdmin
      ? tForm("resubmit")
      : tForm("save");

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5" aria-busy={pending || undefined}>
      {editing && document.status === "PUBLISHED" && !isAdmin && (
        <p className="rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground">{tForm("publishedPriceOnly")}</p>
      )}
      {editing && document.status === "REJECTED" && !isAdmin && (
        <p className="rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground">{tForm("resubmitHint")}</p>
      )}

      <Field id={id("title")} label={tForm("title")} error={fieldErrors.title}>
        {(props) => (
          <Input {...props} value={values.title} onChange={set("title")} maxLength={TITLE_MAX_LENGTH} disabled={locked("title") || pending} required />
        )}
      </Field>

      <Field id={id("description")} label={tForm("description")} hint={tForm("descriptionHint")} error={fieldErrors.description}>
        {(props) => (
          <Textarea
            {...props}
            value={values.description}
            onChange={set("description")}
            maxLength={DESCRIPTION_MAX_LENGTH}
            rows={4}
            disabled={locked("description") || pending}
          />
        )}
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id={id("subject")} label={tForm("subject")} error={fieldErrors.subject}>
          {(props) => (
            <Select {...props} value={values.subject} onChange={set("subject")} disabled={locked("subject") || pending} required>
              <option value="">{tForm("chooseSubject")}</option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id={id("type")} label={tForm("type")} error={fieldErrors.type}>
          {(props) => (
            <Select {...props} value={values.type} onChange={set("type")} disabled={locked("type") || pending}>
              {DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`types.${type}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id={id("level")} label={tForm("level")} error={fieldErrors.level}>
          {(props) => (
            <Select {...props} value={values.level} onChange={set("level")} disabled={locked("level") || pending}>
              <option value="">{tForm("noLevel")}</option>
              {LEVELS.map((level) => (
                <option key={level} value={String(level)}>
                  {t("levelValue", { level })}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id={id("academicYear")} label={tForm("academicYear")} error={fieldErrors.academicYear}>
          {(props) => (
            <Select {...props} value={values.academicYear} onChange={set("academicYear")} disabled={locked("academicYear") || pending}>
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id={id("professor")} label={tForm("professor")} error={fieldErrors.professor}>
          {(props) => (
            <Input
              {...props}
              value={values.professor}
              onChange={set("professor")}
              maxLength={PROFESSOR_MAX_LENGTH}
              placeholder={tForm("professorPlaceholder")}
              disabled={locked("professor") || pending}
            />
          )}
        </Field>
        <Field id={id("price")} label={tForm("price")} hint={tForm("priceHint", { max: MAX_PRICE })} error={fieldErrors.price}>
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="numeric"
              min={MIN_PRICE}
              max={MAX_PRICE}
              step={1}
              value={values.price}
              onChange={set("price")}
              disabled={locked("price") || pending}
            />
          )}
        </Field>
      </div>

      {!editing && (
        <Field id={id("file")} label={tForm("file")} hint={tForm("fileHint", { max: maxUploadMb })} error={fieldErrors.file}>
          {(props) => (
            <div className="space-y-2">
              <Input
                {...props}
                type="file"
                accept={FILE_ACCEPT}
                disabled={pending}
                className="h-auto cursor-pointer py-2 file:mr-3 file:cursor-pointer file:rounded-full file:bg-accent file:px-3 file:py-1 file:text-accent-foreground"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  clearError("file");
                }}
              />
              {file && (
                <p className="flex flex-wrap items-center gap-2 rounded-2xl border bg-background px-3 py-2 text-sm" data-testid="selected-file">
                  <FileUp className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="break-all">{file.name}</span>
                  <span className="text-xs text-muted-foreground">· {fileSize(file.size)}</span>
                </p>
              )}
            </div>
          )}
        </Field>
      )}

      {!editing && <p className="text-sm text-muted-foreground">{isAdmin ? tForm("adminPublishHint") : tForm("reviewHint")}</p>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
          <X className="h-4 w-4" aria-hidden="true" />
          {tForm("cancel")}
        </Button>
        <Button type="submit" disabled={pending || fields.length === 0} aria-busy={pending || undefined}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
