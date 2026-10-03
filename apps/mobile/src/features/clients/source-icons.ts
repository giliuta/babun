import {
  Circle,
  Footprints,
  Globe,
  Instagram,
  MapPin,
  Megaphone,
  MessageCircle,
  RotateCcw,
  Users,
  type LucideIcon,
} from "lucide-react-native";
import type { AcquisitionSource } from "@babun/shared/local/clients";

/** Значок источника: откуда пришёл клиент, узнаётся с одного взгляда. */
export const SOURCE_ICONS: Partial<Record<AcquisitionSource, LucideIcon>> = {
  referral: Users,
  instagram: Instagram,
  whatsapp: MessageCircle,
  google_maps: MapPin,
  website: Globe,
  repeat: RotateCcw,
  walk_in: Footprints,
  other: Circle,
};

/** Свой источник команды — один общий значок. */
export const CUSTOM_SOURCE_ICON: LucideIcon = Megaphone;
