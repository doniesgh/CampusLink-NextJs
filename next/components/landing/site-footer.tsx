import Link from "next/link";

const links = [
  { title: "Home", href: "/" },
  { title: "Features", href: "/features" },
  { title: "Learn", href: "/learn" },
  { title: "Academy", href: "/academy" },
];

export default function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="container flex flex-col items-start justify-between gap-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center">
        <p>&copy; {new Date().getFullYear()} CampusLink</p>
        <nav aria-label="Footer">
          <ul className="flex gap-5">
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