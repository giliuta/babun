import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Building2, EyeOff, RotateCcw, Trash2 } from "lucide-react-native";
import { useNextInvoiceNumber } from "@/features/invoices/queries";
import { AppearanceTile, appearanceRowFill } from "@/components/ui/AppearanceSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { ReorderList } from "@/components/ui/ReorderList";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { GUTTER } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { useAccountScope } from "@/features/cabinet/account-scope";
import { useThemeColors } from "@/theme/colors";
import { CompanySheet } from "./CompanySheet";
import { companyDetail, companyFilled, defaultHeir } from "./company-rules";
import {
  companyHasDocuments,
  useArchiveCompany,
  useCompanies,
  useDeleteCompany,
  useMakeDefaultCompany,
  useReorderCompanies,
  useSaveCompany,
  type Company,
} from "./queries";

// РЕКВИЗИТЫ — СПРАВОЧНИК ПО ОБЩЕМУ КАНОНУ (владелец 2026-09-22: «сделай точно
// такую же, как мы делали в услугах… выбор меток; внизу кнопка „Добавить
// реквизиты“; добавляем, сохраняем — появляется блок с данными; вправо
// сдвинуть — удалить, влево — скрывать, чтоб оно больше не показывалось»).
//
// До этого страница жила анатомией объектов клиента: строка «Добавить
// реквизиты» последней в карточке, ни свайпов, ни порядка. Теперь ровно то
// же, что у типов событий и меток:
//   • строка — своя карточка с ручкой перетаскивания, порядок задаёт человек;
//   • тап — правка листом снизу (`CompanySheet`, одна форма на создание и
//     правку);
//   • правая кромка — «Удалить» с подтверждением;
//   • левая кромка — «Скрыть» / «Показать»;
//   • «Добавить реквизиты» — внизу и всегда, пустой список или полный.
//
// ЧТО ТАКОЕ ЗАПИСЬ ЗДЕСЬ. НАБОР РЕКВИЗИТОВ, которым подписывают чек и инвойс:
// имя на бумаге, адрес, VAT, рег. номер, банк, логотип. Один набор —
// ОСНОВНОЙ: его подставляет документ, пока человек не выбрал другой.
//
// ОСНОВНОЙ НЕ БЫВАЕТ СКРЫТЫМ. Сервер (`resolve_company_id`) подписывает
// документ основным набором, не глядя на `archived_at`: скрыть основной
// значило бы спрятать его из выбора и продолжать им подписывать. Поэтому
// скрытие и удаление основного сперва отдают это звание следующему видимому
// набору, а единственный видимый скрыть нельзя — документу нечем будет
// подписаться.
//
// ПРАВА (AGENTS.md, правило 10). Закрыто РОЛЬЮ владельца, а не галочкой
// календаря: реквизиты — подпись всей компании под бумагой. Сервер: RLS
// `companies_write_owner` (писать — только владелец), `companies_read` —
// владелец и диспетчер. Дверь сюда («Настройки финансов» → «Реквизиты»)
// видит только владелец; кто пришёл прямой ссылкой, видит список ТОЛЬКО ДЛЯ
// ЧТЕНИЯ — без свайпов, порядка, правки и кнопки, а не кнопки, которые
// сервер отклонит ошибкой.
//
// Чек и инвойс печатают продавца из своего снимка, поэтому ни скрытие, ни
// удаление выданную бумагу не меняют.
//
// ПЕРЕСОБРАНО 2026-09-30 (владелец: «страницу реквизитов — по нашей
// архитектуре, как теги и услуги; шаблон реквизитов — тот блок, что
// вставляем в инвойс; может быть несколько»). На странице — ТОЛЬКО список
// наборов и кнопка внизу. Справа в строке — номер следующего инвойса этого
// набора (нумерация живёт за реквизитами), как цена в прайсе услуг. Бланк,
// общий для всех наборов, с 03.10 — дверь «Инвойсы» в шестерёнке «Финансов»;
// своей шестерёнки у страницы больше нет.

/** Высота строки: по ней перетаскивание считает перелёт через соседей. Та же,
 *  что у типов событий и меток. */
const ROW_H = 60;

export function RequisitesScreen() {
  const t = useThemeColors();
  const toast = useToast();
  const companies = useCompanies();
  const save = useSaveCompany();
  const makeDefault = useMakeDefaultCompany();
  const archive = useArchiveCompany();
  const del = useDeleteCompany();
  // Аккаунт страницы (04.10): из блока пригласившего аккаунта в Кабинете —
  // его наборы и его роль, правка — только владельцу этого аккаунта.
  const scope = useAccountScope();
  const tenantId = scope.tenantId;
  const reorder = useReorderCompanies();
  const [editing, setEditing] = useState<Company | null>(null);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const role = scope.viewRole;
  // Пока роль грузится, владелец не должен видеть мигание «только чтение».
  // Аккаунт страницы — не открытый на телефоне (свой, открытый из Кабинета
  // со стороны, 04.10): правка наборов пишет в открытый, поэтому здесь —
  // только чтение; править — из своего аккаунта.
  const readOnly = scope.foreign || (role !== undefined && role !== "owner");

  // Видимые сверху, скрытые под ними — тем же порядком, что у меток и услуг.
  const rows = useMemo(() => {
    const all = companies.data ?? [];
    return [...all.filter((c) => !c.archived_at), ...all.filter((c) => c.archived_at)];
  }, [companies.data]);
  const live = rows.filter((c) => !c.archived_at);
  const busy = archive.isPending || del.isPending || makeDefault.isPending;

  const show = (company: Company | null) => {
    setEditing(company);
    setOpen(true);
  };

  const fail = (title: string) => (error: unknown) =>
    notify(title, error instanceof Error ? error.message : undefined);

  /** Основной уходит из выбора — звание сперва переходит к следующему
   *  видимому. `false` — передать некому. */
  const handOverDefault = async (company: Company): Promise<boolean> => {
    if (!company.is_default) return true;
    const heirId = defaultHeir(rows, company.id);
    const heir = rows.find((c) => c.id === heirId);
    if (!heir) return false;
    await makeDefault.mutateAsync(heir.id);
    toast(`Основные реквизиты — ${heir.name}`);
    return true;
  };

  const toggleHidden = async (company: Company) => {
    if (busy) return;
    try {
      if (!company.archived_at && !(await handOverDefault(company))) {
        notify(
          "Это единственные рабочие реквизиты",
          "Документу нечем будет подписаться. Сначала добавьте другие.",
        );
        return;
      }
      await archive.mutateAsync({ id: company.id, archived: !company.archived_at });
      toast(company.archived_at ? "Реквизиты показаны" : "Реквизиты скрыты");
    } catch (error) {
      fail(company.archived_at ? "Не удалось показать" : "Не удалось скрыть")(error);
    }
  };

  const remove = (company: Company) => {
    if (busy) return;
    confirmThen(
      "Удалить реквизиты?",
      {
        // ПРАВДА, А НЕ ПУГАЛКА: удаляется только набор без документов, и
        // выданным бумагам удалять нечего (STORY-101).
        message: `«${company.name}» исчезнет из выбора.`,
        confirmLabel: "Удалить",
        destructive: true,
      },
      () =>
        void (async () => {
          try {
            // Юрлицо с документами держит их серию номеров — только скрыть.
            // Спрашиваем раньше передачи умолчания: отказ после неё оставил
            // бы основным другой набор (STORY-101).
            if (tenantId && (await companyHasDocuments(tenantId, company.id))) {
              notify(
                "Реквизиты с документами не удаляются",
                "Выпущенные инвойсы и чеки держат их серию номеров. Их можно скрыть.",
              );
              return;
            }
            // Единственные основные реквизиты не удаляются — тем же правилом,
            // что скрытие: документу было бы нечем подписаться (аудит
            // 2026-09-30, удаление этот ответ пропускало).
            if (!(await handOverDefault(company))) {
              notify(
                "Это единственные рабочие реквизиты",
                "Документу нечем будет подписаться. Сначала добавьте другие.",
              );
              return;
            }
            await del.mutateAsync(company.id);
            toast("Реквизиты удалены");
          } catch (error) {
            fail("Не удалось удалить")(error);
          }
        })(),
    );
  };

  const move = (ids: string[]) => {
    const moves = ids
      .map((id, position) => ({ id, position }))
      .filter(({ id, position }) => rows.find((c) => c.id === id)?.position !== position);
    if (moves.length === 0) return;
    reorder.mutate(moves, { onError: fail("Не удалось изменить порядок") });
  };

  return (
    <Screen edges={["top"]}>
      {/* БЕЗ ШЕСТЕРЁНКИ (владелец 03.10): бланк инвойса — дверь «Инвойсы» в
          шестерёнке «Финансов», рядом с «Реквизитами». У настройки одна дверь. */}
      <ScreenHeader title="Реквизиты" />

      {companies.isLoading ? (
        <EmptyState state="loading" fill />
      ) : companies.isError ? (
        <EmptyState
          fill
          state="error"
          title="Не удалось загрузить реквизиты"
          subtitle={companies.error instanceof Error ? companies.error.message : undefined}
          action={{ label: "Повторить", onPress: () => void companies.refetch() }}
        />
      ) : rows.length === 0 ? (
        // Пустое состояние — только слова: действие экрана одно, в футере.
        <EmptyState
          fill
          title="Реквизитов пока нет"
          subtitle="Ими подписываются чеки и инвойсы: имя на бумаге, адрес, VAT, банк и логотип."
        />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 12 }}
          scrollEnabled={!dragging}
        >
          <View style={{ marginHorizontal: GUTTER }}>
            <ReorderList
              items={rows}
              rowHeight={ROW_H}
              spaced
              labelFor={(company) => company.name}
              handleInside
              onReorder={readOnly ? () => undefined : move}
              onDraggingChange={setDragging}
            >
              {(company, _index, handle) => (
                <SwipeRow
                  label={readOnly ? undefined : "Удалить"}
                  color={t.danger}
                  icon={Trash2}
                  accessibilityLabel={`Удалить реквизиты ${company.name}`}
                  onAction={readOnly ? undefined : () => remove(company)}
                  leading={readOnly ? undefined : {
                    label: company.archived_at ? "Показать" : "Скрыть",
                    color: company.archived_at ? t.success : t.warning,
                    icon: company.archived_at ? RotateCcw : EyeOff,
                    accessibilityLabel: company.archived_at
                      ? `Показать реквизиты ${company.name}`
                      : `Скрыть реквизиты ${company.name}`,
                    onAction: () => void toggleHidden(company),
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      // Скрытый не исчезает и не кричит — просто тише живых.
                      opacity: company.archived_at ? 0.45 : 1,
                      backgroundColor: appearanceRowFill(company.color, false, {
                        rest: t.surface,
                        pressed: t.pressed,
                      }),
                    }}
                  >
                    <Pressable
                      onPress={readOnly ? undefined : () => show(company)}
                      accessibilityRole="button"
                      accessibilityLabel={`Реквизиты ${company.name}, редактировать`}
                      style={({ pressed }) => ({
                        flex: 1,
                        height: ROW_H,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        paddingLeft: 16,
                        backgroundColor: pressed ? t.pressed : "transparent",
                      })}
                    >
                      <AppearanceTile
                        color={company.color}
                        icon={company.icon}
                        fallback={Building2}
                        size={30}
                      />
                      <View style={{ flex: 1 }}>
                        <Text
                          numberOfLines={1}
                          maxFontSizeMultiplier={1.3}
                          style={{ fontSize: 16, color: t.ink }}
                        >
                          {company.name}
                        </Text>
                        <Text
                          numberOfLines={1}
                          maxFontSizeMultiplier={1.3}
                          // Незаполненный набор — цветом предупреждения, как в
                          // блоке «Реквизиты» инвойса: документу нечего
                          // напечатать о продавце.
                          style={{
                            fontSize: 13,
                            color: companyFilled(company) ? t.sub : t.warning,
                            marginTop: 1,
                          }}
                        >
                          {companyDetail(company)}
                        </Text>
                      </View>
                      {/* НОМЕР СЛЕДУЮЩЕГО ИНВОЙСА НАБОРА — справа, как цена в
                          прайсе услуг: нумерация живёт за реквизитами. У
                          скрытого набора номера нет — им не выставляют. Номер
                          серии читается в аккаунте, открытом на телефоне, —
                          у чужого аккаунта (04.10) он был бы не его. */}
                      {company.archived_at || scope.foreign ? null : <NextNumber companyId={company.id} />}
                    </Pressable>
                    {readOnly ? null : handle}
                  </View>
                </SwipeRow>
              )}
            </ReorderList>
          </View>
        </ScrollView>
      )}

      {/* ГЛАВНОЕ ДЕЙСТВИЕ ЭКРАНА — ВНИЗУ И ВСЕГДА (AGENTS.md 7.1): место
          кнопки не зависит от того, пуст список или полон. */}
      {!companies.isLoading && !companies.isError && !readOnly ? (
        <View style={{ paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 16 }}>
          <GradientButton label="Добавить реквизиты" onPress={() => show(null)} />
        </View>
      ) : null}

      <CompanySheet
        visible={open}
        company={editing}
        saving={save.isPending}
        onMakeDefault={
          editing && !editing.is_default && !editing.archived_at
            ? () =>
                makeDefault.mutate(editing.id, {
                  onSuccess: () => {
                    setOpen(false);
                    toast(`Основные реквизиты — ${editing.name}`, "success");
                  },
                  onError: fail("Не переключилось"),
                })
            : undefined
        }
        onClose={() => setOpen(false)}
        onSave={(patch) =>
          save.mutate(
            // Новый набор встаёт последним, а не на место первого.
            { id: editing?.id ?? null, patch: editing ? patch : { ...patch, position: rows.length } },
            {
              onSuccess: async (id) => {
                // Первый видимый набор сразу становится основным: справочник,
                // из которого нечего подставить, документу бесполезен.
                if (live.length === 0) await makeDefault.mutateAsync(id);
                setOpen(false);
              },
              onError: fail("Не сохранилось"),
            },
          )
        }
      />
    </Screen>
  );
}

/** Номер, который получит следующий инвойс этих реквизитов. */
function NextNumber({ companyId }: { companyId: string }) {
  const t = useThemeColors();
  const number = useNextInvoiceNumber(new Date().getFullYear(), companyId).data;
  if (!number) return null;
  return (
    <Text
      numberOfLines={1}
      maxFontSizeMultiplier={1.3}
      style={{
        fontSize: 15,
        fontWeight: "600",
        color: t.body,
        fontVariant: ["tabular-nums"],
        paddingRight: 4,
      }}
    >
      {number}
    </Text>
  );
}
