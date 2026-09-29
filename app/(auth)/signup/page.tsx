"use client";

import * as React from "react";
import Link from "next/link";
import {
  Bell, Bus, CalendarDays, Eye, EyeOff, Loader2, Lock, Mail, School, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Logo from "@/components/ui/logo";

const perks = [
  { icon: CalendarDays, text: "Your timetable, even offline" },
  { icon: Bell, text: "Instant room and class changes" },
  { icon: Bus, text: "Carpools with students near you" },
  { icon: ShieldCheck, text: "One secure login for every role" },
];

export default function LoginPage() {
  const [showPassword, setShowPassword] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const data = new FormData(e.currentTarget);
    try {
      // TODO: replace with your auth call, e.g. signIn("credentials", {...})
      console.log({ email: data.get("email"), password: data.get("password") });
    } catch {
      setError("Incorrect email or password. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-blue-400/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-indigo-400/30 blur-3xl" />

        <Link href="/" className="relative text-xl font-bold tracking-tight">
          CampusLink
        </Link>

        <div className="relative max-w-md">
          <h2 className="text-4xl font-extrabold tracking-tight">
            Welcome back to your campus
          </h2>
          <ul className="mt-8 space-y-4">
            {perks.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-blue-50">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
                  <Icon className="h-5 w-5" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex max-w-sm items-start gap-3 rounded-2xl border border-white/15 bg-white/10 p-4 text-sm backdrop-blur">
          <Bell className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Stay updated with the latest news and announcements.
          </p>
        </div>
      </aside>

      {/* Form */}
      <main className="flex flex-col bg-gradient-to-b from-blue-50 to-background px-6 py-8 dark:from-blue-950/40 sm:px-12">
        <div className="lg:hidden">
          <Logo />
        </div>

        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          <h1 className="text-3xl font-bold tracking-tight text-blue-950 dark:text-white">
            Sign up
          </h1>
          <p className="mt-2 text-muted-foreground">
            Enter your details to create your CampusLink account.
          </p>

          <Button
            type="button"
            variant="outline"
            size="lg"
            className="mt-8 h-11 w-full rounded-xl border-blue-200 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-200 dark:hover:bg-blue-950"
          >
            <School className="mr-2 h-4 w-4" />
            Continue with school account
          </Button>

          <div className="my-6 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or with email
            <span className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@school.edu"
                  required
                  className="h-11 rounded-xl pl-10 focus-visible:ring-blue-500"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
              </div>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Your password"
                  required
                  className="h-11 rounded-xl pl-10 pr-11 focus-visible:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                name="remember"
                className="h-4 w-4 rounded border-input accent-blue-600"
              />
              Keep me signed in
            </label>

            <p role="alert" aria-live="polite" className="min-h-5 text-sm text-destructive">
              {error}
            </p>

            <Button
              type="submit"
              size="lg"
              disabled={loading}
              className="h-11 w-full rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/30 hover:from-blue-700 hover:to-indigo-700"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Logging in...
                </>
              ) : (
                "Log in"
              )}
            </Button>
          </form>

          <p className="mt-8 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-300">
              Log in
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}