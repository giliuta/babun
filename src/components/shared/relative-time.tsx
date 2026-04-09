"use client";

import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface RelativeTimeProps {
  date: string;
  className?: string;
}

export function RelativeTime({ date, className }: RelativeTimeProps) {
  const d = new Date(date);
  const relative = formatDistanceToNow(d, { addSuffix: true, locale: ru });
  const absolute = d.toLocaleString("ru-RU");

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <time dateTime={date} className={className}>
            {relative}
          </time>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{absolute}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
