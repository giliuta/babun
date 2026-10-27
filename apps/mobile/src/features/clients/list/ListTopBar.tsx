import { Pressable, Text, TextInput, View } from "react-native";
import { Search, Settings, SlidersHorizontal } from "lucide-react-native";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { TYPE } from "@/components/ui/tokens";
import { TourTarget } from "@/components/tour/TourTarget";
import { clientsSettingsHref } from "@/session/clients-company";
import { ALL_TEAMS, toggleTeamChoice } from "@/features/clients/team-scope";
import { haptics } from "@/lib/haptics";
import type { ClientsList } from "./use-clients-list";

/** Top of the list: the selection header in bulk mode, otherwise the
 *  search bar with settings and filters, and the team ribbon under it. */
export function ListTopBar({ list }: { list: ClientsList }) {
  const {
    t,
    router,
    selecting,
    exitSelection,
    pickedCount,
    toggleAll,
    allSelected,
    teams,
    query,
    setQuery,
    result,
    setInitialFacet,
    setSheetOpen,
    teamChips,
    teamChoice,
    setSavedTeam,
  } = list;
  return (
    <>
      {selecting ? (
        // Селекшн-хедер: Отмена · «Выбрано N» · Выбрать всё/Снять. Та же
        // полоса, что у поиска (48, surface, шов снизу), и кегль навбара —
        // иначе список прыгал при входе в выбор.
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 8,
            minHeight: 48,
            backgroundColor: t.surface,
            borderBottomWidth: 1,
            borderBottomColor: t.separator,
          }}
        >
          <Pressable
            onPress={exitSelection}
            accessibilityRole="button"
            accessibilityLabel="Отменить выбор"
            hitSlop={6}
            style={({ pressed }) => ({
              minHeight: 44,
              justifyContent: "center",
              paddingHorizontal: 8,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text maxFontSizeMultiplier={1.3} style={{ ...TYPE.headline, color: t.accent }}>
              Отмена
            </Text>
          </Pressable>
          <Text
            maxFontSizeMultiplier={1.3}
            accessibilityRole="header"
            style={{ ...TYPE.headline, color: t.ink }}
          >
            {pickedCount > 0
              ? `Выбрано ${pickedCount}`
              : "Выберите клиентов"}
          </Text>
          <Pressable
            onPress={toggleAll}
            accessibilityRole="button"
            accessibilityLabel={allSelected ? "Снять всё" : "Выбрать всё"}
            hitSlop={6}
            style={({ pressed }) => ({
              minHeight: 44,
              justifyContent: "center",
              paddingHorizontal: 8,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text maxFontSizeMultiplier={1.3} style={{ ...TYPE.headline, color: t.accent }}>
              {allSelected ? "Снять" : "Всё"}
            </Text>
          </Pressable>
        </View>
      ) : (
        // Шапка в анатомии CalendarHeader (правило единого стиля): полоса
        // на surface с нижним разделителем, шестерёнка СЛЕВА (44×44,
        // t.sub 21/2), по центру — поиск (заголовок-дубль «Клиенты»
        // убран: имя вкладки уже в таб-баре), справа — аналитика и «+».
        // Вход в мультивыбор переехал в long-press меню строки (web v313).
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingHorizontal: 8,
            minHeight: 48,
            backgroundColor: t.surface,
            // Шов снизу даёт лента команд (как в календаре): две линии
            // подряд читались бы как случайный зазор.
            borderBottomWidth: teams.length > 0 ? 0 : 1,
            borderBottomColor: t.separator,
          }}
        >
          <TourTarget id="clients.gear" shape="control">
          <Pressable
            onPress={() => router.push(clientsSettingsHref())}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Настройки клиентов"
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: t.radius.card,
              backgroundColor: pressed ? t.pressed : "transparent",
            })}
          >
            <Settings color={t.sub} size={21} strokeWidth={2} />
          </Pressable>
          </TourTarget>

          <TourTarget id="clients.search" shape="control" flex>
          <View
            className="h-9 flex-1 flex-row items-center gap-1.5 px-2.5"
            style={{ borderRadius: t.radius.input, backgroundColor: t.fill }}
          >
            <Search color={t.faint} size={16} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              // Приём Jobber: активные фильтры меняют плейсхолдер — статус
              // «список отфильтрован» виден даже без открытия панели.
              placeholder={
                result.activeCount > 0
                  ? "Поиск среди отфильтрованных"
                  : "Имя, телефон, адрес"
              }
              accessibilityLabel="Поиск клиентов"
              placeholderTextColor={t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance="light"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              returnKeyType="search"
              clearButtonMode="while-editing"
              maxFontSizeMultiplier={1.3}
              // ПОЛЕ РАСТЯНУТО НА ВСЮ ВЫСОТУ ПЛАШКИ. Без этого iOS после
              // перерисовки ронял подсказку ниже плашки — «Имя, телефон,
              // адрес» обрезалась снизу.
              // Не числом: `h-9` плашки — это rem NativeWind, а не 36pt.
              style={{
                flex: 1,
                alignSelf: "stretch",
                paddingVertical: 0,
                fontSize: 15,
                textAlignVertical: "center",
                color: t.ink,
              }}
            />
          </View>
          </TourTarget>

          {/* ФИЛЬТРЫ — ЗНАЧКОМ СПРАВА, вверху (фильтры лежат рядом с
              аналитикой). Строка «Фильтры · N клиентов» под
              поиском уступила место ленте команд; аналитика — последней
              строкой шторки. Включённый фильтр — точкой на значке: список
              не имеет права прятать клиентов молча. */}
          <TourTarget id="clients.filters" shape="control">
          <Pressable
            onPress={() => {
              setInitialFacet(null);
              setSheetOpen(true);
            }}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={
              result.activeCount > 0
                ? `Фильтры, включено ${result.activeCount}`
                : "Фильтры"
            }
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: t.radius.card,
              backgroundColor: pressed ? t.pressed : "transparent",
            })}
          >
            <SlidersHorizontal
              color={result.activeCount > 0 ? t.accent : t.sub}
              size={21}
              strokeWidth={2}
            />
            {result.activeCount > 0 ? (
              <View
                style={{
                  position: "absolute",
                  top: 9,
                  right: 8,
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: t.accent,
                  borderWidth: 1.5,
                  borderColor: t.surface,
                }}
              />
            ) : null}
          </Pressable>
          </TourTarget>
        </View>
      )}

      {/* ЛЕНТА КОМАНД — на месте строки фильтров. В режиме выбора её нет:
          фокус на наборе. Без команд (компания их не завела) ленты нет. */}
      {!selecting && teams.length > 0 ? (
        <ScopeChips
          items={teamChips}
          activeId={teamChoice === ALL_TEAMS ? null : teamChoice}
          onSelect={(id) => {
            haptics.tap();
            setSavedTeam.mutate(toggleTeamChoice(teamChoice, id));
          }}
        />
      ) : null}
    </>
  );
}
