import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Cta() {
  return (
    <section className="container py-20 md:py-28 p-10">
      <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-blue-600 to-indigo-700 px-6 py-16 text-center text-white shadow-2xl shadow-blue-600/30 sm:px-12">
        <div className="pointer-events-none absolute -left-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-20 -right-10 h-72 w-72 rounded-full bg-indigo-300/20 blur-3xl" />
        <h2 className="relative mx-auto max-w-2xl text-3xl font-bold tracking-tight sm:text-5xl">
          Bring your school onto CampusLink
        </h2>
        <p className="relative mx-auto mt-4 max-w-xl text-blue-100">
          Sign in with your school account and see your timetable in a minute.
        </p>
        <div className="relative mt-8 flex flex-wrap justify-center gap-3">
          <Button  size="lg" className="rounded-full bg-white px-7 text-blue-700 hover:bg-blue-50">
            <Link href="/signup">Create your account</Link>
          </Button>
          <Button  size="lg" variant="ghost" className="rounded-full px-7 text-white hover:bg-white/10 hover:text-white">
            <Link href="/login">Log in</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}