"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "@/components/ui/app-link";
import { ArrowDown, ArrowLeft, ArrowUp, Loader2, Save, Send, Sigma, UsersRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { SubjectLabel } from "@/components/analytics/level-badge";
import { StatTile } from "@/components/analytics/stat-tile";
import { useAnalyticsFormat } from "@/components/analytics/use-analytics-format";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageFeedback } from "@/components/analytics/page-feedback";
import { useFeedback } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { useOnlineStatus } from "@/lib/offline";
import { buildQuery, GRADES_HREF } from "@/lib/analytics/paths";
import { personName, type Assessment, type GradeChange, type GradeEntry, type GradeSheet } from "@/lib/analytics/types";
import type { ActionState } from "@/lib/server-api";
import { cn } from "@/lib/utils";

type Row = { score: string; comment: string };
export type SaveGradesAction = (assessmentId: string, grades: GradeChange[]) => Promise<ActionState<GradeSheet>>;
export type PublishAction = (id: string) => Promise<ActionState<Assessment>>;

const rowsOf = (sheet: GradeSheet): Record<string, Row> =>
  Object.fromEntries(sheet.grades.map((entry) => [entry.student.id, { score: entry.score === null ? "" : String(entry.score), comment: entry.comment ?? "" }]));

/** "" -> null (not graded), "12,5" / "12.5" -> 12.5, invalid -> undefined. */
function parseScore(value: string, max: number): number | null | undefined {
  const text = value.trim().replace(",", ".");
  if (text === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return undefined;
  const score = Number(text);
  return score >= 0 && score <= max ? score : undefined;
}

function diff(grades: GradeEntry[], rows: Record<string, Row>, max: number): { changes: GradeChange[]; invalid: Set<string> } {
  const changes: GradeChange[] = [];
  const invalid = new Set<string>();
  for (const entry of grades) {
    const row = rows[entry.student.id];
    if (!row) continue;
    const score = parseScore(row.score, max);
    if (score === undefined) {
      invalid.add(entry.student.id);
      continue;
    }
    const comment = row.comment.trim();
    const commentChanged = comment !== (entry.comment ?? "");
    if (score === entry.score && !commentChanged) continue;
    changes.push(commentChanged ? { student: entry.student.id, score, comment } : { student: entry.student.id, score });
  }
  return { changes, invalid };
}

/**
 * Grade entry of one assessment: one score (empty = not graded) and comment per student, live "out of 20",
 * statistics, "Save grades" (changed rows only, Server Action) and "Publish" (confirmation; students are notified
 * once). Enter moves to the next student's score.
 */
export function GradeSheetEditor({
  initial,
  saveAction,
  publishAction,
}: {
  initial: GradeSheet;
  saveAction: SaveGradesAction;
  publishAction: PublishAction;
}) {
  const t = useTranslations("analytics.grades.sheet");
  const tGrades = useTranslations("analytics.grades");
  const tTypes = useTranslations("analytics.assessmentTypes");
  const fmt = useAnalyticsFormat();
  const online = useOnlineStatus();
  const [sheet, setSheet] = useState(initial);
  const [rows, setRows] = useState<Record<string, Row>>(() => rowsOf(initial));
  const [feedback, setFeedback] = useFeedback();
  const [pending, startTransition] = useTransition();

  const { assessment, grades } = sheet;
  const max = assessment.maxScore;
  const { changes, invalid } = useMemo(() => diff(grades, rows, max), [grades, rows, max]);
  const dirty = changes.length + invalid.size;

  const stats = useMemo(() => {
    const scores = grades.map((entry) => entry.score).filter((score): score is number => score !== null);
    return {
      graded: scores.length,
      min: scores.length ? Math.min(...scores) : null,
      max: scores.length ? Math.max(...scores) : null,
    };
  }, [grades]);

  useEffect(() => {
    if (dirty === 0) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const save = () => {
    if (invalid.size > 0) {
      setFeedback({ type: "error", message: t("fixErrors") });
      document.getElementById(`score-${[...invalid][0]}`)?.focus();
      return;
    }
    if (changes.length === 0) return;
    if (!online) {
      setFeedback({ type: "error", message: t("errors.offline") });
      return;
    }
    startTransition(async () => {
      try {
        const result = await saveAction(assessment.id, changes);
        if (result.ok && result.data) {
          setSheet(result.data);
          setRows(rowsOf(result.data));
          setFeedback({ type: "success", message: result.message ?? "" });
        } else {
          setFeedback({ type: "error", message: result.message ?? t("errors.offline") });
        }
      } catch {
        setFeedback({ type: "error", message: t("errors.offline") });
      }
    });
  };

  const publish = async () => {
    try {
      const result = await publishAction(assessment.id);
      if (result.ok && result.data) setSheet((current) => ({ ...current, assessment: { ...current.assessment, ...result.data } }));
      setFeedback({ type: result.ok ? "success" : "error", message: result.message ?? "" });
    } catch {
      setFeedback({ type: "error", message: t("errors.offline") });
    }
  };

  const focusNext = (index: number) => {
    const next = grades[index + 1];
    if (next) document.getElementById(`score-${next.student.id}`)?.focus();
  };

  const backHref = `${GRADES_HREF}${buildQuery({ subject: assessment.subject?.id, group: assessment.group?.id })}`;

  return (
    <div className="space-y-6 pb-24 sm:pb-0">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("back")}
      </Link>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">{tTypes(assessment.type)}</Badge>
            {/* Opaque surface: the translucent success tint is under 4.5:1 on the bg-muted page area. */}
            {assessment.published ? (
              <Badge variant="success" className="bg-background">
                {tGrades("published")}
              </Badge>
            ) : (
              <Badge variant="outline">{tGrades("draft")}</Badge>
            )}
          </div>
          <h1 className="break-words text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{assessment.title}</h1>
          <p className="flex flex-wrap items-center gap-x-1 text-muted-foreground">
            <span>{assessment.group?.name}</span>
            <span aria-hidden="true">·</span>
            <SubjectLabel subject={assessment.subject} />
            <span aria-hidden="true">·</span>
            <span>{fmt.longDay(assessment.date)}</span>
            <span aria-hidden="true">·</span>
            <span>{tGrades("scale", { max: fmt.number(max), coefficient: fmt.number(assessment.coefficient) })}</span>
          </p>
          <p className="text-sm text-muted-foreground" data-testid="publication-state">
            {assessment.published && assessment.publishedAt ? t("publishedNote", { date: fmt.dateTime(assessment.publishedAt) }) : t("draftNote")}
          </p>
        </div>
        {!assessment.published && (
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <ConfirmDialog
              trigger={
                <Button variant="highlight" className="rounded-full" disabled={dirty > 0 || pending} aria-describedby={dirty > 0 ? "publish-hint" : undefined}>
                  <Send className="h-4 w-4" aria-hidden="true" />
                  {tGrades("publish")}
                </Button>
              }
              title={tGrades("publishConfirm", { title: assessment.title })}
              description={tGrades("publishDescription", { group: assessment.group?.name ?? "" })}
              confirmLabel={tGrades("publishConfirmLabel")}
              destructive={false}
              onConfirm={publish}
            />
            {dirty > 0 && (
              <p id="publish-hint" className="text-xs text-muted-foreground">
                {t("saveBeforePublish")}
              </p>
            )}
          </div>
        )}
      </header>

      <section aria-label={t("stats.label")}>
        <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatTile icon={UsersRound} label={t("stats.graded")} value={`${fmt.number(stats.graded, 0)}/${fmt.number(grades.length, 0)}`} />
          <StatTile icon={Sigma} label={t("stats.average")} value={fmt.grade(assessment.stats?.average ?? null)} />
          <StatTile icon={ArrowDown} label={t("stats.min")} value={fmt.score(stats.min, max)} />
          <StatTile icon={ArrowUp} label={t("stats.max")} value={fmt.score(stats.max, max)} />
        </dl>
      </section>

      <PageFeedback feedback={feedback} />

      {grades.length === 0 ? (
        <EmptyState icon={UsersRound} title={t("empty")} />
      ) : (
        <div className="overflow-x-auto rounded-3xl border bg-card">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t("tableCaption", { title: assessment.title })}</caption>
            <thead className="bg-muted/60">
              <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t("student")}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t("score", { max: fmt.number(max) })}
                </th>
                <th scope="col" className="hidden px-4 py-3 text-right font-semibold sm:table-cell">
                  {t("on20")}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t("comment")}
                </th>
              </tr>
            </thead>
            <tbody>
              {grades.map((entry, index) => {
                const id = entry.student.id;
                const name = personName(entry.student);
                const row = rows[id] ?? { score: "", comment: "" };
                const parsed = parseScore(row.score, max);
                const isInvalid = invalid.has(id);
                return (
                  <tr key={id} className="border-b align-top last:border-0" data-student-id={id}>
                    <th scope="row" className="whitespace-nowrap px-4 py-3 font-medium text-foreground">
                      {name}
                    </th>
                    <td className="px-4 py-2">
                      <Input
                        id={`score-${id}`}
                        inputMode="decimal"
                        autoComplete="off"
                        value={row.score}
                        aria-label={t("scoreLabel", { name, max: fmt.number(max) })}
                        aria-invalid={isInvalid || undefined}
                        aria-describedby={isInvalid ? `score-error-${id}` : undefined}
                        disabled={pending}
                        className={cn("h-9 w-24 text-right tabular-nums")}
                        onChange={(event) => setRows((current) => ({ ...current, [id]: { ...row, score: event.target.value } }))}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            focusNext(index);
                          }
                        }}
                      />
                      {isInvalid && (
                        <p id={`score-error-${id}`} className="mt-1 text-xs text-destructive">
                          {t("invalidScore", { max: fmt.number(max) })}
                        </p>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 text-right tabular-nums text-muted-foreground sm:table-cell">
                      {typeof parsed === "number" ? fmt.number((parsed / max) * 20) : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <Input
                        value={row.comment}
                        maxLength={500}
                        aria-label={t("commentLabel", { name })}
                        disabled={pending}
                        className="h-9 min-w-44"
                        onChange={(event) => setRows((current) => ({ ...current, [id]: { ...row, comment: event.target.value } }))}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {grades.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t bg-background/95 px-4 py-3 backdrop-blur sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 sm:justify-end">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {t("unsaved", { count: dirty })}
            </p>
            <Button type="button" className="rounded-full" onClick={save} disabled={pending || dirty === 0} aria-busy={pending || undefined}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              {t("save")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
