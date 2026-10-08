import type { Role } from "@/lib/types";

/** Keys of `common.nav.*` messages. */
export type NavLabelKey =
  | "home"
  | "timetable"
  | "announcements"
  | "notifications"
  | "account"
  | "bookings"
  | "forum"
  | "analytics"
  | "attendance"
  | "grades"
  | "carpool"
  | "marketplace"
  | "alumni"
  | "alumniProfile"
  | "users"
  | "academic"
  | "timetableManagement"
  | "announcementsManagement"
  | "bookingsManagement"
  | "forumModeration"
  | "studentFollowUp"
  | "marketplaceModeration"
  | "audit";

export type NavIconName = NavLabelKey;

export type NavItem = { key: NavLabelKey; href: string; icon: NavIconName };
export type NavGroup = { labelKey: "campus" | "administration" | "teaching"; items: NavItem[] };

/** Links every signed-in user sees (also the mobile bottom navigation). */
export const MAIN_NAV: NavItem[] = [
  { key: "home", href: "/dashboard", icon: "home" },
  { key: "timetable", href: "/dashboard/timetable", icon: "timetable" },
  { key: "announcements", href: "/dashboard/announcements", icon: "announcements" },
  { key: "notifications", href: "/dashboard/notifications", icon: "notifications" },
  { key: "account", href: "/dashboard/account", icon: "account" },
];

const item = (key: NavLabelKey, href: string): NavItem => ({ key, href, icon: key });

// Phase 2 modules (docs/phase2-contract.md section 4).
const BOOKINGS = item("bookings", "/dashboard/bookings");
const FORUM = item("forum", "/dashboard/forum");
const ANALYTICS = item("analytics", "/dashboard/analytics");
const ATTENDANCE = item("attendance", "/dashboard/attendance");
const GRADES = item("grades", "/dashboard/grades");
// Phase 3 modules (docs/phase3-contract.md section 5).
const CARPOOL = item("carpool", "/dashboard/carpool");
const MARKETPLACE = item("marketplace", "/dashboard/marketplace");
const ALUMNI = item("alumni", "/dashboard/alumni");
const ALUMNI_PROFILE = item("alumniProfile", "/dashboard/alumni/me");

const ADMIN_NAV: NavItem[] = [
  item("users", "/dashboard/admin/users"),
  item("academic", "/dashboard/admin/academic"),
  item("timetableManagement", "/dashboard/admin/timetable"),
  item("announcementsManagement", "/dashboard/admin/announcements"),
  item("bookingsManagement", "/dashboard/admin/bookings"),
  item("forumModeration", "/dashboard/admin/forum"),
  item("studentFollowUp", "/dashboard/admin/analytics"),
  item("marketplaceModeration", "/dashboard/admin/marketplace"),
  ATTENDANCE,
  GRADES,
  item("audit", "/dashboard/admin/audit"),
];

/** Campus-life links per role (bookings, forum, progress, carpooling, marketplace, alumni network). */
function campusItems(role: Role | undefined): NavItem[] {
  switch (role) {
    case "STUDENT":
      return [BOOKINGS, FORUM, ANALYTICS, CARPOOL, MARKETPLACE, ALUMNI];
    case "TEACHER":
    case "ADMIN":
      return [BOOKINGS, FORUM, MARKETPLACE, ALUMNI];
    case "ALUMNI":
      return [FORUM, ALUMNI, ALUMNI_PROFILE];
    default:
      return [];
  }
}

/** Role-based management links: ADMIN gets "Administration", TEACHER gets "Teaching". */
export function managementNav(role: Role | undefined): NavGroup | null {
  if (role === "ADMIN") return { labelKey: "administration", items: ADMIN_NAV };
  if (role === "TEACHER") {
    const announcements = ADMIN_NAV.find((entry) => entry.key === "announcementsManagement");
    return { labelKey: "teaching", items: [...(announcements ? [announcements] : []), ATTENDANCE, GRADES] };
  }
  return null;
}

/** Sidebar groups shown under the main links, in order. */
export function navGroups(role: Role | undefined): NavGroup[] {
  const groups: NavGroup[] = [];
  const campus = campusItems(role);
  if (campus.length > 0) groups.push({ labelKey: "campus", items: campus });
  const management = managementNav(role);
  if (management) groups.push(management);
  return groups;
}

/** "/dashboard" is only active on itself; other links also on their sub-pages. */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  // "My alumni profile" has its own link: do not also highlight "Alumni network" there.
  if (href === "/dashboard/alumni" && (pathname === "/dashboard/alumni/me" || pathname.startsWith("/dashboard/alumni/me/"))) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}
