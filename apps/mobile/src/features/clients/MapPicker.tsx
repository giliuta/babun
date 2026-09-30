import { useEffect, useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import Constants from "expo-constants";
import { MapPin } from "lucide-react-native";
import type { Coords } from "@/features/clients/location-request-form";
import { hasNativeView } from "@/lib/native-view";
import { useThemeColors } from "@/theme/colors";

// КАРТА, НА КОТОРОЙ СТАВЯТ ТОЧКУ — НАТИВНАЯ (владелец 2026-09-10: «хочу
// максимальное качество, вставляй native maps»).
//
// Почему не «увести в Google Maps и получить точку обратно»: ни у Google, ни у
// Apple нет режима «выбери точку и вернись к вызвавшему» — их URL-схемы
// односторонние, параметра возврата не существует. Единственный честный способ
// получить координаты — своя карта.
//
// ВСТРОЕННЫЙ БЛОК, А НЕ ВТОРОЙ ЛИСТ. Сперва это был `BottomSheet` поверх листа
// объекта — и он не показался: iOS не выводит два модальных листа в один кадр
// (тот же капкан, что у выбора объекта, где добавление ждёт `onExited`).
// Карта раскрывается прямо в карточке адреса — заодно нет и лишнего этапа.
//
// ПИН СТОИТ, ДВИГАЕТСЯ КАРТА: палец не закрывает собой цель, и всё делается
// одной рукой — тот же приём, что в Uber и Яндекс.Картах.
//
// МОДУЛЬ ПОДКЛЮЧЁН ЛЕНИВО. `react-native-maps` нативный: клиент, собранный до
// его появления, такого компонента не знает. На этой ветке живут ещё две
// сессии со своими сборками (см. [[second-simulator-worktree]]) — у них человек
// увидит внятную строчку, а не пустоту.
type MapsModule = typeof import("react-native-maps");
let maps: MapsModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  maps = require("react-native-maps") as MapsModule;
} catch {
  maps = null;
}

/** Ключ Google Maps из конфигурации сборки — пусто, пока его не завели. */
const GOOGLE_MAPS_KEY =
  (Constants.expoConfig?.ios as { config?: { googleMapsApiKey?: string } } | undefined)
    ?.config?.googleMapsApiKey ?? "";

/** Лимасол: тенант работает на Кипре, и пустая карта посреди океана хуже,
 *  чем карта не того города. */
const FALLBACK: Coords = { lat: 34.7071, lng: 33.0226 };

export function MapPicker({
  value,
  follow,
  height = 260,
  onChange,
}: {
  /** Уже отмеченная точка — карта открывается на ней. */
  value: Coords | null;
  /** Куда переехать, когда адрес словами нашёлся геокодером. Меняется —
   *  карта летит туда; двигают карту рукой — она остаётся где поставили. */
  follow?: Coords | null;
  height?: number;
  /** Центр карты после каждого движения: это и есть выбранная точка. */
  onChange: (coords: Coords) => void;
}) {
  const t = useThemeColors();
  const mapRef = useRef<InstanceType<NonNullable<MapsModule["default"]>> | null>(null);
  const start = useRef<Coords>(value ?? FALLBACK);
  // Свежий обработчик без пересоздания карты: `onChange` пересобирается на
  // каждый рендер формы, а карта должна пережить их все.
  const emit = useRef(onChange);
  emit.current = onChange;
  const [ready, setReady] = useState(false);

  // Карта едет за найденным адресом. Ключ — сами координаты: один и тот же
  // адрес, найденный второй раз, карту не дёргает.
  const followKey = follow ? `${follow.lat},${follow.lng}` : null;
  useEffect(() => {
    if (!follow || !mapRef.current) return;
    mapRef.current.animateToRegion(
      {
        latitude: follow.lat,
        longitude: follow.lng,
        latitudeDelta: 0.006,
        longitudeDelta: 0.006,
      },
      400,
    );
    // followKey — стабильный ключ точки; сам объект пересобирается каждый рендер.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followKey]);

  const MapView = maps?.default;
  // ТАЙЛЫ GOOGLE, КОГДА ЕСТЬ КЛЮЧ (владелец 2026-09-10: «желательно
  // использовать не Apple Maps, а Google Maps — она понятнее, и клиентов у неё
  // больше»). Провайдер Google на iOS работает только со своим SDK и ключом
  // Google Cloud: ключа в проекте пока нет, и без него карта была бы пустой —
  // поэтому пока рисует Apple, а переключение уже здесь и включится само,
  // как только ключ появится в `app.json` (ios.config.googleMapsApiKey) и
  // сборка это подхватит. На Android провайдер Google — единственный.
  const provider =
    Platform.OS === "android" || GOOGLE_MAPS_KEY
      ? maps?.PROVIDER_GOOGLE
      : undefined;

  // ВЬЮХУ СПРАШИВАЕМ У ПРИЛОЖЕНИЯ, А НЕ У JS. `MapView` существует всегда:
  // это JS-обёртка. Нет `AIRMap` в сборке — рендер обёртки роняет ЭКРАН
  // целиком («View config not found»), поэтому до него дело доходить не
  // должно. Проверка и есть разница между «карточка сказала, что карт нет» и
  // красным экраном на месте формы.
  if (!MapView || !hasNativeView("AIRMap")) {
    return (
      <View
        style={{
          height,
          borderRadius: t.radius.input,
          backgroundColor: t.fill,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 16,
        }}
      >
        <Text style={{ fontSize: 14, color: t.sub, textAlign: "center" }}>
          Приложение собрано без модуля карт — обновите сборку.
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{
        height,
        borderRadius: t.radius.input,
        overflow: "hidden",
        backgroundColor: t.fill,
      }}
    >
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        provider={provider}
        initialRegion={{
          latitude: start.current.lat,
          longitude: start.current.lng,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
        onMapReady={() => {
          setReady(true);
          // Первая точка отдаётся сразу: карту открыли — значит согласны с
          // тем, что видно по центру, и «Готово» не должно быть мёртвым.
          emit.current(start.current);
        }}
        onRegionChangeComplete={(region) =>
          emit.current({ lat: region.latitude, lng: region.longitude })
        }
        showsUserLocation={false}
        toolbarEnabled={false}
      />
      {/* Пин — над картой и ровно в центре. Остриё внизу, поэтому его сдвигают
          вверх на половину высоты: иначе точка ставится там, где у пина
          шляпка, а не там, куда он показывает. */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          alignItems: "center",
          justifyContent: "center",
          opacity: ready ? 1 : 0,
        }}
      >
        <MapPin color={t.accent} size={32} strokeWidth={2.4} style={{ marginBottom: 32 }} />
      </View>
    </View>
  );
}
