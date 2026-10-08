"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BellRing, UsersRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { SkeletonList } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type FollowUpTab = "alerts" | "groups";

/**
 * "Alerts" / "Groups" tabs of the student follow-up page. The active tab lives in the URL (`?tab=groups`) and the
 * server page renders only its data (`children`); while the other tab loads, its panel shows a skeleton.
 */
export function FollowUpTabs({ tab, children }: { tab: FollowUpTab; children: React.ReactNode }) {
  const t = useTranslations("analytics.followUp");
  const tStates = useTranslations("common.states");
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [requested, setRequested] = useState<FollowUpTab | null>(null);
  const current = pending && requested ? requested : tab;

  const onValueChange = (value: string) => {
    const next: FollowUpTab = value === "groups" ? "groups" : "alerts";
    if (next === tab) return;
    setRequested(next);
    startTransition(() => router.push(next === "groups" ? `${pathname}?tab=groups` : pathname, { scroll: false }));
  };

  const panel = current === tab ? children : <SkeletonList rows={4} label={tStates("loading")} />;

  return (
    <Tabs value={current} onValueChange={onValueChange}>
      <TabsList aria-label={t("tabsLabel")}>
        <TabsTrigger value="alerts">
          <BellRing className="h-4 w-4" aria-hidden="true" />
          {t("tabs.alerts")}
        </TabsTrigger>
        <TabsTrigger value="groups">
          <UsersRound className="h-4 w-4" aria-hidden="true" />
          {t("tabs.groups")}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="alerts">{current === "alerts" ? panel : null}</TabsContent>
      <TabsContent value="groups">{current === "groups" ? panel : null}</TabsContent>
    </Tabs>
  );
}
