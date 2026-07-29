import { Outlet, createFileRoute } from "@tanstack/react-router";

import { AppSidebar } from "@/components/scoutly/app-sidebar";
import { DemoBadge } from "@/components/scoutly/source-badge";
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
            <DemoBadge className="shrink-0" />
          </header>
          <main className="flex-1">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
