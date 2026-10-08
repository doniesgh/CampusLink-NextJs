"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useErrorFormatter } from "@/lib/i18n/client";
import { useOnlineStatus } from "@/lib/offline";
import { POST_BODY_MAX_LENGTH, POST_BODY_MIN_LENGTH, POST_LINK_MAX_LENGTH, POST_TYPES, type AlumniPost } from "@/lib/alumni/types";
import { hasValidationErrors, validatePost, type PostInput } from "@/lib/alumni/validation";
import { createPostAction } from "@/app/(back)/dashboard/alumni/actions";

const FIELDS = ["type", "body", "link"] as const;
type FieldName = (typeof FIELDS)[number];
const EMPTY: PostInput = { type: "", body: "", link: "" };

/**
 * "Share news" form of the alumni (news wall and "My posts"): "Type", "Message" (10–2000 characters, plain text)
 * and "Link (optional)" (https). Checked here first, then by the Server Action and the API (10 posts per day).
 */
export function PostComposer({
  idPrefix,
  onPublished,
  onFailure,
  onCancel,
}: {
  idPrefix: string;
  onPublished: (post: AlumniPost, message: string) => void;
  onFailure: (message: string) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations("alumni.composer");
  const tTypes = useTranslations("alumni.postTypes");
  const tValidation = useTranslations("alumni.validation");
  const tActions = useTranslations("common.actions");
  const errors = useErrorFormatter();
  const online = useOnlineStatus();
  const [values, setValues] = useState<PostInput>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [pending, setPending] = useState(false);

  const fieldId = (name: FieldName) => `${idPrefix}-${name}`;
  const focusFirst = (found: Partial<Record<FieldName, string>>) => {
    const first = FIELDS.find((name) => found[name]);
    if (first) document.getElementById(fieldId(first))?.focus();
  };
  const update = (name: FieldName) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const value = event.target.value;
    setValues((current) => ({ ...current, [name]: value }));
    if (fieldErrors[name]) setFieldErrors((current) => ({ ...current, [name]: undefined }));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !online) return;
    const checked = validatePost(values).errors;
    if (hasValidationErrors(checked)) {
      const found = Object.fromEntries(Object.entries(checked).map(([field, error]) => [field, tValidation(error.key, error.values)]));
      setFieldErrors(found);
      focusFirst(found);
      return;
    }
    setPending(true);
    try {
      const result = await createPostAction(values);
      if (result.ok && result.data) {
        setValues(EMPTY);
        setFieldErrors({});
        onPublished(result.data, result.message ?? "");
        return;
      }
      const found = Object.fromEntries(
        Object.entries(result.fieldErrors ?? {}).filter(([field]) => (FIELDS as readonly string[]).includes(field))
      ) as Partial<Record<FieldName, string>>;
      setFieldErrors(found);
      if (Object.keys(found).length > 0) focusFirst(found);
      else onFailure(result.message ?? errors.forCode("GENERIC"));
    } catch {
      onFailure(errors.forCode("NETWORK_ERROR"));
    } finally {
      setPending(false);
    }
  };

  const length = values.body.trim().length;

  return (
    <form onSubmit={submit} noValidate className="grid gap-4" aria-busy={pending || undefined}>
      <Field id={fieldId("type")} label={t("type")} error={fieldErrors.type}>
        {(props) => (
          <Select {...props} name="type" value={values.type} onChange={update("type")} required wrapperClassName="sm:max-w-xs">
            <option value="">{t("typePlaceholder")}</option>
            {POST_TYPES.map((type) => (
              <option key={type} value={type}>
                {tTypes(type)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        id={fieldId("body")}
        label={t("body")}
        hint={t("bodyHint", { min: POST_BODY_MIN_LENGTH, count: length, max: POST_BODY_MAX_LENGTH })}
        error={fieldErrors.body}
      >
        {(props) => (
          <Textarea
            {...props}
            name="body"
            value={values.body}
            onChange={update("body")}
            maxLength={POST_BODY_MAX_LENGTH}
            rows={5}
            placeholder={t("bodyPlaceholder")}
            required
          />
        )}
      </Field>
      <Field id={fieldId("link")} label={t("link")} hint={t("linkHint")} error={fieldErrors.link}>
        {(props) => (
          <Input
            {...props}
            name="link"
            type="url"
            inputMode="url"
            value={values.link}
            onChange={update("link")}
            maxLength={POST_LINK_MAX_LENGTH}
            placeholder="https://"
            autoComplete="off"
          />
        )}
      </Field>
      {!online && <p className="text-sm text-muted-foreground">{t("offline")}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            {tActions("cancel")}
          </Button>
        )}
        <Button type="submit" disabled={pending || !online} aria-busy={pending || undefined}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          {pending ? t("publishing") : t("publish")}
        </Button>
      </div>
    </form>
  );
}
