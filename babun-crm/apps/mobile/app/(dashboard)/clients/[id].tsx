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
// A top chrome row owns the back button + a ⋯ action menu (message via
// Linking sms:, share via RN Share, blacklist toggle via update) — the
// blocks stay free of screen-level concerns.

import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, MoreHorizontal } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import { buildStats } from "@babun/shared/local/selectors/client-stats";
import { buildServiceDue } from "@babun/shared/local/selectors/service-due";
import { Screen } from "@/components/ui/Screen";
import { useThemeColors } from "@/theme/colors";
import {
  useClient,
  useClientTags,
  useUpdateClient,
} from "@/features/clients/queries";
import { useClientAppointments } from "@/features/clients/appointments";
import { useServices } from "@/features/services/queries";
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

  const { data: client, isLoading } = useClient(id);
  const updateClient = useUpdateClient(id);
  const { data: appointments = [] } = useClientAppointments(id);
  const { data: tags = [] } = useClientTags();
  // Web parity: VisitsBlock resolves service NAMES from the catalog.
  const { data: services = [] } = useServices();

  const [menuOpen, setMenuOpen] = useState(false);

  // Single persist path for every block (mirrors the web blocks' update()).
  const update = (patch: Partial<Client>) => updateClient.mutate(patch);

  // Shared selectors — port-as-is, memoized so unrelated state changes
  // (menu open, mutation responses) don't re-scan every appointment.
  // Hooks must run unconditionally, hence the guards before the early
  // returns below.
  const stats = useMemo(
    () => (client ? buildStats(client, appointments) : undefined),
    [client, appointments],
  );
  const serviceDue = useMemo(
    () => buildServiceDue(client ?? { locations: [] }),
    [client],
  );

  // The unit the NEXT-JOB hero already names — the «Обслуживание» spine
  // drops it so the same overdue/soon fact never appears twice (web
  // ClientCardPage parity: one home per fact).
  const heroUnitId = useMemo(() => {
    if (stats?.nextApt) return null;
    return serviceDue.overdue[0]?.unitId ?? serviceDue.soon[0]?.unitId ?? null;
  }, [serviceDue, stats]);

  if (isLoading) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!client) {
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

  const phoneDigits = client.phone?.replace(/\D/g, "") ?? "";

  const onMessage = () => {
    setMenuOpen(false);
    if (phoneDigits) Linking.openURL(`sms:${phoneDigits}`);
  };

  const onShare = async () => {
    setMenuOpen(false);
    const lines = [
      client.full_name || "Клиент",
      client.phone || "",
      client.locations?.find((l) => l.isPrimary)?.address ??
        client.locations?.[0]?.address ??
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
    update({ blacklisted: !client.blacklisted });
  };

  return (
    <Screen edges={["top"]}>
      {/* Chrome: back + title + ⋯ menu */}
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
          Клиент
        </Text>
        <Pressable
          onPress={() => setMenuOpen((v) => !v)}
          className="h-9 w-9 items-center justify-center rounded-lg active:opacity-60"
          accessibilityLabel="Ещё"
        >
          <MoreHorizontal color={t.body} size={22} />
        </Pressable>
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
                client.blacklisted
                  ? "Убрать из чёрного списка"
                  : "В чёрный список"
              }
              onPress={onToggleBlacklist}
              danger={!client.blacklisted}
            />
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
        <ClientHeader
          client={client}
          appointments={appointments}
          stats={stats}
          update={update}
        />
        <ClientNextJob
          client={client}
          appointments={appointments}
          stats={stats}
          serviceDue={serviceDue}
        />
        <CardActions client={client} stats={stats} update={update} />
        <ServiceBlock
          client={client}
          stats={stats}
          serviceDue={serviceDue}
          excludeUnitId={heroUnitId}
        />
        <ObjectsBlock
          client={client}
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
        <NotesBlock client={client} update={update} />
        <AttachmentsBlock clientId={client.id} />
        <ContactsBlock client={client} update={update} />
        <PersonalBlock client={client} update={update} />
        <MetaBlock client={client} update={update} tags={tags} />
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
