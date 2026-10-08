"use client";

import * as React from "react";
import Link from "@/components/ui/app-link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Boxes,
  CalendarCheck,
  CalendarCog,
  CalendarDays,
  ClipboardCheck,
  Flag,
  GraduationCap,
  House,
  Megaphone,
  Menu,
  MessagesSquare,
  School,
  ScrollText,
  Send,
  TrendingUp,
  UserRound,
  UserSearch,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useUnreadCount } from "@/components/notifications/use-unread-count";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { LogoutButton } from "@/components/shell/logout-button";
import { isActive, MAIN_NAV, navGroups, type NavIconName, type NavItem } from "@/components/shell/nav-items";
import { Button } from "@/components/ui/button";
import Logo from "@/components/ui/logo";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";

const ICONS: Record<NavIconName, LucideIcon> = {
  home: House,
  timetable: CalendarDays,
  announcements: Megaphone,
  notifications: Bell,
  account: UserRound,
  users: Users,
  academic: School,
  timetableManagement: CalendarCog,
  announcementsManagement: Send,
  bookings: CalendarCheck,
  forum: MessagesSquare,
  analytics: TrendingUp,
  attendance: ClipboardCheck,
  grades: GraduationCap,
  bookingsManagement: Boxes,
  forumModeration: Flag,
  studentFollowUp: UserSearch,
  audit: ScrollText,
};

export type ShellUser = { firstname: string; lastname: string; email: string; role: Role };

function formatBadge(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/** Sidebar / sheet link. Accessible name: label (+ " <count>" for the unread badge). */
function SideLink({ item, label, pathname, badge, onNavigate }: {
  item: NavItem;
  label: string;
  pathname: string;
  badge?: number;
  onNavigate?: () => void;
}) {
  const Icon = ICONS[item.icon];
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-primary text-primary-foreground shadow-md shadow-primary/20" : "text-foreground hover:bg-accent hover:text-accent-foreground"
      )}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      <span className="flex-1 truncate">{label}</span>{" "}
      {badge ? (
        <span className="rounded-full bg-highlight px-2 py-0.5 text-xs font-semibold leading-4 text-highlight-foreground">
          {formatBadge(badge)}
        </span>
      ) : null}
    </Link>
  );
}

/** Mobile bottom navigation link (icon above a short label). */
function BottomLink({ item, label, pathname, badge }: { item: NavItem; label: string; pathname: string; badge?: number }) {
  const Icon = ICONS[item.icon];
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-1.5 text-[11px] font-medium leading-tight",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "text-primary" : "text-muted-foreground hover:text-foreground"
      )}
    >
      <span className={cn("flex h-7 w-12 items-center justify-center rounded-full transition-colors", active && "bg-accent")}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="max-w-full truncate">{label}</span>{" "}
      {badge ? (
        <span className="absolute right-[18%] top-1 min-w-5 rounded-full bg-highlight px-1.5 text-center text-[10px] font-bold leading-5 text-highlight-foreground">
          {formatBadge(badge)}
        </span>
      ) : null}
    </Link>
  );
}

function UserCard({ user }: { user: ShellUser }) {
  const t = useTranslations("common.roles");
  const initials = `${user.firstname.charAt(0)}${user.lastname.charAt(0)}`.toUpperCase();
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-muted px-3 py-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-brand-foreground" aria-hidden="true">
        {initials}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">
          {user.firstname} {user.lastname}
        </p>
        <p className="truncate text-xs text-muted-foreground">{t(user.role)}</p>
      </div>
    </div>
  );
}

/**
 * Dashboard shell: sidebar on large screens, top bar + bottom navigation on phones.
 * The <main id="main-content"> holds the page; everything else stays outside it.
 */
export function AppShell({
  user,
  unreadCount,
  renderedAt,
  children,
}: Readonly<{ user: ShellUser | null; unreadCount: number; renderedAt?: number; children: React.ReactNode }>) {
  const t = useTranslations("common");
  const pathname = usePathname();
  const unread = useUnreadCount(unreadCount, renderedAt);
  const groups = navGroups(user?.role);
  const [menuOpen, setMenuOpen] = React.useState(false);
  // The account page has its own "Language" select: avoid two controls with the same label.
  const showLanguageSwitcher = !isActive(pathname, "/dashboard/account");

  const label = (item: NavItem) => t(`nav.${item.key}`);
  const badgeFor = (item: NavItem) => (item.key === "notifications" ? unread : undefined);

  const managementGroup = (onNavigate?: () => void, idSuffix = "desktop") =>
    groups.map((group) => (
      <div key={group.labelKey} role="group" aria-labelledby={`nav-${group.labelKey}-${idSuffix}`} className="mt-6">
        <p id={`nav-${group.labelKey}-${idSuffix}`} className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t(`nav.${group.labelKey}`)}
        </p>
        <ul className="space-y-1">
          {group.items.map((item) => (
            <li key={item.href}>
              <SideLink item={item} label={label(item)} pathname={pathname} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </div>
    ));

  return (
    <div className="flex flex-1 bg-muted">
      <a
        href="#main-content"
        className="sr-only z-[70] rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        {t("nav.skipToContent")}
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r bg-background lg:flex">
        <div className="flex h-16 items-center px-5">
          <Logo href="/dashboard" />
        </div>
        <nav aria-label={t("nav.label")} className="flex-1 overflow-y-auto px-3 pb-4">
          <ul className="space-y-1">
            {MAIN_NAV.map((item) => (
              <li key={item.href}>
                <SideLink item={item} label={label(item)} pathname={pathname} badge={badgeFor(item)} />
              </li>
            ))}
          </ul>
          {managementGroup()}
        </nav>
        <div className="space-y-3 border-t p-3">
          {showLanguageSwitcher && <LanguageSwitcher className="justify-between px-1" />}
          {user && <UserCard user={user} />}
          <LogoutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur lg:hidden">
          <Logo href="/dashboard" />
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="rounded-full">
                <Menu className="h-5 w-5" aria-hidden="true" />
                <span className="sr-only">{t("nav.menu")}</span>
              </Button>
            </SheetTrigger>
            <SheetContent className="flex w-[300px] flex-col p-0 sm:w-[360px] [&>button]:text-brand-foreground">
              <SheetHeader className="bg-brand px-6 py-6 text-left text-brand-foreground">
                <SheetTitle className="text-xl font-bold text-brand-foreground">{t("nav.menu")}</SheetTitle>
                <SheetDescription className="text-brand-muted-foreground">{t("nav.menuDescription")}</SheetDescription>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto px-3 py-4">
                {user && <UserCard user={user} />}
                {managementGroup(() => setMenuOpen(false), "mobile")}
              </div>
              <div className="space-y-3 border-t px-4 py-4">
                {showLanguageSwitcher && <LanguageSwitcher className="justify-between px-1" />}
                <LogoutButton />
              </div>
            </SheetContent>
          </Sheet>
        </header>

        <main id="main-content" tabIndex={-1} className="flex-1 pb-28 focus:outline-none lg:pb-12">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        aria-label={t("nav.label")}
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1 backdrop-blur lg:hidden"
      >
        <ul className="mx-auto flex max-w-lg items-stretch justify-between gap-1">
          {MAIN_NAV.map((item) => (
            <li key={item.href} className="flex flex-1">
              <BottomLink item={item} label={label(item)} pathname={pathname} badge={badgeFor(item)} />
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
