"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "@/components/ui/app-link";
import { BookOpenCheck, ClipboardList, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { AssessmentDialog, type SaveAssessmentAction } from "@/components/analytics/assessment-dialog";
import { SubjectLabel } from "@/components/analytics/level-badge";
import { useAnalyticsFormat } from "@/components/analytics/use-analytics-format";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageFeedback } from "@/components/analytics/page-feedback";
import { InlineFeedback, useFeedback } from "@/components/ui/feedback";
import { Select } from "@/components/ui/select";
import { buildQuery, gradeSheetHref } from "@/lib/analytics/paths";
import { personName, type Assessment, type TeachingPair } from "@/lib/analytics/types";
import type { ActionState } from "@/lib/server-api";
import { cn } from "@/lib/utils";

export type GradesActions = {
  save: SaveAssessmentAction;
  remove: (id: string, title: string) => Promise<ActionState>;
  publish: (id: string) => Promise<ActionState<Assessment>>;
};

const pairKey = (pair: TeachingPair) => `${pair.subject.id}:${pair.group.id}`;

/** "Class" picker: one option per (group, subject) pair, grouped by group; the choice lives in the URL. */
function ClassPicker({ pairs, selected }: { pairs: TeachingPair[]; selected: TeachingPair }) {
  const t = useTranslations("analytics.grades");
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const groups: { name: string; pairs: TeachingPair[] }[] = [];
  for (const pair of pairs) {
    const last = groups[groups.length - 1];
    if (last && last.name === pair.group.name) last.pairs.push(pair);
    else groups.push({ name: pair.group.name, pairs: [pair] });
  }

  return (
    <div className="space-y-1.5 sm:max-w-md">
      <label htmlFor="grades-class" className="block text-sm font-medium">
        {t("pair")}
      </label>
      <Select
        id="grades-class"
        value={pairKey(selected)}
        aria-describedby="grades-class-hint"
        aria-busy={pending || undefined}
        onChange={(event) => {
          const [subject, group] = event.target.value.split(":");
          startTransition(() => router.replace(`${pathname}${buildQuery({ subject, group })}`, { scroll: false }));
        }}
      >
        {groups.map((group) => (
          <optgroup key={group.name} label={group.name}>
            {group.pairs.map((pair) => (
              <option key={pairKey(pair)} value={pairKey(pair)}>
                {`${pair.group.name} · ${pair.subject.name}`}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      <p id="grades-class-hint" className="text-sm text-muted-foreground">
        {selected.teachers.length > 0 ? t("teachers", { names: selected.teachers.map(personName).join(", ") }) : t("pairHint")}
      </p>
    </div>
  );
}

function AssessmentCard({
  assessment,
  actions,
  isAdmin,
  onEdit,
  onFeedback,
}: {
  assessment: Assessment;
  actions: GradesActions;
  /** Only administrators may delete a published assessment (and its published grades). */
  isAdmin: boolean;
  onEdit: (assessment: Assessment) => void;
  onFeedback: (ok: boolean, message: string) => void;
}) {
  const t = useTranslations("analytics.grades");
  const tTypes = useTranslations("analytics.assessmentTypes");
  const fmt = useAnalyticsFormat();
  const stats = assessment.stats;

  return (
    <article className="space-y-3 rounded-2xl border bg-card p-4 text-card-foreground" data-assessment-id={assessment.id} data-published={assessment.published}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h3 className="break-words font-semibold text-foreground">{assessment.title}</h3>
          <p className="text-sm text-muted-foreground">
            {fmt.longDay(assessment.date)} · {t("scale", { max: fmt.number(assessment.maxScore), coefficient: fmt.number(assessment.coefficient) })}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="neutral">{tTypes(assessment.type)}</Badge>
          {assessment.published ? <Badge variant="success">{t("published")}</Badge> : <Badge variant="outline">{t("draft")}</Badge>}
        </div>
      </div>
      {stats && (
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
          <span className="font-medium">{t("graded", { graded: stats.graded, students: stats.students })}</span>
          <span className="text-muted-foreground">
            {stats.average === null ? t("noClassAverage") : t("classAverage", { value: fmt.grade(stats.average) })}
          </span>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Link href={gradeSheetHref(assessment.id)} className={cn(buttonVariants({ size: "sm" }), "rounded-full")}>
          <ClipboardList className="h-4 w-4" aria-hidden="true" />
          {assessment.published ? t("viewGrades") : t("enterGrades")}
          <span className="sr-only"> ({assessment.title})</span>
        </Link>
        <Button variant="outline" size="sm" className="rounded-full" onClick={() => onEdit(assessment)}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
          {t("edit")}
          <span className="sr-only"> ({assessment.title})</span>
        </Button>
        {!assessment.published && (
          <ConfirmDialog
            trigger={
              <Button variant="outline" size="sm" className="rounded-full">
                <Send className="h-4 w-4" aria-hidden="true" />
                {t("publish")}
                <span className="sr-only"> ({assessment.title})</span>
              </Button>
            }
            title={t("publishConfirm", { title: assessment.title })}
            description={t("publishDescription", { group: assessment.group?.name ?? "" })}
            confirmLabel={t("publishConfirmLabel")}
            destructive={false}
            onConfirm={async () => {
              const result = await actions.publish(assessment.id);
              onFeedback(!!result.ok, result.message ?? "");
            }}
          />
        )}
        {(!assessment.published || isAdmin) && (
        <ConfirmDialog
          trigger={
            <Button variant="ghost" size="sm" className="rounded-full text-destructive hover:text-destructive">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {t("delete")}
              <span className="sr-only"> ({assessment.title})</span>
            </Button>
          }
          title={t("deleteConfirm", { title: assessment.title })}
          description={t(assessment.published ? "deletePublishedDescription" : "deleteDescription")}
          confirmLabel={t("delete")}
          onConfirm={async () => {
            const result = await actions.remove(assessment.id, assessment.title);
            onFeedback(!!result.ok, result.message ?? "");
          }}
        />
        )}
      </div>
    </article>
  );
}

/**
 * Grades page (TEACHER, ADMIN): class picker (pairs the user teaches; every pair for ADMIN), the class's
 * assessments with their stats, "New assessment", edit, publish and delete (Server Actions, then the server page
 * re-renders). Grade entry happens on /dashboard/grades/<assessmentId>.
 */
export function GradesManager({
  pairs,
  selected,
  assessments,
  loadError,
  actions,
  isAdmin = false,
}: {
  pairs: TeachingPair[];
  selected: TeachingPair | null;
  assessments: Assessment[];
  loadError: string | null;
  actions: GradesActions;
  isAdmin?: boolean;
}) {
  const t = useTranslations("analytics.grades");
  const [feedback, setFeedback] = useFeedback();
  const [dialog, setDialog] = useState<{ key: number; editing: Assessment | null } | null>(null);
  const report = (ok: boolean, message: string) => setFeedback(message ? { type: ok ? "success" : "error", message } : null);

  if (!selected) {
    return <EmptyState icon={BookOpenCheck} title={t("noPairs")} description={t("noPairsHint")} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <ClassPicker pairs={pairs} selected={selected} />
        <Button className="rounded-full" onClick={() => setDialog({ key: Date.now(), editing: null })}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("newAssessment")}
        </Button>
      </div>

      <PageFeedback feedback={feedback} />
      {loadError && feedback?.type !== "error" && <InlineFeedback feedback={{ type: "error", message: loadError }} />}

      <section aria-labelledby="assessments-title" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="assessments-title" className="text-lg font-semibold text-foreground">
            <span className="mr-2">{t("listTitle")}</span>
            <SubjectLabel subject={selected.subject} className="text-base font-normal text-muted-foreground" />
          </h2>
          <p className="text-sm text-muted-foreground">{t("listCount", { count: assessments.length })}</p>
        </div>
        {assessments.length === 0 && !loadError ? (
          <EmptyState icon={ClipboardList} title={t("empty")} description={t("emptyHint")} headingLevel="h3" />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {assessments.map((assessment) => (
              <AssessmentCard
                key={assessment.id}
                assessment={assessment}
                actions={actions}
                isAdmin={isAdmin}
                onEdit={(editing) => setDialog({ key: Date.now(), editing })}
                onFeedback={report}
              />
            ))}
          </div>
        )}
      </section>

      {dialog && (
        <AssessmentDialog
          key={dialog.key}
          open
          onOpenChange={(open) => !open && setDialog(null)}
          pair={selected}
          editing={dialog.editing}
          saveAction={actions.save}
          onSaved={(message) => report(true, message)}
        />
      )}
    </div>
  );
}
