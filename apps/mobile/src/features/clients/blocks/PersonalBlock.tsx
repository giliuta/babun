// ЛИЧНОЕ — День рождения · Источник (· Кто привёл) · Метка и тег плитками.
//
// «Обращение» (`sms_name`) со страницы убрано 22.09 по слову владельца
// («блок обращения давай уберём»): поле осталось в данных, и SMS-шаблоны
// по-прежнему подставляют его, если оно уже заполнено, — просто строки для
// правки на карточке больше нет.
//
// Метка и теги с 22.09 живут наверху карточки двумя плитками, как «Команда |
// Метка» в записи (`ClientLabelTags`; владелец: «сделаем вот такие блоки —
// метка и теги… чтоб было более красиво»). Здесь остались справочные
// свойства человека — строками одного вида: значение справа, тап — выбор.

import { useState } from "react";
import { useRouter, type Href } from "expo-router";
import type { AcquisitionSource, Client } from "@babun/shared/local/clients";
import { Circle } from "lucide-react-native";
import { NavRow } from "@/components/ui/card-rows";
import { SectionCard } from "@/components/ui/SectionCard";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { DateWheelSheet } from "@/components/ui/DateWheelSheet";
import { formatShortDateRu } from "@/features/clients/format";
import { ClientPickerSheet } from "@/features/clients/ClientPickerSheet";
import { normalizeYMD } from "@/features/clients/OptionalDateField";
import { useClients } from "@/features/clients/queries";
import { useClientSources } from "@/features/clients/acquisition-sources";
import {
  normalizeSource,
  sourceLabel,
  sourcePickerOptions,
} from "@/features/clients/acquisition-source";
import { CUSTOM_SOURCE_ICON, SOURCE_ICONS } from "@/features/clients/source-icons";
import { useTeams } from "@/features/reference/queries";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

interface PersonalBlockProps {
  client: Client;
  update: (patch: Partial<Client>) => Promise<boolean> | void;
  /** Сотрудник без «Клиенты: Меняет»: строки показывают, но не открывают
   *  выбор — сервер правку карточки отказал бы (STORY-088, волна 4). */
  readOnly?: boolean;
  /** Черновик нового клиента: отказ от SMS ставится уже сохранённому. */
  draft?: boolean;
}

export function PersonalBlock({ client, update, readOnly = false, draft = false }: PersonalBlockProps) {
  const t = useThemeColors();
  const [birthdayOpen, setBirthdayOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [referrerOpen, setReferrerOpen] = useState(false);
  const birthday = normalizeYMD(client.birthday);
  const router = useRouter();
  // ИСТОЧНИК — ГОТОВЫЕ ПЛЮС СВОИ КОМАНДЫ КЛИЕНТА (владелец 03.10). Клиент без
  // команды — у компании без команд — берёт первую.
  const { data: sources = [] } = useClientSources();
  const { data: ownTeams = [] } = useTeams();
  const sourceTeamId = client.team_id ?? ownTeams[0]?.id ?? null;
  const source = sourceLabel(client.acquisition_source, sources);
  const sourceOptions = sourcePickerOptions(sources, sourceTeamId);
  // «Кто привёл»: список — сами клиенты компании, тот же кеш, что у списка.
  const { data: allClients = [] } = useClients();
  const referrerName =
    allClients.find((x: Client) => x.id === client.referred_by_client_id)?.full_name ?? null;

  return (
    <>
      <SectionCard title="Личное">
        <NavRow
          label="День рождения"
          value={birthday ? formatShortDateRu(birthday) : null}
          placeholder="не указан"
          onPress={
            readOnly
              ? undefined
              : () => {
                  haptics.tap();
                  setBirthdayOpen(true);
                }
          }
        />
        <NavRow
          label="Источник"
          value={source}
          placeholder="неизвестен"
          separated
          onPress={
            readOnly
              ? undefined
              : () => {
                  haptics.tap();
                  setSourceOpen(true);
                }
          }
        />
        {/* КТО ПРИВЁЛ — только при источнике «Рекомендация». */}
        {client.acquisition_source === "referral" ? (
          <NavRow
            label="Кто привёл"
            value={referrerName}
            placeholder="не указан"
            separated
            onPress={
              readOnly
                ? undefined
                : () => {
                    haptics.tap();
                    setReferrerOpen(true);
                  }
            }
          />
        ) : null}
        {/* «Присылать SMS» и «Имя для SMS» с 30.09 живут в блоке «SMS»
            (владелец: «присылать или не присылать — в едином блоке SMS»). */}
      </SectionCard>

      <PickerSheet
        visible={sourceOpen}
        title="Источник обращения"
        items={sourceOptions.map((o) => ({
          id: o.value,
          label: o.label,
          icon: o.sourceId ? CUSTOM_SOURCE_ICON : (SOURCE_ICONS[o.value as AcquisitionSource] ?? Circle),
          color: t.accent,
          onPress: () => update({ acquisition_source: o.value }),
        }))}
        selectedId={normalizeSource(client.acquisition_source, sources)}
        // ШЕСТЕРЁНКА — В СВОИ ИСТОЧНИКИ ТОЙ КОМАНДЫ, чьи предложены: там их
        // добавляют («могут самостоятельно добавить источник»).
        onSettings={() =>
          router.push(
            sourceTeamId
              ? ({ pathname: "/clients/sources", params: { team: sourceTeamId } } as Href)
              : ("/clients/sources" as Href),
          )
        }
        settingsLabel="Свои источники"
        onClose={() => setSourceOpen(false)}
      />
      <DateWheelSheet
        visible={birthdayOpen}
        title="День рождения"
        value={birthday || null}
        seed="1990-01-01"
        clearLabel={birthday ? "Убрать дату" : undefined}
        onApply={(ymd) => {
          update({ birthday: ymd });
          setBirthdayOpen(false);
        }}
        onClear={() => {
          update({ birthday: "" });
          setBirthdayOpen(false);
        }}
        onClose={() => setBirthdayOpen(false)}
      />
      <ClientPickerSheet
        visible={referrerOpen}
        title="Кто привёл"
        selectedId={client.referred_by_client_id}
        excludeId={client.id}
        clearLabel="Убрать"
        onSelect={(c) => update({ referred_by_client_id: c.id })}
        onClear={() => update({ referred_by_client_id: null })}
        onClose={() => setReferrerOpen(false)}
      />
    </>
  );
}

export default PersonalBlock;
