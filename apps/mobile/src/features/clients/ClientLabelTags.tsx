import { useEffect, useMemo, useState } from "react";
import { useRouter, type Href } from "expo-router";
import { Pressable, View } from "react-native";
import { Bookmark, Settings2, Tags } from "lucide-react-native";
import type { Client, ClientTag } from "@babun/shared/local/clients";
import type { Appointment } from "@babun/shared/local/appointments";
import { getAvatarColor } from "@babun/shared/common/utils/avatar-color";
import { IdentityCard } from "@/components/blocks/TeamLabelRow";
import { GUTTER, ICON } from "@/components/ui/tokens";
import { LabelPickerSheet } from "@/features/reference/LabelPickerSheet";
import { TagPickerSheet } from "@/features/clients/TagPickerSheet";
import { useJsonArrayWriter } from "@/features/clients/use-json-writer";
import { tagsOfferedFor } from "@/features/clients/picker-tags";
import { labelsOfferedFor, servingTeamIds } from "@/features/clients/serving-teams";
import { useArchivedTeamIds } from "@/features/clients/use-archived-teams";
import { useReferenceHref } from "@/lib/reference-href";
import { useSheetDoorway } from "@/components/ui/use-sheet-doorway";
import { useCities } from "@/features/reference/queries";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { useClientSettingsDoor } from "@/features/clients/use-settings-door";

// МЕТКА И ТЕГИ КЛИЕНТА — ДВУМЯ ПЛИТКАМИ, КАК «КОМАНДА | МЕТКА» В ЗАПИСИ
// Та же `IdentityCard`, что в шапке записи: белая карточка,
// плитка цвета значения, пустое — кружок-приглашение акцентом.
//
// МЕТКА ЗАХОДИТ САМА. Запись в день с меткой переносит её на клиента, пока
// её не выбрали руками (`label-auto-assign.ts`, `city_manual`). Такая метка
// читается тише и подписана «по записи» — чтобы отличать от выбранной.
// Снять выбранную — тап по активной в листе: клиент возвращается в авто.

export function ClientLabelTags({
  client,
  appointments,
  update,
  tags,
  readOnly,
  tagReadOnly,
  labelOn = true,
  tagOn = true,
}: {
  /** Блоки «Метка» и «Тег» — у команды раздельно. */
  labelOn?: boolean;
  tagOn?: boolean;
  client: Client;
  /** Записи клиента: их команды — тоже обслуживающие календари. */
  appointments: readonly Pick<Appointment, "team_id" | "client_id" | "status">[];
  update: (patch: Partial<Client>) => Promise<boolean> | void;
  /** Каталог тегов компании (Кабинет → «Теги клиентов»). */
  tags: ClientTag[];
  /** Нет права менять метку — её плитка только читается. */
  readOnly?: boolean;
  /** Своё «только читать» у тега: у метки и тега разные выключатели команды,
   *  и выключенная метка не должна запирать тег. Нет — как метка. */
  tagReadOnly?: boolean;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const { data: cities = [] } = useCities();
  // ВАРИАНТЫ — ТОЛЬКО ОБСЛУЖИВАЮЩИХ КАЛЕНДАРЕЙ (`serving-teams.ts`): своя
  // команда клиента и команды его записей, без архива и удалённых строк.
  // Раньше шторка клиента Y&D предлагала метки всех календарей компании,
  // включая «Кабинет 1» и «Ирина» из архива.
  const archivedTeamIds = useArchivedTeamIds();
  const servingTeams = useMemo(
    () => servingTeamIds(client, appointments, archivedTeamIds),
    [client, appointments, archivedTeamIds],
  );
  // ОДНО ИМЯ — ОДНА СТРОКА: метка принадлежит команде, у клиента она — имя.
  const servingLabels = useMemo(
    () => labelsOfferedFor(cities, servingTeams),
    [cities, servingTeams],
  );
  const labelOptions = useMemo(
    () => servingLabels.map((c) => ({ name: c.name, color: c.color ?? getAvatarColor(c.name) })),
    [servingLabels],
  );
  const [labelOpen, setLabelOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  // ШЕСТЕРЁНКИ ЛИСТОВ — ДВЕРЬ С ВОЗВРАТОМ (AGENTS 5.4): адрес своей вкладки
  // или общий (`useReferenceHref`), лист паркуется и встаёт обратно по
  // «назад». Метки и теги — той команды, чей клиент.
  const refs = useReferenceHref();
  const doorway = useSheetDoorway();
  const teamParams = client.team_id ? { team: client.team_id } : undefined;
  const tagsDoor = useClientSettingsDoor("tags", client.team_id ?? null);
  const label = client.city.trim();
  // Цвет — строки обслуживающего календаря: у одноимённых меток разных
  // команд цвета свои.
  const labelColor =
    (servingLabels.find((c) => c.name === label) ?? cities.find((c) => c.name === label))?.color ??
    getAvatarColor(label);
  const labelAuto = !!label && !client.city_manual;

  // Теги — набор, который RPC заменяет ЦЕЛИКОМ: пишем из свежайшего значения
  // и по очереди, иначе два быстрых тапа затирают друг друга.
  const tagWriter = useJsonArrayWriter<string>(client.tag_ids, (next) =>
    Promise.resolve(update({ tag_ids: next })).then((ok) => ok !== false),
  );
  const [shownTags, setShownTags] = useState<string[]>(client.tag_ids);
  useEffect(() => setShownTags(client.tag_ids), [client.tag_ids]);
  // ТЕГИ — ОБСЛУЖИВАЮЩИХ КАЛЕНДАРЕЙ (закреплены за командой): в шторке теги
  // его календарей и уже стоящие на нём теги других (`picker-tags.ts`).
  const offeredTags = useMemo(
    () => tagsOfferedFor(tags, servingTeams, shownTags),
    [tags, servingTeams, shownTags],
  );
  // ТЕГОВ НЕСКОЛЬКО: шторка отдаёт весь набор по «Применить», карточка
  // показывает его сразу и откатывает, если запись не прошла.
  const applyTags = (next: string[]) => {
    const before = shownTags;
    if (next.length === before.length && next.every((id, i) => id === before[i])) return;
    setShownTags(next);
    void tagWriter
      .apply(() => next)
      .then((ok) => {
        if (!ok) setShownTags(before);
      })
      .catch(() => setShownTags(before));
  };
  // ПОРЯДОК — КАК В НАБОРЕ КЛИЕНТА, А НЕ КАК В КАТАЛОГЕ: первый выбранный тег
  // главный, его имя и цвет несёт плитка, остальные — «+N».
  const chosen = shownTags
    .map((id) => tags.find((tag) => tag.id === id))
    .filter((tag): tag is ClientTag => !!tag);
  const tagsTitle = chosen[0]?.name ?? null;
  const tagsMore = chosen.length > 1 ? `+${chosen.length - 1}` : undefined;

  // ПУСТАЯ ПЛИТКА ТОЛЬКО ДЛЯ ТОГО, КТО МОЖЕТ ЕЁ ЗАПОЛНИТЬ.
  // «Только видит» и значения нет — плитка-приглашение была бы кнопкой в
  // никуда: её нет, а обе пустые — нет и ряда.
  const showLabel = labelOn && (!readOnly || !!label);
  const tagLocked = tagReadOnly ?? readOnly;
  const showTag = tagOn && (!tagLocked || !!tagsTitle);
  if (!showLabel && !showTag) return null;

  return (
    <>
      {/* Края — по карточкам страницы (`GUTTER`), а не по шапке записи:
          здесь плитки стоят между блоками, и лишние 2 точки были видны. */}
      <View style={{ flexDirection: "row", gap: 8, marginHorizontal: GUTTER, marginTop: 8 }}>
        {showLabel ? (
          <IdentityCard
            icon={Bookmark}
            color={label ? labelColor : t.accent}
            title={label || "Метка"}
            sub={labelAuto ? "по записи" : undefined}
            muted={!label}
            quiet={labelAuto}
            onPress={
              readOnly
                ? undefined
                : () => {
                    haptics.tap();
                    setLabelOpen(true);
                  }
            }
            accessibilityLabel={label ? `Метка: ${label}${labelAuto ? ", по записи" : ""}` : "Метка не выбрана"}
            accessibilityHint="Открывает выбор метки"
          />
        ) : null}
        {showTag ? (
          <IdentityCard
            icon={Tags}
            color={chosen[0]?.color || t.accent}
            title={tagsTitle ?? "Тег"}
            badge={tagsMore}
            muted={!tagsTitle}
            onPress={
              tagLocked
                ? undefined
                : () => {
                    haptics.tap();
                    setTagsOpen(true);
                  }
            }
            accessibilityLabel={
              chosen.length > 0
                ? `Теги: ${chosen.map((tag) => tag.name).join(", ")}`
                : "Тег не выбран"
            }
            accessibilityHint="Открывает выбор тегов"
          />
        ) : null}
      </View>

      <LabelPickerSheet
        visible={labelOpen && !doorway.parked}
        title="Метка клиента"
        options={labelOptions}
        value={label || null}
        onPick={(name) => update({ city: name, city_manual: true })}
        onClear={() => update({ city: "", city_manual: false })}
        // ШЕСТЕРЁНКА ВЕДЁТ В СПРАВОЧНИК: сразу в настройки этой метки. Та же дверь, что у метки дня и у способов связи.
        onSettings={
          <Pressable
            onPress={() =>
              doorway.open(() =>
                router.push({ pathname: refs.labels, params: teamParams } as Href),
              )
            }
            accessibilityRole="button"
            accessibilityLabel="Настроить метки"
            className="h-11 w-11 items-center justify-center active:opacity-60"
          >
            <Settings2 color={t.sub} size={ICON.command} strokeWidth={2} />
          </Pressable>
        }
        onClose={() => setLabelOpen(false)}
      />
      <TagPickerSheet
        visible={tagsOpen && !doorway.parked}
        open={tagsOpen}
        tags={offeredTags}
        selected={shownTags}
        onApply={applyTags}
        // Шестерёнка ведёт в теги ТОЙ команды, чьи теги предложены. Дверь
        // общая с «Связью»: у клиента чужого аккаунта и без права её нет
        // (иначе вела бы в свои теги).
        onSettings={tagsDoor ? () => doorway.open(() => router.push(tagsDoor)) : undefined}
        onClose={() => setTagsOpen(false)}
      />
    </>
  );
}
