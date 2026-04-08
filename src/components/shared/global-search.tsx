"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  ClipboardList,
  Users,
  CalendarDays,
  Wrench,
  DollarSign,
  MessageSquare,
  BarChart3,
  Settings,
  Search,
} from "lucide-react";

const pages = [
  {
    name: "Заказы",
    href: "/orders",
    icon: ClipboardList,
    keywords: "orders заказы kanban",
  },
  {
    name: "Клиенты",
    href: "/clients",
    icon: Users,
    keywords: "clients клиенты",
  },
  {
    name: "Календарь",
    href: "/calendar",
    icon: CalendarDays,
    keywords: "calendar календарь",
  },
  { name: "Бригады", href: "/crews", icon: Wrench, keywords: "crews бригады" },
  {
    name: "Финансы",
    href: "/finance",
    icon: DollarSign,
    keywords: "finance финансы деньги",
  },
  {
    name: "Сообщения",
    href: "/inbox",
    icon: MessageSquare,
    keywords: "inbox сообщения чат",
  },
  {
    name: "Отчёты",
    href: "/reports",
    icon: BarChart3,
    keywords: "reports отчёты аналитика",
  },
  {
    name: "Настройки",
    href: "/settings",
    icon: Settings,
    keywords: "settings настройки",
  },
];

const quickActions = [
  {
    name: "Новый заказ",
    href: "/orders?action=new",
    keywords: "new order создать заказ",
  },
  {
    name: "Добавить клиента",
    href: "/clients?action=new",
    keywords: "new client добавить клиент",
  },
  {
    name: "Добавить бригаду",
    href: "/crews?action=new",
    keywords: "new crew добавить бригада",
  },
  {
    name: "Добавить расход",
    href: "/finance?tab=expenses&action=new",
    keywords: "expense расход",
  },
];

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const runCommand = useCallback((command: () => void) => {
    setOpen(false);
    command();
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-8 w-64 items-center gap-2 rounded-lg border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Поиск...</span>
        <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium opacity-70 sm:flex">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Поиск страниц, действий..." />
        <CommandList>
          <CommandEmpty>Ничего не найдено.</CommandEmpty>
          <CommandGroup heading="Страницы">
            {pages.map((page) => {
              const Icon = page.icon;
              return (
                <CommandItem
                  key={page.href}
                  value={page.name + " " + page.keywords}
                  onSelect={() => runCommand(() => router.push(page.href))}
                >
                  <Icon className="mr-2 h-4 w-4" />
                  {page.name}
                </CommandItem>
              );
            })}
          </CommandGroup>
          <CommandGroup heading="Быстрые действия">
            {quickActions.map((action) => (
              <CommandItem
                key={action.href}
                value={action.name + " " + action.keywords}
                onSelect={() => runCommand(() => router.push(action.href))}
              >
                <span className="mr-2 text-xs">+</span>
                {action.name}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
