import SiteHeader from "@/components/landing/site-header";
import SiteFooter from "@/components/landing/site-footer";
import Hero from "@/components/landing/hero";
import Modules from "@/components/landing/modules";
import Offline from "@/components/landing/offline";
import Cta from "@/components/landing/cta";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <Modules />
        <Offline />
        <Cta />
      </main>
      <SiteFooter />
    </>
  );
}