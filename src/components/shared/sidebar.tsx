"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardList,
  Users,
  CalendarDays,
  Wrench,
  DollarSign,
  MessageSquare,
  BarChart3,
  Settings,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const navItems = [
  { href: "/orders", label: "Заказы", icon: ClipboardList },
  { href: "/clients", label: "Клиенты", icon: Users },
  { href: "/calendar", label: "Календарь", icon: CalendarDays },
  { href: "/crews", label: "Бригады", icon: Wrench },
] as const;

const navItems2 = [
  { href: "/finance", label: "Финансы", icon: DollarSign },
  { href: "/inbox", label: "Сообщения", icon: MessageSquare },
  { href: "/reports", label: "Отчёты", icon: BarChart3 },
] as const;

const navItems3 = [
  { href: "/settings", label: "Настройки", icon: Settings },
] as const;

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();

  function NavLink({
    href,
    label,
    icon: Icon,
  }: {
    href: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }) {
    const isActive = pathname.startsWith(href);
    const link = (
      <Link
        href={href}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
          "hover:bg-accent/80 hover:text-accent-foreground",
          isActive &&
            "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
          collapsed && "justify-center px-2",
        )}
      >
        <Icon
          className={cn(
            "h-[18px] w-[18px] shrink-0",
            isActive && "text-primary",
          )}
        />
        {!collapsed && <span>{label}</span>}
      </Link>
    );

    if (collapsed) {
      return (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side="right" className="text-xs">
            {label}
          </TooltipContent>
        </Tooltip>
      );
    }

    return link;
  }

  return (
    <TooltipProvider>
      <aside
        className={cn(
          "flex h-screen flex-col border-r bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 transition-all duration-200",
          collapsed ? "w-[52px]" : "w-56",
        )}
      >
        <div className="flex h-14 items-center border-b px-3">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
                B
              </div>
              <span className="text-base font-semibold tracking-tight">
                Babun
              </span>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className={cn(
              "h-7 w-7 shrink-0",
              collapsed ? "mx-auto" : "ml-auto",
            )}
          >
            {collapsed ? (
              <PanelLeft className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </Button>
        </div>

        <ScrollArea className="flex-1 px-2 py-3">
          <nav className="flex flex-col gap-0.5">
            {navItems.map((item) => (
              <NavLink key={item.href} {...item} />
            ))}
            <Separator className="my-2" />
            {navItems2.map((item) => (
              <NavLink key={item.href} {...item} />
            ))}
            <Separator className="my-2" />
            {navItems3.map((item) => (
              <NavLink key={item.href} {...item} />
            ))}
          </nav>
        </ScrollArea>
      </aside>
    </TooltipProvider>
  );
}
