import { Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { Tag } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import type { useSheetDoorway } from "@/components/ui/use-sheet-doorway";
import { Button } from "@/components/ui/Button";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { iconPreset } from "@/components/ui/icon-set";
import { FOOTER_SIDE } from "@/components/ui/tokens";
import { WhenSheet } from "@/features/appointments/WhenSheet";
import { ClientPickerSheet } from "@/features/clients/ClientPickerSheet";
import { useBusinessNow } from "@/features/appointments/business-now";
import { useThemeColors } from "@/theme/colors";
import { VIEW_ONLY_REASON } from "../finance-page-access";
import { CATEGORY_KIND_ROW } from "../settings-levels";
import type { useFinanceSettingLevelsOf } from "../use-finance-settings";
import type { useDebtDraft } from "../use-debt-draft";

type DebtDraft = ReturnType<typeof useDebtDraft>;

/** Footer of the debt sheet: the reason the button is grey, then the button. */
export function DebtSheetFooter({
  canWrite,
  reason,
  isEdit,
  save,
  canSave,
  busy,
}: {
  canWrite: boolean;
  reason: DebtDraft["reason"];
  isEdit: boolean;
  save: () => void;
  canSave: boolean;
  busy: boolean;
}) {
  const th = useThemeColors();
  return (
    <View style={{ paddingHorizontal: FOOTER_SIDE, gap: 8 }}>
      {/* Причина «Смотрит» вытесняет остальные: пока права нет, ни сумма,
          ни клиент кнопку не оживят. */}
      {!canWrite ? (
        <Text
          accessibilityLiveRegion="polite"
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 13, lineHeight: 18, textAlign: "center", color: th.sub }}
        >
          {VIEW_ONLY_REASON}
        </Text>
      ) : reason ? (
        <Text
          accessibilityLiveRegion="polite"
          maxFontSizeMultiplier={1.3}
          style={{
            fontSize: 13,
            lineHeight: 18,
            textAlign: "center",
            color: reason.error ? th.danger : th.sub,
          }}
        >
          {reason.text}
        </Text>
      ) : null}
      <Button
        label={isEdit ? "Сохранить" : "Записать долг"}
        onPress={save}
        disabled={!canSave || !canWrite}
        loading={busy}
      />
    </View>
  );
}

/** The three sheets the debt form opens: when, category and client. */
export function DebtPickers({
  d,
  whenOpen,
  setWhenOpen,
  categoryOpen,
  setCategoryOpen,
  clientOpen,
  setClientOpen,
  doorway,
  categoriesHref,
  categoriesLevelOf,
  router,
}: {
  d: DebtDraft;
  whenOpen: boolean;
  setWhenOpen: (open: boolean) => void;
  categoryOpen: boolean;
  setCategoryOpen: (open: boolean) => void;
  clientOpen: boolean;
  setClientOpen: (open: boolean) => void;
  doorway: ReturnType<typeof useSheetDoorway>;
  categoriesHref: string;
  categoriesLevelOf: ReturnType<typeof useFinanceSettingLevelsOf>;
  router: ReturnType<typeof useRouter>;
}) {
  const th = useThemeColors();
  // Час долга без часа — по часам бизнеса, как в самом листе.
  const businessNow = useBusinessNow();
  const {
    date,
    setDate,
    time,
    setTime,
    cats,
    categoryId,
    setCategoryId,
    debtTeamId,
    leaveForClient,
    clients,
    recentIds,
    statsById,
    setClientId,
    setCounterparty,
  } = d;
  return (
    <>
      <WhenSheet
        open={whenOpen}
        onClose={() => setWhenOpen(false)}
        date={date}
        timeStart={time ?? businessNow().hm}
        timeEnd={time ?? businessNow().hm}
        allDay={false}
        allowAllDay={false}
        singleTime
        onCommit={(next) => {
          setDate(next.date);
          setTime(next.timeStart);
        }}
      />

      <PickerSheet
        visible={categoryOpen}
        title="Категория долга"
        // Пустой лист говорит, где заводят категории, — как у операции.
        // Без этой строки лист долга открывался немым: заголовок и пустота
        // (у AirFix ни одной категории долгов).
        subtitle={
          cats.length > 0
            ? undefined
            : categoriesLevelOf(debtTeamId)[CATEGORY_KIND_ROW.debt] === "write"
              ? "Категорий нет — создайте их (значок справа)"
              : "Категорий пока нет"
        }
        items={cats.map((c) => ({
          id: c.id,
          label: c.name,
          // БЕЗ ЭМОДЗИ (категории устроены так же, как события). В справочнике у категорий
          // лежат ⛽ 🍔 📦, и лист печатал их вперемешку со значками словаря —
          // единственное место продукта, где строка выбора выглядела иначе,
          // чем у команды, метки и типа события. Цвет категории остаётся: он и
          // различает строки.
          icon: iconPreset(c.icon) ?? Tag,
          color: c.color ?? th.accent,
          onPress: () => setCategoryId(c.id),
        }))}
        selectedId={categoryId}
        // Та же дверь и та же парковка, что у листа операции; у партнёра —
        // по праву «Категории долгов» в команде долга.
        onSettings={
          categoriesLevelOf(debtTeamId)[CATEGORY_KIND_ROW.debt] !== "hidden"
            ? () =>
                doorway.open(() =>
                  router.push(
                    (debtTeamId
                      ? `${categoriesHref}?team=${encodeURIComponent(debtTeamId)}&kind=debt`
                      : `${categoriesHref}?kind=debt`) as Href,
                  ),
                )
            : undefined
        }
        settingsLabel="Категории долгов"
        onClose={() => setCategoryOpen(false)}
      />

      {/* ТОТ ЖЕ ВЫБОР КЛИЕНТА, ЧТО В ЗАПИСИ — со вводной о каждом и недавними
          первыми. «Создать клиента» внутри него уходит на карточку нового
          клиента отдельным маршрутом, а маршрут под открытым окном `Modal` не
          виден: поэтому лист долга на это время уезжает и возвращается сам,
          когда клиент заведён (см. `wentForClient`). Набранное переживает
          поход — `keepDraft` запрещает пересев. */}
      <ClientPickerSheet
        visible={clientOpen}
        onClose={() => setClientOpen(false)}
        onCreate={(prefill) => {
          // Уходим МЫ, а не лист выбора: под открытым окном шторки долга
          // маршрут карточки не виден. Сперва уезжаем сами, потом пуш.
          setClientOpen(false);
          leaveForClient(prefill);
        }}
        clients={clients as Client[]}
        recentIds={recentIds}
        statsById={statsById}
        onSelect={(picked) => {
          setClientId(picked.id);
          setCounterparty(picked.full_name || "");
          setClientOpen(false);
        }}
      />
    </>
  );
}
