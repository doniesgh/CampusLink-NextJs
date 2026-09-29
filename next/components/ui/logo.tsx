import React from "react";
import Link from "next/link";
import { GraduationCap } from "lucide-react";

export default function Logo() {
  return (
    <Link href="/" className="mr-4 flex items-center gap-2.5" aria-label="CampusLink home">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-600/30">
        <GraduationCap className="h-5 w-5" />
      </span>
      <span className="text-lg font-bold tracking-tight text-blue-950 dark:text-white">
        CampusLink
      </span>
    </Link>
  );
}