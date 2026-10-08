"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { SimilarQuestions } from "@/components/forum/similar-questions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useOnlineStatus } from "@/lib/offline";
import {
  BODY_MAX_LENGTH,
  BODY_MIN_LENGTH,
  CHAPTER_MAX_LENGTH,
  LEVELS,
  MAX_TAGS,
  TITLE_MAX_LENGTH,
  TITLE_MIN_LENGTH,
} from "@/lib/forum/types";
import { hasValidationErrors, validateQuestion, type QuestionInput } from "@/lib/forum/validation";
import type { Subject } from "@/lib/types";

const FIELDS = ["title", "subject", "body", "chapter", "level", "tags"] as const;
type FieldName = (typeof FIELDS)[number];

export type QuestionFormResult = { ok?: boolean; message?: string; fieldErrors?: Record<string, string> };

/**
 * Ask / edit form of a question: "Title" (+ similar questions while typing when asking), "Subject", "Details",
 * "Chapter (optional)", "Level (optional)", "Tags (optional)". Checked here first (same rules as the API);
 * errors are shown under the fields (the first invalid one gets the focus), other failures go to `onFailure`.
 */
export function QuestionForm({
  idPrefix,
  mode,
  subjects,
  initialValues,
  submit,
  onFailure,
  onCancel,
  excludeId,
}: {
  idPrefix: string;
  mode: "ask" | "edit";
  subjects: Subject[];
  initialValues: QuestionInput;
  submit: (input: QuestionInput) => Promise<QuestionFormResult>;
  onFailure: (message: string) => void;
  onCancel?: () => void;
  excludeId?: string;
}) {
  const t = useTranslations("forum.ask");
  const tValidation = useTranslations("forum.validation");
  const tActions = useTranslations("common.actions");
  const tLevel = useTranslations("forum");
  const online = useOnlineStatus();
  const [values, setValues] = useState<QuestionInput>(initialValues);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [pending, setPending] = useState(false);

  const fieldId = (name: FieldName) => `${idPrefix}-${name}`;
  const focusFirstError = (fieldErrors: Partial<Record<FieldName, string>>) => {
    const first = FIELDS.find((name) => fieldErrors[name]);
    if (first) document.getElementById(fieldId(first))?.focus();
  };

  const update = (name: FieldName) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const value = event.target.value;
    setValues((current) => ({ ...current, [name]: value }));
    if (errors[name]) setErrors((current) => ({ ...current, [name]: undefined }));
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !online) return;
    const checked = validateQuestion(values).errors;
    if (hasValidationErrors(checked)) {
      const fieldErrors = Object.fromEntries(Object.entries(checked).map(([field, error]) => [field, tValidation(error.key, error.values)]));
      setErrors(fieldErrors);
      focusFirstError(fieldErrors);
      return;
    }
    setPending(true);
    try {
      const result = await submit(values);
      if (result.ok) return;
      const fieldErrors = Object.fromEntries(
        Object.entries(result.fieldErrors ?? {}).filter(([field]) => (FIELDS as readonly string[]).includes(field))
      ) as Partial<Record<FieldName, string>>;
      setErrors(fieldErrors);
      if (Object.keys(fieldErrors).length > 0) focusFirstError(fieldErrors);
      else if (result.message) onFailure(result.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5" aria-busy={pending || undefined}>
      <div className="space-y-3">
        <Field id={fieldId("title")} label={t("titleLabel")} hint={t("titleHint", { min: TITLE_MIN_LENGTH, max: TITLE_MAX_LENGTH })} error={errors.title}>
          {(props) => (
            <Input
              {...props}
              name="title"
              value={values.title}
              onChange={update("title")}
              maxLength={TITLE_MAX_LENGTH}
              placeholder={t("titlePlaceholder")}
              autoComplete="off"
              required
            />
          )}
        </Field>
        {mode === "ask" && <SimilarQuestions title={values.title} excludeId={excludeId} />}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id={fieldId("subject")} label={t("subjectLabel")} error={errors.subject}>
          {(props) => (
            <Select {...props} name="subject" value={values.subject} onChange={update("subject")} required>
              <option value="">{t("subjectPlaceholder")}</option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id={fieldId("level")} label={t("levelLabel")} error={errors.level}>
          {(props) => (
            <Select {...props} name="level" value={values.level} onChange={update("level")}>
              <option value="">{t("noLevel")}</option>
              {LEVELS.map((level) => (
                <option key={level} value={String(level)}>
                  {tLevel("levelValue", { level })}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <Field id={fieldId("body")} label={t("bodyLabel")} hint={t("bodyHint", { min: BODY_MIN_LENGTH })} error={errors.body}>
        {(props) => (
          <Textarea {...props} name="body" value={values.body} onChange={update("body")} maxLength={BODY_MAX_LENGTH} rows={7} required />
        )}
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id={fieldId("chapter")} label={t("chapterLabel")} error={errors.chapter}>
          {(props) => <Input {...props} name="chapter" value={values.chapter} onChange={update("chapter")} maxLength={CHAPTER_MAX_LENGTH} />}
        </Field>
        <Field id={fieldId("tags")} label={t("tagsLabel")} hint={t("tagsHint", { max: MAX_TAGS })} error={errors.tags}>
          {(props) => <Input {...props} name="tags" value={values.tags} onChange={update("tags")} maxLength={200} autoComplete="off" />}
        </Field>
      </div>

      {!online && <p className="text-sm text-muted-foreground">{t(mode === "ask" ? "offline" : "offlineEdit")}</p>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            {tActions("cancel")}
          </Button>
        )}
        <Button type="submit" disabled={pending || !online} aria-busy={pending || undefined}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {mode === "ask" ? (pending ? t("submitting") : t("submit")) : pending ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
