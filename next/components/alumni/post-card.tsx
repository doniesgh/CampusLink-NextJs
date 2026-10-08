"use client";

import { useState } from "react";
import { Eye, EyeOff, ExternalLink, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { AlumniAvatar } from "@/components/alumni/alumni-avatar";
import { AlumniText, linkHost } from "@/components/alumni/alumni-text";
import { HiddenBadge, PostTypeBadge } from "@/components/alumni/badges";
import { TextDialog } from "@/components/alumni/text-dialog";
import { useAlumniFormat, useDisplayName } from "@/components/alumni/use-alumni-format";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import Link from "@/components/ui/app-link";
import { Button } from "@/components/ui/button";
import type { Feedback } from "@/components/ui/feedback";
import { useErrorFormatter } from "@/lib/i18n/client";
import { useOnlineStatus } from "@/lib/offline";
import { profileHref } from "@/lib/alumni/paths";
import { HIDE_REASON_MAX_LENGTH, type AlumniPost } from "@/lib/alumni/types";
import { validateHideReason } from "@/lib/alumni/validation";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import { deletePostAction, setPostHiddenAction } from "@/app/(back)/dashboard/alumni/actions";

export type AlumniViewer = { id: string; role: Role };

const ACTION_BUTTON = "h-9 rounded-full px-3";

/**
 * One post of the news wall: author (link to their profile when it can be opened), headline, type, date, the text
 * (plain text, never HTML), the optional link, and — depending on the viewer — "Delete" (author, ADMIN) and
 * "Hide" / "Unhide" (ADMIN). Outcomes are reported to the wall (`report`), dialogs being portals outside <main>.
 */
export function PostCard({
  post,
  viewer,
  onRemoved,
  onChanged,
  report,
  readOnly = false,
}: {
  post: AlumniPost;
  viewer: AlumniViewer;
  onRemoved?: (post: AlumniPost) => void;
  onChanged?: (post: AlumniPost) => void;
  report?: (feedback: Feedback) => void;
  /** No actions (profile page: the wall has them). */
  readOnly?: boolean;
}) {
  const t = useTranslations("alumni.news");
  const tValidation = useTranslations("alumni.validation");
  const tActions = useTranslations("common.actions");
  const errors = useErrorFormatter();
  const online = useOnlineStatus();
  const format = useAlumniFormat();
  const name = useDisplayName()(post.author);
  const [busy, setBusy] = useState(false);
  const isAdmin = viewer.role === "ADMIN";
  const isAuthor = !!post.author && post.author.id === viewer.id;

  const remove = async () => {
    setBusy(true);
    try {
      const result = await deletePostAction(post.id);
      if (result.ok) {
        onRemoved?.(post);
        report?.({ type: "success", message: result.message ?? t("deleted") });
      } else {
        report?.({ type: "error", message: result.message ?? errors.forCode("GENERIC") });
        if (result.code === "RESOURCE_NOT_FOUND") onRemoved?.(post);
      }
    } catch {
      report?.({ type: "error", message: errors.forCode("NETWORK_ERROR") });
    } finally {
      setBusy(false);
    }
  };

  const setHidden = async (hidden: boolean, reason = ""): Promise<string | null> => {
    setBusy(true);
    try {
      const result = await setPostHiddenAction(post.id, hidden, reason);
      if (!result.ok) return result.fieldErrors?.reason ?? result.message ?? errors.forCode("GENERIC");
      if (result.data) onChanged?.(result.data);
      report?.({ type: "success", message: result.message ?? t(hidden ? "hiddenDone" : "unhiddenDone") });
      return null;
    } catch {
      return errors.forCode("NETWORK_ERROR");
    } finally {
      setBusy(false);
    }
  };

  const unhide = async () => {
    const failure = await setHidden(false);
    if (failure) report?.({ type: "error", message: failure });
  };

  const disabled = busy || !online;

  return (
    <article
      className={cn("rounded-2xl border bg-card p-4 text-card-foreground sm:p-5", post.hidden && "border-dashed border-destructive/40")}
      data-post-id={post.id}
      data-type={post.type}
      data-hidden={post.hidden ? "true" : "false"}
    >
      <header className="flex items-start gap-3">
        <AlumniAvatar user={post.author} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold text-foreground">
            {post.author?.profileId ? (
              <Link
                href={profileHref(post.author.profileId)}
                className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {name}
              </Link>
            ) : (
              name
            )}
          </p>
          {post.author?.headline && <p className="line-clamp-1 break-words text-xs text-muted-foreground">{post.author.headline}</p>}
          <p className="text-xs text-muted-foreground">
            <time dateTime={post.createdAt}>{format.dateTime(post.createdAt)}</time>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <PostTypeBadge type={post.type} />
          {post.hidden && <HiddenBadge />}
        </div>
      </header>

      <AlumniText text={post.body} className="mt-3" testId="post-body" />

      {post.link && (
        <a
          href={post.link}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{t("openLink", { host: linkHost(post.link) })}</span>
          <span className="sr-only">{t("newTab")}</span>
        </a>
      )}

      {post.hidden && (
        <div
          className="mt-3 flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          data-testid="hidden-notice"
        >
          <EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-semibold">{t("hiddenTitle")}</p>
            <p>{t(isAdmin ? "hiddenAdminText" : "hiddenAuthorText")}</p>
            {post.hiddenReason && <p className="whitespace-pre-wrap break-words">{t("hiddenReason", { reason: post.hiddenReason })}</p>}
          </div>
        </div>
      )}

      {!readOnly && (isAuthor || isAdmin) && (
        <div className="mt-3 flex flex-wrap justify-end gap-2" role="group" aria-label={t("actionsLabel")}>
          {isAdmin &&
            (post.hidden ? (
              <Button type="button" variant="outline" size="sm" className={ACTION_BUTTON} disabled={disabled} onClick={() => void unhide()}>
                <Eye className="h-4 w-4" aria-hidden="true" />
                {t("unhide")}
              </Button>
            ) : (
              <TextDialog
                trigger={
                  <Button type="button" variant="outline" size="sm" className={ACTION_BUTTON} disabled={disabled}>
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                    {t("hide")}
                  </Button>
                }
                title={t("hideTitle")}
                description={t("hideDescription")}
                label={t("hideReason")}
                submitLabel={t("hideSubmit")}
                maxLength={HIDE_REASON_MAX_LENGTH}
                validate={(value) => {
                  const invalid = validateHideReason(value);
                  return invalid ? tValidation(invalid.key, invalid.values) : null;
                }}
                destructive
                onSubmit={(reason) => setHidden(true, reason)}
              />
            ))}
          <ConfirmDialog
            trigger={
              <Button type="button" variant="outline" size="sm" className={cn(ACTION_BUTTON, "text-destructive")} disabled={disabled}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {tActions("delete")}
              </Button>
            }
            title={t("deleteTitle")}
            description={isAuthor ? t("deleteOwnText") : t("deleteAdminText", { name })}
            confirmLabel={tActions("confirmDelete")}
            onConfirm={remove}
          />
        </div>
      )}
    </article>
  );
}
