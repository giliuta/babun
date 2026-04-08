"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { LayoutGrid, List } from "lucide-react";
import { cities } from "@/lib/validations/client";

const cityLabels: Record<string, string> = {
  limassol: "Лимассол",
  paphos: "Пафос",
  larnaca: "Ларнака",
  nicosia: "Никосия",
};

interface OrderFiltersProps {
  crews: { id: string; name: string }[];
  view: string;
}

export function OrderFilters({ crews, view }: OrderFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== "all") {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      router.push(`/orders?${params.toString()}`);
    },
    [router, searchParams],
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        defaultValue={searchParams.get("city") ?? "all"}
        onValueChange={(v) => updateFilter("city", v)}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Город" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Все города</SelectItem>
          {cities.map((c) => (
            <SelectItem key={c} value={c}>
              {cityLabels[c]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        defaultValue={searchParams.get("crew_id") ?? "all"}
        onValueChange={(v) => updateFilter("crew_id", v)}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Бригада" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Все бригады</SelectItem>
          {crews.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="date"
        className="w-40"
        defaultValue={searchParams.get("date") ?? ""}
        onChange={(e) => updateFilter("date", e.target.value)}
      />
      <div className="ml-auto flex gap-1">
        <Button
          variant={view === "kanban" ? "default" : "outline"}
          size="icon"
          className="h-8 w-8"
          onClick={() => updateFilter("view", "kanban")}
        >
          <LayoutGrid className="h-4 w-4" />
        </Button>
        <Button
          variant={view === "list" ? "default" : "outline"}
          size="icon"
          className="h-8 w-8"
          onClick={() => updateFilter("view", "list")}
        >
          <List className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
