"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { SubmitButton } from "@/components/auth/submit-button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InlineFeedback } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ASSESSMENT_TYPES, type Assessment, type TeachingPair } from "@/lib/analytics/types";
import { dateKey, todayKey } from "@/lib/datetime";
import type { ActionState } from "@/lib/server-api";

export type SaveAssessmentAction = (prev: ActionState<Assessment>, formData: FormData) => Promise<ActionState<Assessment>>;

const initialState: ActionState<Assessment> = {};

/**
 * "New assessment" / "Edit the assessment" dialog (Server Action). Subject and group come from the selected class
 * and cannot change afterwards (backend rule). The outcome is reported in the page by `onSaved`.
 */
export function AssessmentDialog({
  open,
  onOpenChange,
  pair,
  editing,
  saveAction,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pair: TeachingPair;
  editing: Assessment | null;
  saveAction: SaveAssessmentAction;
  onSaved: (message: string) => void;
}) {
  const t = useTranslations("analytics.grades.form");
  const tTypes = useTranslations("analytics.assessmentTypes");
  const [state, formAction, pending] = useActionState(async (prev: ActionState<Assessment>, formData: FormData) => {
    const result = await saveAction(prev, formData);
    if (result.ok) {
      onSaved(result.message ?? "");
      onOpenChange(false);
    }
    return result;
  }, initialState);

  const fieldErrors = state.ok ? {} : (state.fieldErrors ?? {});
  const values = state.ok ? {} : (state.values ?? {});
  const defaults = {
    title: values.title ?? editing?.title ?? "",
    type: values.type ?? editing?.type ?? "EXAM",
    date: values.date ?? (editing ? dateKey(editing.date) : todayKey()),
    maxScore: values.maxScore ?? String(editing?.maxScore ?? 20),
    coefficient: values.coefficient ?? String(editing?.coefficient ?? 1),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? t("editTitle") : t("createTitle")}</DialogTitle>
          <DialogDescription>{t("description", { group: pair.group.name, subject: pair.subject.name })}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          {editing ? (
            <input type="hidden" name="id" value={editing.id} />
          ) : (
            <>
              <input type="hidden" name="subject" value={pair.subject.id} />
              <input type="hidden" name="group" value={pair.group.id} />
            </>
          )}
          <Field id="assessment-title" label={t("title")} error={fieldErrors.title}>
            {(props) => <Input {...props} name="title" maxLength={200} defaultValue={defaults.title} required />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="assessment-type" label={t("type")} error={fieldErrors.type}>
              {(props) => (
                <Select {...props} name="type" defaultValue={defaults.type}>
                  {ASSESSMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {tTypes(type)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="assessment-date" label={t("date")} error={fieldErrors.date}>
              {(props) => <Input {...props} type="date" name="date" defaultValue={defaults.date} required />}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="assessment-max" label={t("maxScore")} hint={t("maxScoreHint")} error={fieldErrors.maxScore}>
              {(props) => <Input {...props} name="maxScore" inputMode="decimal" defaultValue={defaults.maxScore} required />}
            </Field>
            <Field id="assessment-coefficient" label={t("coefficient")} hint={t("coefficientHint")} error={fieldErrors.coefficient}>
              {(props) => <Input {...props} name="coefficient" inputMode="decimal" defaultValue={defaults.coefficient} required />}
            </Field>
          </div>
          <InlineFeedback feedback={state.ok === false && state.message ? { type: "error", message: state.message, at: state.at } : null} />
          <div className="flex justify-end">
            <SubmitButton pending={pending} className="h-10 w-auto rounded-full px-6 shadow-none">
              {editing ? t("save") : t("create")}
            </SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
