import { useState } from "react";
import { Text, View } from "react-native";
import { MapPin } from "lucide-react-native";
import type { Client, Location } from "@babun/shared/local/clients";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { SectionCard } from "@/components/ui/SectionCard";
import { ObjectRow } from "@/features/clients/blocks/ObjectsBlock";
import { ObjectEditSheet } from "@/features/clients/ObjectEditSheet";
import { ObjectPickerSheet } from "@/features/clients/ObjectPickerSheet";
import { ObjectSheet } from "@/features/clients/ObjectSheet";
import { hasAddressPlace } from "@/features/clients/object-address";
import { useUpdateClientById } from "@/features/clients/queries";
import { useLocationWriter } from "@/features/clients/use-location-writer";
import { useThemeColors } from "@/theme/colors";

// БЛОК «ОБЪЕКТ» ИНВОЙСА — ТОТ ЖЕ, ЧТО В ЗАПИСИ.
//
// Владелец 2026-09-22: «объект всегда зафиксирован блоком… выбираю клиента —
// объект сразу не выбирается, он выбирается только нажатием: написано
// „Добавить объект“, и выбираю уже объект или создаю новый… должна быть
// такая же страница, как в записи». Поэтому ровно состояния записи:
//   • клиента нет — «Добавить объект» стоит на месте и пригашена;
//   • у клиента нет объектов — «Добавить объект» открывает лист нового;
//   • объекты есть, ни один не выбран — «Выбрать объект», шторка выбора с
//     «Добавить объект» в футере;
//   • объект выбран — строка `ObjectRow`: тап меняет объект, «…» — правка.
// Заметки у объекта здесь нет (владелец: «в целом она и не нужна»).
//
// АДРЕС НА БУМАГЕ — ТОЛЬКО ТОЧНЫЙ АДРЕС ОБЪЕКТА. Нет его — адреса на инвойсе
// нет вовсе; об этом строка под объектом говорит словами до выпуска.

const EMPTY_LOCATIONS: Location[] = [];

export function InvoiceObjectBlock({
  client,
  locationId,
  onLocationChange,
}: {
  client: Client | null;
  locationId: string | null;
  onLocationChange: (id: string | null) => void;
}) {
  const t = useThemeColors();
  const updateClient = useUpdateClientById();
  const [picker, setPicker] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  // Только что заведённый объект: `client.locations` узнает о нём после
  // перечитывания, а выбран он должен быть сразу.
  const [added, setAdded] = useState<Location | null>(null);

  const locations = client?.locations ?? EMPTY_LOCATIONS;
  const selected =
    locations.find((loc) => loc.id === locationId)
    ?? (added && added.id === locationId ? added : null);

  const writer = useLocationWriter(
    locations,
    async (patch) => {
      if (!client) return false;
      try {
        await updateClient.mutateAsync({ id: client.id, patch });
        return true;
      } catch {
        return false;
      }
    },
    client?.id ?? null,
  );

  return (
    <>
      <SectionCard title="Объект">
        {!client ? (
          <ChooseRow
            icon={MapPin}
            label="Добавить объект"
            hint="Станет доступно после выбора клиента"
            disabled
            onPress={() => {}}
          />
        ) : selected ? (
          <View>
            <ObjectRow
              loc={selected}
              showNote={false}
              onPress={() => setPicker(true)}
              onMore={() => setEditing(true)}
            />
            {hasAddressPlace(selected.addressParts) ? null : (
              <Text
                style={{
                  paddingHorizontal: 16,
                  paddingBottom: 12,
                  fontSize: 13,
                  color: t.warning,
                }}
              >
                Точного адреса нет — на инвойсе адреса не будет
              </Text>
            )}
          </View>
        ) : locations.length > 0 ? (
          <ChooseRow
            icon={MapPin}
            label="Выбрать объект"
            hint="Открывает список объектов клиента"
            onPress={() => setPicker(true)}
          />
        ) : (
          <ChooseRow
            icon={MapPin}
            label="Добавить объект"
            hint="Заводит первый объект клиента"
            onPress={() => setAdding(true)}
          />
        )}
      </SectionCard>

      {client ? (
        <>
          <ObjectPickerSheet
            visible={picker}
            locations={locations}
            selectedId={locationId}
            onSelect={(loc) => onLocationChange(loc.id)}
            onAdd={() => setAdding(true)}
            onClose={() => setPicker(false)}
          />
          <ObjectSheet
            visible={adding}
            writer={writer}
            onAdded={(loc) => {
              setAdded({ ...loc, isPrimary: locations.length === 0 });
              onLocationChange(loc.id);
            }}
            onClose={() => setAdding(false)}
          />
          <ObjectEditSheet
            visible={editing}
            client={client}
            locationId={editing ? locationId : null}
            writer={writer}
            onDeleted={(id) => {
              if (id === locationId) onLocationChange(null);
            }}
            onClose={() => setEditing(false)}
          />
        </>
      ) : null}
    </>
  );
}
