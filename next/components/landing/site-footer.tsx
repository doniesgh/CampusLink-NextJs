import Link from "next/link";
import { useTranslations } from "next-intl";

export default function SiteFooter() {
  const t = useTranslations("landing");
  const links = [
    { title: t("nav.home"), href: "/" },
    { title: t("nav.modules"), href: "/#modules" },
    { title: t("nav.offline"), href: "/#offline" },
    { title: t("nav.login"), href: "/login" },
    { title: t("nav.signup"), href: "/signup" },
  ];

  return (
    <footer className="border-t">
      <div className="container flex flex-col items-start justify-between gap-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center">
        <p>{t("footer.copyright", { year: new Date().getFullYear() })}</p>
        <nav aria-label={t("nav.footer")}>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="hover:text-foreground">
                  {l.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
