import { ScrollView, View } from "react-native";
import { useRouter, type Href } from "expo-router";

import { NavRow } from "@/components/ui/card-rows";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { useToast } from "@/components/ui/Toast";
import { confirmThen } from "@/lib/confirm";
import { useThemeColors } from "@/theme/colors";

import { useAccessBlocks } from "../queries";
import { useAccessTemplates, useCreateTemplate, useDeleteTemplate } from "./queries";
import { templateBlocks, templateLevel, type AccessTemplate } from "./templates";
import type { AccessBlock } from "../access-map";

// ШАБЛОНЫ ДОСТУПА — «Кабинет → Сотрудники → ⚙» (владелец 29.09: «с шаблонами
// того, что он может видеть и что не может»). Строка — шаблон и сколько в нём
// открыто; тап — правка, свайп вправо — «Удалить» (AGENTS п.9). Создание —
// кнопкой внизу (AGENTS 7.1): шаблон заводится сразу и открывается правкой.
// Применяется шаблон КОПИЕЙ на странице человека: при добавлении в команду и
// строкой «Шаблон» в правах команды.

/** «Открыто 6 из 22» — сколько блоков шаблон не закрывает. */
function openLine(blocks: readonly AccessBlock[], template: AccessTemplate): string {
  const own = templateBlocks(blocks);
  const open = own.filter((block) => templateLevel(template, block) !== "off").length;
  return `Открыто ${open} из ${own.length}`;
}

export function TemplatesScreen({ onBack }: { onBack: () => void }) {
  const t = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  const blocksQuery = useAccessBlocks({ fresh: true });
  const templatesQuery = useAccessTemplates();
  const create = useCreateTemplate();
  const remove = useDeleteTemplate();
  const templates = templatesQuery.data ?? [];
  const blocks = blocksQuery.data ?? [];

  const open = (id: string) => router.push(`/cabinet/people/templates/${id}` as Href);

  const addTemplate = async () => {
    try {
      const id = await create.mutateAsync({
        name: `Шаблон ${templates.length + 1}`,
        position: templates.length,
      });
      open(id);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Не удалось создать шаблон", "error");
    }
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Шаблоны доступа" onBack={onBack} />
      {templatesQuery.isLoading ? (
        <EmptyState state="loading" fill />
      ) : templatesQuery.isError ? (
        <EmptyState
          state="error"
          fill
          title="Не удалось загрузить шаблоны"
          action={{ label: "Повторить", onPress: () => void templatesQuery.refetch() }}
        />
      ) : templates.length === 0 ? (
        <EmptyState
          fill
          title="Шаблонов пока нет"
          subtitle="Шаблон — набор прав команды. Его ставят человеку одним тапом, а потом правят точечно."
        />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          <SectionCard padded={false}>
            {templates.map((template, i) => (
              <SwipeRow
                key={template.id}
                label="Удалить"
                color={t.danger}
                accessibilityLabel={`Удалить шаблон ${template.name}`}
                onAction={() =>
                  confirmThen(
                    `Удалить шаблон «${template.name}»?`,
                    {
                      message: "Права людей, выставленные по нему, останутся как есть.",
                      confirmLabel: "Удалить",
                      destructive: true,
                    },
                    () =>
                      remove.mutate(template.id, {
                        onError: (error) => toast(error.message || "Не удалось удалить", "error"),
                      }),
                  )
                }
              >
                <NavRow
                  label={template.name}
                  value={blocks.length > 0 ? openLine(blocks, template) : undefined}
                  separated={i > 0}
                  onPress={() => open(template.id)}
                />
              </SwipeRow>
            ))}
          </SectionCard>
        </ScrollView>
      )}
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
        <GradientButton
          label="Создать шаблон"
          onPress={() => void addTemplate()}
          loading={create.isPending}
        />
      </View>
    </Screen>
  );
}
