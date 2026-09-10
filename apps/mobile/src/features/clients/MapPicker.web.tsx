import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { Coords } from "@/features/clients/location-request-form";
import { useThemeColors } from "@/theme/colors";

// КАРТА, НА КОТОРОЙ КЛИЕНТ САМ СТАВИТ ТОЧКУ — ВЕБ (владелец 2026-09-10:
// «хочу, чтобы клиент тоже мог сразу на карте выбрать точку»).
//
// Почему не «увести его в Google Maps и получить точку обратно»: ни у Google,
// ни у Apple нет режима «выбери точку и вернись к вызвавшему», а веб-страница
// тем более не может получить результат из чужого приложения. Единственный
// честный способ — своя карта на нашей же странице.
//
// LEAFLET + OPENSTREETMAP: без ключей, без аккаунта, без денег — на странице,
// которую открывает клиент с чужого телефона, это важнее любых красот. Скрипт
// и стиль тянутся с CDN один раз на страницу; не загрузились — блок молчит, а
// «Я сейчас здесь» и поле адреса на странице работают как работали.
//
// ПИН СТОИТ, ДВИГАЕТСЯ КАРТА — тот же приём, что в нативном листе: палец не
// закрывает собой цель, и всё делается одной рукой.

const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
/** Лимасол: тенант работает на Кипре, и пустая карта посреди океана хуже,
 *  чем карта не того города. */
const FALLBACK: Coords = { lat: 34.7071, lng: 33.0226 };

declare global {
  interface Window {
    L?: {
      map: (el: HTMLElement, opts?: Record<string, unknown>) => LeafletMap;
      tileLayer: (url: string, opts?: Record<string, unknown>) => { addTo: (m: LeafletMap) => void };
    };
  }
}

interface LeafletMap {
  setView: (center: [number, number], zoom: number) => LeafletMap;
  getCenter: () => { lat: number; lng: number };
  on: (event: string, handler: () => void) => void;
  remove: () => void;
}

/** Грузим Leaflet один раз на страницу и ждём готовности. */
function useLeaflet(): "loading" | "ready" | "failed" {
  const [state, setState] = useState<"loading" | "ready" | "failed">(
    typeof window !== "undefined" && window.L ? "ready" : "loading",
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (window.L) {
      setState("ready");
      return;
    }
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = LEAFLET_CSS;
      document.head.appendChild(css);
    }
    let script = document.querySelector<HTMLScriptElement>(
      `script[src="${LEAFLET_JS}"]`,
    );
    if (!script) {
      script = document.createElement("script");
      script.src = LEAFLET_JS;
      script.async = true;
      document.head.appendChild(script);
    }
    const ok = () => setState(window.L ? "ready" : "failed");
    const fail = () => setState("failed");
    script.addEventListener("load", ok);
    script.addEventListener("error", fail);
    return () => {
      script?.removeEventListener("load", ok);
      script?.removeEventListener("error", fail);
    };
  }, []);
  return state;
}

export function MapPicker({
  value,
  follow,
  height = 260,
  onChange,
}: {
  /** Уже отмеченная точка — карта открывается на ней. */
  value: Coords | null;
  /** Куда переехать, когда адрес словами нашёлся геокодером. */
  follow?: Coords | null;
  height?: number;
  /** Центр карты после каждого движения: это и есть выбранная точка. */
  onChange: (coords: Coords) => void;
}) {
  const t = useThemeColors();
  const leaflet = useLeaflet();
  const host = useRef<HTMLDivElement | null>(null);
  const map = useRef<LeafletMap | null>(null);
  // Свежий обработчик без пересоздания карты: карта живёт весь блок, а
  // `onChange` пересобирается на каждый рендер страницы.
  const emit = useRef(onChange);
  emit.current = onChange;
  const start = useRef<Coords>(value ?? FALLBACK);

  useEffect(() => {
    if (leaflet !== "ready" || !host.current || map.current) return;
    const L = window.L;
    if (!L) return;
    const instance = L.map(host.current, {
      zoomControl: false,
      attributionControl: true,
    }).setView([start.current.lat, start.current.lng], 16);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(instance);
    instance.on("moveend", () => {
      const c = instance.getCenter();
      emit.current({ lat: c.lat, lng: c.lng });
    });
    map.current = instance;
    // Первая точка отдаётся сразу: человек открыл карту — значит уже согласен
    // с тем, что видит по центру, и кнопка «Готово» не должна быть мёртвой.
    emit.current(start.current);
    return () => {
      instance.remove();
      map.current = null;
    };
  }, [leaflet]);

  // Карта едет за найденным адресом. Ключ — сами координаты: один и тот же
  // адрес, найденный второй раз, карту не дёргает.
  const followKey = follow ? `${follow.lat},${follow.lng}` : null;
  useEffect(() => {
    if (!follow || !map.current) return;
    map.current.setView([follow.lat, follow.lng], 17);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followKey]);

  return (
    <View
      style={{
        height,
        borderRadius: t.radius.input,
        overflow: "hidden",
        backgroundColor: t.fill,
      }}
    >
      {leaflet === "failed" ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 16 }}>
          <Text style={{ fontSize: 14, color: t.sub, textAlign: "center" }}>
            Карта не загрузилась. Напишите адрес словами — этого достаточно.
          </Text>
        </View>
      ) : (
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
          <div ref={host} style={{ width: "100%", height: "100%" }} />
          {/* Пин рисуем сами: маркер Leaflet тянет свои картинки с CDN, а без
              них показывает битую иконку. Свой — всегда на месте. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                width: 18,
                height: 18,
                marginBottom: 18,
                borderRadius: 9,
                border: `3px solid ${t.accent}`,
                backgroundColor: "#fff",
                boxShadow: "0 1px 6px rgba(0,0,0,0.35)",
              }}
            />
          </div>
        </div>
      )}
    </View>
  );
}
