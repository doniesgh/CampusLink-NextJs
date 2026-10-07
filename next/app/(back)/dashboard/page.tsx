import type { Metadata } from "next";
import Link from "next/link";
import { Bus, CalendarClock, CircleAlert, MessagesSquare, ShieldCheck, ShoppingBag, UserRound } from "lucide-react";
import { messageForError } from "@/lib/auth-messages";
import { getCurrentUser } from "@/lib/dal";
import { ROLE_LABELS } from "@/lib/types";

export const metadata: Metadata = {
  title: "Dashboard",
};

const upcoming = [
  { icon: CalendarClock, title: "Smart timetable", text: "Your classes and room changes, even offline." },
  { icon: Bus, title: "Carpooling", text: "Find rides from classmates near you." },
  { icon: ShoppingBag, title: "Notes marketplace", text: "Share and rate course notes." },
  { icon: MessagesSquare, title: "Help forum", text: "Ask and answer by subject." },
];

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "long" });

export default async function DashboardPage() {
  const { user, error } = await getCurrentUser("/dashboard");

  if (!user) {
    return (
      <div className="container py-10">
        <div role="alert" className="mx-auto flex max-w-xl items-start gap-3 rounded-2xl border border-destructive/30 bg-card p-6 text-card-foreground">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
          <div>
            <h1 className="text-lg font-semibold">We couldn&apos;t load your dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">{messageForError(error)}</p>
            <Link href="/dashboard" className="mt-4 inline-block text-sm font-semibold text-primary underline-offset-4 hover:underline">
              Try again
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const memberSince = Number.isNaN(Date.parse(user.createdAt)) ? null : dateFormat.format(new Date(user.createdAt));

  return (
    <div className="container space-y-8 py-10">
      <section className="relative overflow-hidden rounded-3xl bg-brand p-8 text-brand-foreground shadow-lg shadow-primary/20 sm:p-10">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-highlight/20 blur-3xl" />
        <p className="relative text-sm font-medium text-brand-muted-foreground">Your CampusLink</p>
        <h1 className="relative mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Welcome, {user.firstname}</h1>
        <p className="relative mt-2 text-brand-muted-foreground">Signed in as {user.email}</p>
      </section>

      <section aria-labelledby="account-heading" className="rounded-3xl border bg-card p-6 text-card-foreground sm:p-8">
        <h2 id="account-heading" className="text-xl font-semibold">Your account</h2>
        <dl className="mt-6 grid gap-6 sm:grid-cols-3">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
              <UserRound className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <dt className="text-sm text-muted-foreground">Role</dt>
              <dd className="font-semibold" data-role={user.role}>
                {ROLE_LABELS[user.role] ?? user.role}
              </dd>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <dt className="text-sm text-muted-foreground">Two-step verification</dt>
              <dd className="font-semibold">{user.twoFactorEnabled ? "On" : "Off"}</dd>
            </div>
          </div>
          {memberSince && (
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
                <CalendarClock className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <dt className="text-sm text-muted-foreground">Member since</dt>
                <dd className="font-semibold">{memberSince}</dd>
              </div>
            </div>
          )}
        </dl>
      </section>

      <section aria-labelledby="soon-heading">
        <h2 id="soon-heading" className="text-xl font-semibold">Coming soon</h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {upcoming.map(({ icon: Icon, title, text }) => (
            <li key={title} className="rounded-2xl border bg-card p-5 text-card-foreground">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-highlight text-highlight-foreground">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{text}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
