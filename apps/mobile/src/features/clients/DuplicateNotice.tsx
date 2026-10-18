import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { Users } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import { useClientsScopeOrNull } from "@/session/company-scope";
import { phoneKey, phoneTail, samePhone } from "@/features/clients/merge-clients";
import { GUTTER } from "@/components/ui/tokens";
import { supabase } from "@/lib/supabase";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import { useTenantId } from "@/lib/tenant";
import { useThemeColors } from "@/theme/colors";
import { useDefaultCountry } from "@/features/reference/default-country";
import { formatPhoneForDisplay, tryToE164 } from "@/lib/phone";

// «ПОХОЖЕ, ЭТО ОДИН ЧЕЛОВЕК».
//
// Дубли заводятся буднично: звонок со второго номера, импорт, два
// диспетчера одновременно. Дальше половина визитов у одной карточки,
// половина у другой, и долг не сходится ни там, ни там. Проверка на дубль
// была ТОЛЬКО при создании — на живых карточках никто никогда не смотрел.
//
// ПЛАШКА ТОЛЬКО ГОВОРИТ. Кнопка «Объединить» отсюда убрана: слияние
// необратимо, а внутри содержимого страницы кнопок не бывает. Действие живёт в «⋯» карточки, к остальным необратимым, —
// пункт «Объединить с дублем» (`use-merge-duplicate.ts`). Кого сливать, он
// узнаёт ЭТИМ ЖЕ поиском (`useDuplicateOf`): ключ один, запрос один, и плашка
// с пунктом не могут назвать дублем разные карточки.
//
// ИЩЕМ ТОЧЕЧНО. Плашка тянула ВЕСЬ справочник (`useClients`) и ВСЕ записи
// (`useAppointments`) ради одного сравнения — на тысяче клиентов это
// страница, которая ждёт два списка, чтобы почти всегда не показать ничего.
// Спрашиваем у сервера ровно то, что нужно: есть ли ЖИВАЯ чужая карточка с
// тем же номером. Сравнение — по E.164 целиком: хвост из 8 цифр склеивал
// +7 916 … с +7 926 … и обвинял разных людей в одном лице. Хвост остался
// только для старых строк, у которых `phone_e164` пуст.

/** Короче восьми цифр у неразобранного номера ключа нет: по четырём
 *  совпадёт пол-базы. */
const KEY_DIGITS = 8;

/** Ровно то, что показывает плашка. Полная карточка ей не нужна: слияние
 *  берёт строку дубля само (`useClient`), по id отсюда. */
interface DuplicateHit {
  id: string;
  full_name: string | null;
  phone: string | null;
}

/** Префикс ключа поиска: слияние сбрасывает по нему ответ, чтобы плашка и
 *  пункт «⋯» ушли вместе с архивным дублем. */
export function duplicateQueryKeyPrefix(tenantId: string | null, clientId: string) {
  return ["client-duplicate", tenantId, clientId] as const;
}

/** Поиск дубля — один на плашку и на пункт «⋯». `null` вместо карточки —
 *  искать не нужно (черновик, нет права): запрос тогда не уходит вовсе. */
function useDuplicateHit(client: Client | null | undefined): DuplicateHit | null {
  // Компания карточки, а не активная: своя база читается обычным клиентом,
  // чужая — клиентом с заголовком компании (тот же выбор, что в черновике).
  const scope = useClientsScopeOrNull();
  const activeTenantId = useTenantId();
  const tenantId = scope?.tenantId ?? activeTenantId;
  const db = scope && !scope.isActive ? tenantBoundClient(scope.tenantId) : supabase;

  const country = useDefaultCountry(client?.team_id ?? null);
  const clientId = client?.id ?? "";
  const live = !!client && !client.deleted_at;
  const key = live ? phoneKey(client.phone, country) : "";
  const e164 = live ? tryToE164(client.phone ?? "", country) : null;
  const searchable = e164 !== null || key.length >= KEY_DIGITS;

  const { data: dup = null } = useQuery({
    // Ключ несёт компанию: у клиента работодателя и своего совпадение хвостов
    // ищется в РАЗНЫХ базах, и один ключ склеил бы два ответа.
    queryKey: [...duplicateQueryKeyPrefix(tenantId, clientId), key],
    enabled: !!tenantId && !!clientId && searchable,
    staleTime: 60_000,
    queryFn: async (): Promise<DuplicateHit | null> => {
      // ТОЛЬКО ПО НОМЕРУ. Дубли ловятся и по имени (`findClientByPhoneE164`
      // умеет иначе), но за этой подсказкой стоит НЕОБРАТИМОЕ слияние: двух
      // разных Марий с разными телефонами оно предложило бы склеить.
      const liveRows = () =>
        db
          .from("clients")
          .select("id, full_name, phone")
          .eq("tenant_id", tenantId as string)
          .neq("id", clientId)
          .is("deleted_at", null);
      if (e164) {
        const { data, error } = await liveRows().eq("phone_e164", e164).limit(1);
        // Нет сети — нет и подсказки: плашка не обвиняет карточку в дубле по
        // догадке, и молчание здесь безопаснее выдумки.
        if (error) return null;
        if (data?.[0]) return data[0];
      }
      // Старые строки без `phone_e164`: их единицы, читаем целиком и сверяем
      // в приложении (`samePhone`: разобранный номер — целиком, иначе хвост).
      const { data: legacy, error } = await liveRows().is("phone_e164", null).neq("phone", "");
      if (error) return null;
      return (
        legacy?.find((row) =>
          e164 ? samePhone(row.phone, e164, country) : phoneTail(row.phone) === key,
        ) ?? null
      );
    },
  });
  return dup;
}

/** Id живого дубля карточки или `null`. */
export function useDuplicateOf(client: Client | null | undefined): string | null {
  return useDuplicateHit(client)?.id ?? null;
}

export function DuplicateNotice({ client }: { client: Client }) {
  const t = useThemeColors();
  const country = useDefaultCountry(client.team_id ?? null);
  const dup = useDuplicateHit(client);
  if (!dup) return null;

  return (
    // ОДИН ГОЛОС С ОСТАЛЬНЫМИ ПЛАШКАМИ страницы (ClientDataNotice,
    // ClientDraftNotice): та же подложка surface, тот же паддинг 16, тот же
    // ритм 15/600 заголовок + 13 пояснение. Прежний янтарный прямоугольник
    // был единственным цветным пятном на белой странице и читался как
    // предупреждение об ошибке, хотя это подсказка.
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        marginHorizontal: GUTTER,
        marginTop: 8,
        paddingHorizontal: 16,
        paddingVertical: 16,
        borderRadius: t.radius.card,
        backgroundColor: t.surface,
      }}
    >
      <Users color={t.warning} size={20} strokeWidth={2} />
      <View style={{ flex: 1 }}>
        <Text
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
        >
          Похоже, это один человек
        </Text>
        <Text
          maxFontSizeMultiplier={1.3}
          numberOfLines={2}
          style={{ marginTop: 2, fontSize: 13, color: t.sub }}
        >
          {`${dup.full_name || "Без имени"}${dup.phone ? ` · ${formatPhoneForDisplay(dup.phone, country)}` : ""}`}
        </Text>
      </View>
    </View>
  );
}

export default DuplicateNotice;
