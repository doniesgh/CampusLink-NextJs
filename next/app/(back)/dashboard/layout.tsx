import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { SubmitButton } from "@/components/auth/submit-button";
import Logo from "@/components/ui/logo";

export default function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-1 flex-col bg-muted">
      <header className="border-b bg-background">
        <div className="container flex h-16 items-center justify-between">
          <Logo />
          <form action={logoutAction}>
            <SubmitButton
              variant="outline"
              size="default"
              className="h-10 w-auto rounded-full px-4 text-primary shadow-none"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Log out
            </SubmitButton>
          </form>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
