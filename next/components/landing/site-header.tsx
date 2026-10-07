"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRight, Home, LayoutGrid, Menu, WifiOff } from "lucide-react";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import Logo from "../ui/logo";

const signUpClass =
  "rounded-full shadow-lg shadow-highlight/30 transition-shadow hover:shadow-highlight/40";

export default function SiteHeader() {
  const t = useTranslations("landing.nav");
  const [open, setOpen] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);
  const pathname = usePathname();

  const menuItems = [
    { title: t("home"), href: "/", icon: Home },
    { title: t("modules"), href: "/#modules", icon: LayoutGrid },
    { title: t("offline"), href: "/#offline", icon: WifiOff },
  ];

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Only "Home" maps to a real pathname; the other entries are in-page anchors.
  const isActive = (href: string) => !href.includes("#") && pathname === href;

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
            ? "h-14 max-w-5xl rounded-full border border-border bg-background/80 px-4 shadow-lg shadow-primary/10 backdrop-blur-xl"
            : "container h-16"
        )}
      >
        <Logo />

        {/* Desktop navigation */}
        <nav aria-label={t("main")} className="hidden flex-1 justify-center md:flex">
          <ul className="flex items-center gap-1">
            {menuItems.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "rounded-full px-4 py-2 text-sm font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "bg-primary text-primary-foreground shadow-md shadow-primary/30"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
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
          <LanguageSwitcher hideLabel selectClassName="w-30" />
          <Link
            href="/login"
            className={cn(
              buttonVariants({ variant: "ghost" }),
              "rounded-full text-primary hover:bg-accent hover:text-accent-foreground"
            )}
          >
            {t("login")}
          </Link>
          <Link
            href="/signup"
            className={cn(buttonVariants({ variant: "highlight" }), signUpClass, "px-5")}
          >
            {t("signup")}
          </Link>
        </div>

        {/* Mobile menu */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild className="ml-auto md:hidden">
            <Button
              variant="outline"
              size="icon"
              aria-label={t("openMenu")}
              className="rounded-full border-border text-primary"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </Button>
          </SheetTrigger>

          <SheetContent className="flex w-[300px] flex-col p-0 sm:w-[380px] [&>button]:text-brand-foreground">
            <SheetHeader className="bg-brand px-6 py-6 text-left text-brand-foreground">
              <SheetTitle className="text-xl font-bold text-brand-foreground">CampusLink</SheetTitle>
              <SheetDescription className="text-brand-muted-foreground">{t("tagline")}</SheetDescription>
            </SheetHeader>

            <nav aria-label={t("mobile")} className="flex-1 overflow-y-auto px-3 py-4">
              <ul className="space-y-1">
                {menuItems.map(({ title, href, icon: Icon }) => {
                  const active = isActive(href);
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-3 rounded-xl px-3 py-3 text-base font-medium transition-colors",
                          active ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-9 w-9 items-center justify-center rounded-lg",
                            active
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="flex-1">{title}</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <div className="space-y-3 border-t px-6 py-5">
              <LanguageSwitcher className="justify-between" />
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "w-full rounded-full text-primary"
                )}
              >
                {t("login")}
              </Link>
              <Link
                href="/signup"
                onClick={() => setOpen(false)}
                className={cn(buttonVariants({ variant: "highlight", size: "lg" }), signUpClass, "w-full")}
              >
                {t("signup")}
              </Link>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
