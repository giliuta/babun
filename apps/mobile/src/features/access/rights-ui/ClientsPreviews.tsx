import { Text, View } from "react-native";
import { Ban, Bell, CalendarPlus, Check, ChevronRight, Share2, Trash2, type LucideIcon } from "lucide-react-native";

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

/** Окно «Ограничений» словами (вариант 1 владельца, 02.10). */
const SCOPE_SPAN: Readonly<Record<string, string>> = {
  week: "Запись за неделю до или после",
  near: "Запись за две недели до или после",
  month: "Запись за месяц до или после",
  quarter: "Запись за три месяца до или после",
  half: "Запись за полгода до или после",
};

/** Номер, который ещё не открыли, — как на его карточке. */
const LOCKED_NUMBER = "•• ••• •••";

const OWN = [
  { name: "Анна Петрова" },
  { name: "Иван Смирнов" },
];

/** Пункты меню клиента — тем же видом, что в его меню (`ClientActionsSheet`). */
type MenuItem = { label: string; icon: LucideIcon; tone: "accent" | "warning" | "danger" };

/** Клиент и меню, открытое долгим нажатием на него (владелец 03.10: «добавь
 *  картинку того, когда оно открывается»), — как «Перенос записей» в
 *  календаре. */
function ClientMenuPreview({ items, phones }: { items: readonly MenuItem[]; phones: boolean }) {
  const t = useThemeColors();
  const person = OWN[0];
  return (
    <View>
      <Card style={{ marginHorizontal: 16, marginTop: 8, paddingVertical: 8 }}>
        <SelectList>
          <SelectRow
            title={person.name}
            initial={person.name[0]}
            subtitle={phones ? LOCKED_NUMBER : undefined}
            onPress={noop}
          />
        </SelectList>
      </Card>
      <Card style={{ marginHorizontal: 16, marginTop: 8, paddingTop: 10, paddingBottom: 8 }}>
        <Text
          maxFontSizeMultiplier={1.2}
          style={{ textAlign: "center", fontSize: 13, fontWeight: "600", color: t.sub, marginBottom: 4 }}
        >
          {person.name}
        </Text>
        <SelectList>
          {items.map((item) => (
            <SelectRow
              key={item.label}
              title={item.label}
              icon={item.icon}
              color={item.tone === "danger" ? t.danger : item.tone === "warning" ? t.warning : t.accent}
              onPress={noop}
            />
          ))}
        </SelectList>
      </Card>
    </View>
  );
}

/** «Меню клиента» — всё меню, кроме «Удалить» (владелец 03.10), в его
 *  порядке; «Записать» — только с правом «Новые записи» (ниже).
 *  «Удаление клиента» — удаление. */
const BOOK_ITEM: MenuItem = { label: "Записать", icon: CalendarPlus, tone: "accent" };
const MENU_ITEMS: Readonly<Record<string, readonly MenuItem[]>> = {
  "clients.menu": [
    { label: "Поделиться", icon: Share2, tone: "accent" },
    { label: "Выбрать несколько", icon: Check, tone: "accent" },
    { label: "Напомнить", icon: Bell, tone: "warning" },
    { label: "В чёрный список", icon: Ban, tone: "danger" },
  ],
  "clients.delete": [{ label: "Удалить", icon: Trash2, tone: "danger" }],
};

export function ClientsPreview({
  blockKey,
  levels,
}: {
  blockKey: string;
  levels: Readonly<Record<string, AccessLevel>>;
}) {
  const t = useThemeColors();
  const base = levels.clients ?? "off";
  const scope = levels["clients.scope"] ?? "week";
  // Номер — блок «Клиент» карточки (02.10), переход на страницу — сама база.
  const phones = levels["clients.client"] === "read" || levels["clients.client"] === "write";
  const canCreate = levels["clients.create"] === "write";
  // Переход на страницу клиента — шеврон строки (как в его списке).
  const opens = base !== "off";
  // База закрыта — у зависимой строки «Ограничение по времени» показывать
  // нечего: базы у него нет вовсе, и рамка гасит весь список.
  const people = scope === "week" || scope === "near" ? OWN.slice(0, 1) : OWN;
  const state = levelState(base);
  if (!CLIENTS_PREVIEW_KEYS.includes(blockKey)) return null;
  const menuItems = MENU_ITEMS[blockKey];
  if (menuItems) {
    // Меню открывается долгим нажатием и «⋯» — «Может» ставит пункт в меню.
    const can = levels[blockKey] === "write";
    return (
      <PreviewFrame
        state={state === "hidden" ? "hidden" : can ? "can" : "cannot"}
        caption={
          state === "hidden"
            ? undefined
            : blockKey === "clients.menu"
              ? can
                ? "Долгое нажатие и «⋯» в карточке"
                : "Этих пунктов в меню клиента нет"
              : can
                ? "Меню, «⋯» в карточке и свайп влево"
                : "«Удалить» в меню клиента нет"
        }
      >
        <ClientMenuPreview
          // «Если нет разрешения на запись — этого и не будет» (03.10).
          items={
            blockKey === "clients.menu" && levels["calendar.create"] === "write"
              ? [BOOK_ITEM, ...menuItems]
              : menuItems
          }
          phones={phones}
        />
      </PreviewFrame>
    );
  }
  // Зависимые строки говорят своё: список один, а меняют они в нём разное.
  const caption =
    state === "hidden"
      ? undefined
      : blockKey === "clients.scope"
        ? scope === "own"
          ? "Видит всех клиентов команды"
          : `Видит клиента команды, если ${(SCOPE_SPAN[scope] ?? SCOPE_SPAN.week).toLowerCase()}`
        : blockKey === "clients.create"
          ? canCreate
            ? "Кнопка «Создать клиента» работает"
            : "Кнопка «Создать клиента» серая"
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
        <Button variant="secondary" label="Создать клиента" onPress={noop} disabled={!canCreate} />
      </View>
    </PreviewFrame>
  );
}
