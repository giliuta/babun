import { useState } from "react";
import { Text, View } from "react-native";
import { MapPin } from "lucide-react-native";
import type { Client, Location } from "@babun/shared/local/clients";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { SectionCard } from "@/components/ui/SectionCard";
import { ObjectRow } from "@/features/clients/blocks/ObjectsBlock";
import { ObjectPickerSheet } from "@/features/clients/ObjectPickerSheet";
import { ObjectSheet } from "@/features/clients/ObjectSheet";
import { hasAddressPlace } from "@/features/clients/object-address";
import { useUpdateClientById } from "@/features/clients/queries";
import { useLocationWriter } from "@/features/clients/use-location-writer";
import { useThemeColors } from "@/theme/colors";

// БЛОК «ОБЪЕКТ» ИНВОЙСА — ПОД КАКОЙ ОБЪЕКТ ВЫПИСАН СЧЁТ.
//
// Владелец 2026-09-22: «компания может предоставлять нам несколько объектов, и
// под каждый объект надо выписывать свой инвойс — объект фиксируется, как
// клиент». Блок — тот же, что в записи: строка `ObjectRow` с карточки клиента,
// тап — шторка выбора `ObjectPickerSheet` с «Добавить объект» в футере,
// добавление — канонический `ObjectSheet` тем же писателем `locations`.
//
// АДРЕС НА БУМАГЕ — ТОЛЬКО ТОЧНЫЙ АДРЕС ОБЪЕКТА (улица, комплекс, город и
// уточнения). Нет его — адреса на инвойсе нет вовсе; об этом строка под
// объектом говорит словами, до выпуска, а не бумага после.

const EMPTY_LOCATIONS: Location[] = [];

export function InvoiceObjectBlock({
  client,
  locationId,
  onLocationChange,
}: {
  client: Client;
  locationId: string | null;
  onLocationChange: (id: string | null) => void;
}) {
  const t = useThemeColors();
  const updateClient = useUpdateClientById();
  const [picker, setPicker] = useState(false);
  const [adding, setAdding] = useState(false);
  // Только что заведённый объект: `client.locations` узнает о нём после
  // перечитывания, а выбран он должен быть сразу.
  const [added, setAdded] = useState<Location | null>(null);

  const locations = client.locations ?? EMPTY_LOCATIONS;
  const selected =
    locations.find((loc) => loc.id === locationId)
    ?? (added && added.id === locationId ? added : null);

  const writer = useLocationWriter(
    locations,
    async (patch) => {
      try {
        await updateClient.mutateAsync({ id: client.id, patch });
        return true;
      } catch {
        return false;
      }
    },
    client.id,
  );

  return (
    <>
      <SectionCard title="Объект">
        {selected ? (
          <View>
            <ObjectRow loc={selected} showNote={false} onPress={() => setPicker(true)} />
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
        ) : (
          <ChooseRow
            icon={MapPin}
            label={locations.length > 0 ? "Выбрать объект" : "Добавить объект"}
            hint={
              locations.length > 0
                ? "Открывает список объектов клиента"
                : "Открывает лист нового объекта"
            }
            onPress={() => (locations.length > 0 ? setPicker(true) : setAdding(true))}
          />
        )}
      </SectionCard>

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
    </>
  );
}
