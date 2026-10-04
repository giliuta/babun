import {
  Banknote,
  Briefcase,
  HandCoins,
  NotebookPen,
  ReceiptText,
  Trash2,
  Wallet,
  CalendarRange,
  ClipboardList,
  Eye,
  Globe,
  Megaphone,
  MessageCircle,
  Navigation,
  Shapes,
  Tags,
} from "lucide-react-native";

import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";

import type { AccessLevel } from "../access-map";
import { PreviewFrame } from "./PreviewFrame";

// ВИД СТРОК «НАСТРОЕК КОМАНДЫ» И «НАСТРОЕК КЛИЕНТОВ» В ШТОРКЕ ПРАВА
// (владелец 30.09: «полностью, как в шестерёнке»). Строка — ровно та, что
// стоит в шестерёнке календаря или клиентов у партнёра: «Скрыт» — её у него нет, «Только видит» — строка со значением
// без двери, «Видит и меняет» — с дверью.

const noop = () => {};

type State = "hidden" | "read" | "write";

const CAPTION: Record<State, string> = {
  hidden: "Так у него: этой строки в настройках нет",
  read: "Так он видит — без правки",
  write: "Так он меняет — тапом по строке",
};

export function SettingsPreview({
  blockKey,
  level,
  teamName,
  teamColor,
}: {
  blockKey: string;
  level: AccessLevel;
  teamName: string;
  teamColor: string;
}) {
  const state: State = level === "off" ? "hidden" : level === "read" ? "read" : "write";
  // Строка шестерёнки клиентов открывается и при «Только видит» — страницей
  // без правки (аудит 03.10): у неё та же стрелка, что у «Меняет».
  const onPress =
    state === "write" ||
    (state === "read" && (blockKey.startsWith("clients.settings_") || blockKey.startsWith("finance.settings_")))
      ? noop
      : undefined;
  const row = (() => {
    switch (blockKey) {
      case "calendar.identity":
        return (
          <SettingsRow
            appearance={{ color: teamColor }}
            title={teamName || "Команда"}
            sub="Название и цвет"
            onPress={onPress}
          />
        );
      case "calendar.timezone":
        return (
          <SettingsRow
            tile={SETTINGS_TILE.orange}
            icon={Globe}
            title="Часовой пояс"
            sub="Nicosia, Kyiv, Helsinki · UTC+3"
            onPress={onPress}
          />
        );
      case "calendar.hours":
        return (
          <SettingsRow
            tile={SETTINGS_TILE.teal}
            icon={CalendarRange}
            title="Часы календаря"
            sub="08:00–20:00"
            onPress={onPress}
          />
        );
      case "calendar.booking_form":
        return (
          <SettingsRow
            tile={SETTINGS_TILE.blue}
            icon={ClipboardList}
            title="Записи"
            sub="Цвет команды · все блоки"
            onPress={onPress}
          />
        );
      case "calendar.services":
        return (
          <SettingsRow
            tile={SETTINGS_TILE.blue}
            icon={Briefcase}
            title="Услуги"
            sub="Каталог работ и цены"
            onPress={onPress}
          />
        );
      case "calendar.labels":
        return (
          <SettingsRow
            tile={SETTINGS_TILE.purple}
            icon={Tags}
            title="Метки"
            sub="Центр, Север, Выезд"
            onPress={onPress}
          />
        );
      // Шестерёнка «Клиентов» (владелец 01.10; словами 03.10) — строки
      // ровно как в ней.
      case "clients.settings_card":
        return (
          <SettingsRow
            tile={SETTINGS_TILE.blue}
            icon={Eye}
            title="Блоки клиентов"
            sub="Все блоки"
            onPress={onPress}
          />
        );
      case "clients.settings_ways":
        return (
          <SettingsRow
            tile={SETTINGS_TILE.green}
            icon={MessageCircle}
            title="Связь"
            sub="SMS · WhatsApp · Viber"
            onPress={onPress}
          />
        );
      case "clients.settings_maps":
        return (
          <SettingsRow
            tile={SETTINGS_TILE.blue}
            icon={Navigation}
            title="Карты для маршрута"
            sub="Google Maps · Waze"
            onPress={onPress}
          />
        );
      case "clients.settings_objects":
        return (
          <SettingsRow
            tile={SETTINGS_TILE.teal}
            icon={Shapes}
            title="Типы объектов"
            sub="Вилла, Дом…"
            onPress={onPress}
          />
        );
      case "clients.settings_tags":
        return (
          <SettingsRow
            tile={SETTINGS_TILE.purple}
            icon={Tags}
            title="Теги"
            sub="3 тега"
            onPress={onPress}
          />
        );
      case "clients.settings_sources":
        return (
          <SettingsRow
            tile={SETTINGS_TILE.orange}
            icon={Megaphone}
            title="Источники"
            sub="8 источников"
            onPress={onPress}
          />
        );
      // Шестерёнка «Финансов» (владелец 03.10: «по строке на каждую») —
      // строки как в ней.
      case "finance.settings_accounts":
        return (
          <SettingsRow tile={SETTINGS_TILE.blue} icon={Wallet} title="Счета" sub="2 счёта" onPress={onPress} />
        );
      case "finance.settings_trash":
        return (
          <SettingsRow
            tile={SETTINGS_TILE.red}
            icon={Trash2}
            title="Удалённые операции"
            sub="2 операции"
            onPress={onPress}
          />
        );
      case "finance.settings_categories_income":
        return (
          <SettingsRow tile={SETTINGS_TILE.green} icon={HandCoins} title="Доходы" sub="2 категории" onPress={onPress} />
        );
      case "finance.settings_categories_expense":
        return (
          <SettingsRow
            tile={SETTINGS_TILE.red}
            icon={ReceiptText}
            title="Расходы"
            sub="5 категорий"
            onPress={onPress}
          />
        );
      case "finance.settings_categories_debts":
        return (
          <SettingsRow tile={SETTINGS_TILE.yellow} icon={NotebookPen} title="Долги" sub="Пока нет" onPress={onPress} />
        );
      case "finance.settings_currency":
        return (
          <SettingsRow tile={SETTINGS_TILE.green} icon={Banknote} title="Валюта" sub="EUR · €" onPress={onPress} />
        );
      default:
        return null;
    }
  })();
  if (!row) return null;
  return (
    <PreviewFrame state={state === "hidden" ? "hidden" : state} caption={CAPTION[state]} captionOff={state === "hidden"}>
      <SectionCard>{row}</SectionCard>
    </PreviewFrame>
  );
}
