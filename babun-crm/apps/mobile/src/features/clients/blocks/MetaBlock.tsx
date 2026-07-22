// MetaBlock (mobile port of apps/web/.../blocks/MetaBlock.tsx)
// STORY-034 — Метаданные: Источник обращения · теги · «в базе с …».
// Collapsed by default (CollapsibleCard) — the closed row shows
// «{источник} · N тегов».
// Plus a Чёрный список toggle (client.blacklisted) — the field exists
// on Client and has no home in the other blocks, so it lives here.
// Presentational only — receives client + update() + the tenant tag
// catalog (the composer supplies `tags`; absent → empty-catalog state,
// matching web).

import { X } from "lucide-react-native";
import { Text, View } from "react-native";
import {
  ACQUISITION_LABELS,
  type AcquisitionSource,
  type Client,
  type ClientTag,
} from "@babun/shared/local/clients";
import { Chip } from "@/components/ui/Chip";
import { CollapsibleCard } from "@/features/clients/card-collapse";
import { useThemeColors } from "@/theme/colors";
import { readableColorOnTint } from "@/components/ui/color-contrast";

interface MetaBlockProps {
  client: Client;
  update: (patch: Partial<Client>) => void;
  /** Tenant-managed tag catalog (palette + label). The composer passes
   *  this; when omitted we render the empty-catalog hint, same as web. */
  tags?: ClientTag[];
  draft?: boolean;
}

const SOURCE_KEYS = Object.keys(
  ACQUISITION_LABELS,
) as AcquisitionSource[];

function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function MetaBlock({ client, update, tags = [], draft = false }: MetaBlockProps) {
  const th = useThemeColors();

  const toggleTag = (id: string) =>
    update({
      tag_ids: client.tag_ids.includes(id)
        ? client.tag_ids.filter((t) => t !== id)
        : [...client.tag_ids, id],
    });

  // Collapsed-row summary: «Рекомендация · 2 тега» — only what's set.
  const summary = [
    client.acquisition_source && client.acquisition_source !== "unknown"
      ? ACQUISITION_LABELS[client.acquisition_source]
      : null,
    client.tag_ids.length
      ? `${client.tag_ids.length} ${tagsWord(client.tag_ids.length)}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <CollapsibleCard title="Метаданные" summary={summary}>
      <View className="gap-3 px-1 pt-1">
        {/* Источник обращения — web uses a <select>; RN has no native
            select, so render the options as a wrapping chip group. */}
        <View>
          <Text className="mb-1.5 text-xs" style={{ color: th.sub }}>
            Источник обращения
          </Text>
          <View className="flex-row flex-wrap gap-1.5">
            {SOURCE_KEYS.map((k) => (
              <Chip
                key={k}
                label={ACQUISITION_LABELS[k]}
                radio
                selected={client.acquisition_source === k}
                onPress={() => update({ acquisition_source: k })}
              />
            ))}
          </View>
        </View>

        {/* Теги */}
        <View>
          <Text className="mb-1.5 text-xs" style={{ color: th.sub }}>Теги</Text>
          {tags.length === 0 ? (
            <Text className="text-xs italic" style={{ color: th.faint }}>
              Нет тегов в каталоге.
            </Text>
          ) : (
            <View className="flex-row flex-wrap gap-1.5">
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
                        <X
                          color={readableColorOnTint(
                            tag.color,
                            th.surface,
                            th.ink,
                            0x14 / 255,
                          )}
                          size={10}
                          strokeWidth={2.5}
                        />
                      ) : undefined
                    }
                  />
                );
              })}
            </View>
          )}
        </View>

        {/* Чёрный список — client.blacklisted. Not present in the web
            block, but the field exists and belongs with meta flags. */}
        <View className="flex-row items-center justify-between border-t pt-3" style={{ borderColor: th.separator }}>
          <Text className="text-[13px]" style={{ color: th.sub }}>Чёрный список</Text>
          <Chip
            label={client.blacklisted ? "В списке" : "Нет"}
            color={th.danger}
            selected={!!client.blacklisted}
            onPress={() => update({ blacklisted: !client.blacklisted })}
            accessibilityLabel="Чёрный список"
          />
        </View>

        {/* В базе с … */}
        {!draft ? (
          <Text className="border-t pt-3 text-xs" style={{ borderColor: th.separator, color: th.faint }}>
            В базе с {formatCreatedAt(client.created_at)}
          </Text>
        ) : null}
      </View>
    </CollapsibleCard>
  );
}

function tagsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "тег";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "тега";
  return "тегов";
}

export default MetaBlock;
