import { BadgeCheck, Building2, History, MessageSquare, Receipt, UserCog } from "lucide-react-native";

import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { CAN_PAY_HERE } from "@/lib/pay-here";

import type { AccessLevel } from "../access-map";
import { PreviewFrame } from "./PreviewFrame";

// ВИД ПРАВ «КАБИНЕТА» В ШТОРКЕ (владелец 04.10: «можем дать доступ к
// кабинету — реквизиты, тариф, SMS, оплата… зафиксировано за нашей
// командой»). Строка — ровно та, что встанет у партнёра в Кабинете в блоке
// вашего аккаунта: «Скрыт» — её там нет, «Видит» — строка без оплаты,
// «Оплачивает» / «Пополняет» — со страницей, где кнопка платит за ваш
// аккаунт и называет его.
//
// В ПРИЛОЖЕНИИ ИЗ МАГАЗИНА — БЕЗ ОПЛАТЫ (`pay-here.ts`, App Store 3.1.3(f)):
// ни цены, ни срока оплаты, ни подписи «так он платит». Ступени оплаты там не
// предлагаются, а выданная на сайте показывается как «Видит».

const noop = () => {};

type State = "hidden" | "read" | "write";

const CAPTION: Record<State, string> = {
  hidden: "Так у него: в Кабинете этой строки нет",
  read: "Так он видит в блоке вашего аккаунта — без оплаты",
  write: "Так он платит — кнопкой с именем вашего аккаунта",
};

export function CabinetPreview({ blockKey, level }: { blockKey: string; level: AccessLevel }) {
  // Ступень оплаты в приложении из магазина читается как «Видит» (`right-words.ts`).
  const payStep = !CAN_PAY_HERE && (blockKey === "cabinet.tariff" || blockKey === "cabinet.sms");
  const state: State = level === "off" ? "hidden" : level === "read" || payStep ? "read" : "write";
  // Страница открывается и при «Видит» — без кнопки оплаты.
  const onPress = state === "hidden" ? undefined : noop;
  const row = (() => {
    switch (blockKey) {
      case "cabinet.tariff":
        return (
          <SettingsRow tile={SETTINGS_TILE.blue} icon={BadgeCheck} title="Тариф" sub={CAN_PAY_HERE ? "Про · оплачен до 12.11" : "Про"} onPress={onPress} />
        );
      case "cabinet.tariff_payments":
        return (
          <SettingsRow tile={SETTINGS_TILE.blue} icon={Receipt} title="Оплаты тарифа" sub={CAN_PAY_HERE ? "12 окт · €29,99" : undefined} onPress={onPress} />
        );
      case "cabinet.sms":
        return (
          <SettingsRow tile={SETTINGS_TILE.green} icon={MessageSquare} title="SMS" value="€14,20" onPress={onPress} />
        );
      case "finance.settings_requisites":
        return (
          <SettingsRow tile={SETTINGS_TILE.green} icon={Building2} title="Реквизиты" sub="1 набор" onPress={onPress} />
        );
      case "cabinet.history":
        return (
          <SettingsRow tile={SETTINGS_TILE.teal} icon={History} title="История изменений" sub="Сегодня 3 изменения" onPress={onPress} />
        );
      case "company.partners":
        return (
          <SettingsRow
            tile={SETTINGS_TILE.indigo}
            icon={UserCog}
            title="Партнёры"
            sub={state === "write" ? "Приглашает и ставит права" : "Только видит"}
            onPress={onPress}
          />
        );
      default:
        return null;
    }
  })();
  if (!row) return null;
  // SMS не оплачивают, а пополняют; реквизитам и истории платить нечем. В
  // приложении из магазина — «Так он видит…» без «без оплаты».
  const caption =
    !CAN_PAY_HERE && state === "read"
      ? "Так он видит в блоке вашего аккаунта"
      : state === "write" && blockKey === "cabinet.sms"
      ? "Так он пополняет — кнопкой с именем вашего аккаунта"
      : state === "write" && blockKey === "company.partners"
        ? "Так он ведёт партнёров вашего аккаунта — не выше своих прав"
      : state === "read" && (blockKey === "cabinet.history" || blockKey === "finance.settings_requisites" || blockKey === "company.partners")
        ? "Так он видит в блоке вашего аккаунта"
        : CAPTION[state];
  return (
    <PreviewFrame state={state === "hidden" ? "hidden" : state} caption={caption} captionOff={state === "hidden"}>
      <SectionCard>{row}</SectionCard>
    </PreviewFrame>
  );
}
