// Shapes returned by the CampusLink backend (see docs/phase1-contract.md).
// Usable from Server and Client Components (types only, no runtime code apart from constants).

export type Role = "STUDENT" | "TEACHER" | "ADMIN" | "ALUMNI";
export const ROLES: readonly Role[] = ["STUDENT", "TEACHER", "ADMIN", "ALUMNI"];

export type Locale = "fr" | "en";

export type ProgramRef = { id: string; name: string; code: string };

/** Group as embedded in a user (`user.group`). */
export type UserGroup = {
  id: string;
  name: string;
  level: number;
  academicYear: string;
  program: ProgramRef;
};

export type User = {
  id: string;
  firstname: string;
  lastname: string;
  email: string;
  role: Role;
  twoFactorEnabled: boolean;
  /** Phase 1. Optional in the type so older backends still type-check at runtime boundaries. */
  locale?: Locale;
  group?: UserGroup | null;
  createdAt: string;
  updatedAt: string;
};

export type Session = {
  user: User;
  accessToken: string;
  refreshToken: string;
};

/** Returned by POST /api/auth/login when the account has 2FA enabled. */
export type OtpChallenge = {
  otpRequired: true;
  email: string;
};

/** Paginated lists: `?page=1&limit=20` (limit max 100). */
export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
};

// ---- Academic structure (/api/academic) ----

export type Program = { id: string; name: string; code: string; description: string };

export type Group = {
  id: string;
  name: string;
  level: number;
  academicYear: string;
  program: ProgramRef;
  studentCount: number;
};

export type Subject = { id: string; name: string; code: string; color: string };

export type RoomType = "CLASSROOM" | "AMPHITHEATER" | "LAB" | "OTHER";
export const ROOM_TYPES: readonly RoomType[] = ["CLASSROOM", "AMPHITHEATER", "LAB", "OTHER"];

export type Room = { id: string; name: string; building: string; capacity: number; type: RoomType };

// ---- Notifications (/api/notifications) ----

export type NotificationType = "TIMETABLE_CHANGE" | "ANNOUNCEMENT" | "SYSTEM";

export type AppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Relative web path, e.g. "/dashboard/announcements/<id>". */
  link: string | null;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationList = Paginated<AppNotification> & { unreadCount: number };

// ---- Audit log (/api/audit) ----

export type AuditActor = { id: string; firstname: string; lastname: string; email: string; role: Role };

export type AuditLog = {
  id: string;
  actor: AuditActor | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
};
