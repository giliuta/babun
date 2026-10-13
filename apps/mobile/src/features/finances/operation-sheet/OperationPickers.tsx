import type { ComponentProps } from "react";
import { Tag, User } from "lucide-react-native";
import { useRouter, type Href } from "expo-router";
import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import type { Client } from "@babun/shared/local/clients";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { iconPreset } from "@/components/ui/icon-set";
import type { useSheetDoorway } from "@/components/ui/use-sheet-doorway";
import { WhenSheet } from "@/features/appointments/WhenSheet";
import { ClientPickerSheet } from "@/features/clients/ClientPickerSheet";
import { useReferenceHref } from "@/features/clients/reference-href";
import { useThemeColors } from "@/theme/colors";
import type { useClientChoice } from "../use-client-choice";
import { CATEGORY_KIND_ROW } from "../settings-levels";
import { useFinanceSettingLevelsOf } from "../use-finance-settings";
import type { OperationType } from "./types";

/** A person the payout can go to (`payeeOptions`). */
interface Payee {
  id: string;
  full_name: string;
  color?: string | null;
  is_active: boolean;
}

/** The sheets the operation form opens over itself: when, category, client
 *  and payee. Each is the same picker the rest of the product uses. */
export function OperationPickers({
  type,
  teamId,
  isOwner,
  doorway,
  when,
  category,
  client,
  payee,
}: {
  type: OperationType;
  teamId: string | null;
  isOwner: boolean;
  doorway: ReturnType<typeof useSheetDoorway>;
  when: {
    open: boolean;
    onClose: () => void;
    date: string;
    timeStart: string;
    timeEnd: string;
    onCommit: ComponentProps<typeof WhenSheet>["onCommit"];
  };
  category: {
    open: boolean;
    onClose: () => void;
    items: FinanceCategory[];
    selectedId: string | null;
    onPick: (id: string) => void;
  };
  client: {
    open: boolean;
    onClose: () => void;
    choice: ReturnType<typeof useClientChoice>;
    selectedId: string | null;
    onPick: (id: string | null) => void;
  };
  payee: {
    open: boolean;
    onClose: () => void;
    items: Payee[];
    selectedId: string | null;
    onPick: (id: string) => void;
  };
}) {
  const th = useThemeColors();
  const router = useRouter();
  const isExpense = type === "expense";
  // Куда ведёт шестерёнка — решает маршрут (см. `useReferenceHref`).
  const categoriesHref = useReferenceHref().categories;
  // Шестерёнка справочника — по праву вида в команде операции (03.10): есть
  // строка категорий этого вида — есть и дверь (страница сама гасит правку
  // у «Только видит»).
  const categoriesLevelOf = useFinanceSettingLevelsOf();
  return (
    <>
      {/* Выбор категории — тот же лист, что и везде. Шестерёнка внутри
          ведёт на страницу категорий: свои категории заводятся там, а не
          выдумываются заметкой в поле «Заметка». */}
      {/* ВЫБОР КАТЕГОРИИ — ТОТ ЖЕ ЛИСТ, ЧТО «ТИП СОБЫТИЯ» В ЗАПИСИ (владелец
          2026-09-09). Значок и цвет у категорий лежат в справочнике, а прежний
          лист рисовал только точку цвета: список читался как столбик слов.
          Ничего нового не заводим — берём готовый примитив продукта. */}
      {/* Полоса недель, барабаны и язык — те же, что у записи; сегмент
          «Начало | Конец» спрятан: у операции время одно. */}
      <WhenSheet
        open={when.open}
        onClose={when.onClose}
        date={when.date}
        timeStart={when.timeStart}
        timeEnd={when.timeEnd}
        allDay={false}
        allowAllDay={false}
        singleTime
        onCommit={when.onCommit}
      />
      <PickerSheet
        visible={category.open}
        title={isExpense ? "Категория расхода" : "Категория дохода"}
        // Готовых категорий нет — компания заводит свои (владелец
        // 2026-09-24). Пустой лист говорит, где их создают.
        subtitle={
          category.items.length > 0
            ? undefined
            : isOwner
              ? "Категорий нет — создайте их (значок справа)"
              : "Категорий пока нет"
        }
        items={category.items.map((c) => ({
          id: c.id,
          label: c.name,
          // БЕЗ ЭМОДЗИ (владелец 2026-09-10: «переделай категории так же, как
          // события; эмодзи убираем, это не надо»). В справочнике у категорий
          // лежат ⛽ 🍔 📦, и лист печатал их вперемешку со значками словаря —
          // единственное место продукта, где строка выбора выглядела иначе,
          // чем у команды, метки и типа события. Цвет категории остаётся: он и
          // различает строки.
          icon: iconPreset(c.icon) ?? Tag,
          color: c.color ?? th.accent,
          onPress: () => category.onPick(c.id),
        }))}
        selectedId={category.selectedId}
        // Дверь паркует лист операции: иначе страница категорий открывается
        // ПОД ним и до неё не дотянуться (владелец 2026-09-10). У партнёра —
        // по праву вида в команде операции (03.10).
        onSettings={
          categoriesLevelOf(teamId)[CATEGORY_KIND_ROW[type]] !== "hidden"
            ? () =>
                doorway.open(() =>
                  // Команда операции — команда справочника: без неё страница
                  // открывалась на первой команде (аудит 2026-09-30).
                  router.push(
                    // Страница своего вида: «Категории расходов» у расхода.
                    (teamId
                      ? `${categoriesHref}?team=${encodeURIComponent(teamId)}&kind=${type}`
                      : `${categoriesHref}?kind=${type}`) as Href,
                  ),
                )
            : undefined
        }
        settingsLabel={type === "income" ? "Категории доходов" : "Категории расходов"}
        onClose={category.onClose}
      />
      <ClientPickerSheet
        visible={client.open}
        onClose={client.onClose}
        clients={client.choice.clients as Client[]}
        recentIds={client.choice.recentIds}
        statsById={client.choice.statsById}
        selectedId={client.selectedId}
        onSelect={(picked) => client.onPick(picked.id)}
        onDeselect={() => client.onPick(null)}
      />
      <PickerSheet
        visible={payee.open}
        title={isExpense ? "Кому" : "Партнёр"}
        // ПУСТОЙ СПИСОК — СЛОВАМИ (канон пустых состояний): у компании без
        // сотрудников лист иначе был бы одной шапкой без ответа, что делать.
        subtitle={
          payee.items.length > 0
            ? undefined
            : isOwner && teamId
              ? "Партнёров нет — пригласите в «Кабинет → Партнёры»"
              : "Партнёров нет"
        }
        items={payee.items.map((m) => ({
          id: m.id,
          label: m.full_name,
          hint: m.is_active ? undefined : "Не работает",
          icon: User,
          color: m.color ?? th.accent,
          onPress: () => payee.onPick(m.id),
        }))}
        selectedId={payee.selectedId}
        // ЛЮДЕЙ БЕРЁМ ИЗ «МАСТЕРОВ» — там же их и заводят. Пустой список у
        // компании без сотрудников не тупик: ползунки в шапке ведут на
        // страницу мастеров календаря (тот же приём, что у категорий).
        onSettings={
          isOwner && teamId
            ? () =>
                doorway.open(() =>
                  router.push(
                    "/cabinet/people" as Href,
                  ),
                )
            : undefined
        }
        settingsLabel="Партнёры"
        onClose={payee.onClose}
      />
    </>
  );
}
