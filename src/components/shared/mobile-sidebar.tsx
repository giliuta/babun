"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu,
  ClipboardList,
  Users,
  CalendarDays,
  Wrench,
  DollarSign,
  MessageSquare,
  BarChart3,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const allNavItems = [
  { href: "/orders", label: "Заказы", icon: ClipboardList },
  { href: "/clients", label: "Клиенты", icon: Users },
  { href: "/calendar", label: "Календарь", icon: CalendarDays },
  { href: "/crews", label: "Бригады", icon: Wrench },
  null,
  { href: "/finance", label: "Финансы", icon: DollarSign },
  { href: "/inbox", label: "Сообщения", icon: MessageSquare },
  { href: "/reports", label: "Отчёты", icon: BarChart3 },
  null,
  { href: "/settings", label: "Настройки", icon: Settings },
] as const;

export function MobileSidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-64 p-0">
        <div className="flex h-14 items-center border-b px-4">
          <span className="text-lg font-semibold tracking-tight">Babun</span>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {allNavItems.map((item, i) => {
            if (!item) return <Separator key={i} className="my-2" />;
            const isActive = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                  isActive && "bg-accent text-accent-foreground",
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
