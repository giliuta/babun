import { Pressable, View } from "react-native";
import { ChevronLeft } from "lucide-react-native";
import { ICON, TYPE } from "@/components/ui/tokens";
import { Screen } from "@/components/ui/Screen";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import type { useThemeColors } from "@/theme/colors";
import { Text } from "./book-text";
import type { GateRef } from "./reference-gate";

type Theme = ReturnType<typeof useThemeColors>;

/** The record was opened by link, references arrived, but the record is gone. */
export function BookMissingScreen({ t, onBack }: { t: Theme; onBack: () => void }) {
  return (
    <Screen edges={["top", "bottom"]}>
      <View className="flex-row items-center px-3" style={{ height: 48 }}>
        <Pressable
          onPress={onBack}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Назад"
          style={{ minWidth: 72, minHeight: 44, justifyContent: "center" }}
        >
          <ChevronLeft color={t.body} size={ICON.header} />
        </Pressable>
        <Text
          className="flex-1 text-center"
          style={{ ...TYPE.headline, color: t.ink }}
        >
          Запись
        </Text>
        <View style={{ minWidth: 72 }} />
      </View>
      {/* Пустой экран — канонный `EmptyState` (заголовок 17, подпись 13),
          как у остальных страниц. */}
      <EmptyState fill title="Записи больше нет" subtitle="Её удалили или ссылка устарела." />
    </Screen>
  );
}

interface BookLoadingScreenProps {
  t: Theme;
  title: string;
  onClose: () => void;
  failedReference: GateRef | undefined;
  errorWords: { title: string; subtitle: string };
  referenceQueries: readonly GateRef[];
}

/** References are still loading, or the first load of an essential one failed. */
export function BookLoadingScreen({
  t,
  title,
  onClose,
  failedReference,
  errorWords,
  referenceQueries,
}: BookLoadingScreenProps) {
  return (
    <Screen edges={["top", "bottom"]}>
      <View className="flex-row items-center px-3" style={{ height: 48 }}>
        <Pressable
          onPress={onClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Назад"
          style={{ minWidth: 72, minHeight: 44, justifyContent: "center" }}
        >
          <ChevronLeft color={t.body} size={ICON.header} />
        </Pressable>
        <Text
          className="flex-1 text-center"
          style={{ ...TYPE.headline, color: t.ink }}
        >
          {title}
        </Text>
        <View style={{ minWidth: 72 }} />
      </View>
      {failedReference ? (
        // Тот же экран ошибки, что у календаря и списков: облако, слова,
        // «Повторить» — футером, где все кнопки.
        <EmptyState
          state="error"
          fill
          title={errorWords.title}
          subtitle={errorWords.subtitle}
          action={{
            label: "Повторить",
            onPress: () => {
              void Promise.all(referenceQueries.map(({ query }) => query.refetch()));
            },
          }}
        />
      ) : (
        <View className="flex-1 items-center justify-center px-7">
          {/* Ожидание ДВИЖЕТСЯ: крупная надпись без движения читалась как
              зависший экран. */}
          <View style={{ marginBottom: 14 }}>
            <Spinner size={30} label="Загружаем данные записи" />
          </View>
          <Text style={{ ...TYPE.headline, color: t.ink, textAlign: "center" }}>
            Загружаем данные записи
          </Text>
        </View>
      )}
    </Screen>
  );
}
