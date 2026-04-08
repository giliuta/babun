"use client";

import { useState } from "react";
import Link from "next/link";
import { format, addDays, startOfWeek, isSameDay } from "date-fns";
import { ru } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type CalendarOrder = {
  id: string;
  order_number: number;
  scheduled_date: string | null;
  scheduled_time_start: string | null;
  city: string;
  client_name: string;
  address: string | null;
  crew_name: string | null;
  crew_color: string | null;
};

interface CalendarViewProps {
  orders: CalendarOrder[];
  crews: { id: string; name: string }[];
  cities: string[];
}

const cityLabels: Record<string, string> = {
  limassol: "Лимассол",
  paphos: "Пафос",
  larnaca: "Ларнака",
  nicosia: "Никосия",
};

export function CalendarView({ orders, crews, cities }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<"day" | "week">("week");
  const [filterCity, setFilterCity] = useState("all");
  const [filterCrew, setFilterCrew] = useState("all");

  const filteredOrders = orders.filter((o) => {
    if (filterCity !== "all" && o.city !== filterCity) return false;
    if (filterCrew !== "all" && o.crew_name !== filterCrew) return false;
    return true;
  });

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const days =
    viewMode === "week"
      ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
      : [currentDate];

  const hours = Array.from({ length: 12 }, (_, i) => i + 7); // 7:00 - 18:00

  function prev() {
    setCurrentDate((d) => addDays(d, viewMode === "week" ? -7 : -1));
  }
  function next() {
    setCurrentDate((d) => addDays(d, viewMode === "week" ? 7 : 1));
  }

  function getOrdersForDay(day: Date) {
    const dateStr = format(day, "yyyy-MM-dd");
    return filteredOrders.filter((o) => o.scheduled_date === dateStr);
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={prev}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentDate(new Date())}
          >
            Сегодня
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={next}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <span className="text-sm font-medium">
          {viewMode === "week"
            ? `${format(weekStart, "d MMM", { locale: ru })} — ${format(addDays(weekStart, 6), "d MMM yyyy", { locale: ru })}`
            : format(currentDate, "d MMMM yyyy", { locale: ru })}
        </span>
        <div className="ml-auto flex gap-2">
          <Select value={filterCity} onValueChange={setFilterCity}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все города</SelectItem>
              {cities.map((c) => (
                <SelectItem key={c} value={c}>
                  {cityLabels[c] ?? c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterCrew} onValueChange={setFilterCrew}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все бригады</SelectItem>
              {crews.map((c) => (
                <SelectItem key={c.id} value={c.name}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-1">
            <Button
              variant={viewMode === "day" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("day")}
            >
              День
            </Button>
            <Button
              variant={viewMode === "week" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("week")}
            >
              Неделя
            </Button>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto rounded-lg border">
        <div
          className="grid min-w-[700px]"
          style={{
            gridTemplateColumns: `60px repeat(${days.length}, 1fr)`,
          }}
        >
          {/* Header row */}
          <div className="border-b bg-muted/50 p-2" />
          {days.map((day) => (
            <div
              key={day.toISOString()}
              className={cn(
                "border-b border-l bg-muted/50 p-2 text-center text-sm",
                isSameDay(day, new Date()) && "bg-primary/5 font-semibold",
              )}
            >
              <div>{format(day, "EEE", { locale: ru })}</div>
              <div className="text-lg">{format(day, "d")}</div>
            </div>
          ))}

          {/* Time rows */}
          {hours.map((hour) => (
            <div key={hour} className="contents">
              <div className="border-b p-1 text-right text-xs text-muted-foreground">
                {hour}:00
              </div>
              {days.map((day) => {
                const dayOrders = getOrdersForDay(day).filter((o) => {
                  if (!o.scheduled_time_start) return hour === 7;
                  const h = parseInt(o.scheduled_time_start.split(":")[0]);
                  return h === hour;
                });
                return (
                  <div
                    key={`${day.toISOString()}-${hour}`}
                    className="min-h-[48px] border-b border-l p-0.5"
                  >
                    {dayOrders.map((o) => (
                      <Link
                        key={o.id}
                        href={`/orders/${o.id}`}
                        className="mb-0.5 block rounded px-1.5 py-0.5 text-xs transition-colors hover:opacity-80"
                        style={{
                          backgroundColor: o.crew_color
                            ? `${o.crew_color}20`
                            : "#e5e7eb",
                          borderLeft: `3px solid ${o.crew_color ?? "#9ca3af"}`,
                        }}
                      >
                        <span className="font-medium">#{o.order_number}</span>{" "}
                        {o.client_name}
                        {o.address && (
                          <span className="block text-muted-foreground truncate">
                            {o.address}
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
