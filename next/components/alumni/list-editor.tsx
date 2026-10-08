"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addToList, normalizeLine, validateListItem } from "@/lib/alumni/validation";
import { cn } from "@/lib/utils";

/**
 * Editor of a short list of labels (skills, mentoring topics): type one and press Enter (or a comma, or "Add");
 * each item is a chip with a "Remove <item>" button. A typed item is also added when the field loses the focus,
 * so nothing is lost when "Save" is clicked right away. Duplicates are ignored (case and accents too).
 */
export function ListEditor({
  id,
  kind,
  label,
  hint,
  error,
  items,
  onChange,
  maxLength,
  suggestions = [],
  placeholder,
}: {
  id: string;
  kind: "skills" | "mentoringTopics";
  label: string;
  hint?: string;
  error?: string;
  items: string[];
  onChange: (items: string[]) => void;
  maxLength: number;
  suggestions?: string[];
  placeholder?: string;
}) {
  const t = useTranslations("alumni.form");
  const tValidation = useTranslations("alumni.validation");
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const hintId = hint ? `${id}-hint` : undefined;
  const shownError = localError ?? error;
  const errorId = shownError ? `${id}-error` : undefined;
  const listId = suggestions.length > 0 ? `${id}-suggestions` : undefined;

  const add = (): boolean => {
    const value = normalizeLine(draft);
    if (!value) return true;
    const invalid = validateListItem(kind, value, items);
    if (invalid) {
      setLocalError(tValidation(invalid.key, invalid.values));
      return false;
    }
    onChange(addToList(items, value));
    setDraft("");
    setLocalError(null);
    return true;
  };

  const remove = (item: string) => {
    onChange(items.filter((entry) => entry !== item));
    setLocalError(null);
    document.getElementById(id)?.focus();
  };

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium leading-none">
        {label}
      </label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          onChange={(event) => {
            const value = event.target.value;
            // A comma ends the item (paste "React, Node.js" to add two).
            if (value.includes(",")) {
              const parts = value.split(",");
              let next = items;
              for (const part of parts.slice(0, -1)) {
                const invalid = validateListItem(kind, part, next);
                if (invalid) {
                  setLocalError(tValidation(invalid.key, invalid.values));
                  setDraft(part.trim());
                  return;
                }
                next = addToList(next, part);
              }
              onChange(next);
              setDraft(parts[parts.length - 1].trimStart());
              setLocalError(null);
              return;
            }
            setDraft(value);
            if (localError) setLocalError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          onBlur={() => {
            if (draft.trim()) add();
          }}
          maxLength={maxLength + 10}
          placeholder={placeholder}
          autoComplete="off"
          list={listId}
          aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
          aria-invalid={shownError ? true : undefined}
        />
        <Button type="button" variant="outline" className="shrink-0" onClick={add} aria-label={t("addTo", { list: label })}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">{t("add")}</span>
        </Button>
      </div>
      {listId && (
        <datalist id={listId}>
          {suggestions.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
      )}
      {hint && (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {shownError && (
        <p id={errorId} className="text-sm text-destructive">
          {shownError}
        </p>
      )}
      {items.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("listLabel", { list: label })}>
          {items.map((item) => (
            <li key={item}>
              <span
                className={cn(
                  "inline-flex max-w-full items-center gap-1 rounded-full border border-primary/20 bg-accent py-0.5 pl-3 pr-1 text-sm text-accent-foreground"
                )}
              >
                <span className="break-all">{item}</span>
                <button
                  type="button"
                  onClick={() => remove(item)}
                  className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t("remove", { item })}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("emptyList")}</p>
      )}
    </div>
  );
}
