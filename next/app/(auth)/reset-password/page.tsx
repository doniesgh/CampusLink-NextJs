import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import ResetPasswordForm from "./reset-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.reset");
  return {
    title: t("metaTitle"),
    // The reset token is in the URL: never leak it through the Referer header.
    referrer: "no-referrer",
  };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ResetPasswordPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const { token } = await searchParams;
  return <ResetPasswordForm token={(Array.isArray(token) ? token[0] : token) ?? ""} />;
}
