// Shapes returned by the CampusLink backend (see the API contract).

export type Role = "STUDENT" | "TEACHER" | "ADMIN" | "ALUMNI";

export type User = {
  id: string;
  firstname: string;
  lastname: string;
  email: string;
  role: Role;
  twoFactorEnabled: boolean;
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

export const ROLE_LABELS: Record<Role, string> = {
  STUDENT: "Student",
  TEACHER: "Teacher",
  ADMIN: "Admin",
  ALUMNI: "Alumni",
};
