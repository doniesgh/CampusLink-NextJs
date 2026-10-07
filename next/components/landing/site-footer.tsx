import Link from "next/link";

const links = [
  { title: "Home", href: "/" },
  { title: "Modules", href: "/#modules" },
  { title: "Offline mode", href: "/#offline" },
  { title: "Log in", href: "/login" },
  { title: "Sign up", href: "/signup" },
];

export default function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="container flex flex-col items-start justify-between gap-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center">
        <p>&copy; {new Date().getFullYear()} CampusLink</p>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {links.map((l) => (
              <li key={l.title}>
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
