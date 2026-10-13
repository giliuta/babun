import type { LucideIcon } from "lucide-react-native";
import {
  Bookmark,
  Briefcase,
  CalendarRange,
  FileText,
  MapPin,
  Clock,
  StickyNote,
  Tags,
  UserRound,
  Wallet,
} from "lucide-react-native";
import { BOOKING_BLOCKS, EVENT_BLOCKS } from "@/features/appointments/booking-prefs";

/** Значок блока формы — тот же, что у сущности в продукте (BLOCKS.md §0.2). */
export const BLOCK_ICON: Record<string, LucideIcon> = {
  team: CalendarRange,
  type: Tags,
  when: Clock,
  services: Briefcase,
  label: Bookmark,
  client: UserRound,
  object: MapPin,
  payment: Wallet,
  note: StickyNote,
  files: FileText,
};

export const BLOCK_LABEL: Record<string, string> = Object.fromEntries(
  [...BOOKING_BLOCKS, ...EVENT_BLOCKS].map((b) => [b.id, b.label]),
);
