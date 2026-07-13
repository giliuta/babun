// Client detail card — COMPOSER (mobile port of the web ClientCardPage,
// «Карта-диспетчер» LOCKED design).
//
// This screen does ALL data wiring; the blocks are presentational. It
// fetches the client + its appointments, computes the shared `stats`
// (client-stats selector) and `serviceDue` (service-due selector), then
// renders in the web ClientCardPage order:
//
//   ClientHeader (list-tile) · ClientNextJob (hero) · CardActions (5)
//   · ServiceBlock («Обслуживание» spine, hero unit de-duped)
//   · ObjectsBlock (equipment-first)
//   · collapsed reference: Visits · Finance · Notes · Attachments
//     · Contacts · Personal · Meta
//
// СОЗДАНИЕ = ЭТА ЖЕ СТРАНИЦА (решение владельца 2026-07-13, LOCKED
// client-app.html «new» mode): роут /clients/new попадает сюда с
// id="new" → карточка работает с ЧЕРНОВИКОМ (createBlankClient) через
// локальный update; шапка в порядке создания — ТЕЛЕФОН первичен
// (пикер страны + live-дедуп по phone_e164, clients-99 F1.5/F2.7), имя
// вторично. «Готово» создаёт клиента и router.replace приводит на этот
// же экран уже с сервера. Блоки-ДЕЙСТВИЯ (hero, 5 кнопок, ТО,
// вложения) до сохранения скрыты — им нужен реальный id; блоки-ДАННЫЕ
// (объекты, заметки, контакты, личное, мета) работают с черновиком,
// так что всё внесённое до «Готово» сохраняется одним créate.
//
// A top chrome row owns the back button + a ⋯ action menu (message via
// Linking sms:, share via RN Share, blacklist toggle via update) — the
// blocks stay free of screen-level concerns.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Check, ChevronLeft, MoreHorizontal } from "lucide-react-native";
import {
  createBlankClient,
  type Client,
} from "@babun/shared/local/clients";
import { findClientByPhoneE164 } from "@babun/shared/db/repositories/clients";
import { buildStats } from "@babun/shared/local/selectors/client-stats";
import { buildServiceDue } from "@babun/shared/local/selectors/service-due";
import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { useThemeColors } from "@/theme/colors";
import {
  useClient,
  useClientTags,
  useCreateClient,
  useDeleteClients,
  useUpdateClient,
} from "@/features/clients/queries";
import { useClientAppointments } from "@/features/clients/appointments";
import {
  countryDialCode,
  countryFlag,
  countryFromDialPrefix,
  DEFAULT_COUNTRY,
  formatPhoneAsYouType,
  tryToE164,
} from "@/features/clients/phone";
import { useServices } from "@/features/services/queries";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import ClientHeader from "@/features/clients/ClientHeader";
import ClientNextJob from "@/features/clients/ClientNextJob";
import CardActions from "@/features/clients/card-actions";
import ServiceBlock from "@/features/clients/blocks/ServiceBlock";
import ObjectsBlock from "@/features/clients/blocks/ObjectsBlock";
import VisitsBlock from "@/features/clients/blocks/VisitsBlock";
import FinanceBlock from "@/features/clients/blocks/FinanceBlock";
import AttachmentsBlock from "@/features/clients/blocks/AttachmentsBlock";
import ContactsBlock from "@/features/clients/blocks/ContactsBlock";
import NotesBlock from "@/features/clients/blocks/NotesBlock";
import PersonalBlock from "@/features/clients/blocks/PersonalBlock";
import MetaBlock from "@/features/clients/blocks/MetaBlock";

export default function ClientDetailScreen() {
  const t = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const tenantId = useTenantId();

  // «new» → черновик без запросов; иначе обычная карточка с сервера.
  const isDraft = id === "new";
  const { data: client, isLoading } = useClient(isDraft ? "" : id);
  const updateClient = useUpdateClient(isDraft ? "" : id);
  const deleteClients = useDeleteClients();
  const create = useCreateClient();
  const { data: appointments = [] } = useClientAppointments(isDraft ? "" : id);
  const { data: tags = [] } = useClientTags();
  // Web parity: VisitsBlock resolves service NAMES from the catalog.
  const { data: services = [] } = useServices();

  const [menuOpen, setMenuOpen] = useState(false);

  // ── Draft (create) state ───────────────────────────────────────────
  // Телефон предзаполнен кодом страны по умолчанию — код РЕДАКТИРУЕТСЯ
  // прямо в поле (решение владельца: не пикер): стёр «+357», написал
  // «+49…» — страна распозналась сама (countryFromDialPrefix), флаг
  // рядом с полем подстраивается. Локальный формат без «+» продолжает
  // считаться страной по умолчанию.
  const [draft, setDraft] = useState<Client>(() =>
    createBlankClient({ phone: `${countryDialCode(DEFAULT_COUNTRY)} ` }),
  );
  const [duplicate, setDuplicate] = useState<Client | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const e164 = isDraft ? tryToE164(draft.phone.trim(), DEFAULT_COUNTRY) : null;
  const draftCountry = isDraft
    ? (countryFromDialPrefix(draft.phone) ??
      (draft.phone.trim() && !draft.phone.trim().startsWith("+")
        ? DEFAULT_COUNTRY
        : undefined))
    : undefined;

  // Live-дедуп телефона (debounce + sequence guard) — как в старом
  // /clients/new, clients-99 F1.5.
  const seq = useRef(0);
  useEffect(() => {
    if (!isDraft) return;
    const mySeq = ++seq.current;
    if (!e164 || !tenantId) {
      setDuplicate(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const existing = await findClientByPhoneE164(supabase, e164, tenantId);
        if (seq.current === mySeq) setDuplicate(existing ?? null);
      } catch {
        // Network blip — the DB unique index is the ultimate guarantee.
        if (seq.current === mySeq) setDuplicate(null);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [isDraft, e164, tenantId]);

  // Единый persist-путь для блоков: черновик — локально, карточка — PATCH.
  const update = (patch: Partial<Client>) =>
    isDraft
      ? setDraft((d) => ({ ...d, ...patch }))
      : updateClient.mutate(patch);

  // Объект, который видят блоки (черновик или серверная строка).
  const c: Client | undefined = isDraft ? draft : client ?? undefined;

  // Shared selectors — memoized so unrelated state changes don't re-scan
  // every appointment. Hooks must run unconditionally, hence the guards
  // before the early returns below.
  const stats = useMemo(
    () => (c ? buildStats(c, appointments) : undefined),
    [c, appointments],
  );
  const serviceDue = useMemo(
    () => buildServiceDue(c ?? { locations: [] }),
    [c],
  );

  // The unit the NEXT-JOB hero already names — the «Обслуживание» spine
  // drops it so the same overdue/soon fact never appears twice (web
  // ClientCardPage parity: one home per fact).
  const heroUnitId = useMemo(() => {
    if (stats?.nextApt) return null;
    return serviceDue.overdue[0]?.unitId ?? serviceDue.soon[0]?.unitId ?? null;
  }, [serviceDue, stats]);

  // ── Create («Готово») — save-gate по телефону. Поле предзаполнено
  // кодом страны, поэтому «непустое» — не критерий: требуем либо валидный
  // E.164, либо ≥5 цифр (короткий локальный формат).
  const draftDigits = isDraft ? draft.phone.replace(/\D/g, "").length : 0;
  const canSave =
    isDraft && (e164 !== null || draftDigits >= 5) && !create.isPending;

  async function handleCreate() {
    if (!canSave) return;
    setCreateError(null);
    const trimmedPhone = draft.phone.trim();

    // Debounce мог не успеть (быстрый ввод → сразу Готово): проверяем
    // один раз здесь; при видимом баннере Готово форс-создаёт (web parity).
    if (e164 && !duplicate && tenantId) {
      try {
        const existing = await findClientByPhoneE164(supabase, e164, tenantId);
        if (existing) {
          setDuplicate(existing);
          return;
        }
      } catch {
        // Network blip — let the save proceed; the DB unique index is
        // the ultimate guarantee (web parity).
      }
    }

    try {
      const created = await create.mutateAsync({
        ...draft,
        phone: trimmedPhone,
        full_name: draft.full_name.trim(),
        phone_e164: e164,
      });
      // «Максимально просто» (владелец): без промежуточного диалога —
      // черновик заменяется той же страницей, уже привязанной к серверу.
      // «Записать» тут же ждёт первым hero-действием карточки, так что
      // диспетчерский сценарий остаётся в один тап, но не навязан.
      router.replace(`/clients/${created.id}`);
    } catch (e) {
      setCreateError((e as Error).message);
    }
  }

  if (!isDraft && isLoading) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!c) {
    return (
      <Screen className="items-center justify-center px-6">
        <Text className="mb-3 text-sm" style={{ color: t.sub }}>
          Клиент не найден
        </Text>
        <Pressable
          onPress={() => router.back()}
          className="rounded-xl px-4 py-2 active:opacity-80"
          style={{ backgroundColor: t.accent }}
        >
          <Text className="font-semibold" style={{ color: t.onAccent }}>
            ← К списку
          </Text>
        </Pressable>
      </Screen>
    );
  }

  const phoneDigits = c.phone?.replace(/\D/g, "") ?? "";

  const onMessage = () => {
    setMenuOpen(false);
    if (phoneDigits) Linking.openURL(`sms:${phoneDigits}`);
  };

  const onShare = async () => {
    setMenuOpen(false);
    const lines = [
      c.full_name || "Клиент",
      c.phone || "",
      c.locations?.find((l) => l.isPrimary)?.address ??
        c.locations?.[0]?.address ??
        "",
    ].filter(Boolean);
    try {
      await Share.share({ message: lines.join("\n") });
    } catch {
      // user dismissed the share sheet — no-op.
    }
  };

  const onToggleBlacklist = () => {
    setMenuOpen(false);
    update({ blacklisted: !c.blacklisted });
  };

  // Web parity: ClientCardPage ⋯ «Удалить клиента» → confirm → hard delete
  // (useDeleteClients) → back to the list. Destructive style on both buttons.
  const onDelete = () => {
    setMenuOpen(false);
    Alert.alert(
      "Удалить клиента?",
      "Клиент и вся его история будут удалены безвозвратно.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: () =>
            deleteClients.mutate([c.id], {
              onSuccess: (res) => {
                if (res.deleted > 0) router.back();
              },
            }),
        },
      ],
    );
  };

  return (
    <Screen edges={["top"]}>
      {/* Chrome: back + title + (⋯ menu | save-gated «Готово») */}
      <View
        className="flex-row items-center border-b px-2 py-2"
        style={{ borderColor: t.separator }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          className="h-9 w-9 items-center justify-center rounded-lg active:opacity-60"
          accessibilityLabel="Назад"
        >
          <ChevronLeft color={t.body} size={22} />
        </Pressable>
        <Text
          className="flex-1 text-base font-semibold"
          style={{ color: t.ink }}
        >
          {isDraft ? "Новый клиент" : "Клиент"}
        </Text>
        {isDraft ? (
          <Pressable
            onPress={handleCreate}
            disabled={!canSave}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Готово — сохранить клиента"
            accessibilityState={{ disabled: !canSave }}
            className="h-9 items-center justify-center rounded-lg px-2 active:opacity-60"
          >
            <Text
              className="text-[15px] font-semibold"
              style={{ color: canSave ? t.accent : t.faint }}
            >
              {create.isPending ? "Сохраняю…" : "Готово"}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => setMenuOpen((v) => !v)}
            className="h-9 w-9 items-center justify-center rounded-lg active:opacity-60"
            accessibilityLabel="Ещё"
          >
            <MoreHorizontal color={t.body} size={22} />
          </Pressable>
        )}
      </View>

      {/* Lightweight action sheet (no extra deps) */}
      {menuOpen ? (
        <>
          <Pressable
            onPress={() => setMenuOpen(false)}
            className="absolute inset-0 z-10"
          />
          <View
            className="absolute right-3 top-12 z-20 w-52 overflow-hidden rounded-xl shadow-lg"
            style={{ backgroundColor: t.surface }}
          >
            <MenuItem
              label="Написать SMS"
              onPress={onMessage}
              disabled={!phoneDigits}
            />
            <View className="h-px" style={{ backgroundColor: t.separator }} />
            <MenuItem label="Поделиться" onPress={onShare} />
            <View className="h-px" style={{ backgroundColor: t.separator }} />
            <MenuItem
              label={
                c.blacklisted
                  ? "Убрать из чёрного списка"
                  : "В чёрный список"
              }
              onPress={onToggleBlacklist}
              danger={!c.blacklisted}
            />
            <View className="h-px" style={{ backgroundColor: t.separator }} />
            <MenuItem label="Удалить клиента" onPress={onDelete} danger />
          </View>
        </>
      ) : null}

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        {isDraft ? (
          // Шапка создания в порядке карточки (решение владельца
          // 2026-07-13): ИМЯ первой строкой — крупно, как заголовок
          // готовой карточки; ТЕЛЕФОН второй, с автофокусом. Код страны
          // не пикер: он часть номера, редактируется прямо в поле, флаг
          // подстраивается под набранный «+код».
          <Card style={{ marginHorizontal: 12, marginTop: 8, padding: 12 }}>
            <TextInput
              value={draft.full_name}
              onChangeText={(v) => setDraft((d) => ({ ...d, full_name: v }))}
              placeholder="Имя (можно позже)"
              placeholderTextColor={t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance={t.dark ? "dark" : "light"}
              accessibilityLabel="Имя клиента"
              className="min-h-[44px] py-1 text-xl font-bold"
              style={{ color: t.ink }}
            />
            <View className="flex-row items-center gap-2">
              {draftCountry ? (
                <Text className="text-lg" accessibilityLabel={`Страна: ${draftCountry}`}>
                  {countryFlag(draftCountry)}
                </Text>
              ) : null}
              <TextInput
                value={draft.phone}
                // Живое форматирование по маске страны (+357 99 123 456).
                // При УДАЛЕНИИ (новая строка короче) не переформатируем —
                // иначе AsYouType тут же возвращал бы стёртый пробел и
                // backspace «залипал». Сброс дубля на каждый ввод: стейл-
                // баннер иначе отключал бы дедуп-проверку в handleCreate.
                onChangeText={(v) => {
                  setDraft((d) => ({
                    ...d,
                    phone:
                      v.length < d.phone.length ? v : formatPhoneAsYouType(v),
                  }));
                  setDuplicate(null);
                }}
                placeholder="Телефон"
                placeholderTextColor={t.placeholder}
                selectionColor={t.accent}
                keyboardAppearance={t.dark ? "dark" : "light"}
                keyboardType="phone-pad"
                autoFocus
                accessibilityLabel="Телефон клиента"
                className="min-h-[44px] flex-1 py-1 text-[17px] font-semibold"
                style={{ color: t.ink, fontVariant: ["tabular-nums"] }}
              />
              {e164 ? (
                <Check color={t.accent} size={20} strokeWidth={2.5} />
              ) : null}
            </View>

            {/* Inline dedup — «Открыть» существующего вместо дубля */}
            {duplicate ? (
              <View
                className="mt-2 border-t pt-2.5"
                style={{ borderColor: t.separator }}
              >
                <Text
                  className="pb-2 text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: t.sub }}
                >
                  Похоже, такой уже есть
                </Text>
                <View className="flex-row items-center gap-3">
                  <View className="flex-1">
                    <Text
                      className="text-sm font-semibold"
                      style={{ color: t.ink }}
                      numberOfLines={1}
                    >
                      {duplicate.full_name || duplicate.phone || "Клиент"}
                    </Text>
                    <Text className="text-xs" style={{ color: t.sub }} numberOfLines={1}>
                      {[duplicate.phone, duplicate.city].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => router.replace(`/clients/${duplicate.id}`)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Открыть существующего клиента"
                    className="rounded-xl px-3.5 py-2 active:opacity-80"
                    style={{ backgroundColor: t.accent }}
                  >
                    <Text className="text-sm font-semibold" style={{ color: t.onAccent }}>
                      Открыть
                    </Text>
                  </Pressable>
                </View>
                <Text className="pt-2 text-[11px]" style={{ color: t.faint }}>
                  «Готово» всё равно создаст нового с этим номером.
                </Text>
              </View>
            ) : null}

            {createError ? (
              <Text className="pt-2 text-sm" style={{ color: t.danger }}>
                {createError}
              </Text>
            ) : null}
          </Card>
        ) : (
          <ClientHeader
            client={c}
            appointments={appointments}
            stats={stats}
            update={update}
          />
        )}

        {/* Действия существующего клиента — hero, 5 кнопок, ТО и вложения
            требуют реального id; в черновике их нет, данные-блоки ниже
            работают с черновиком и сохраняются одним «Готово». */}
        {!isDraft ? (
          <>
            <ClientNextJob
              client={c}
              appointments={appointments}
              stats={stats}
              serviceDue={serviceDue}
            />
            <CardActions client={c} stats={stats} update={update} />
            <ServiceBlock
              client={c}
              stats={stats}
              serviceDue={serviceDue}
              excludeUnitId={heroUnitId}
            />
          </>
        ) : null}
        <ObjectsBlock
          client={c}
          appointments={appointments}
          stats={stats}
          update={update}
        />
        <VisitsBlock
          appointments={appointments}
          services={services}
          stats={stats}
        />
        <FinanceBlock appointments={appointments} stats={stats} />
        <NotesBlock client={c} update={update} />
        {!isDraft ? <AttachmentsBlock clientId={c.id} /> : null}
        <ContactsBlock client={c} update={update} />
        <PersonalBlock client={c} update={update} />
        <MetaBlock client={c} update={update} tags={tags} />
      </ScrollView>
      </KeyboardAvoidingView>

    </Screen>
  );
}

function MenuItem({
  label,
  onPress,
  disabled,
  danger,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`px-4 py-3 active:opacity-60 ${disabled ? "opacity-40" : ""}`}
    >
      <Text
        className="text-sm font-medium"
        style={{ color: danger ? t.danger : t.ink }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
