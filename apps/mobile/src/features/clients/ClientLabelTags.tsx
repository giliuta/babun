import { useEffect, useMemo, useState } from "react";
import { useRouter, type Href } from "expo-router";
import { Pressable, View } from "react-native";
import { Bookmark, Settings2, Tags } from "lucide-react-native";
import type { Client, ClientTag } from "@babun/shared/local/clients";
import { getAvatarColor } from "@babun/shared/common/utils/avatar-color";
import { IdentityCard } from "@/features/appointments/TeamLabelRow";
import { GUTTER, ICON } from "@/components/ui/tokens";
import { LabelPickerSheet } from "@/features/reference/LabelPickerSheet";
import { TagPickerSheet } from "@/features/clients/TagPickerSheet";
import { useJsonArrayWriter } from "@/features/clients/use-json-writer";
import { useReferenceHref } from "@/features/clients/reference-href";
import { useSheetDoorway } from "@/components/ui/use-sheet-doorway";
import { useCities } from "@/features/reference/queries";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// МЕТКА И ТЕГИ КЛИЕНТА — ДВУМЯ ПЛИТКАМИ, КАК «КОМАНДА | МЕТКА» В ЗАПИСИ
// (владелец 22.09: «сделаем вот такие блоки — метка и теги… чтоб было более
// красиво»). Та же `IdentityCard`, что в шапке записи: белая карточка,
// плитка цвета значения, пустое — кружок-приглашение акцентом.
//
// МЕТКА ЗАХОДИТ САМА. Запись в день с меткой переносит её на клиента, пока
// её не выбрали руками (`label-auto-assign.ts`, `city_manual`). Такая метка
// читается тише и подписана «по записи» — чтобы отличать от выбранной.
// Снять выбранную — тап по активной в листе: клиент возвращается в авто.

export function ClientLabelTags({
  client,
  update,
  tags,
  readOnly,
  tagReadOnly,
  labelOn = true,
  tagOn = true,
}: {
  /** Блоки «Метка» и «Тег» — у команды раздельно (03.10). */
  labelOn?: boolean;
  tagOn?: boolean;
  client: Client;
  update: (patch: Partial<Client>) => Promise<boolean> | void;
  /** Каталог тегов компании (Кабинет → «Теги клиентов»). */
  tags: ClientTag[];
  /** Нет права менять метку — её плитка только читается. */
  readOnly?: boolean;
  /** Своё «только читать» у тега: у метки и тега разные выключатели команды
   *  (03.10), и выключенная метка не должна запирать тег. Нет — как метка. */
  tagReadOnly?: boolean;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const { data: cities = [] } = useCities();
  // ОДНО ИМЯ — ОДНА СТРОКА: метка принадлежит команде, у клиента она — имя.
  const labelOptions = useMemo(() => {
    const seen = new Set<string>();
    return cities
      .filter((c) => {
        const key = c.name.trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((c) => ({ name: c.name, color: c.color ?? getAvatarColor(c.name) }));
  }, [cities]);
  const [labelOpen, setLabelOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  // ШЕСТЕРЁНКИ ЛИСТОВ — ДВЕРЬ С ВОЗВРАТОМ (AGENTS 5.4): адрес своей вкладки
  // или общий (`useReferenceHref`), лист паркуется и встаёт обратно по
  // «назад». Метки и теги — той команды, чей клиент.
  const refs = useReferenceHref();
  const doorway = useSheetDoorway();
  const teamParams = client.team_id ? { team: client.team_id } : undefined;
  // ТЕГИ — КОМАНДЫ КЛИЕНТА (владелец 30.09: «теги закреплены за командой»).
  // Предлагаются теги его команды; уже стоящий тег другой команды на плитке
  // остаётся виден (он берётся из всего каталога ниже).
  const teamTags = useMemo(
    () =>
      client.team_id
        ? tags.filter((tag) => !tag.team_id || tag.team_id === client.team_id)
        : tags,
    [tags, client.team_id],
  );

  const label = client.city.trim();
  const labelColor = cities.find((c) => c.name === label)?.color ?? getAvatarColor(label);
  const labelAuto = !!label && !client.city_manual;

  // Теги — набор, который RPC заменяет ЦЕЛИКОМ: пишем из свежайшего значения
  // и по очереди, иначе два быстрых тапа затирают друг друга.
  const tagWriter = useJsonArrayWriter<string>(client.tag_ids, (next) =>
    Promise.resolve(update({ tag_ids: next })).then((ok) => ok !== false),
  );
  const [shownTags, setShownTags] = useState<string[]>(client.tag_ids);
  useEffect(() => setShownTags(client.tag_ids), [client.tag_ids]);
  // ТЕГ ОДИН, КАК МЕТКА (владелец 22.09): тап ставит этот тег вместо
  // прежних, тап по единственному выбранному — снимает.
  const pickTag = (id: string) => {
    const before = shownTags;
    const next = before.length === 1 && before[0] === id ? [] : [id];
    setShownTags(next);
    void tagWriter
      .apply(() => next)
      .then((ok) => {
        if (!ok) setShownTags(before);
      })
      .catch(() => setShownTags(before));
  };
  const chosen = tags.filter((tag) => shownTags.includes(tag.id));
  // Тег один (22.09); у старых карточек их бывает больше — видно первый.
  const tagsTitle = chosen[0]?.name ?? null;

  // ПУСТАЯ ПЛИТКА ТОЛЬКО ДЛЯ ТОГО, КТО МОЖЕТ ЕЁ ЗАПОЛНИТЬ (владелец 01.10).
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
            muted={!tagsTitle}
            onPress={
              tagLocked
                ? undefined
                : () => {
                    haptics.tap();
                    setTagsOpen(true);
                  }
            }
            accessibilityLabel={tagsTitle ? `Тег: ${tagsTitle}` : "Тег не выбран"}
            accessibilityHint="Открывает выбор тега"
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
        // ШЕСТЕРЁНКА ВЕДЁТ В СПРАВОЧНИК (владелец 22.09: «справа вверху
        // настройки — оно сразу может перекидывать в настройки этой метки»).
        // Та же дверь, что у метки дня и у способов связи.
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
            <Settings2 color={t.sub} size={ICON.sm} strokeWidth={2} />
          </Pressable>
        }
        onClose={() => setLabelOpen(false)}
      />
      <TagPickerSheet
        visible={tagsOpen && !doorway.parked}
        tags={teamTags}
        selected={shownTags}
        onPick={pickTag}
        // Шестерёнка ведёт в теги ТОЙ команды, чьи теги предложены.
        onSettings={() =>
          doorway.open(() =>
            router.push({ pathname: refs.tags, params: teamParams } as Href),
          )
        }
        onClose={() => setTagsOpen(false)}
      />
    </>
  );
}
