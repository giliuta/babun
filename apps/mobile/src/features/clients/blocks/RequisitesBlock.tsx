import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Building2, ChevronRight } from "lucide-react-native";
import type { Client, ClientRequisites } from "@babun/shared/local/clients";
import {
  clientRequisitesOf,
  orderedRequisites,
  requisitesNumbersLine,
} from "@babun/shared/local/client-requisites";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { SelectList, SelectRow } from "@/components/ui/select-rows";
import { useToast } from "@/components/ui/Toast";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { SectionCard } from "@/components/ui/SectionCard";
import { haptics } from "@/lib/haptics";
import { useCopyValue } from "@/lib/copy-value";
import { requisitesLines } from "@/features/clients/client-share";
import { moreLabel } from "@/features/clients/more-label";
import { RequisitesSheet } from "@/features/clients/RequisitesSheet";
import { useRequisitesWriter } from "@/features/clients/use-requisites-writer";
import { useThemeColors } from "@/theme/colors";
import { useClientsCapabilities } from "@/features/clients/company-scope";

// РЕКВИЗИТЫ КЛИЕНТА (STORY-085, владелец 2026-09-21): «реквизиты делаем
// всегда… инвойс могут просить прямо на клиента с его реквизитами». Блок
// постоянный у любого клиента — человека или компании; то, что печатается
// получателем на инвойсе. Слова те же, что у реквизитов своей компании
// («Юридическое имя», «VAT номер»…): обе стороны документа подписаны одним
// языком.
//
// НЕСКОЛЬКО НАБОРОВ — КАК ОБЪЕКТЫ (владелец 22.09: «один и тот же клиент
// может попросить один инвойс на эти реквизиты, а второй — на эти. Сделать
// как объекты»). С 03.10 — как «История» и «Файлы»: на карточке ОДИН набор,
// основной, плашкой; тап — страница всех наборов, где каждый — своя плашка:
// юр. имя, под ним «VAT … · Рег. …», ниже адрес; основной помечен тихим
// словом «Основные» — только когда наборов больше одного. Тап — лист с
// четырьмя полями (тот же для нового и для правки); свайп — «Удалить» с
// «Отменить»; «Добавить реквизиты» — футером страницы, на карточке — дверью
// у пустого блока. Какой набор печатать, выбирают в самом инвойсе; не
// выбрали — основной.
//
// Только владельцу: реквизиты — к документам и деньгам, сотруднику сервер их
// не отдаёт и править не даёт.

export function RequisitesBlock({
  client,
  update,
  onOpenAll,
  bare,
  single,
  adding,
  onAddingChange,
  readOnly = false,
}: {
  client: Client;
  draft: boolean;
  /** Только видит (право блока «Реквизиты», 30.09): наборы читаются и
   *  копируются, но не правятся, не удаляются и не заводятся. */
  readOnly?: boolean;
  update: (patch: Partial<Client>) => Promise<boolean>;
  /** Открыть страницу всех наборов — тап по набору на карточке. */
  onOpenAll?: () => void;
  /** Своя страница: название уже в заголовке экрана, шапки у блока нет. */
  bare?: boolean;
  /** Карточка: один набор — основной; тап — страница всех (03.10). */
  single?: boolean;
  /** Лист нового набора открывает кнопка ВНЕ блока (футер страницы): тогда
   *  двери «Добавить реквизиты» в блоке нет, а лист — по этому флагу. */
  adding?: boolean;
  onAddingChange?: (open: boolean) => void;
}) {
  const t = useThemeColors();
  const copy = useCopyValue();
  const toast = useToast();
  const sets = useMemo(() => clientRequisitesOf(client), [client]);
  const ordered = useMemo(() => orderedRequisites(sets), [sets]);
  const shown = single ? ordered.slice(0, 1) : ordered;
  const writer = useRequisitesWriter(sets, update, client.id);
  // Копирование — вынос из приложения: только с правом выгрузки (владелец
  // 30.09: «без передачи»; аудит 015).
  const canCopy = useClientsCapabilities().export;
  const copySet = (set: ClientRequisites) => {
    if (canCopy) copy(requisitesLines(set).join("\n"));
  };

  // Лист монтируется заново на каждое открытие (`key`): черновик полей и
  // курсор собираются из набора В МОМЕНТ ОТКРЫТИЯ, а не эффектом после —
  // `autoFocus` работает только на монтировании.
  // Закрытие гасит `open`, а не сам лист: иначе он исчезал бы без анимации.
  const [sheet, setSheet] = useState<{ key: number; id: string | null; open: boolean } | null>(
    null,
  );
  const openSheet = (id: string | null) => {
    haptics.tap();
    setSheet((prev) => ({ key: (prev?.key ?? 0) + 1, id, open: true }));
  };
  const closeSheet = () => {
    setSheet((prev) => (prev ? { ...prev, open: false } : prev));
    onAddingChange?.(false);
  };
  const editing = sheet?.id ? sets.find((s) => s.id === sheet.id) ?? null : null;
  // Футер страницы поднял флаг — открываем лист нового набора.
  useEffect(() => {
    if (adding) openSheet(null);
  }, [adding]);

  // СВАЙП УБИРАЕТ СРАЗУ (владелец 22.09: «всё можно вот так вот убирать»,
  // как объекты и связи). Выданные инвойсы печатают свой снимок и не
  // меняются; набор заводится обратно дверью блока.
  // …И С «ОТМЕНИТЬ» (аудит 23.09: юр. имя, VAT и адрес вбивать заново
  // дорого, а свайп на ходу промахивается). Вернуть — тот же набор с тем же
  // id; был основным — снова основной.
  const askRemove = (set: ClientRequisites) => {
    haptics.warning();
    void writer.removeRequisites(set.id).then((ok) => {
      if (!ok) return;
      toast(`Удалили: ${set.legal_name?.trim() || "реквизиты"}`, "success", {
        label: "Отменить",
        onPress: () =>
          void writer
            .saveRequisites({
              id: set.id,
              legal_name: set.legal_name,
              vat_number: set.vat_number,
              reg_number: set.reg_number,
              billing_address: set.billing_address,
            })
            .then((id) => {
              if (id && set.is_default) void writer.makeDefault(id);
            }),
      });
    });
  };

  const sheetNode =
    sheet && !readOnly ? (
      <RequisitesSheet
        key={sheet.key}
        // Набор удалили под открытым листом (реалтайм, второе устройство) —
        // лист закрывается: править больше нечего.
        visible={sheet.open && (sheet.id === null || editing !== null)}
        set={editing}
        canMakeDefault={sets.length > 1}
        onClose={closeSheet}
        onSave={async (fields) =>
          (await writer.saveRequisites({ ...fields, id: sheet.id })) !== null
        }
        onMakeDefault={() => {
          if (!sheet.id) return;
          haptics.success();
          void writer.makeDefault(sheet.id);
          closeSheet();
        }}
      />
    ) : null;

  // СВОЯ СТРАНИЦА — КАЖДЫЙ НАБОР ОТДЕЛЬНОЙ ПЛАШКОЙ (владелец 03.10: «то же
  // самое» — как «История» и «Файлы»): тап — лист правки, удержание —
  // скопировать набор, свайп — «Удалить» с «Отменить». Добавляет футер
  // страницы; пустой список говорит сама страница.
  if (bare) {
    return (
      <>
        {shown.length > 0 ? (
          <SelectList>
            {shown.map((set) => {
              const plaque = (
                <RequisitesPlaque
                  set={set}
                  markDefault={sets.length > 1}
                  onPress={readOnly ? () => undefined : () => openSheet(set.id)}
                  onLongPress={() => copySet(set)}
                />
              );
              return readOnly ? (
                <View key={set.id}>{plaque}</View>
              ) : (
                <SwipeRow
                  key={set.id}
                  radius={t.radius.input}
                  label="Удалить"
                  color={t.danger}
                  onAction={() => askRemove(set)}
                  accessibilityLabel={`Удалить реквизиты ${set.legal_name ?? ""}`.trim()}
                >
                  {plaque}
                </SwipeRow>
              );
            })}
          </SelectList>
        ) : null}
        {sheetNode}
      </>
    );
  }

  // Только видит и смотреть нечего — блока нет (недоступное просто
  // отсутствует, владелец 20.09).
  if (readOnly && ordered.length === 0) return null;

  // КАРТОЧКА — ОДИН НАБОР, ОСНОВНОЙ (владелец 03.10, как «История» и
  // «Файлы»): плашкой под шапкой блока, тап — страница всех наборов. Пусто —
  // дверь «Добавить реквизиты», как «Добавить объект».
  // «Ещё N» — наборов сверх показанного основного (03.10).
  const more = single && onOpenAll ? moreLabel(ordered.length) : null;
  return (
    <SectionCard
      title="Реквизиты"
      action={more && onOpenAll ? { label: more, pill: true, onPress: onOpenAll } : undefined}
    >
      {shown.map((set) => (
        <View key={set.id} style={{ paddingHorizontal: 2, paddingTop: 2, paddingBottom: 6 }}>
          <RequisitesPlaque
            set={set}
            markDefault={false}
            onPress={onOpenAll ?? (readOnly ? () => undefined : () => openSheet(set.id))}
            onLongPress={() => copySet(set)}
          />
        </View>
      ))}
      {/* Дверь — у пустого блока карточки и в черновике (у него страницы
          всех наборов ещё нет). */}
      {readOnly || onAddingChange || (single && ordered.length > 0) ? null : (
        <ChooseRow compact icon={Building2} label="Добавить реквизиты" onPress={() => openSheet(null)} />
      )}
      {sheetNode}
    </SectionCard>
  );
}

/** НАБОР РЕКВИЗИТОВ — ПЛАШКОЙ, КАК ЗАПИСЬ В «ИСТОРИИ» И ФАЙЛ (владелец
 *  03.10): плитка со зданием, юр. имя — названием, под ним «Основные · VAT …
 *  · Рег. …», ниже адрес тихо. */
function RequisitesPlaque({
  set,
  markDefault,
  onPress,
  onLongPress,
}: {
  set: ClientRequisites;
  markDefault: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const legal = (set.legal_name ?? "").trim();
  const numbers = [markDefault && set.is_default ? "Основные" : "", requisitesNumbersLine(set)]
    .filter(Boolean)
    .join(" · ");
  const address = (set.billing_address ?? "").trim();
  const t = useThemeColors();
  return (
    <SelectRow
      icon={Building2}
      // Плитка акцентом: серая читалась выключенной рядом с цветными
      // плитками «Истории» и «Файлов».
      color={t.accent}
      plain
      title={legal || "Юридическое имя не указано"}
      subtitle={numbers || undefined}
      hint={address || undefined}
      accessibilityLabel={["Реквизиты", legal, numbers, address].filter(Boolean).join(", ")}
      accessibilityHint="Открывает реквизиты; удерживайте, чтобы скопировать"
      onPress={onPress}
      onLongPress={onLongPress}
    />
  );
}

/** Строка набора — её же ставит блок реквизитов клиента в инвойсе. */
export function RequisitesRow({
  set,
  markDefault,
  separated,
  onPress,
  onLongPress,
  chevron = true,
}: {
  set: ClientRequisites;
  markDefault: boolean;
  separated: boolean;
  onPress: () => void;
  onLongPress: () => void;
  /** Шеврон обещает страницу. На карточке тап открывает ЛИСТ, как у строки
   *  объекта, — там шеврона нет (аудит 23.09: соседи должны совпасть). */
  chevron?: boolean;
}) {
  const t = useThemeColors();
  const legal = (set.legal_name ?? "").trim();
  const numbers = [markDefault && set.is_default ? "Основные" : "", requisitesNumbersLine(set)]
    .filter(Boolean)
    .join(" · ");
  const address = (set.billing_address ?? "").trim();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={["Реквизиты", legal, numbers, address].filter(Boolean).join(", ")}
      accessibilityHint="Открывает правку реквизитов"
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: 60,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{ fontSize: 15, fontWeight: "600", color: legal ? t.ink : t.faint }}
        >
          {legal || "Юридическое имя не указано"}
        </Text>
        {numbers ? (
          <Text
            maxFontSizeMultiplier={1.2}
            numberOfLines={1}
            style={{ fontSize: 13, color: t.body, fontVariant: ["tabular-nums"] }}
          >
            {numbers}
          </Text>
        ) : null}
        {address ? (
          <Text maxFontSizeMultiplier={1.2} numberOfLines={2} style={{ fontSize: 13, color: t.sub }}>
            {address}
          </Text>
        ) : null}
      </View>
      {chevron ? <ChevronRight color={t.faint} size={18} strokeWidth={2} /> : null}
    </Pressable>
  );
}
