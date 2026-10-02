import { View } from "react-native";
import { ChevronRight } from "lucide-react-native";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SelectList, SelectRow } from "@/components/ui/select-rows";
import { useThemeColors } from "@/theme/colors";

import type { AccessLevel } from "../access-map";
import { PreviewFrame, levelState } from "./PreviewFrame";
import { CLIENTS_PREVIEW_KEYS } from "./preview-keys";

// ВИД ПРАВ КЛИЕНТОВ В ШТОРКЕ: список клиентов теми же строками, что шторка
// выбора клиента (`SelectRow` с буквой). «Какие клиенты» меняет, сколько их в
// списке; «Телефоны» — есть ли номер под именем; «Меняет» — живая кнопка
// создания внизу, «Только видит» — та же серая, как у списка клиентов.
//
// Защита базы (30.09, окно — 02.10): «2 недели» и «Месяц» — в списке только
// клиент, у которого запись в этом окне до или после сегодня. Цифр в списке у сотрудника нет НИКОГДА — номер открывается
// тапом, по одному (`LockedPhoneRow`), поэтому и здесь вместо цифр точки:
// «Всегда» — у всех, «В день записи» — у того, чья запись сегодня (первый в
// образце), у остальных — «В день записи».

const noop = () => {};

/** Номер, который ещё не открыли, — как на его карточке. */
const LOCKED_NUMBER = "•• ••• •••";

const OWN = [
  { name: "Анна Петрова" },
  { name: "Иван Смирнов" },
];

export function ClientsPreview({
  blockKey,
  levels,
}: {
  blockKey: string;
  levels: Readonly<Record<string, AccessLevel>>;
}) {
  const t = useThemeColors();
  const base = levels.clients ?? "off";
  const scope = levels["clients.scope"] ?? "near";
  const contacts = levels["clients.contacts"] ?? "off";
  const phones = contacts === "read" || contacts === "day";
  // Переход на страницу клиента — шеврон строки (как в его списке).
  const opens =
    blockKey === "clients.from_record"
      ? levels["clients.from_record"] === "write"
      : levels["clients.open"] === "write";
  // Карточки закрыты — у зависимых строк («Какие», «Телефоны») показывать
  // нечего: базы у него нет вовсе, и рамка гасит весь список.
  const people = scope === "near" ? OWN.slice(0, 1) : OWN;
  const state = levelState(base);
  if (!CLIENTS_PREVIEW_KEYS.includes(blockKey)) return null;
  // Зависимые строки говорят своё: список один, а меняют они в нём разное.
  const caption =
    state === "hidden"
      ? undefined
      : blockKey === "clients.scope"
        ? scope === "own"
          ? "Видит клиентов своей команды"
          : scope === "month"
            ? "Видит клиента за месяц до и после записи"
            : "Видит клиента за 2 недели до и после записи"
        : blockKey === "clients.contacts"
          ? contacts === "read"
            ? "Открывает номер по одному"
            : contacts === "day"
              ? "Номер — только в день записи"
              : "Номеров не видит"
          : blockKey === "clients.open"
            ? opens
              ? "Тапом открывает страницу клиента"
              : "Только строка — страница не открывается"
            : blockKey === "clients.from_record"
              ? opens
                ? "Из записи открывает страницу клиента"
                : "Из записи страница клиента не открывается"
              : undefined;
  return (
    <PreviewFrame
      state={state}
      caption={caption}
      captionOff={blockKey === "clients.contacts" && !phones}
    >
      <Card style={{ marginHorizontal: 16, marginTop: 8, paddingVertical: 8 }}>
        <SelectList>
          {people.map((person) => (
            // Номер закрыт — строки номера нет вовсе, как в его списке
            // клиентов (`ClientRow` не рисует пустой телефон).
            <SelectRow
              key={person.name}
              title={person.name}
              initial={person.name[0]}
              subtitle={
                !phones
                  ? undefined
                  : contacts === "read" || person === OWN[0]
                    ? LOCKED_NUMBER
                    : "В день записи"
              }
              // Переход есть — шеврон справа, как у двери; нет — строка без
              // него: имя видно, а проходить некуда.
              trailing={
                (blockKey === "clients.open" || blockKey === "clients.from_record") && opens ? (
                  <ChevronRight color={t.faint} size={18} />
                ) : undefined
              }
              onPress={noop}
            />
          ))}
        </SelectList>
      </Card>
      {/* Кнопка на своём месте и серая, как на его вкладке (владелец 20.09:
          «визуал страницы сохраняем, потом отключаем»). */}
      <View style={{ marginHorizontal: 16, marginTop: 8 }}>
        <Button variant="secondary" label="Создать клиента" onPress={noop} disabled={base !== "write"} />
      </View>
    </PreviewFrame>
  );
}
