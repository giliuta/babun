import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { Building2 } from "lucide-react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { FieldRow, RowCaption } from "@/components/ui/card-rows";
import { NameColorField } from "@/components/ui/picker-fields";
import { SectionCard } from "@/components/ui/SectionCard";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { GUTTER } from "@/components/ui/tokens";
import { LogoRow } from "@/features/settings/LogoRow";
import { getStorage } from "@babun/shared/storage";
import { useTenantId } from "@/lib/tenant";
import { useThemeColors } from "@/theme/colors";
import { canSaveCompany, isCompanyDraftDirty, normalizeCompanyDraft } from "./company-rules";
import type { Company, CompanyDraft } from "./queries";

// КАРТОЧКА РЕКВИЗИТОВ — ОДНА ФОРМА НА СОЗДАНИЕ И НА ПРАВКУ (тот же закон, что у
// объекта: «если я показываю в одном месте, значит то же самое будет
// показывать в другом»).
//
// БЛОКИ ИДУТ В ТОМ ПОРЯДКЕ, В КАКОМ ПЕЧАТАЕТСЯ БУМАГА (владелец 2026-09-22:
// «очень много блоков… укомплектуй, чтобы правильно написалось и потом
// вносилось в инвойс»). Шапка инвойса у AirFix: логотип слева, под ним FROM —
// юридическое имя, VAT, телефон, почта, адрес в несколько строк; внизу
// «Notes & payment instructions» с IBAN. Отсюда четыре карточки:
//   • «Логотип»     — шапка документа;
//   • «На бумаге»   — кто выставляет: имя, VAT, рег. номер;
//   • «Контакты»    — телефон, почта, адрес (многострочный — как печатается);
//   • «Оплата»      — IBAN и банк, куда клиенту платить.
// Раньше это были одиннадцать голых полей подряд другой ширины, чем карточки
// над ними, — анкета, в которой не видно, что куда ляжет.
//
// ПОЛЯ — РОВНО ТЕ, ЧТО ПЕЧАТАЮТСЯ, и ни одного лишнего: каждое однажды
// окажется у клиента в чеке или инвойсе.

const EMPTY: CompanyDraft = {
  name: "",
  color: null,
  icon: null,
  logo_url: null,
  legal_name: null,
  business_address: null,
  vat_number: null,
  reg_number: null,
  iban: null,
  bank_name: null,
  contact_phone: null,
  contact_email: null,
};

function companyToDraft(company: Company | null): CompanyDraft {
  if (!company) return EMPTY;
  return {
    name: company.name,
    // Без цвета и значка правка открывалась «без вида» и первым же
    // сохранением стирала выбранный.
    color: company.color,
    icon: company.icon,
    logo_url: company.logo_url,
    legal_name: company.legal_name,
    business_address: company.business_address,
    vat_number: company.vat_number,
    reg_number: company.reg_number,
    iban: company.iban,
    bank_name: company.bank_name,
    contact_phone: company.contact_phone,
    contact_email: company.contact_email,
  };
}

/** Черновик на устройстве — пережить перезапуск приложения (см. ниже). */
function readStoredDraft(storageKey: string | null): CompanyDraft | null {
  if (!storageKey) return null;
  try {
    const stored = getStorage().get<CompanyDraft>(storageKey);
    return stored && typeof stored.name === "string" ? { ...EMPTY, ...stored } : null;
  } catch {
    return null;
  }
}

type TextKey =
  | "legal_name"
  | "business_address"
  | "vat_number"
  | "reg_number"
  | "iban"
  | "bank_name"
  | "contact_phone"
  | "contact_email";

export function CompanySheet({
  visible,
  company,
  saving,
  onSave,
  onMakeDefault,
  onClose,
}: {
  visible: boolean;
  /** `null` — заводим новые. */
  company: Company | null;
  saving: boolean;
  onSave: (patch: CompanyDraft) => void;
  /** Сделать этот набор основным. `undefined` — он уже основной, скрыт либо
   *  ещё не заведён: переключать нечего. */
  onMakeDefault?: () => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const [draft, setDraft] = useState<CompanyDraft>(EMPTY);

  // ЧЕРНОВИК ДОЖИВАЕТ ДО СЛЕДУЮЩЕГО ОТКРЫТИЯ (тот же приём, что у листа
  // объекта). Лист закрывается свайпом, тапом по фону и жестом VoiceOver, и
  // одиннадцать набранных полей пропадали без вопроса. Спросить «выйти без
  // сохранения?» здесь нельзя: жест уже увёз лист вниз. Поэтому набранное
  // просто не теряется — открыли тот же набор снова, и всё на месте.
  // Черновик сбрасывается, только когда открыли ДРУГОЙ набор или сохранили.
  //
  // …И ДОЖИВАЕТ ДО ПЕРЕЗАПУСКА ПРИЛОЖЕНИЯ (владелец 2026-09-22: «заполняю,
  // заполняю — через время выбивает на календарь»). Реквизиты — длинная
  // анкета; перезапуск (iOS выгрузил приложение в фоне, обновление сборки)
  // стирал всё набранное. Пока набор отличается от сохранённого, черновик
  // лежит на устройстве, отдельно на компанию и на набор; «Сохранить» его
  // убирает.
  const tenantId = useTenantId();
  const key = company?.id ?? "new";
  const storageKey = tenantId ? `companies.draft.${tenantId}.${key}` : null;
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  useEffect(() => {
    if (!visible || hydratedKey === key) return;
    setDraft(readStoredDraft(storageKey) ?? companyToDraft(company));
    setHydratedKey(key);
  }, [visible, key, company, hydratedKey, storageKey]);

  useEffect(() => {
    if (!storageKey || hydratedKey !== key) return;
    try {
      if (isCompanyDraftDirty(companyToDraft(company), draft)) {
        getStorage().set(storageKey, draft);
      } else {
        getStorage().remove(storageKey);
      }
    } catch {
      // Хранилище недоступно — черновик живёт в памяти, как раньше.
    }
  }, [draft, storageKey, hydratedKey, key, company]);

  // Сохранение прошло — лист закрыт, запись ушла: следующее открытие берёт
  // свежую строку из базы, а не старый черновик. Неудача оставляет лист
  // открытым, и черновик живёт дальше.
  const wasSaving = useRef(false);
  useEffect(() => {
    if (wasSaving.current && !saving && !visible) {
      setHydratedKey(null);
      if (storageKey) {
        try {
          getStorage().remove(storageKey);
        } catch {
          // см. выше
        }
      }
    }
    wasSaving.current = saving;
  }, [saving, visible, storageKey]);

  const set = (patch: Partial<CompanyDraft>) =>
    setDraft((prev) => ({ ...prev, ...patch }));

  /** Строка поля. `live`: черновик пишется на каждый символ, иначе кнопка в
   *  футере сохранила бы набор без последнего поля, из которого не ушли. */
  const field = (
    key: TextKey,
    label: string,
    options: {
      separated?: boolean;
      multiline?: boolean;
      keyboardType?: "phone-pad" | "email-address";
      // Номера набирают как угодно — заглавными их делает `normalizeCompanyDraft`.
      autoCapitalize?: "none" | "words";
    } = {},
  ) => (
    <FieldRow
      label={label}
      value={draft[key] ?? ""}
      placeholder={label}
      addLabel="Добавить"
      stacked
      live
      separated={options.separated}
      multiline={options.multiline}
      keyboardType={options.keyboardType}
      autoCapitalize={options.autoCapitalize}
      onSave={(v) => set({ [key]: v.trim() ? v : null })}
    />
  );

  return (
    // ТЕЛО — ЯЗЫК СТРАНИЦЫ, КАК У ЛИСТА ОБЪЕКТА: карточки на прохладном фоне,
    // каждая сама держит отступ от края (`SectionCard` — GUTTER). Лист со
    // своими полями удваивал отступ, и карточки вставали на 32pt уже поля
    // названия над ними.
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={company ? company.name || "Реквизиты" : "Новые реквизиты"}
      padded={false}
      maxHeightRatio={0.92}
      avoidKeyboard
      footer={
        <View style={{ paddingHorizontal: GUTTER }}>
          <Button
            label={company ? "Сохранить" : "Добавить реквизиты"}
            loading={saving}
            disabled={!canSaveCompany(draft) || saving}
            onPress={() => onSave(normalizeCompanyDraft(draft))}
          />
        </View>
      }
    >
      <ScrollView
        style={{ flexShrink: 1, backgroundColor: t.canvas }}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ИМЯ И ВИД — ОДНОЙ СТРОКОЙ, как у услуги, метки, категории и типа
          события (владелец 21.09: «должно быть слева цвет иконкой и название
          компании… всё в одном стиле»). Это имя ВНУТРИ продукта — им набор
          называется в выборе; на бумагу идёт юридическое имя ниже. */}
        <View style={{ marginHorizontal: GUTTER }}>
          <NameColorField
            name={draft.name}
            onNameChange={(name) => set({ name })}
            color={draft.color}
            onColorChange={(color) => set({ color })}
            icon={draft.icon}
            onIconChange={(icon) => set({ icon })}
            fallback={Building2}
            autoCapitalize="words"
            placeholder="Как называть набор внутри"
            autoFocus={!company}
          />
        </View>

        {/* ЛОГОТИП ПРИНАДЛЕЖИТ НАБОРУ (владелец 2026-09-20). Пусто — бумага
          печатает логотип компании целиком, как раньше. */}
        <SectionCard dense title="Логотип">
          <LogoRow
            logoUrl={draft.logo_url ?? null}
            onChange={(logo_url) => set({ logo_url })}
          />
        </SectionCard>

        <SectionCard dense title="На бумаге">
          {field("legal_name", "Юридическое имя", { autoCapitalize: "words" })}
          {field("vat_number", "VAT номер", {
            separated: true,
            autoCapitalize: "none",
          })}
          {field("reg_number", "Регистрационный номер", {
            separated: true,
            autoCapitalize: "none",
          })}
        </SectionCard>

        <SectionCard dense title="Контакты">
          {field("contact_phone", "Телефон", { keyboardType: "phone-pad" })}
          {field("contact_email", "Почта", {
            separated: true,
            keyboardType: "email-address",
            autoCapitalize: "none",
          })}
          {field("business_address", "Адрес", {
            separated: true,
            multiline: true,
          })}
        </SectionCard>
        <RowCaption text="Адрес печатается так, как набран: перенос строки здесь — перенос на бумаге." />

        <SectionCard dense title="Оплата">
          {field("iban", "IBAN", { autoCapitalize: "none" })}
          {field("bank_name", "Банк", {
            separated: true,
            autoCapitalize: "words",
          })}
        </SectionCard>
        <RowCaption text="Печатается в инвойсе как реквизиты для оплаты." />

        {/* ОСНОВНЫЕ — ОТВЕТ НА ВОПРОС «ЧЕМ ПОДПИСАТЬ, ЕСЛИ НЕ ВЫБРАЛИ»
          (владелец 2026-09-20). Тумблер ОДНОСТОРОННИЙ: основные назначают, а
          не снимают — без основных документу нечем подписаться. Снимаются они
          сами, когда основными делают другие. Раньше здесь стояло слово «Да»
          синим на месте переключателя. */}
        {company ? (
          <SectionCard dense>
            <SwitchRow
              label="Основные реквизиты"
              hint="Их сам подставляет чек и инвойс"
              value={company.is_default}
              disabled={company.is_default || !onMakeDefault}
              onChange={(next) => {
                if (next) onMakeDefault?.();
              }}
            />
          </SectionCard>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}
