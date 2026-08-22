import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect } from "react";

import { AppSidebar } from "@/components/scoutly/app-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

function AppLayout() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      void navigate({ to: "/login", replace: true });
    }
  }, [loading, user, navigate]);

  if (loading || !user) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Verificando sua sessão…
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/60 bg-background/80 px-3 backdrop-blur-xl sm:px-5">
            <SidebarTrigger aria-label="Alternar menu lateral" />
            <div className="min-w-0 flex-1" />
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-lime/40 bg-lime/10 px-2.5 py-1 text-[0.7rem] font-semibold tracking-wide text-lime uppercase">
              <CheckCircle2 className="size-3" />
              Futebol · consultas reais
            </span>
          </header>
          <main className="flex-1">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
