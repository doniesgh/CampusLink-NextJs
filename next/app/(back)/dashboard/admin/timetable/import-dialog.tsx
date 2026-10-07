"use client";

import { useRef, useState, useTransition } from "react";
import { CircleAlert, CircleCheck, FileCheck2, Loader2, Upload } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Feedback } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatTimeRange } from "@/lib/datetime";
import type { ImportProblems } from "@/lib/timetable/types";
import { importTimetableAction, type ImportActionState } from "./actions";

const EXAMPLE = `date,start,end,subject_code,teacher_email,groups,room,type,notes
2026-10-12,08:30,10:00,BDD,amira.bensalah@campuslink.local,4TWIN1|4TWIN2,A04,LECTURE,
2026-10-12,10:15,11:45,WEB,karim.trabelsi@campuslink.local,4TWIN1,C201,LAB,Bring your laptop`;

type ReportRow = { key: string; line: number | null; text: string };

/** Error codes of the CSV import with a translated text (messages: timetable.manage.importDialog.errorCodes). */
const ERROR_CODES = [
  "CSV_PARSE_ERROR",
  "EMPTY_FILE",
  "MISSING_COLUMNS",
  "UNKNOWN_COLUMNS",
  "DUPLICATE_COLUMNS",
  "TOO_MANY_ROWS",
  "INVALID_ENCODING",
  "TOO_MANY_VALUES",
  "MISSING_VALUE",
  "INVALID_DATE",
  "INVALID_TIME",
  "INVALID_TIME_RANGE",
  "UNKNOWN_SUBJECT",
  "UNKNOWN_TEACHER",
  "NOT_A_TEACHER",
  "TOO_MANY_GROUPS",
  "UNKNOWN_GROUP",
  "UNKNOWN_ROOM",
  "INVALID_TYPE",
  "NOTES_TOO_LONG",
] as const;
type ImportErrorCode = (typeof ERROR_CODES)[number];
const isKnownCode = (code: string): code is ImportErrorCode => (ERROR_CODES as readonly string[]).includes(code);

/** Lines of the report, sorted by line (whole-file problems first). */
function useReportRows(problems: ImportProblems): ReportRow[] {
  const t = useTranslations("timetable.manage.importDialog");
  const tReasons = useTranslations("timetable.manage.conflict.reasons");
  const locale = useLocale();
  const format = useFormatter();
  const rows: ReportRow[] = problems.errors.map((error, index) => {
    // The backend explains each problem in English; other languages get a translated text per code.
    const code = error.code;
    const base = locale === "en" || !isKnownCode(code) ? error.message : t(`errorCodes.${code}`);
    const text = locale !== "en" && error.column ? `${base} (${t("column", { column: error.column })})` : base;
    return { key: `e${index}`, line: error.line, text };
  });
  problems.conflicts.forEach((conflict, index) => {
    const reason = tReasons(conflict.reason);
    const text =
      conflict.otherLine !== undefined && conflict.otherLine !== null
        ? t("conflictWithLine", { line: conflict.otherLine, reason })
        : t("conflictWith", {
            subject: conflict.subject?.name ?? "—",
            when:
              conflict.startsAt && conflict.endsAt
                ? `${format.dateTime(new Date(conflict.startsAt), "weekdayDayMonth")}, ${formatTimeRange(conflict.startsAt, conflict.endsAt)}`
                : "—",
            reason,
          });
    rows.push({ key: `c${index}`, line: conflict.line, text });
  });
  return rows.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}

function ProblemsReport({ problems }: { problems: ImportProblems }) {
  const t = useTranslations("timetable.manage.importDialog");
  const rows = useReportRows(problems);
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <Table aria-label={t("reportTitle")} wrapperClassName="max-h-64 overflow-y-auto">
        <TableHeader>
          <TableRow>
            <TableHead className="w-20">{t("line")}</TableHead>
            <TableHead>{t("problem")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell className="font-mono tabular-nums">{row.line ?? t("wholeFile")}</TableCell>
              <TableCell>{row.text}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {problems.truncated && <p className="text-xs text-muted-foreground">{t("truncated")}</p>}
    </div>
  );
}

/**
 * "Import CSV" dialog: file input "CSV file", "Check file" (dry run, nothing written) and "Import"
 * (all-or-nothing), then a report: role="status" when the file is fine / imported, role="alert" with
 * a Line / Problem table when the backend answers IMPORT_INVALID. The page is told about a successful
 * import when the dialog closes (`onDone`).
 */
export function ImportDialog({
  open,
  onOpenChange,
  onDone,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (feedback: Feedback) => void;
  /** Where focus goes when the dialog closes (it has no Radix trigger). */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useTranslations("timetable.manage.importDialog");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<ImportActionState | null>(null);
  const [imported, setImported] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<"check" | "import" | null>(null);

  const run = (dryRun: boolean) => {
    const form = formRef.current;
    if (!form) return;
    const formData = new FormData(form);
    formData.set("dryRun", String(dryRun));
    setRunning(dryRun ? "check" : "import");
    startTransition(async () => {
      const result = await importTimetableAction(formData);
      setState(result);
      setRunning(null);
      if (result.ok && !dryRun) {
        setImported(result.message ?? null);
        form.reset();
      }
    });
  };

  const close = (next: boolean) => {
    if (pending) return;
    onOpenChange(next);
    if (!next && imported) onDone({ type: "success", message: imported });
  };

  const fileError = state && !state.ok ? state.fieldErrors?.file : undefined;
  const problems = state && !state.ok ? state.data?.problems : undefined;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <details className="rounded-2xl border bg-muted/50 px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">{t("example")}</summary>
          <pre className="mt-3 overflow-x-auto whitespace-pre text-xs leading-5">{EXAMPLE}</pre>
        </details>

        <form
          ref={formRef}
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            run(true);
          }}
          onChange={() => {
            if (state) setState(null);
          }}
        >
          <Field id="timetable-import-file" label={t("file")} hint={t("fileHint")} error={fileError}>
            {(props) => <Input {...props} type="file" name="file" accept=".csv,text/csv" required className="h-auto py-2" />}
          </Field>

          {state?.ok && (
            <div role="status" className="flex items-start gap-2 rounded-2xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
              <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>{state.message}</p>
            </div>
          )}
          {state && !state.ok && state.message && (
            <div role="alert" className="space-y-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
              <p className="flex items-start gap-2 font-medium text-destructive">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {state.message}
              </p>
              {problems && <ProblemsReport problems={problems} />}
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="submit" variant="outline" className="rounded-full" disabled={pending} aria-busy={running === "check" || undefined}>
              {running === "check" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileCheck2 className="h-4 w-4" aria-hidden="true" />}
              {t("check")}
            </Button>
            <Button type="button" className="rounded-full" disabled={pending} aria-busy={running === "import" || undefined} onClick={() => run(false)}>
              {running === "import" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
              {t("import")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
