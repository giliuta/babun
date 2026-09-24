import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Building2, ChevronRight } from "lucide-react-native";
import type { Client, ClientRequisites } from "@babun/shared/local/clients";
import {
  clientRequisitesOf,
  orderedRequisites,
  requisitesNumbersLine,
} from "@babun/shared/local/client-requisites";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { NavRow } from "@/components/ui/card-rows";
import { useToast } from "@/components/ui/Toast";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { SectionCard } from "@/components/ui/SectionCard";
import { haptics } from "@/lib/haptics";
import { useCopyValue } from "@/lib/copy-value";
import { requisitesLines } from "@/features/clients/client-share";
import { RequisitesSheet } from "@/features/clients/RequisitesSheet";
import { useRequisitesWriter } from "@/features/clients/use-requisites-writer";
import { useThemeColors } from "@/theme/colors";

// РЕКВИЗИТЫ КЛИЕНТА (STORY-085, владелец 2026-09-21): «реквизиты делаем
// всегда… инвойс могут просить прямо на клиента с его реквизитами». Блок
// постоянный у любого клиента — человека или компании; то, что печатается
// получателем на инвойсе. Слова те же, что у реквизитов своей компании
// («Юридическое имя», «VAT номер»…): обе стороны документа подписаны одним
// языком.
//
// НЕСКОЛЬКО НАБОРОВ — СПИСКОМ, КАК ОБЪЕКТЫ (владелец 22.09: «один и тот же
// клиент может попросить один инвойс на эти реквизиты, а второй — на эти.
// Сделать как объекты»). Каждая строка — набор: юр. имя крупно, под ним
// «VAT … · Рег. …», ниже адрес; основной помечен тихим словом «Основные» в
// подписи, как у реквизитов своей компании — и только когда наборов больше
// одного: у единственного отличать его не от чего. Тап — лист с четырьмя
// полями (тот же для нового и для правки); свайп — «Удалить» с
// подтверждением; последняя строка — дверь «Добавить реквизиты», как
// «Добавить объект». Какой набор печатать, выбирают в самом инвойсе; не
// выбрали — основной.
//
// Только владельцу: реквизиты — к документам и деньгам, сотруднику сервер их
// не отдаёт и править не даёт.

/** Сколько наборов показывает карточка; остальные — за дверью. */
export const REQUISITES_ON_CARD = 2;

export function RequisitesBlock({
  client,
  update,
  limit,
  onOpenAll,
  bare,
}: {
  client: Client;
  draft: boolean;
  update: (patch: Partial<Client>) => Promise<boolean>;
  /** Сколько наборов показывать; без него — все (своя страница). */
  limit?: number;
  /** Открыть страницу всех наборов — дверь под списком. */
  onOpenAll?: () => void;
  /** Своя страница: название уже в заголовке экрана, шапки у блока нет. */
  bare?: boolean;
}) {
  const t = useThemeColors();
  const copy = useCopyValue();
  const toast = useToast();
  const sets = useMemo(() => clientRequisitesOf(client), [client]);
  const ordered = useMemo(() => orderedRequisites(sets), [sets]);
  const shown = limit ? ordered.slice(0, limit) : ordered;
  const rest = ordered.length - shown.length;
  const writer = useRequisitesWriter(sets, update, client.id);

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
  const closeSheet = () => setSheet((prev) => (prev ? { ...prev, open: false } : prev));
  const editing = sheet?.id ? sets.find((s) => s.id === sheet.id) ?? null : null;

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

  return (
    <SectionCard title={bare ? undefined : "Реквизиты"}>
      {shown.map((set, i) => (
        <SwipeRow
          key={set.id}
          label="Удалить"
          color={t.danger}
          onAction={() => askRemove(set)}
          accessibilityLabel={`Удалить реквизиты ${set.legal_name ?? ""}`.trim()}
        >
          <RequisitesRow
            set={set}
            markDefault={sets.length > 1}
            chevron={false}
            separated={i > 0}
            onPress={() => openSheet(set.id)}
            // Долгое нажатие копирует набор целиком, построчно — его обычно
            // пересылают в банк или бухгалтеру одним сообщением.
            onLongPress={() => copy(requisitesLines(set).join("\n"))}
          />
        </SwipeRow>
      ))}
      {/* ОСТАЛЬНЫЕ НАБОРЫ — НА СВОЕЙ СТРАНИЦЕ (владелец 22.09: «то же самое
          можно сделать с реквизитами — если их много»). */}
      {rest > 0 && onOpenAll ? (
        <NavRow
          label="Все реквизиты"
          value={String(ordered.length)}
          separated
          onPress={onOpenAll}
        />
      ) : null}
      <ChooseRow compact icon={Building2} label="Добавить реквизиты" onPress={() => openSheet(null)} />

      {sheet ? (
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
      ) : null}
    </SectionCard>
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
