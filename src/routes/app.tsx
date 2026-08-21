import { Outlet, createFileRoute } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";

import { AppSidebar } from "@/components/scoutly/app-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

function AppLayout() {
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
