// Shapes of the timetable API (docs/phase1-contract.md section 6). Types only, plus constants:
// usable from Server and Client Components.

export type SessionType = "LECTURE" | "TUTORIAL" | "LAB" | "EXAM" | "OTHER";
export const SESSION_TYPES: readonly SessionType[] = ["LECTURE", "TUTORIAL", "LAB", "EXAM", "OTHER"];

export type SessionStatus = "SCHEDULED" | "CANCELLED";

export type SessionScope = "occurrence" | "series";

export type SessionChange = {
  kind: "ROOM" | "TIME" | "CANCELLED";
  /** Set when the room differs from the planned one (also with kind TIME when both changed). */
  previousRoom?: { id: string; name: string | null };
  previousStartsAt?: string;
  previousEndsAt?: string;
  changedAt: string | null;
};

export type SessionSubject = { id: string; name: string; code: string; color: string };
export type SessionTeacher = { id: string; firstname: string; lastname: string };
export type SessionGroup = { id: string; name: string; level?: number; program?: { id: string; code: string } | null };
export type SessionRoom = { id: string; name: string; building: string };

export type ClassSession = {
  id: string;
  /** null only when the referenced document was deleted. */
  subject: SessionSubject | null;
  teacher: SessionTeacher | null;
  groups: SessionGroup[];
  room: SessionRoom | null;
  startsAt: string;
  endsAt: string;
  type: SessionType;
  status: SessionStatus;
  notes: string;
  seriesId: string | null;
  change: SessionChange | null;
  createdAt: string;
  updatedAt: string;
};

/** GET /api/timetable/me and GET /api/timetable. */
export type TimetableResponse = {
  from: string;
  to: string;
  items: ClassSession[];
  /** Student without a group. */
  hint?: "NO_GROUP";
};

export type ConflictReason = "ROOM" | "TEACHER" | "GROUP";

/** 409 SESSION_CONFLICT `details.conflicts[]`. */
export type SessionConflict = {
  sessionId: string | null;
  startsAt?: string;
  endsAt?: string;
  reason: ConflictReason;
  subject?: { id: string; name: string; code: string } | null;
};

/** 422 IMPORT_INVALID `details`. */
export type ImportProblems = {
  errors: { line: number | null; code: string; message: string; column?: string }[];
  conflicts: (SessionConflict & { line: number | null; otherLine?: number })[];
  rows?: number;
  truncated?: boolean;
};

/** 200 answer of POST /api/timetable/import. */
export type ImportResult = { dryRun: boolean; created: number; rows: number };

export function teacherName(teacher: SessionTeacher | null | undefined): string {
  return teacher ? `${teacher.firstname} ${teacher.lastname}`.trim() : "";
}
