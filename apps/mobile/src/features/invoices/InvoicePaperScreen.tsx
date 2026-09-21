import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { Button } from "@/components/ui/Button";
import { DateWheelSheet } from "@/components/ui/DateWheelSheet";
import { useSheetDoorway } from "@/components/ui/use-sheet-doorway";
import { useThemeColors } from "@/theme/colors";
import type { InvoiceDocument } from "./document";
import { INVOICE_LANGUAGE_LABEL, type InvoiceLanguage } from "./dictionary";
import type { EditableInvoiceLine } from "./format";
import { InvoicePaper } from "./InvoicePaper";
import { LineSheet } from "./InvoiceLines";
import { ModeSwitch } from "./ModeSwitch";

// РЕЖИМ «ДОКУМЕНТ» — ОТДЕЛЬНЫЙ ЭКРАН, ЧТОБЫ InvoiceEditor.tsx НЕ РОСЛА
// ДАЛЬШЕ (AGENTS.md, максимум 400 строк на компонент; сам файл уже на грани
// задолго до этого захода). Здесь живут ТОЛЬКО хотспоты бумаги 2026-09-20:
// какой лист открыть по тапу. Данные документа (клиент, позиции, налог, даты)
// по-прежнему принадлежат `InvoiceEditor` — сюда приходят пропами и уходят
// обратно теми же сеттерами, которыми правит форма «Правка». Листы, которые
// нужны ТОЛЬКО бумаге (позиция, дата), эта же бумага и держит открытыми —
// как `InvoiceLines.tsx` держит свой `editing` для листа позиции в «Правке».
//
// Три зоны первого захода ведут не в лист, а в готовый экран: логотип и
// продавец — в реквизиты (`/requisites`, реэкспорт страницы справочника
// над табами — AGENTS.md → Canon Reuse 5.4), налог и комментарий — обратно в
// «Правку», где для них уже есть форма и нет отдельной шторки.

export function InvoicePaperScreen({
  mode,
  onChangeMode,
  doc,
  language,
  onChangeLanguage,
  error,
  submitting,
  actionLabel,
  onSubmit,
  currency,
  lines,
  onChangeLine,
  onRemoveLine,
  onReorderLine,
  issuedOn,
  dueOn,
  onChangeIssuedOn,
  onChangeDueOn,
  onPressClient,
}: {
  mode: "edit" | "paper";
  onChangeMode: (next: "edit" | "paper") => void;
  doc: InvoiceDocument;
  language: InvoiceLanguage;
  onChangeLanguage: (code: InvoiceLanguage) => void;
  error: string | null;
  submitting: boolean;
  actionLabel: string;
  onSubmit: () => void;
  /** Валюта документа — листу позиции нужна для подписи поля цены. */
  currency: string;
  /** Позиции, ВЫРОВНЕННЫЕ с `doc.lines` (тот же порядок и длина) — иначе тап
   *  по строке бумаги открыл бы не ту позицию (см. `InvoiceEditor.paperLines`). */
  lines: EditableInvoiceLine[];
  onChangeLine: (line: EditableInvoiceLine) => void;
  onRemoveLine: (line: EditableInvoiceLine) => void;
  onReorderLine: (id: string, delta: -1 | 1) => void;
  issuedOn: string;
  dueOn: string | null;
  onChangeIssuedOn: (value: string) => void;
  onChangeDueOn: (value: string | null) => void;
  onPressClient: () => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  // ДВЕРЬ В РЕКВИЗИТЫ КОМПАНИИ. Составитель — корневой экран НАД табами
  // (`app/invoices/*`); прямой push на адрес внутри вкладки положил бы поверх
  // него вторую копию таб-бара — «назад» увёл бы на календарь, а набранный
  // счёт пропал бы вместе с ним. Общий адрес — `app/(shared)/requisites.tsx`.
  //
  // `doorway.parked` здесь не гасит разметку: это парковка ЛИСТА
  // (`Modal`, плавает НАД стеком и не спрятался бы сам под новый экран) — а
  // бумага стоит в обычном потоке страницы «Инвойс», и пуш и так кладёт новый
  // экран поверх нас штатно. Дверь используем ради самого перехода
  // (`doorway.open`), чтобы, если бумагу однажды позовут из настоящей
  // шторки, канон уже был на месте.
  const doorway = useSheetDoorway();
  const openBusiness = () => doorway.open(() => router.push("/requisites" as Href));

  const [lineSheetId, setLineSheetId] = useState<string | null>(null);
  const editingLine = lines.find((line) => line.id === lineSheetId) ?? null;
  const editingIndex = editingLine ? lines.indexOf(editingLine) : -1;

  const [dateField, setDateField] = useState<"issued" | "due" | null>(null);
  const toEdit = () => onChangeMode("edit");

  return (
    <View className="flex-1">
      <ModeSwitch mode={mode} onChange={onChangeMode} />
      {/* ЯЗЫК ПЕРЕКЛЮЧАЕТСЯ НА САМОМ ДОКУМЕНТЕ (владелец 2026-08-25). */}
      <View className="flex-row items-center justify-end gap-2 px-4 pb-1">
        {(["ru", "en"] as const).map((code) => {
          const active = language === code;
          return (
            <Pressable
              key={code}
              onPress={() => onChangeLanguage(code)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Язык документа: ${INVOICE_LANGUAGE_LABEL[code]}`}
              style={({ pressed }) => ({
                minHeight: 32,
                justifyContent: "center",
                paddingHorizontal: 12,
                borderRadius: t.radius.card,
                borderCurve: "continuous",
                backgroundColor: active ? t.accent : t.fill,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text
                maxFontSizeMultiplier={1.2}
                style={{
                  fontSize: 13,
                  fontWeight: active ? "700" : "500",
                  color: active ? t.onAccent : t.sub,
                }}
              >
                {INVOICE_LANGUAGE_LABEL[code]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 12, paddingBottom: 28 }}>
        <InvoicePaper
          doc={doc}
          onPressLogo={openBusiness}
          onPressSeller={openBusiness}
          onPressClient={onPressClient}
          onPressDate={(field) => setDateField(field)}
          onPressLine={(index) => setLineSheetId(lines[index]?.id ?? null)}
          onPressTax={toEdit}
          onPressNote={toEdit}
        />
      </ScrollView>
      {/* КНОПКА ВЫПУСКА ЖИВЁТ НА ДОКУМЕНТЕ. Человек нажимает её, глядя на
          то, что уйдёт клиенту, а не на форму с полями. */}
      <View
        className="px-4 pb-7 pt-3"
        style={{ backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.separator }}
      >
        {error ? (
          <Text
            accessibilityRole="alert"
            className="mb-2 text-center text-sm"
            style={{ color: t.danger }}
          >
            {error}
          </Text>
        ) : null}
        <Button label={actionLabel} onPress={onSubmit} loading={submitting} disabled={submitting} />
      </View>

      <LineSheet
        line={editingLine}
        currency={currency}
        first={editingIndex === 0}
        last={editingIndex === lines.length - 1}
        onChange={onChangeLine}
        onReorder={onReorderLine}
        onRemove={(line) => {
          setLineSheetId(null);
          onRemoveLine(line);
        }}
        onClose={() => setLineSheetId(null)}
      />

      <DateWheelSheet
        visible={dateField !== null}
        title={dateField === "due" ? "Оплатить до" : "Дата выставления"}
        value={dateField === "due" ? dueOn : issuedOn}
        seed={issuedOn}
        minimumDate={dateField === "due" ? issuedOn : undefined}
        clearLabel={dateField === "due" && dueOn ? "Убрать срок оплаты" : undefined}
        onApply={(ymd) => {
          if (dateField === "due") onChangeDueOn(ymd);
          else onChangeIssuedOn(ymd);
          setDateField(null);
        }}
        onClear={
          dateField === "due"
            ? () => {
                onChangeDueOn(null);
                setDateField(null);
              }
            : undefined
        }
        onClose={() => setDateField(null)}
      />
    </View>
  );
}
