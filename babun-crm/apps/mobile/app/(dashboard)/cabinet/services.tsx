import { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Check, ChevronRight, Scissors, Settings2 } from "lucide-react-native";
import { formatEUR } from "@babun/shared/common/utils/money";
import {
  FORMS_KATEGORIYA,
  FORMS_USLUGA,
  formatCountRu,
} from "@babun/shared/common/utils/plural-ru";
import { PRESET_COLORS } from "@babun/shared/common/utils/colors";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { Divider } from "@/components/ui/Divider";
import { AddRow } from "@/components/ui/AddRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useToast } from "@/components/ui/Toast";
import {
  useDeleteService,
  useTeams,
  useUpdateService,
} from "@/features/reference/queries";
import {
  serviceBrigadeIds,
  useCreateService,
  useCreateServiceCategory,
  useDeleteServiceCategory,
  useServiceCategories,
  useServices,
  useUpdateServiceCategory,
  type Service,
  type ServiceCategory,
} from "@/features/services/queries";

// Услуги — порт /dashboard/services: группировка по цветным категориям,
// цвет услуги на календаре, привязка к командам (пусто = все). Bulk/tier-
// цены отложены (не портируем). Палитра — единая PRESET_COLORS (бригада /
// метка / категория / услуга делят один набор, web parity).

const DEFAULT_SERVICE_COLOR = PRESET_COLORS[1].value; // синий

type ServiceEditing = { mode: "create" } | { mode: "edit"; service: Service };

export default function ServicesScreen() {
  const t = useThemeColors();
  const toast = useToast();
  const { data: services = [], isLoading, isError, refetch } = useServices();
  const { data: categories = [] } = useServiceCategories();
  const { data: teams = [] } = useTeams();
  const create = useCreateService();
  const update = useUpdateService();
  const del = useDeleteService();

  const [editing, setEditing] = useState<ServiceEditing | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  const categoryById = useMemo(() => {
    const m = new Map<string, ServiceCategory>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  // Группировка как на вебе: по category_id, неизвестные/пустые — в
  // «Без категории» (мягко удалённая категория тоже падает сюда).
  const grouped = useMemo(() => {
    const groups = new Map<string, Service[]>();
    for (const s of services) {
      const key = s.category_id && categoryById.has(s.category_id)
        ? s.category_id
        : "uncategorized";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }
    return Array.from(groups.entries());
  }, [services, categoryById]);

  const teamById = useMemo(
    () => new Map(teams.map((tm) => [tm.id, tm])),
    [teams],
  );

  const alertError = (e: unknown) =>
    Alert.alert("Ошибка", e instanceof Error ? e.message : "Не удалось сохранить");

  const handleSave = async (
    draft: {
      name: string;
      price: number;
      duration_minutes: number;
      category_id: string | null;
      color: string;
      brigade_ids: string[];
    },
    serviceId?: string,
  ) => {
    try {
      if (serviceId) {
        await update.mutateAsync({ id: serviceId, patch: draft });
      } else {
        await create.mutateAsync(draft);
      }
      setEditing(null);
      toast("Услуга сохранена");
    } catch (e) {
      alertError(e); // шит остаётся открытым
    }
  };

  const handleDelete = (id: string) => {
    Alert.alert("Удалить услугу?", "Услуга будет скрыта из списков.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: async () => {
          try {
            await del.mutateAsync(id);
            setEditing(null);
          } catch (e) {
            alertError(e);
          }
        },
      },
    ]);
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title="Услуги"
        subtitle={
          services.length
            ? `${formatCountRu(services.length, FORMS_USLUGA)} в ${formatCountRu(categories.length, FORMS_KATEGORIYA)}`
            : undefined
        }
      />

      {isLoading ? (
        <EmptyState state="loading" fill />
      ) : isError ? (
        <EmptyState
          fill
          state="error"
          title="Не удалось загрузить услуги"
          action={{ label: "Повторить", onPress: () => void refetch() }}
        />
      ) : (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
          {/* Управление категориями — вход в отдельный шит (web: collapse). */}
          <SectionCard>
            <Pressable
              onPress={() => setCategoriesOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Категории услуг"
              className="flex-row items-center px-4 py-3.5 active:opacity-60"
            >
              <Settings2 color={t.sub} size={ICON.sm} />
              <Text className="ml-3 flex-1 text-base" style={{ color: t.ink }}>
                Категории услуг ({categories.length})
              </Text>
              <ChevronRight color={t.chevron} size={ICON.sm} />
            </Pressable>
          </SectionCard>

          {services.length === 0 ? (
            <EmptyState
              icon={<Scissors color={t.accent} size={28} />}
              title="Пока нет услуг"
              subtitle="Услуга — это то, что продаёте: чистка, диагностика, выезд. Цена и длительность подставятся в запись автоматически."
              action={{
                label: "Создать первую услугу",
                onPress: () => setEditing({ mode: "create" }),
              }}
            />
          ) : (
            <>
            {grouped.map(([catKey, list]) => {
              const cat = categoryById.get(catKey);
              return (
                <SectionCard key={catKey}>
                  <View className="flex-row items-center px-4 pb-1 pt-3">
                    {cat ? (
                      <View
                        style={{
                          height: 10,
                          width: 10,
                          borderRadius: 5,
                          marginRight: 8,
                          backgroundColor: cat.color ?? t.faint,
                        }}
                      />
                    ) : null}
                    <Text
                      className="text-[11px] font-bold uppercase tracking-wider"
                      style={{ color: t.faint }}
                    >
                      {cat?.name ?? "Без категории"} ({list.length})
                    </Text>
                  </View>
                  {list.map((s, i) => {
                    const brigades = serviceBrigadeIds(s);
                    return (
                      <View key={s.id}>
                        {i > 0 ? <Divider inset={24} /> : null}
                        <Pressable
                          onPress={() => setEditing({ mode: "edit", service: s })}
                          accessibilityRole="button"
                          accessibilityLabel={`Услуга ${s.name}, редактировать`}
                          className="flex-row items-center px-4 py-3 active:opacity-60"
                        >
                          <View
                            style={{
                              width: 4,
                              height: 36,
                              borderRadius: 2,
                              backgroundColor: s.color || t.faint,
                            }}
                          />
                          <View className="ml-3 flex-1 pr-2">
                            <Text
                              className="text-base font-semibold"
                              style={{ color: t.ink }}
                              numberOfLines={1}
                            >
                              {s.name}
                            </Text>
                            <Text className="text-sm" style={{ color: t.sub }}>
                              {s.duration_minutes} мин
                              {brigades.length > 0
                                ? ` · ${brigades
                                    .map((id) => teamById.get(id)?.name)
                                    .filter(Boolean)
                                    .join(", ")}`
                                : ""}
                            </Text>
                          </View>
                          <Text
                            className="tabular-nums text-base font-semibold"
                            style={{ color: t.ink }}
                          >
                            {formatEUR(Number(s.price))}
                          </Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </SectionCard>
              );
            })}
            {/* Стандарт «Добавить»: строка под последним элементом списка. */}
            <SectionCard>
              <AddRow
                label="Добавить услугу"
                onPress={() => setEditing({ mode: "create" })}
              />
            </SectionCard>
            </>
          )}
        </ScrollView>
      )}

      <ServiceSheet
        editing={editing}
        categories={categories}
        teams={teams.map((tm) => ({
          id: tm.id,
          name: tm.name,
          color: tm.color ?? t.accent,
        }))}
        busy={create.isPending || update.isPending || del.isPending}
        onClose={() => setEditing(null)}
        onSave={handleSave}
        onDelete={handleDelete}
      />

      <CategoriesSheet
        open={categoriesOpen}
        categories={categories}
        onClose={() => setCategoriesOpen(false)}
      />
    </Screen>
  );
}

// ─── Редактор услуги ─────────────────────────────────────────────────
function ServiceSheet({
  editing,
  categories,
  teams,
  busy,
  onClose,
  onSave,
  onDelete,
}: {
  editing: ServiceEditing | null;
  categories: ServiceCategory[];
  teams: { id: string; name: string; color: string }[];
  busy: boolean;
  onClose: () => void;
  onSave: (
    draft: {
      name: string;
      price: number;
      duration_minutes: number;
      category_id: string | null;
      color: string;
      brigade_ids: string[];
    },
    serviceId?: string,
  ) => void;
  onDelete: (id: string) => void;
}) {
  const t = useThemeColors();
  const service = editing?.mode === "edit" ? editing.service : null;

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [duration, setDuration] = useState("60");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [color, setColor] = useState(DEFAULT_SERVICE_COLOR);
  const [brigadeIds, setBrigadeIds] = useState<string[]>([]);
  const [seeded, setSeeded] = useState<ServiceEditing | null>(null);

  if (editing !== seeded) {
    // Новый показ шита — засеять поля от услуги (render-time reset).
    setSeeded(editing);
    setName(service?.name ?? "");
    setPrice(service ? String(Number(service.price)) : "");
    setDuration(service ? String(service.duration_minutes) : "60");
    setCategoryId(service?.category_id ?? null);
    setColor(service?.color || DEFAULT_SERVICE_COLOR);
    setBrigadeIds(service ? serviceBrigadeIds(service) : []);
  }

  const canSubmit = name.trim().length > 0 && !busy;
  const toggleBrigade = (id: string) =>
    setBrigadeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  return (
    <Modal
      visible={editing !== null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="flex-1 justify-end" style={{ backgroundColor: t.scrim }}>
          <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Закрыть" />
          <View
            className="max-h-[88%] rounded-t-3xl"
            style={{ backgroundColor: t.surface }}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: 20, paddingBottom: 32 }}
            >
              <Text className="mb-3 text-lg font-bold" style={{ color: t.ink }}>
                {service ? "Услуга" : "Новая услуга"}
              </Text>

              <Field
                label="Название"
                value={name}
                onChangeText={setName}
                placeholder="Чистка кондиционера"
                autoFocus={!service}
              />
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Field
                    label="Цена €"
                    value={price}
                    onChangeText={setPrice}
                    placeholder="0"
                    keyboardType="decimal-pad"
                  />
                </View>
                <View className="flex-1">
                  <Field
                    label="Минут"
                    value={duration}
                    onChangeText={setDuration}
                    placeholder="60"
                    keyboardType="number-pad"
                  />
                </View>
              </View>

              {categories.length > 0 ? (
                <>
                  <Text className="mb-2 text-xs font-medium" style={{ color: t.sub }}>
                    Категория
                  </Text>
                  <View className="mb-4 flex-row flex-wrap gap-2">
                    <Chip
                      label="Без категории"
                      radio
                      selected={categoryId === null}
                      onPress={() => setCategoryId(null)}
                    />
                    {categories.map((c) => (
                      <Chip
                        key={c.id}
                        label={c.name}
                        radio
                        selected={categoryId === c.id}
                        onPress={() => setCategoryId(c.id)}
                        accessibilityLabel={`Категория ${c.name}`}
                        icon={
                          <View
                            style={{
                              height: 8,
                              width: 8,
                              borderRadius: 4,
                              backgroundColor: c.color ?? t.faint,
                            }}
                          />
                        }
                      />
                    ))}
                  </View>
                </>
              ) : null}

              <ColorPicker value={color} onChange={setColor} label="Цвет на календаре" />

              {teams.length > 0 ? (
                <>
                  <Text className="mb-2 text-xs font-medium" style={{ color: t.sub }}>
                    Команды, которые делают (пусто = все)
                  </Text>
                  <View className="mb-4 flex-row flex-wrap gap-2">
                    {teams.map((tm) => {
                      const active = brigadeIds.includes(tm.id);
                      return (
                        <Chip
                          key={tm.id}
                          label={tm.name}
                          variant="tint"
                          color={tm.color ?? undefined}
                          selected={active}
                          onPress={() => toggleBrigade(tm.id)}
                          accessibilityLabel={`Команда ${tm.name}`}
                          icon={
                            active ? (
                              <Check color={tm.color} size={ICON.xs} />
                            ) : null
                          }
                        />
                      );
                    })}
                  </View>
                </>
              ) : null}

              <Button
                label={service ? "Сохранить" : "Создать"}
                onPress={() =>
                  onSave(
                    {
                      name: name.trim(),
                      price: Number(price.replace(",", ".")) || 0,
                      duration_minutes: Number(duration) || 60,
                      category_id: categoryId,
                      color,
                      brigade_ids: brigadeIds,
                    },
                    service?.id,
                  )
                }
                disabled={!canSubmit}
                loading={busy}
              />
              {service ? (
                <Pressable
                  onPress={() => onDelete(service.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Удалить услугу"
                  className="mt-1 items-center py-3 active:opacity-70"
                >
                  <Text style={{ fontSize: 16, fontWeight: "500", color: t.danger }}>
                    Удалить
                  </Text>
                </Pressable>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Категории: список + мини-редактор ───────────────────────────────
function CategoriesSheet({
  open,
  categories,
  onClose,
}: {
  open: boolean;
  categories: ServiceCategory[];
  onClose: () => void;
}) {
  const t = useThemeColors();
  const createCat = useCreateServiceCategory();
  const updateCat = useUpdateServiceCategory();
  const deleteCat = useDeleteServiceCategory();

  // null = список; { id: null } = новая; { id } = редактирование.
  const [form, setForm] = useState<{ id: string | null } | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0].value);

  const busy = createCat.isPending || updateCat.isPending || deleteCat.isPending;

  const alertError = (e: unknown) =>
    Alert.alert("Ошибка", e instanceof Error ? e.message : "Не удалось сохранить");

  const openForm = (cat?: ServiceCategory) => {
    setForm({ id: cat?.id ?? null });
    setName(cat?.name ?? "");
    setColor(cat?.color ?? PRESET_COLORS[categories.length % PRESET_COLORS.length].value);
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      if (form?.id) {
        await updateCat.mutateAsync({ id: form.id, patch: { name: trimmed, color } });
      } else {
        await createCat.mutateAsync({ name: trimmed, color });
      }
      setForm(null);
    } catch (e) {
      alertError(e);
    }
  };

  const remove = (cat: ServiceCategory) => {
    Alert.alert(
      `Удалить категорию «${cat.name}»?`,
      "Услуги не удалятся — они станут «без категории».",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteCat.mutateAsync(cat.id);
              setForm(null);
            } catch (e) {
              alertError(e);
            }
          },
        },
      ],
    );
  };

  const close = () => {
    setForm(null);
    onClose();
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          className="flex-1"
          style={{ backgroundColor: t.scrim }}
          onPress={close}
          accessibilityLabel="Закрыть"
        />
        <View className="rounded-t-3xl p-5 pb-8" style={{ backgroundColor: t.surface }}>
          <Text className="mb-3 text-lg font-bold" style={{ color: t.ink }}>
            {form ? (form.id ? "Категория" : "Новая категория") : "Категории услуг"}
          </Text>

          {form ? (
            <>
              <Field
                label="Название"
                value={name}
                onChangeText={setName}
                placeholder="Кондиционеры, Уборка…"
                autoFocus
              />
              <ColorPicker value={color} onChange={setColor} />
              <Button
                label={form.id ? "Сохранить" : "Создать"}
                onPress={() => void submit()}
                disabled={!name.trim() || busy}
                loading={busy}
              />
              {form.id ? (
                <Pressable
                  onPress={() => {
                    const cat = categories.find((c) => c.id === form.id);
                    if (cat) remove(cat);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Удалить категорию"
                  className="mt-1 items-center py-3 active:opacity-70"
                >
                  <Text style={{ fontSize: 16, fontWeight: "500", color: t.danger }}>
                    Удалить
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => setForm(null)}
                accessibilityRole="button"
                accessibilityLabel="Назад к списку категорий"
                className="items-center py-2 active:opacity-70"
              >
                <Text style={{ fontSize: 15, color: t.sub }}>К списку</Text>
              </Pressable>
            </>
          ) : (
            <>
              {categories.length === 0 ? (
                <Text className="mb-3 text-sm" style={{ color: t.sub }}>
                  Категории группируют услуги в списке и в записи. Например:
                  «Кондиционеры», «Вентиляция».
                </Text>
              ) : (
                categories.map((c, i) => (
                  <View key={c.id}>
                    {i > 0 ? <Divider /> : null}
                    <Pressable
                      onPress={() => openForm(c)}
                      accessibilityRole="button"
                      accessibilityLabel={`Категория ${c.name}, редактировать`}
                      className="flex-row items-center py-3 active:opacity-60"
                    >
                      <View
                        style={{
                          height: 12,
                          width: 12,
                          borderRadius: 6,
                          backgroundColor: c.color ?? t.faint,
                        }}
                      />
                      <Text className="ml-3 flex-1 text-base" style={{ color: t.ink }}>
                        {c.name}
                      </Text>
                      <ChevronRight color={t.chevron} size={ICON.sm} />
                    </Pressable>
                  </View>
                ))
              )}
              <View className="mt-3">
                <Button label="Новая категория" onPress={() => openForm()} />
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
