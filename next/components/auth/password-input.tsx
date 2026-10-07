"use client";

import * as React from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PasswordInputProps = Omit<React.ComponentProps<"input">, "type"> & { id: string };

/**
 * Password input with a lock icon and a show/hide toggle.
 * The toggle's name comes from visually hidden text rather than aria-label, so
 * `getByLabel("Password")` only ever matches the input itself.
 */
export function PasswordInput({ id, className, ...props }: PasswordInputProps) {
  const t = useTranslations("auth.fields");
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative">
      <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        id={id}
        type={visible ? "text" : "password"}
        className={cn("h-11 rounded-xl pl-10 pr-11", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-controls={id}
        aria-pressed={visible}
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        <span className="sr-only">{t("showPassword")}</span>
      </button>
    </div>
  );
}
