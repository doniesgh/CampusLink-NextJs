import { CheckCheck, RefreshCw, WifiOff } from "lucide-react";

const steps = [
  { icon: WifiOff, title: "You lose the signal", text: "Your timetable and saved pages stay readable." },
  { icon: RefreshCw, title: "You keep going", text: "Bookings and posts wait in a queue on your device." },
  { icon: CheckCheck, title: "You reconnect", text: "Everything syncs in the background." },
];

export default function Offline() {
  return (
    <section className="relative overflow-hidden  rounded-[2rem] bg-blue-950 text-white p-10 border-b  border-white/10 dark:bg-blue-950 dark:text-white dark:border-white/10">
      <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-blue-500/30 blur-3xl" />
      <div className="container relative py-20 md:py-28">
        <h2 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-5xl">
          Made for patchy campus Wi-Fi
        </h2>
        <p className="mt-4 max-w-2xl text-blue-200">
          CampusLink installs like a native app and keeps working when the network does not.
        </p>
        <ol className="mt-14 grid gap-6 md:grid-cols-3">
          {steps.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="rounded-3xl border border-white/10 bg-white/5 p-7 backdrop-blur">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500 text-white">
                  <Icon className="h-6 w-6" />
                </span>
                <span className="text-4xl font-bold text-white/20">{i + 1}</span>
              </div>
              <h3 className="mt-5 text-xl font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-blue-200">{text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}