// Shapes of the Module 9 API: /api/attendance, /api/grades, /api/analytics (docs/phase2-contract.md section 3,
// backend/docs/analytics.md). Types only, plus constants and tiny pure helpers: usable from Server and Client
// Components.
import type { ClassSession } from "@/lib/timetable/types";

export type { ClassSession };

/** Absence level of a rate: OK, WARNING (>= thresholds.warning), CRITICAL (>= thresholds.critical). */
export type Level = "OK" | "WARNING" | "CRITICAL";
export const LEVELS: readonly Level[] = ["OK", "WARNING", "CRITICAL"];

export type AttendanceStatus = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
export const ATTENDANCE_STATUSES: readonly AttendanceStatus[] = ["PRESENT", "ABSENT", "LATE", "EXCUSED"];
/** Statuses a teacher can set (EXCUSED is for administrators only). */
export const TEACHER_STATUSES: readonly AttendanceStatus[] = ["PRESENT", "ABSENT", "LATE"];

export type AssessmentType = "EXAM" | "QUIZ" | "PROJECT" | "LAB" | "OTHER";
export const ASSESSMENT_TYPES: readonly AssessmentType[] = ["EXAM", "QUIZ", "PROJECT", "LAB", "OTHER"];

export type SubjectRef = { id: string; name: string; code: string; color: string };
export type PersonRef = { id: string; firstname: string; lastname: string };
export type Thresholds = { warning: number; critical: number };
export type StatusCounts = Record<AttendanceStatus, number>;

// ---------- Attendance (/api/attendance) ----------

export type SubjectAttendance = {
  subject: SubjectRef;
  heldHours: number;
  absentHours: number;
  excusedHours: number;
  lateCount: number;
  /** Absence rate, 0..1. */
  rate: number;
  level: Level;
};

/** Absence figures of a student (every rate is an ABSENCE rate, 0..1). */
export type AttendanceSummary = {
  overallRate: number;
  heldHours: number;
  absentHours: number;
  excusedHours: number;
  lateCount: number;
  level: Level;
  worstLevel: Level;
  bySubject: SubjectAttendance[];
};

/** GET /api/attendance/sessions */
export type SessionListItem = {
  session: ClassSession;
  rollCall: { students: number; marked: number; counts: StatusCounts };
  editable: boolean;
};
export type SessionList = { from: string; to: string; items: SessionListItem[] };

export type RosterEntry = {
  student: PersonRef & { group: { id: string; name: string | null } | null };
  status: AttendanceStatus | null;
  note: string;
  markedAt: string | null;
};

/** GET|PUT /api/attendance/sessions/:id (PUT adds `changed`). */
export type RollCall = {
  session: ClassSession;
  editable: boolean;
  canExcuse: boolean;
  window: { opensAt: string; closesAt: string };
  roster: RosterEntry[];
  summary: { students: number; marked: number; counts: StatusCounts };
  changed?: number;
};

/** Body entry of PUT /api/attendance/sessions/:id (`status: null` clears the mark). */
export type RollCallChange = { student: string; status: AttendanceStatus | null; note?: string };

/** GET /api/attendance/alerts */
export type AttendanceAlert = {
  id: string;
  student: (PersonRef & { group?: { id: string; name: string | null } | null }) | null;
  subject: SubjectRef | null;
  level: Exclude<Level, "OK">;
  rate: number;
  createdAt: string;
};

// ---------- Grades (/api/grades) ----------

export type AssessmentStats = { students: number; graded: number; average: number | null };

export type Assessment = {
  id: string;
  subject: SubjectRef | null;
  group: { id: string; name: string; level: number | null; academicYear: string | null } | null;
  title: string;
  type: AssessmentType;
  date: string;
  maxScore: number;
  coefficient: number;
  published: boolean;
  publishedAt: string | null;
  createdBy: PersonRef | null;
  createdAt: string | null;
  updatedAt: string | null;
  stats?: AssessmentStats;
};

export type AssessmentList = { items: Assessment[]; total: number; page: number; limit: number };

/** GET /api/grades/teaching */
export type TeachingPair = {
  subject: SubjectRef;
  group: { id: string; name: string; level: number; academicYear: string; program: { id: string; name: string; code: string } | null };
  teachers: PersonRef[];
};
export type TeachingList = { items: TeachingPair[] };

export type GradeEntry = { student: PersonRef; score: number | null; comment: string; gradedAt: string | null };

/** GET|PUT /api/grades/assessments/:id/grades (PUT adds `changed`). */
export type GradeSheet = { assessment: Assessment; grades: GradeEntry[]; changed?: number };

/** Body entry of PUT .../grades (`score: null` = not graded). */
export type GradeChange = { student: string; score: number | null; comment?: string };

/** A published assessment as a student sees it (GET /api/grades/me, /api/analytics/me grades.items). */
export type StudentGradeItem = {
  id: string;
  title: string;
  type: AssessmentType;
  date: string;
  maxScore: number;
  coefficient: number;
  subject: SubjectRef | null;
  group: { id: string; name: string | null } | null;
  publishedAt: string | null;
  score: number | null;
  scoreOn20: number | null;
  comment: string;
};

export type SubjectAverage = { subject: SubjectRef | null; average: number | null; assessments: number };

export type GradesSummary = {
  /** Weighted average on 20, null when nothing is graded. */
  overall: number | null;
  bySubject: SubjectAverage[];
  /** Overall average after each day with a graded assessment ("YYYY-MM-DD", campus timezone). */
  trend: { date: string; average: number | null }[];
  items: StudentGradeItem[];
};

// ---------- Analytics (/api/analytics) ----------

export type ActivityWeek = { week: string; forumQuestions: number; forumAnswers: number; announcementsRead: number };

export type Comparison =
  | { available: false; minGroupSize: number }
  | {
      available: true;
      groupSize: number;
      attendance: { averageRate: number; bySubject: { subject: SubjectRef; averageRate: number }[] };
      grades: { overall: number | null; bySubject: { subject: SubjectRef; average: number | null }[] };
    };

export type StudentAnalytics = {
  student: PersonRef & {
    group: { id: string; name: string; level: number; academicYear: string; program: { id: string; name: string; code: string } | null } | null;
  };
  academicYear: string;
  thresholds: Thresholds;
  attendance: AttendanceSummary;
  grades: GradesSummary;
  activity: { weeks: ActivityWeek[] };
  comparison?: Comparison;
};

export type GroupStudentRow = {
  student: PersonRef;
  attendance: Omit<AttendanceSummary, "overallRate"> & { rate: number };
  grades: { average: number | null; bySubject: SubjectAverage[] };
};

/** GET /api/analytics/groups/:groupId */
export type GroupOverview = {
  group: { id: string; name: string; level: number; academicYear: string; program: { id: string; name: string; code: string } | null } | null;
  subjects: SubjectRef[];
  thresholds: Thresholds;
  students: GroupStudentRow[];
  summary: { students: number; averageRate: number; averageGrade: number | null; levels: Record<Level, number> };
};

// ---------- Helpers ----------

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function isObjectId(value: unknown): value is string {
  return typeof value === "string" && OBJECT_ID_RE.test(value);
}

export function isLevel(value: unknown): value is Level {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

export function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return typeof value === "string" && (ATTENDANCE_STATUSES as readonly string[]).includes(value);
}

export function isAssessmentType(value: unknown): value is AssessmentType {
  return typeof value === "string" && (ASSESSMENT_TYPES as readonly string[]).includes(value);
}

export function personName(person: { firstname?: string; lastname?: string } | null | undefined): string {
  return person ? `${person.firstname ?? ""} ${person.lastname ?? ""}`.trim() : "";
}

/** Level of an absence rate with the given thresholds (same rule as the backend). */
export function levelOf(rate: number, thresholds: Thresholds): Level {
  if (rate >= thresholds.critical) return "CRITICAL";
  if (rate >= thresholds.warning) return "WARNING";
  return "OK";
}

export function emptyCounts(): StatusCounts {
  return { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 };
}

/** Shape check of GET /api/analytics/me (and /students/:id) answers. */
export function isStudentAnalytics(value: unknown): value is StudentAnalytics {
  const data = value as StudentAnalytics | null;
  return (
    !!data &&
    typeof data === "object" &&
    !!data.attendance &&
    Array.isArray(data.attendance.bySubject) &&
    !!data.grades &&
    Array.isArray(data.grades.items) &&
    !!data.activity &&
    Array.isArray(data.activity.weeks)
  );
}

export function isRollCall(value: unknown): value is RollCall {
  const data = value as RollCall | null;
  return !!data && typeof data === "object" && !!data.session && Array.isArray(data.roster);
}

export function isGradeSheet(value: unknown): value is GradeSheet {
  const data = value as GradeSheet | null;
  return !!data && typeof data === "object" && !!data.assessment && Array.isArray(data.grades);
}
