"use client";

import { useEffect, useEffectEvent, useId, useMemo } from "react";
import { CircleAlert, CircleCheck, Loader2, LocateFixed } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import type { GeoState } from "@/components/carpool/use-geolocation";
import { cn } from "@/lib/utils";
import type { Place } from "@/lib/carpool/types";

/** Value of the picker: "" (none / anywhere), a curated place id, or "me" (the device's position). */
export type PlaceValue = string;
export const MY_LOCATION = "me";

/**
 * Native select of the curated places (GET /api/carpool/places) + "Use my location" (Geolocation API).
 * Once the position is known, the option "My location" is added and selected. The outcome of the location
 * request is announced politely under the field (no alert: one per page).
 */
export function PlacePicker({
  id,
  label,
  hint,
  error,
  places,
  value,
  onChange,
  geo,
  onLocate,
  emptyLabel,
  emptyDisabled = false,
  disabled = false,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  places: readonly Place[];
  value: PlaceValue;
  onChange: (value: PlaceValue) => void;
  geo: GeoState;
  onLocate: () => void;
  /** Text of the empty option ("Anywhere" in the search, "Choose a place" in the offer form). */
  emptyLabel: string;
  emptyDisabled?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("carpool.geo");
  const locale = useLocale();
  const statusId = useId();
  const sorted = useMemo(() => [...places].sort((a, b) => a.label.localeCompare(b.label, locale)), [places, locale]);
  const located = geo.status === "located";

  // The position just arrived: select "My location".
  const selectMe = useEffectEvent(() => {
    if (value !== MY_LOCATION) onChange(MY_LOCATION);
  });
  const point = geo.status === "located" ? geo.point : null;
  useEffect(() => {
    if (point) selectMe();
  }, [point]);

  const message =
    geo.status === "locating"
      ? { tone: "muted", icon: Loader2, text: t("locating") }
      : geo.status === "located" && value === MY_LOCATION
        ? { tone: "success", icon: CircleCheck, text: geo.accuracy ? t("located", { meters: geo.accuracy }) : t("locatedNoAccuracy") }
        : geo.status === "error"
          ? { tone: "error", icon: CircleAlert, text: t(geo.reason) }
          : null;

  return (
    <div className="space-y-2">
      <Field id={id} label={label} hint={hint} error={error}>
        {(control) => (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select
              {...control}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              disabled={disabled}
              wrapperClassName="min-w-0 flex-1"
              aria-describedby={[control["aria-describedby"], message ? statusId : null].filter(Boolean).join(" ") || undefined}
            >
              <option value="" disabled={emptyDisabled}>
                {emptyLabel}
              </option>
              {located && <option value={MY_LOCATION}>{t("myLocation")}</option>}
              {sorted.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.label}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              variant="outline"
              onClick={onLocate}
              disabled={disabled || geo.status === "locating"}
              aria-busy={geo.status === "locating" || undefined}
              className="shrink-0"
            >
              {geo.status === "locating" ? (
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <LocateFixed className="h-4 w-4" aria-hidden="true" />
              )}
              {t("useMyLocation")}
            </Button>
          </div>
        )}
      </Field>
      <p
        id={statusId}
        aria-live="polite"
        data-testid="geo-status"
        data-geo={geo.status === "error" ? geo.reason : geo.status}
        className={cn(
          "flex items-start gap-1.5 text-sm",
          message?.tone === "error" && "text-destructive",
          message?.tone === "success" && "text-success",
          message?.tone === "muted" && "text-muted-foreground"
        )}
      >
        {message && (
          <>
            <message.icon
              className={cn("mt-0.5 h-4 w-4 shrink-0", message.icon === Loader2 && "animate-spin motion-reduce:animate-none")}
              aria-hidden="true"
            />
            <span>{message.text}</span>
          </>
        )}
      </p>
    </div>
  );
}
