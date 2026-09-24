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
import type { AcquisitionSource, Client } from "@babun/shared/local/clients";
import { ACQUISITION_LABELS } from "@babun/shared/local/clients";
import {
  Circle,
  Footprints,
  Globe,
  Instagram,
  MapPin,
  MessageCircle,
  RotateCcw,
  Users,
  type LucideIcon,
} from "lucide-react-native";
import { NavRow } from "@/components/ui/card-rows";
import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { useToast } from "@/components/ui/Toast";
import { smsErrorText, useSetClientSmsOptOut } from "@/features/sms/sms-account";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { DateWheelSheet } from "@/components/ui/DateWheelSheet";
import { formatShortDateRu } from "@/features/clients/format";
import { ClientPickerSheet } from "@/features/clients/ClientPickerSheet";
import { normalizeYMD } from "@/features/clients/OptionalDateField";
import { useClients } from "@/features/clients/queries";
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

/** Значок источника: откуда пришёл клиент, узнаётся с одного взгляда. */
const SOURCE_ICONS: Partial<Record<AcquisitionSource, LucideIcon>> = {
  referral: Users,
  instagram: Instagram,
  whatsapp: MessageCircle,
  google_maps: MapPin,
  website: Globe,
  repeat: RotateCcw,
  walk_in: Footprints,
  other: Circle,
};

export function PersonalBlock({ client, update, readOnly = false, draft = false }: PersonalBlockProps) {
  const t = useThemeColors();
  const toast = useToast();
  // «ПРИСЫЛАТЬ SMS» (STORY-089): клиент попросил не писать — сервис ему не
  // пишет ни сам, ни по кнопке. Своя функция базы, а не правка карточки:
  // флаг нельзя стереть офлайн-очередью. Тумблер откликается сразу.
  const optOut = useSetClientSmsOptOut();
  const [smsOff, setSmsOff] = useState<boolean | null>(null);
  const smsBlocked = smsOff ?? client.sms_opt_out === true;
  const [birthdayOpen, setBirthdayOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [referrerOpen, setReferrerOpen] = useState(false);
  const birthday = normalizeYMD(client.birthday);
  const source =
    client.acquisition_source && client.acquisition_source !== "unknown"
      ? ACQUISITION_LABELS[client.acquisition_source]
      : null;
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
        {!draft ? (
          <>
            <Divider inset={16} />
            <SwitchRow
              label="Присылать SMS"
              hint={smsBlocked ? "Клиент просил не писать" : undefined}
              value={!smsBlocked}
              disabled={readOnly || optOut.isPending}
              onChange={(send) => {
                setSmsOff(!send);
                optOut.mutate(
                  { clientId: client.id, value: !send },
                  {
                    onError: (e) => {
                      setSmsOff(null);
                      toast(smsErrorText(e), "error");
                    },
                  },
                );
              }}
            />
          </>
        ) : null}
      </SectionCard>

      <PickerSheet
        visible={sourceOpen}
        title="Источник обращения"
        items={(Object.keys(ACQUISITION_LABELS) as AcquisitionSource[])
          .filter((k) => k !== "unknown")
          .map((k) => ({
            id: k,
            label: ACQUISITION_LABELS[k],
            icon: SOURCE_ICONS[k] ?? Circle,
            color: t.accent,
            onPress: () => update({ acquisition_source: k }),
          }))}
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
