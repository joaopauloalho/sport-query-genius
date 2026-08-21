import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Moon, Sun } from "lucide-react";

import { Logo } from "@/components/scoutly/logo";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useScoutly } from "@/lib/store";

const MAIN = [{ title: "Início", url: "/app", icon: Home }];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (routerState) => routerState.location.pathname });
  const { theme, toggleTheme } = useScoutly();

  const isActive = (url: string) =>
    url === "/app" ? pathname === "/app" : pathname.startsWith(url);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        <Link to="/" aria-label="Scoutly AI — início">
          <Logo compact={collapsed} />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          {!collapsed && <SidebarGroupLabel>Análise</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {MAIN.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <Link to={item.url} className="flex items-center gap-2.5">
                      <item.icon className="size-4 shrink-0" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-3 border-t border-sidebar-border p-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleTheme}
          className="justify-start gap-2 text-muted-foreground"
          aria-label="Alternar tema"
        >
          {theme === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
          {!collapsed && <span>{theme === "dark" ? "Modo escuro" : "Modo claro"}</span>}
        </Button>

        {!collapsed && (
          <p className="px-2 text-[0.7rem] leading-relaxed text-muted-foreground">
            O histórico recente é salvo somente neste navegador e não é sincronizado em conta ou
            nuvem.
          </p>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
