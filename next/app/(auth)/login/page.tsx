import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { safeNextPath } from "@/lib/safe-next";
import LoginForm from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.login");
  return { title: t("metaTitle") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next)) ?? "";
  const notice = first(params.reset) === "1" ? "reset" : first(params.changed) === "1" ? "passwordChanged" : null;

  return <LoginForm next={next} notice={notice} />;
}
