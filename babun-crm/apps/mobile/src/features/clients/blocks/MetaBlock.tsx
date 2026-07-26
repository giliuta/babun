// О КЛИЕНТЕ — Источник обращения · Теги.
//
// Переведён на ЗАКОН СТРОКИ (2026-07-26). Источник — единичный выбор, поэтому
// строка с шевроном и нативный ActionSheetIOS. Теги — множественный выбор, и
// они остаются цветными чипами: чип и есть канонический вид тега во всём
// продукте (список клиентов, фильтры), а нативного меню с галками у iOS нет.
//
// «Чёрный список» из блока УБРАН: тот же переключатель живёт в меню ⋯, и
// двух путей к одному флагу быть не должно. Поднятый флаг остаётся видимым
// тихой подписью под группой — иначе про него узнают только при записи.
//
// «В базе с …» показывается только у существующего клиента: в черновике блок
// сообщал дату появления клиента, которого ещё нет.

import { ActionSheetIOS, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import {
  ACQUISITION_LABELS,
  type AcquisitionSource,
  type Client,
  type ClientTag,
} from "@babun/shared/local/clients";
import { Chip } from "@/components/ui/Chip";
import { NavRow, RowCaption, RowGroup } from "@/features/clients/card-rows";
import { readableColorOnTint } from "@/components/ui/color-contrast";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

interface MetaBlockProps {
  client: Client;
  update: (patch: Partial<Client>) => void;
  /** Каталог тегов тенанта. Пустой — рисуем честную пустую строку. */
  tags?: ClientTag[];
  draft?: boolean;
}

const SOURCE_KEYS = Object.keys(ACQUISITION_LABELS) as AcquisitionSource[];

function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function MetaBlock({
  client,
  update,
  tags = [],
  draft = false,
}: MetaBlockProps) {
  const th = useThemeColors();

  const toggleTag = (id: string) => {
    haptics.tap();
    update({
      tag_ids: client.tag_ids.includes(id)
        ? client.tag_ids.filter((t) => t !== id)
        : [...client.tag_ids, id],
    });
  };

  const pickSource = () => {
    haptics.tap();
    const options = [...SOURCE_KEYS.map((k) => ACQUISITION_LABELS[k]), "Отмена"];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: "Источник обращения",
        options,
        cancelButtonIndex: options.length - 1,
      },
      (i) => {
        const key = SOURCE_KEYS[i];
        if (key) update({ acquisition_source: key });
      },
    );
  };

  const source =
    client.acquisition_source && client.acquisition_source !== "unknown"
      ? ACQUISITION_LABELS[client.acquisition_source]
      : null;

  return (
    <>
      <RowGroup title="О клиенте">
        <NavRow
          label="Источник"
          value={source}
          placeholder="неизвестен"
          onPress={pickSource}
        />
        {/* Теги — множественный выбор, поэтому чипы внутри подписанной
            строки, а не шеврон: нативного меню с галками у iOS нет, а свой
            лист снизу владелец для такого отверг. */}
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 10,
            gap: 8,
            borderTopWidth: 1,
            borderTopColor: th.separator,
          }}
        >
          <Text
            maxFontSizeMultiplier={1.2}
            style={{
              fontSize: 11,
              fontWeight: "700",
              letterSpacing: 1.2,
              textTransform: "uppercase",
              color: th.faint,
            }}
          >
            Теги
          </Text>
          {tags.length === 0 ? (
            <Text
              maxFontSizeMultiplier={1.3}
              style={{ fontSize: 15, color: th.faint }}
            >
              В каталоге нет тегов
            </Text>
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {tags.map((tag) => {
                const active = client.tag_ids.includes(tag.id);
                return (
                  <Chip
                    key={tag.id}
                    label={tag.name}
                    variant="tint"
                    color={tag.color}
                    selected={active}
                    onPress={() => toggleTag(tag.id)}
                    icon={
                      active ? (
                        <TagCheck color={tag.color} surface={th.surface} ink={th.ink} />
                      ) : undefined
                    }
                  />
                );
              })}
            </View>
          )}
        </View>
      </RowGroup>

      {client.blacklisted ? (
        <RowCaption tone="danger" text="Клиент в чёрном списке." />
      ) : null}
      {!draft ? (
        <RowCaption text={`В базе с ${formatCreatedAt(client.created_at)}`} />
      ) : null}
    </>
  );
}

/** Галка выбранного тега — иконкой, не текстовым знаком: цвет считается по
 *  фону чипа, чтобы читалась и на светлых, и на тёмных тегах. */
function TagCheck({
  color,
  surface,
  ink,
}: {
  color: string;
  surface: string;
  ink: string;
}) {
  return (
    <Check
      color={readableColorOnTint(color, surface, ink, 0x14 / 255)}
      size={10}
      strokeWidth={2.8}
    />
  );
}

export default MetaBlock;
