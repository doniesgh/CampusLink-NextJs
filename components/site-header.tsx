"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { BookOpen, ChevronRight, GraduationCap, Home, Menu, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import Logo from "./ui/logo";

const menuItems = [
  { title: "Home", href: "/", icon: Home },
  { title: "Features", href: "/features", icon: Sparkles },
  { title: "Learn", href: "/learn", icon: BookOpen },
  { title: "Academy", href: "/academy", icon: GraduationCap },
];

const signUpClass =
  "rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/30 transition-shadow hover:from-blue-700 hover:to-indigo-700 hover:shadow-blue-600/40";

export default function SiteHeader() {
  const [open, setOpen] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);
  const pathname = usePathname();

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full transition-all duration-300",
        scrolled && "px-3 pt-3"
      )}
    >
      {/* Full-width at the top, then it becomes a floating pill on scroll */}
      <div
        className={cn(
          "mx-auto flex items-center transition-all duration-300",
          scrolled
            ? "h-14 max-w-5xl rounded-full border border-blue-100 bg-white/80 px-4 shadow-lg shadow-blue-600/10 backdrop-blur-xl dark:border-blue-900 dark:bg-blue-950/70"
            : "container h-16"
        )}
      >
        <Logo />

        {/* Desktop navigation */}
        <nav aria-label="Main" className="hidden flex-1 justify-center md:flex">
          <ul className="flex items-center gap-1">
            {menuItems.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.title}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "rounded-full px-4 py-2 text-sm font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                      active
                        ? "bg-blue-600 text-white shadow-md shadow-blue-600/30"
                        : "text-muted-foreground hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-900/50 dark:hover:text-blue-200"
                    )}
                  >
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Desktop actions */}
        <div className="ml-4 hidden items-center gap-2 md:flex">
          <Button
            variant="ghost"
            className="rounded-full text-blue-700 hover:bg-blue-50 hover:text-blue-800 dark:text-blue-200 dark:hover:bg-blue-900/50"
          >
            Log in
          </Button>
          <Button className={cn(signUpClass, "px-5")}>Sign up</Button>
        </div>

        {/* Mobile menu */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild className="ml-auto md:hidden">
            <Button
              variant="outline"
              size="icon"
              aria-label="Open menu"
              className="rounded-full border-blue-200 text-blue-700 dark:border-blue-800 dark:text-blue-200"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>

          <SheetContent className="flex w-[300px] flex-col p-0 sm:w-[380px] [&>button]:text-white">
            <SheetHeader className="bg-gradient-to-br from-blue-600 to-indigo-700 px-6 py-6 text-left text-white">
              <SheetTitle className="text-xl font-bold text-white">CampusLink</SheetTitle>
              <SheetDescription className="text-blue-100">
                Your whole campus in one app
              </SheetDescription>
            </SheetHeader>

            <nav aria-label="Mobile" className="flex-1 overflow-y-auto px-3 py-4">
              <ul className="space-y-1">
                {menuItems.map(({ title, href, icon: Icon }) => {
                  const active = isActive(href);
                  return (
                    <li key={title}>
                      <Link
                        href={href}
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-3 rounded-xl px-3 py-3 text-base font-medium transition-colors",
                          active
                            ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200"
                            : "hover:bg-muted"
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-9 w-9 items-center justify-center rounded-lg",
                            active
                              ? "bg-blue-600 text-white"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="flex-1">{title}</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <div className="space-y-3 border-t px-6 py-5">
              <Button
                variant="outline"
                size="lg"
                className="w-full rounded-full border-blue-200 text-blue-700 dark:border-blue-800 dark:text-blue-200"
                onClick={() => setOpen(false)}
              >
                Log in
              </Button>
              <Button
                size="lg"
                className={cn(signUpClass, "w-full")}
                onClick={() => setOpen(false)}
              >
                Sign up
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}