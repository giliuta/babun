import { InputAccessoryView, Keyboard, Platform, Pressable, View } from "react-native";
import type { Href } from "expo-router";
import { UserRound, Users } from "lucide-react-native";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { TYPE } from "@/components/ui/tokens";
import { ActionMenuSheet } from "@/components/blocks/ActionMenuSheet";
import { LabelPickerSheet } from "@/features/reference/LabelPickerSheet";
import { SelfReminderSheet } from "@/features/calendar/SelfReminderSheet";
import { eventTypeIcon } from "@/features/reference/event-type-icons";
import { durationLabel } from "@/lib/service-format";
import { TotalSheet } from "@/features/appointments/TotalSheet";
import {
  ColorSheet,
  TeamMasterSheet,
} from "@/features/appointments/BookingSheets";
import { haptics } from "@/lib/haptics";
import { KBD_ACCESSORY_ID } from "./book-constants";
import { Text } from "./book-text";
import type { BookModel } from "./use-book-form";

/** Sheets that edit the record: team, money, label, event team and type,
 *  self-reminder, colour; plus the iOS keyboard «Готово» bar. */
export function BookEditSheets({ form }: { form: BookModel }) {
  const {
    t,
    router,
    teamSheetOpen,
    setTeamSheetOpen,
    isMemberView,
    isEdit,
    teams,
    teamId,
    masters,
    masterId,
    setMasterId,
    selectTeam,
    totalSheetOpen,
    closeTotalSheet,
    serviceLines,
    setQty,
    kind,
    addCustomLine,
    setLineName,
    removeCustomLine,
    setLinePrice,
    discountType,
    discountValue,
    setDiscountType,
    setDiscountValue,
    customTotal,
    effectiveTotal,
    beforeVat,
    setCustomTotal,
    recordVatMode,
    vatRateInUse,
    setRecordVatMode,
    setRecordVatRate,
    rememberedVatRate,
    labelSheetOpen,
    setLabelSheetOpen,
    teamCities,
    effectiveLabel,
    setCityTouched,
    setCity,
    eventTeamSheetOpen,
    setEventTeamSheetOpen,
    eventTypeSheetOpen,
    setEventTypeSheetOpen,
    eventTypeId,
    eventTypes,
    clearEventType,
    applyEventType,
    reminderSheetOpen,
    setReminderSheetOpen,
    selfReminder,
    date,
    timeStart,
    pickSelfReminder,
    colorSheetOpen,
    setColorSheetOpen,
    identityAuto,
    eventColor,
    colorOverride,
    setEventColor,
    setColorOverride,
  } = form;
  return (
    <>
      <ActionMenuSheet menu={form.recordMenu} onClose={form.closeRecordMenu} />
      <TeamMasterSheet
        visible={teamSheetOpen}
        onClose={() => setTeamSheetOpen(false)}
        // ЗАПИСЬ ПАРТНЁРА ОСТАЁТСЯ В СВОЕЙ КОМАНДЕ (сервер: access:team_move).
        // Если предложить все команды, выбор снимет услуги и мастера, а
        // «Сохранить» откажет целиком, вместе с остальными правками. В правке у партнёра —
        // только своя команда и смена мастера внутри неё.
        teams={isMemberView && isEdit ? teams.filter((tm) => tm.id === teamId) : teams}
        masters={masters}
        teamId={teamId}
        masterId={masterId}
        onPickTeam={(id) => {
          selectTeam(id);
          haptics.tap();
        }}
        onPickMaster={(id) => {
          setMasterId(id);
          haptics.tap();
        }}
      />
      {/* ДЕНЬГИ ЗАПИСИ — ОДНИМ ЛИСТОМ: услуги с количеством, скидка в евро
          или процентах, итог. Открывается строкой «Итого». */}
      <TotalSheet
        visible={totalSheetOpen}
        onClose={closeTotalSheet}
        lines={serviceLines}
        onQtyChange={setQty}
        onAddLine={kind === "work" ? addCustomLine : undefined}
        onNameChange={setLineName}
        onRemoveLine={removeCustomLine}
        // ЦЕНА ПРАВИТСЯ У СТРОКИ, А НЕ У ИТОГА. Пишем в
        // `overrides` — снимок ЭТОЙ записи; прайс команды не трогается.
        onPriceChange={setLinePrice}
        // «Без скидки» больше не выбирают: ноль в поле и есть её отсутствие,
        // а переключатель говорит только, ЧЕМ считать вписанное.
        discount={{
          kind: discountType ?? "fixed",
          value: discountValue,
          onKindChange: setDiscountType,
          onValueChange: setDiscountValue,
        }}
        // До налога: шторка сама считает из этой суммы строку скидки (сумма
        // строк − это число) и налог — как у чека и инвойса.
        total={customTotal ? effectiveTotal : beforeVat}
        customTotal={customTotal}
        onResetTotal={() => setCustomTotal(false)}
        vat={
          kind === "work" && !customTotal
            ? {
                mode: recordVatMode,
                rate: vatRateInUse,
                onModeChange: setRecordVatMode,
                onRateChange: (rate) => {
                  setRecordVatRate(rate);
                  rememberedVatRate.remember(rate);
                },
              }
            : undefined
        }
      />
      <LabelPickerSheet
        visible={labelSheetOpen}
        title={kind === "event" ? "Метка события" : "Метка записи"}
        options={teamCities.map((c) => ({ name: c.name, color: c.color ?? t.accent }))}
        // ВЫБРАНА ТА, ЧТО ДЕЙСТВУЕТ СЕЙЧАС — своя либо взятая у дня (открываем метку, там
        // уже автоматически выбрана метка, и можно выбирать другие).
        value={effectiveLabel}
        onPick={(next) => {
          setCityTouched(true);
          setCity(next);
        }}
        onClose={() => setLabelSheetOpen(false)}
      />
      {/* Команда события: «Личное» + команды; тип события — словарь Кабинета
          (шестерёнка ведёт на его страницу). Лист закрывается тапом сам. */}
      <PickerSheet
        visible={eventTeamSheetOpen}
        title="Команда"
        // Отмечена текущая, «Личное» тоже — как в листе команды записи.
        selectedId={teamId ?? "personal"}
        items={[
          {
            id: "personal",
            label: "Личное",
            icon: UserRound,
            color: t.accent,
            onPress: () => {
              selectTeam(null);
              setEventTeamSheetOpen(false);
            },
          },
          ...teams.map((tm) => ({
            id: tm.id,
            label: tm.name,
            icon: Users,
            color: tm.color ?? t.accent,
            onPress: () => {
              selectTeam(tm.id);
              setEventTeamSheetOpen(false);
            },
          })),
        ]}
        onClose={() => setEventTeamSheetOpen(false)}
      />
      {/* ВЫБОР ТИПА — ТОТ ЖЕ ЛИСТ, ЧТО У КАТЕГОРИИ ОПЕРАЦИИ: тип события
          выбирается точно так же, как категория. Строка — значок и цвет типа,
          тихая подпись — длительность, которую тип поставит, и она одна на все
          строки: подпись «Тап снимает тип» у выбранной не нужна — галка и без
          слов говорит, что строка выбрана. ТАП ПО ВЫБРАННОЙ СНИМАЕТ ТИП;
          служебной строки «Без типа» в списке нет — снятие живёт там же, где
          выбор. Дверь в справочник — значок настроек в шапке листа: тем же
          сиблингом формы, а не экраном чужой вкладки, иначе «назад» уводит на
          календарь и теряет набранное событие. */}
      <PickerSheet
        visible={eventTypeSheetOpen}
        title="Тип события"
        selectedId={eventTypeId}
        items={eventTypes.map((type) => ({
          id: type.id,
          label: type.label,
          icon: eventTypeIcon(type.icon),
          color: type.color,
          hint: `${durationLabel(type.defaultDuration)} по умолчанию`,
          onPress:
            type.id === eventTypeId
              ? clearEventType
              : () => applyEventType(type.id),
        }))}
        onSettings={() =>
          router.push({
            pathname: "/event-types",
            params: teamId ? { team: teamId } : {},
          } as Href)
        }
        settingsLabel="Типы событий"
        // Пустой справочник — лист не немой.
        emptyText="Типов пока нет — заведите их значком справа"
        onClose={() => setEventTypeSheetOpen(false)}
      />
      <SelfReminderSheet
        visible={reminderSheetOpen}
        value={selfReminder}
        subtitle={`${kind === "event" ? "Событие" : "Запись"} · ${date.split("-").reverse().slice(0, 2).join(".")}, ${timeStart}`}
        onPick={pickSelfReminder}
        onClose={() => setReminderSheetOpen(false)}
      />
      <ColorSheet
        visible={colorSheetOpen}
        onClose={() => setColorSheetOpen(false)}
        isEvent={kind === "event"}
        autoColor={identityAuto}
        value={kind === "event" ? eventColor : colorOverride}
        onPick={(c) => {
          if (kind === "event") setEventColor(c);
          else setColorOverride(c);
          haptics.tap();
        }}
      />
      {/* ИЗВЕСТНЫЙ ПРЕДЕЛ (симулятор без аппаратной клавиатуры):
          панель показывается у «Итого», смонтированного вместе с экраном, и
          НЕ показывается у поля предоплаты, которое появляется позже, — ни при
          тапе, ни при фокусе из кода, ни после перемонтирования самой панели.
          Клавиатуру там убирают тапом мимо или потянув список вниз. */}
      {Platform.OS === "ios" ? (
        <InputAccessoryView nativeID={KBD_ACCESSORY_ID}>
          <View
            className="flex-row justify-end px-3 py-2"
            style={{ backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.separator }}
          >
            <Pressable
              onPress={() => Keyboard.dismiss()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Скрыть клавиатуру"
              style={{ minHeight: 36, justifyContent: "center", paddingHorizontal: 10 }}
            >
              <Text style={{ ...TYPE.callout, color: t.accent }}>Готово</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
    </>
  );
}
