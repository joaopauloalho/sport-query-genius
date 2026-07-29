import { Link, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  Bookmark,
  Compass,
  CreditCard,
  History,
  Home,
  LayoutGrid,
  Moon,
  Settings,
  Shield,
  Sun,
  Users,
} from "lucide-react";

import { Logo } from "@/components/scoutly/logo";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
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

const MAIN = [
  { title: "Início", url: "/app", icon: Home },
  { title: "Explorar", url: "/app/explorar", icon: Compass },
  { title: "Jogos", url: "/app/jogos", icon: BarChart3 },
  { title: "Jogadores", url: "/app/jogadores", icon: Users },
  { title: "Equipes", url: "/app/equipes", icon: Shield },
];

const LIBRARY = [
  { title: "Análises salvas", url: "/app/salvas", icon: Bookmark },
  { title: "Workspaces", url: "/app/workspaces", icon: LayoutGrid },
  { title: "Histórico", url: "/app/historico", icon: History },
];

const ACCOUNT = [
  { title: "Planos", url: "/precos", icon: CreditCard },
  { title: "Configurações", url: "/app/configuracoes", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { profile, usage, quota, planName, theme, toggleTheme } = useScoutly();

  const isActive = (url: string) => (url === "/app" ? pathname === "/app" : pathname.startsWith(url));

  const renderGroup = (label: string, items: typeof MAIN) => (
    <SidebarGroup>
      {!collapsed && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
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
  );

  const pct = Math.min(100, Math.round((usage / quota) * 100));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        <Link to="/" aria-label="Scoutly AI — início">
          <Logo compact={collapsed} />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {renderGroup("Descobrir", MAIN)}
        {renderGroup("Biblioteca", LIBRARY)}
        {renderGroup("Conta", ACCOUNT)}
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

        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">
            {profile.name.slice(0, 2).toUpperCase()}
          </span>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{profile.name}</p>
              <p className="truncate text-xs text-muted-foreground">Plano {planName}</p>
            </div>
          )}
        </div>

        {!collapsed && (
          <div className="space-y-1.5">
            <Progress value={pct} className="h-1.5" />
            <p className="text-[0.7rem] text-muted-foreground">
              {usage} de {quota} análises usadas neste mês
            </p>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
