import type { Role } from "@/lib/types";

/** Keys of `common.nav.*` messages. */
export type NavLabelKey =
  | "home"
  | "timetable"
  | "announcements"
  | "notifications"
  | "account"
  | "users"
  | "academic"
  | "timetableManagement"
  | "announcementsManagement"
  | "audit";

export type NavIconName =
  | "home"
  | "timetable"
  | "announcements"
  | "notifications"
  | "account"
  | "users"
  | "academic"
  | "timetableManagement"
  | "announcementsManagement"
  | "audit";

export type NavItem = { key: NavLabelKey; href: string; icon: NavIconName };
export type NavGroup = { labelKey: "administration" | "teaching"; items: NavItem[] };

/** Links every signed-in user sees (also the mobile bottom navigation). */
export const MAIN_NAV: NavItem[] = [
  { key: "home", href: "/dashboard", icon: "home" },
  { key: "timetable", href: "/dashboard/timetable", icon: "timetable" },
  { key: "announcements", href: "/dashboard/announcements", icon: "announcements" },
  { key: "notifications", href: "/dashboard/notifications", icon: "notifications" },
  { key: "account", href: "/dashboard/account", icon: "account" },
];

const ADMIN_NAV: NavItem[] = [
  { key: "users", href: "/dashboard/admin/users", icon: "users" },
  { key: "academic", href: "/dashboard/admin/academic", icon: "academic" },
  { key: "timetableManagement", href: "/dashboard/admin/timetable", icon: "timetableManagement" },
  { key: "announcementsManagement", href: "/dashboard/admin/announcements", icon: "announcementsManagement" },
  { key: "audit", href: "/dashboard/admin/audit", icon: "audit" },
];

/** Role-based management links: ADMIN gets "Administration", TEACHER gets "Announcements management". */
export function managementNav(role: Role | undefined): NavGroup | null {
  if (role === "ADMIN") return { labelKey: "administration", items: ADMIN_NAV };
  if (role === "TEACHER") {
    return { labelKey: "teaching", items: ADMIN_NAV.filter((item) => item.key === "announcementsManagement") };
  }
  return null;
}

/** "/dashboard" is only active on itself; other links also on their sub-pages. */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}
