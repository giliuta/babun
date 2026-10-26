import { ScrollView, View } from "react-native";
import type { Href } from "expo-router";
import { Bookmark, Tags } from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { GUTTER } from "@/components/ui/tokens";
import { RowCaption } from "@/components/ui/card-rows";
import { AlwaysLine, BlockCell } from "@/components/ui/block-toggles";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { ColorSheet } from "@/features/appointments/BookingSheets";
import {
  BOOKING_BLOCKS,
  EVENT_BLOCKS,
  type BookingBlockId,
  type EventBlockId,
} from "@/features/appointments/booking-prefs";
import { BLOCK_ICON, BLOCK_LABEL } from "./block-meta";
import { BlockOrder } from "./BlockOrder";
import { ColorRow } from "./ColorRow";
import { useDesignScreen } from "./use-design-screen";

// «ЗАПИСИ» — КАК ВЫГЛЯДИТ И ИЗ ЧЕГО СОСТОИТ ЗАПИСЬ.
// ТРИ КАРТОЧКИ, ВСЁ ТАПОМ. Название «Записи», а не «Дизайн»: на странице и
// клиенты, и события («Клиент | Событие»). Компактно: видишь, как выглядит,
// тапаешь по блоку и сразу выбираешь цвет.
//
// ЦВЕТ. Образец и есть настройка. Сверху — обычная запись: цветом того, от
// чего она красится (команда, метка, услуга); тап — выбрать источник. Под ней
// четыре случая, когда цвет решает правило: нет клиента, нет объекта, нет
// услуг, у источника нет цвета. Тап — палитра, выбор сохраняется сразу.
// «Не красить» — пустой контур: так запись и будет выглядеть, цветом обычной.
// Отдельных списков «автоматически» и «если цвета нет» нет — они
// повторяли бы то, что образцы уже показывают.
//
// БЛОКИ. Одна карточка, чипы и под ними «Клиент | Событие» — вкл. залит
// цветом, выкл. серый. Обязательные блоки не притворяются настройкой: их
// называет строка «Всегда: …».
//
// ТИПЫ СОБЫТИЙ. Дверь на свою страницу, как у услуг и меток.
//
// Состояние страницы — `use-design-screen.ts`, строки — соседними файлами.

export function DesignScreen() {
  const {
    router,
    team,
    teamId,
    readOnly,
    isMaster,
    memberUpdateTeam,
    rule,
    setRule,
    setSituationColor,
    editingColor,
    setEditingColor,
    toggleRecordBlock,
    toggleEventBlock,
    objectsOn,
    recordOrder,
    eventOrder,
    dragging,
    setDragging,
    saveOrderError,
    typesSub,
    ordinary,
    updateTeam,
    hidesCancelled,
    setHidesCancelled,
    clientsInPlan,
    nudgeTariff,
    tab,
    setTab,
    colorSheetTitle,
    colorSheetValue,
    toggleColor,
    openColor,
    colorRows,
    recordOn,
    eventOn,
  } = useDesignScreen();

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Записи" subtitle={team?.name} />
      <ScrollView scrollEnabled={!dragging} contentContainerStyle={{ paddingBottom: 24 }}>
        {/* ПЕРЕКЛЮЧАТЕЛЬ «КЛИЕНТ | СОБЫТИЕ» — НАВЕРХУ И НА ВСЮ СТРАНИЦУ
            (выбрал клиентов — настраивает всё по клиентам, событий — всё по
            событиям). */}
        <View style={{ paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 4 }}>
          <SegmentedControl
            options={[
              { value: "record", label: "Клиент", dimmed: !clientsInPlan },
              { value: "event", label: "Событие" },
            ]}
            value={tab}
            onChange={(next) => {
              if (next === "record" && !clientsInPlan) {
                nudgeTariff();
                return;
              }
              setTab(next);
            }}
          />
        </View>

        {tab === "record" ? (
          <>

            {/* ОБЯЗАТЕЛЬНЫЕ — ОДНОЙ СТРОКОЙ СВЕРХУ: строки с замком
                растягивали список и спорили с теми, что правда выключаются. */}
            <SectionCard title="Блоки записи">
              <AlwaysLine blocks={BOOKING_BLOCKS} />
              {/* Метка живёт в карточке команды — она всегда первая. */}
              <BlockCell
                label="Метка"
                icon={Bookmark}
                on={recordOn("label")}
                locked={false}
                readOnly={readOnly}
                onToggle={() => toggleRecordBlock.mutate("label")}
              />
              <BlockOrder
                ids={recordOrder.order}
                readOnly={readOnly}
                labelFor={(id) => BLOCK_LABEL[id] ?? id}
                onReorder={(ids) => recordOrder.mutate(ids, { onError: saveOrderError })}
                onDraggingChange={setDragging}
                cell={(id) => {
                  const pinned = !!BOOKING_BLOCKS.find((b) => b.id === id)?.pinned;
                  return (
                    <BlockCell
                      label={BLOCK_LABEL[id] ?? id}
                      icon={BLOCK_ICON[id] ?? Bookmark}
                      on={recordOn(id)}
                      locked={false}
                      fixed={pinned}
                      readOnly={readOnly}
                      onToggle={() => toggleRecordBlock.mutate(id as BookingBlockId)}
                    />
                  );
                }}
              />
            </SectionCard>
            <RowCaption text="Порядок — перетащите за точки справа. Выключенный блок пропадает у всей команды, данные остаются." />

            {/* ЦВЕТ ЗАПИСИ — ПОД БЛОКАМИ, ОБЫЧНЫМИ СТРОКАМИ: слева случай,
                справа его цвет (или «Без цвета»), тап — палитра. */}
            <SectionCard title="Цвет записи">
              {colorRows.map((row, i) => (
                <ColorRow
                  key={row.id}
                  title={row.title}
                  when={row.when}
                  hue={row.hue}
                  separated={i > 0}
                  onPress={readOnly ? undefined : () => openColor(row.id)}
                  onToggle={readOnly || !row.toggles ? undefined : (next) => toggleColor(row.id, next)}
                />
              ))}
            </SectionCard>
            <RowCaption text="Выключенный случай красится обычным цветом. Цвет, выбранный в самой записи, главнее всего, кроме отмены, долга и оплаты." />

            <SectionCard className="mt-4">
              <SwitchRow
                label="Скрывать отменённые"
                value={hidesCancelled}
                onChange={setHidesCancelled}
                disabled={readOnly}
              />
            </SectionCard>
          </>
        ) : (
          <>
            <SectionCard title="Блоки события">
              <AlwaysLine blocks={EVENT_BLOCKS} />
              <BlockCell
                label="Метка"
                icon={Bookmark}
                on={eventOn("label")}
                locked={false}
                readOnly={readOnly}
                onToggle={() => toggleEventBlock.mutate("label")}
              />
              <BlockOrder
                ids={eventOrder.order}
                readOnly={readOnly}
                labelFor={(id) => BLOCK_LABEL[id] ?? id}
                onReorder={(ids) => eventOrder.mutate(ids, { onError: saveOrderError })}
                onDraggingChange={setDragging}
                cell={(id) => {
                  // Объекта события нет, пока у команды выключены объекты.
                  // Без тарифа нет клиентов, а объект — всегда объект клиента:
                  // обе строки сняты и не ставятся.
                  const noObjects = id === "object" && !objectsOn;
                  const noPlan = !clientsInPlan && (id === "client" || id === "object");
                  const locked = noObjects || noPlan;
                  return (
                    <BlockCell
                      label={BLOCK_LABEL[id] ?? id}
                      icon={BLOCK_ICON[id] ?? Bookmark}
                      on={!locked && eventOn(id)}
                      locked={locked}
                      readOnly={readOnly}
                      onToggle={() => toggleEventBlock.mutate(id as EventBlockId)}
                    />
                  );
                }}
              />
            </SectionCard>
            <RowCaption text="Порядок — перетащите за точки справа. Выключенный блок пропадает у всей команды, данные остаются." />

            {/* ТИПЫ СОБЫТИЙ — дверь на свою страницу, как у услуг и меток. */}
            {eventOn("type") ? (
              <SectionCard>
                <SettingsRow
                  tile={SETTINGS_TILE.purple}
                  icon={Tags}
                  title="Типы событий"
                  sub={typesSub}
                  onPress={() => {
                    haptics.tap();
                    router.push({
                      pathname: "/calendar/event-types",
                      params: teamId ? { team: teamId } : {},
                    } as Href);
                  }}
                />
              </SectionCard>
            ) : null}
          </>
        )}
      </ScrollView>


      <ColorSheet
        visible={editingColor != null}
        onClose={() => setEditingColor(null)}
        title={colorSheetTitle}
        // «Не красить»: у случая нет автомата — есть отказ от сигнала, и
        // тогда запись красится как обычная. У «Без цвета» отказа нет: это
        // последняя ступень.
        autoLabel="Не красить"
        autoColor={ordinary}
        allowNone={editingColor !== "filled"}
        commitOnPick
        value={colorSheetValue}
        onPick={(color) => {
          if (!editingColor) return;
          if (editingColor === "filled") {
            if (color && team) {
              if (isMaster) {
                memberUpdateTeam.mutate(
                  { teamId: team.id, patch: { color } },
                  { onError: (e) => notify("Ошибка", e.message) },
                );
              } else {
                updateTeam.mutate({ id: team.id, patch: { color } });
              }
              // Записи красятся цветом команды — правило ставим на неё.
              if (rule !== "team") setRule.mutate("team");
            }
          } else {
            setSituationColor.mutate({ situation: editingColor, color });
          }
          setEditingColor(null);
        }}
      />

    </Screen>
  );
}
