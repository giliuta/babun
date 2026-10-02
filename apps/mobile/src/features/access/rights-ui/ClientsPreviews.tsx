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
// списке; «Редактирует» — живая кнопка создания внизу, «Только видит» — та
// же серая, как у списка клиентов. Видит клиентов — есть и номер под именем,
// и переход на страницу (02.10: «Телефон» и «Открывает карточку» убраны).
//
// Защита базы (30.09, окно — 02.10): «2 недели» и «Месяц» — в списке только
// клиент, у которого запись в этом окне до или после сегодня. Цифр в списке
// у партнёра нет НИКОГДА — номер открывается тапом, по одному
// (`LockedPhoneRow`), поэтому и здесь вместо цифр точки.

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
  // Номер и переход на страницу даёт сама база (02.10: «Телефон» и
  // «Открывает карточку» убраны): видит клиента — открывает его и номер.
  const phones = base !== "off";
  // Переход на страницу клиента — шеврон строки (как в его списке).
  const opens = base !== "off";
  // База закрыта — у зависимой строки «Ограничение по времени» показывать
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
          ? "Видит всех клиентов команды"
          : scope === "month"
            ? "Видит клиента команды за месяц до и после записи"
            : "Видит клиента команды за 2 недели до и после записи"
        : undefined;
  return (
    <PreviewFrame
      state={state}
      caption={caption}
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
              subtitle={phones ? LOCKED_NUMBER : undefined}
              // Переход есть — шеврон справа, как у двери; нет — строка без
              // него: имя видно, а проходить некуда.
              trailing={
                blockKey === "clients" && opens ? (
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
