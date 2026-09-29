import {
  BarChart3, Bus, CalendarClock, DoorOpen, GraduationCap,
  Megaphone, MessagesSquare, ShieldCheck, ShoppingBag, WifiOff,
} from "lucide-react";

const modules = [
  { icon: CalendarClock, title: "Smart timetable", text: "Generated for your program, with a push notification whenever a class or room changes.", span: "md:col-span-4", featured: true },
  { icon: DoorOpen, title: "Rooms and equipment", text: "A shared calendar that catches booking conflicts before they happen.", span: "md:col-span-2" },
  { icon: Bus, title: "Carpooling", text: "Find rides from students near you and chat in the app.", span: "md:col-span-2" },
  { icon: ShoppingBag, title: "Notes marketplace", text: "Upload and rate course notes. Payments are simulated.", span: "md:col-span-2" },
  { icon: MessagesSquare, title: "Help forum", text: "Ask and answer by subject. Votes and badges surface the best replies.", span: "md:col-span-2" },
  { icon: GraduationCap, title: "Alumni network", text: "Browse profiles and ask a graduate to mentor you.", span: "md:col-span-3" },
  { icon: BarChart3, title: "Your progress", text: "Track attendance and follow your progress in simple charts.", span: "md:col-span-3", bars: true },
  { icon: Megaphone, title: "Announcements", text: "Admins send push notifications targeted by program.", span: "md:col-span-2" },
  { icon: WifiOff, title: "Full offline mode", text: "Cached pages and background sync keep you going without signal.", span: "md:col-span-2" },
  { icon: ShieldCheck, title: "Sign-in and roles", text: "Single sign-on with separate access for students, teachers and admins.", span: "md:col-span-2" },
];

export default function Modules() {
  return (
    <section id="modules" className="container scroll-mt-20 py-20 md:py-28">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight text-blue-950 dark:text-white sm:text-5xl">
          Ten modules, one login
        </h2>
        <p className="mt-4 text-muted-foreground">
          Everything a school community needs day to day, in a single app.
        </p>
      </div>

      <ul className="mt-14 grid gap-4 md:grid-cols-6">
        {modules.map(({ icon: Icon, title, text, span, featured, bars }) => (
          <li
            key={title}
            className={`${span} rounded-3xl border p-7 transition hover:-translate-y-1 hover:shadow-xl ${
              featured
                ? "border-transparent bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-lg shadow-blue-600/30"
                : "bg-card hover:border-blue-300 hover:shadow-blue-600/10"
            }`}
          >
            <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${featured ? "bg-white/15" : "bg-blue-50 text-blue-600 dark:bg-blue-950"}`}>
              <Icon className="h-6 w-6" />
            </span>
            <h3 className="mt-5 text-xl font-semibold">{title}</h3>
            <p className={`mt-2 text-sm ${featured ? "text-blue-100" : "text-muted-foreground"}`}>{text}</p>
            {bars && (
              <div className="mt-6 flex h-16 items-end gap-2">
                {[40, 65, 50, 80, 95].map((h, i) => (
                  <span key={i} style={{ height: `${h}%` }} className="w-full rounded-t-md bg-gradient-to-t from-blue-600 to-blue-400" />
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}