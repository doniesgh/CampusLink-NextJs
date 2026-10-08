"use client";

import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { ListEditor } from "@/components/alumni/list-editor";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useErrorFormatter } from "@/lib/i18n/client";
import { useOnlineStatus } from "@/lib/offline";
import {
  BIO_MAX_LENGTH,
  CITY_MAX_LENGTH,
  COMPANY_MAX_LENGTH,
  HEADLINE_MAX_LENGTH,
  JOB_TITLE_MAX_LENGTH,
  LINKEDIN_URL_MAX_LENGTH,
  MAX_MENTORING_TOPICS,
  MAX_SKILLS,
  MENTORING_TOPIC_MAX_LENGTH,
  MENTORING_TOPIC_MIN_LENGTH,
  PROMOTION_MIN,
  SECTOR_MAX_LENGTH,
  SKILL_MAX_LENGTH,
  type AlumniProfile,
} from "@/lib/alumni/types";
import { hasValidationErrors, maxPromotion, normalizeText, validateProfile, type ProfileInput } from "@/lib/alumni/validation";
import type { Program } from "@/lib/types";
import { saveProfileAction } from "@/app/(back)/dashboard/alumni/actions";

const FIELDS = [
  "headline",
  "jobTitle",
  "company",
  "sector",
  "city",
  "program",
  "promotion",
  "linkedinUrl",
  "bio",
  "skills",
  "mentoringTopics",
] as const;
type FieldName = (typeof FIELDS)[number];
/** Fields of the form edited as text. */
type TextField = { [K in keyof ProfileInput]: ProfileInput[K] extends string ? K : never }[keyof ProfileInput];

export function toInput(profile: AlumniProfile): ProfileInput {
  return {
    program: profile.program?.id ?? "",
    promotion: profile.promotion ? String(profile.promotion) : "",
    headline: profile.headline ?? "",
    bio: profile.bio ?? "",
    skills: [...profile.skills],
    company: profile.company ?? "",
    jobTitle: profile.jobTitle ?? "",
    sector: profile.sector ?? "",
    city: profile.city ?? "",
    linkedinUrl: profile.linkedinUrl ?? "",
    mentoringAvailable: profile.mentoringAvailable,
    mentoringTopics: [...profile.mentoringTopics],
  };
}

function Fieldset({ legend, description, children }: { legend: string; description?: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4 rounded-3xl border bg-card p-4 text-card-foreground sm:p-6">
      <legend className="float-left mb-1 w-full text-lg font-semibold text-foreground">{legend}</legend>
      {description && <p className="clear-both text-sm text-muted-foreground">{description}</p>}
      <div className="clear-both space-y-4">{children}</div>
    </fieldset>
  );
}

/**
 * Profile form of an alumni (/dashboard/alumni/me): path, about, skills, mentoring availability and topics.
 * Visibility and consent are a separate, explicit action (VisibilityCard). Checked here first (same rules as the
 * API), then by the Server Action; errors are shown under the fields (the first invalid one gets the focus).
 */
export function ProfileForm({
  profile,
  programs,
  sectorSuggestions,
  skillSuggestions,
  onSaved,
  onFailure,
  feedbackSlot,
}: {
  profile: AlumniProfile;
  programs: Program[];
  sectorSuggestions: string[];
  skillSuggestions: string[];
  onSaved: (profile: AlumniProfile, message: string) => void;
  onFailure: (message: string) => void;
  /** Outcome of the last save, shown next to the button. */
  feedbackSlot?: React.ReactNode;
}) {
  const t = useTranslations("alumni.form");
  const tValidation = useTranslations("alumni.validation");
  const errors = useErrorFormatter();
  const online = useOnlineStatus();
  const [values, setValues] = useState<ProfileInput>(() => toInput(profile));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [pending, setPending] = useState(false);

  const fieldId = (name: FieldName) => `profile-${name}`;
  const set = <K extends keyof ProfileInput>(name: K, value: ProfileInput[K]) => {
    setValues((current) => ({ ...current, [name]: value }));
    if (fieldErrors[name as FieldName]) setFieldErrors((current) => ({ ...current, [name]: undefined }));
  };
  const text = (name: TextField) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    set(name, event.target.value);
  const focusFirst = (found: Partial<Record<FieldName, string>>) => {
    const first = FIELDS.find((name) => found[name]);
    if (first) document.getElementById(fieldId(first))?.focus();
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !online) return;
    const checked = validateProfile(values).errors;
    if (hasValidationErrors(checked)) {
      const found = Object.fromEntries(Object.entries(checked).map(([field, error]) => [field, tValidation(error.key, error.values)]));
      setFieldErrors(found);
      focusFirst(found);
      return;
    }
    setPending(true);
    try {
      const result = await saveProfileAction(values);
      if (result.ok && result.data) {
        setFieldErrors({});
        setValues(toInput(result.data));
        onSaved(result.data, result.message ?? t("saved"));
        return;
      }
      const found = Object.fromEntries(
        Object.entries(result.fieldErrors ?? {}).filter(([field]) => (FIELDS as readonly string[]).includes(field))
      ) as Partial<Record<FieldName, string>>;
      setFieldErrors(found);
      if (Object.keys(found).length > 0) focusFirst(found);
      onFailure(result.message ?? errors.forCode("GENERIC"));
    } catch {
      onFailure(errors.forCode("NETWORK_ERROR"));
    } finally {
      setPending(false);
    }
  };

  const bioLength = normalizeText(values.bio).length;
  const latestYear = maxPromotion();

  return (
    <form onSubmit={submit} noValidate className="space-y-5" aria-busy={pending || undefined} aria-labelledby="profile-form-title">
      <h2 id="profile-form-title" className="sr-only">
        {t("title")}
      </h2>
      <Fieldset legend={t("pathLegend")} description={t("pathIntro")}>
        <Field id={fieldId("headline")} label={t("headline")} hint={t("headlineHint")} error={fieldErrors.headline}>
          {(props) => <Input {...props} value={values.headline} onChange={text("headline")} maxLength={HEADLINE_MAX_LENGTH} autoComplete="off" />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={fieldId("jobTitle")} label={t("jobTitle")} error={fieldErrors.jobTitle}>
            {(props) => <Input {...props} value={values.jobTitle} onChange={text("jobTitle")} maxLength={JOB_TITLE_MAX_LENGTH} autoComplete="organization-title" />}
          </Field>
          <Field id={fieldId("company")} label={t("company")} error={fieldErrors.company}>
            {(props) => <Input {...props} value={values.company} onChange={text("company")} maxLength={COMPANY_MAX_LENGTH} autoComplete="organization" />}
          </Field>
          <Field id={fieldId("sector")} label={t("sector")} hint={t("sectorHint")} error={fieldErrors.sector}>
            {(props) => (
              <>
                <Input {...props} value={values.sector} onChange={text("sector")} maxLength={SECTOR_MAX_LENGTH} list="profile-sector-list" autoComplete="off" />
                <datalist id="profile-sector-list">
                  {sectorSuggestions.map((sector) => (
                    <option key={sector} value={sector} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field id={fieldId("city")} label={t("city")} error={fieldErrors.city}>
            {(props) => <Input {...props} value={values.city} onChange={text("city")} maxLength={CITY_MAX_LENGTH} autoComplete="address-level2" />}
          </Field>
          <Field id={fieldId("program")} label={t("program")} error={fieldErrors.program}>
            {(props) => (
              <Select {...props} value={values.program} onChange={text("program")}>
                <option value="">{t("noProgram")}</option>
                {programs.map((program) => (
                  <option key={program.id} value={program.id}>
                    {program.name} ({program.code})
                  </option>
                ))}
                {values.program && !programs.some((program) => program.id === values.program) && profile.program && (
                  <option value={profile.program.id}>
                    {profile.program.name} ({profile.program.code})
                  </option>
                )}
              </Select>
            )}
          </Field>
          <Field
            id={fieldId("promotion")}
            label={t("promotion")}
            hint={t("promotionHint", { min: PROMOTION_MIN, max: latestYear })}
            error={fieldErrors.promotion}
          >
            {(props) => (
              <Input
                {...props}
                value={values.promotion}
                onChange={(event) => set("promotion", event.target.value.replace(/\D/g, "").slice(0, 4))}
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                placeholder={String(latestYear - 1)}
                autoComplete="off"
              />
            )}
          </Field>
        </div>
        <Field id={fieldId("linkedinUrl")} label={t("linkedin")} hint={t("linkedinHint")} error={fieldErrors.linkedinUrl}>
          {(props) => (
            <Input
              {...props}
              type="url"
              inputMode="url"
              value={values.linkedinUrl}
              onChange={text("linkedinUrl")}
              maxLength={LINKEDIN_URL_MAX_LENGTH}
              placeholder="https://www.linkedin.com/in/…"
              autoComplete="url"
            />
          )}
        </Field>
      </Fieldset>

      <Fieldset legend={t("aboutLegend")}>
        <Field id={fieldId("bio")} label={t("bio")} hint={t("bioHint", { count: bioLength, max: BIO_MAX_LENGTH })} error={fieldErrors.bio}>
          {(props) => <Textarea {...props} value={values.bio} onChange={text("bio")} maxLength={BIO_MAX_LENGTH} rows={6} />}
        </Field>
        <ListEditor
          id={fieldId("skills")}
          kind="skills"
          label={t("skills")}
          hint={t("skillsHint", { max: MAX_SKILLS })}
          error={fieldErrors.skills}
          items={values.skills}
          onChange={(items) => set("skills", items)}
          maxLength={SKILL_MAX_LENGTH}
          suggestions={skillSuggestions}
          placeholder={t("skillsPlaceholder")}
        />
      </Fieldset>

      <Fieldset legend={t("mentoringLegend")} description={t("mentoringIntro")}>
        <div className="flex items-start justify-between gap-4 rounded-2xl bg-muted/60 px-4 py-3">
          <div className="space-y-0.5">
            <label htmlFor="profile-mentoring" className="cursor-pointer text-sm font-medium">
              {t("mentoringAvailable")}
            </label>
            <p id="profile-mentoring-description" className="text-sm text-muted-foreground">
              {t(values.mentoringAvailable ? "mentoringOnText" : "mentoringOffText")}
            </p>
          </div>
          <Switch
            id="profile-mentoring"
            checked={values.mentoringAvailable}
            onCheckedChange={(checked) => set("mentoringAvailable", checked)}
            aria-describedby="profile-mentoring-description"
          />
        </div>
        <ListEditor
          id={fieldId("mentoringTopics")}
          kind="mentoringTopics"
          label={t("topics")}
          hint={t("topicsHint", { max: MAX_MENTORING_TOPICS, min: MENTORING_TOPIC_MIN_LENGTH, maxLength: MENTORING_TOPIC_MAX_LENGTH })}
          error={fieldErrors.mentoringTopics}
          items={values.mentoringTopics}
          onChange={(items) => set("mentoringTopics", items)}
          maxLength={MENTORING_TOPIC_MAX_LENGTH}
          placeholder={t("topicsPlaceholder")}
        />
      </Fieldset>

      {feedbackSlot}
      {!online && <p className="text-sm text-muted-foreground">{t("offline")}</p>}
      <div className="flex justify-end">
        <Button type="submit" className="w-full rounded-full sm:w-auto" disabled={pending || !online} aria-busy={pending || undefined}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
