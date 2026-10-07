import React from "react";
import Link from "next/link";
import { GraduationCap } from "lucide-react";

export default function Logo() {
  return (
    <Link href="/" className="mr-4 flex items-center gap-2.5" aria-label="CampusLink home">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/30">
        <GraduationCap className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="font-heading text-lg font-bold tracking-tight text-foreground">
        CampusLink
      </span>
    </Link>
  );
}
