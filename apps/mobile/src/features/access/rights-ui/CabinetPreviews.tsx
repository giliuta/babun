import { BadgeCheck, Building2, MessageSquare, Receipt } from "lucide-react-native";

import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";

import type { AccessLevel } from "../access-map";
import { PreviewFrame } from "./PreviewFrame";

// ВИД ПРАВ «КАБИНЕТА» В ШТОРКЕ (владелец 04.10: «можем дать доступ к
// кабинету — реквизиты, тариф, SMS, оплата… зафиксировано за нашей
// командой»). Строка — ровно та, что встанет у партнёра в Кабинете в блоке
// вашего аккаунта: «Скрыт» — её там нет, «Видит» — строка без оплаты,
// «Оплачивает» / «Пополняет» — со страницей, где кнопка платит за ваш
// аккаунт и называет его.

const noop = () => {};

type State = "hidden" | "read" | "write";

const CAPTION: Record<State, string> = {
  hidden: "Так у него: в Кабинете этой строки нет",
  read: "Так он видит в блоке вашего аккаунта — без оплаты",
  write: "Так он платит — кнопкой с именем вашего аккаунта",
};

export function CabinetPreview({ blockKey, level }: { blockKey: string; level: AccessLevel }) {
  const state: State = level === "off" ? "hidden" : level === "read" ? "read" : "write";
  // Страница открывается и при «Видит» — без кнопки оплаты.
  const onPress = state === "hidden" ? undefined : noop;
  const row = (() => {
    switch (blockKey) {
      case "cabinet.tariff":
        return (
          <SettingsRow tile={SETTINGS_TILE.blue} icon={BadgeCheck} title="Тариф" sub="Про · оплачен до 12.11" onPress={onPress} />
        );
      case "cabinet.tariff_payments":
        return (
          <SettingsRow tile={SETTINGS_TILE.blue} icon={Receipt} title="Оплаты тарифа" sub="12 окт · €29,99" onPress={onPress} />
        );
      case "cabinet.sms":
        return (
          <SettingsRow tile={SETTINGS_TILE.green} icon={MessageSquare} title="SMS" value="€14,20" onPress={onPress} />
        );
      case "finance.settings_requisites":
        return (
          <SettingsRow tile={SETTINGS_TILE.green} icon={Building2} title="Реквизиты" sub="1 набор" onPress={onPress} />
        );
      default:
        return null;
    }
  })();
  if (!row) return null;
  // SMS не оплачивают, а пополняют; реквизиты — только «Видит».
  const caption = state === "write" && blockKey === "cabinet.sms" ? "Так он пополняет — кнопкой с именем вашего аккаунта" : CAPTION[state];
  return (
    <PreviewFrame state={state === "hidden" ? "hidden" : state} caption={caption} captionOff={state === "hidden"}>
      <SectionCard>{row}</SectionCard>
    </PreviewFrame>
  );
}
