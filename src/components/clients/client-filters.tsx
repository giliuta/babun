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
import { Search } from "lucide-react";
import { cities, clientSources } from "@/lib/validations/client";

const cityLabels: Record<string, string> = {
  limassol: "Лимассол",
  paphos: "Пафос",
  larnaca: "Ларнака",
  nicosia: "Никосия",
};

const sourceLabels: Record<string, string> = {
  manual: "Вручную",
  facebook: "Facebook",
  instagram: "Instagram",
  google: "Google",
  referral: "Рекомендация",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  website: "Сайт",
  bazaraki: "Bazaraki",
  repeat: "Повторный",
};

export function ClientFilters() {
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
      params.delete("page");
      router.push(`/clients?${params.toString()}`);
    },
    [router, searchParams],
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative w-64">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Поиск по имени или телефону..."
          className="pl-9"
          defaultValue={searchParams.get("search") ?? ""}
          onChange={(e) => {
            const timer = setTimeout(
              () => updateFilter("search", e.target.value),
              400,
            );
            return () => clearTimeout(timer);
          }}
        />
      </div>
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
        defaultValue={searchParams.get("source") ?? "all"}
        onValueChange={(v) => updateFilter("source", v)}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Источник" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Все источники</SelectItem>
          {clientSources.map((s) => (
            <SelectItem key={s} value={s}>
              {sourceLabels[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
