import { Link, useRouterState } from "@tanstack/react-router";
import { Bookmark, FolderKanban, History, Home, LogOut, Moon, Sun, UserRound } from "lucide-react";

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
import { useAuth } from "@/lib/auth";
import { useScoutly } from "@/lib/store";

const MAIN = [
  { title: "Início", url: "/app", icon: Home },
  { title: "Histórico", url: "/app/historico", icon: History },
  { title: "Salvos", url: "/app/salvos", icon: Bookmark },
  { title: "Workspaces", url: "/app/workspaces", icon: FolderKanban },
  { title: "Perfil", url: "/app/perfil", icon: UserRound },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (routerState) => routerState.location.pathname });
  const { signOut } = useAuth();
  const { theme, toggleTheme, profile } = useScoutly();

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
          {!collapsed && <SidebarGroupLabel>Sua conta</SidebarGroupLabel>}
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

      <SidebarFooter className="gap-2 border-t border-sidebar-border p-3">
        {!collapsed && (
          <div className="px-2 pb-1">
            <p className="truncate text-xs font-medium">{profile.name}</p>
            <p className="truncate text-[0.7rem] text-muted-foreground">{profile.email}</p>
          </div>
        )}
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
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void signOut()}
          className="justify-start gap-2 text-muted-foreground"
          aria-label="Sair da conta"
        >
          <LogOut className="size-4" />
          {!collapsed && <span>Sair</span>}
        </Button>
        {!collapsed && (
          <p className="px-2 pt-1 text-[0.7rem] leading-relaxed text-muted-foreground">
            Histórico, salvos e workspaces sincronizados com sua conta.
          </p>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
