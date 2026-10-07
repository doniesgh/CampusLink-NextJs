import type { Metadata } from "next";
import { safeNextPath } from "@/lib/safe-next";
import LoginForm from "./login-form";

export const metadata: Metadata = {
  title: "Log in",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next)) ?? "";
  const reset = first(params.reset) === "1";

  return <LoginForm next={next} reset={reset} />;
}
