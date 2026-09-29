import { View } from "react-native";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SelectList, SelectRow } from "@/components/ui/select-rows";
import { formatPhoneForDisplay } from "@/features/clients/phone";
import { useDefaultCountry } from "@/features/clients/default-country";

import type { AccessLevel } from "../access-map";
import { PreviewFrame, levelState } from "./PreviewFrame";
import { CLIENTS_PREVIEW_KEYS } from "./preview-keys";

// ВИД ПРАВ КЛИЕНТОВ В ШТОРКЕ: список клиентов теми же строками, что шторка
// выбора клиента (`SelectRow` с буквой). «Какие клиенты» меняет, сколько их в
// списке; «Телефоны» — есть ли номер под именем; «Меняет» — кнопка создания
// внизу, как у списка клиентов.

const noop = () => {};

const OWN = [
  { name: "Анна Петрова", phone: "+35799123456" },
  { name: "Иван Смирнов", phone: "+35797654321" },
];

const OTHERS = [
  { name: "Мария Спиру", phone: "+35796112233" },
  { name: "Георгиос Андреу", phone: "+35799887766" },
];

export function ClientsPreview({
  blockKey,
  levels,
}: {
  blockKey: string;
  levels: Readonly<Record<string, AccessLevel>>;
}) {
  const country = useDefaultCountry();
  const base = levels.clients ?? "off";
  const all = levels["clients.scope"] === "all";
  const phones = levels["clients.contacts"] === "read";
  // Карточки закрыты — у зависимых строк («Какие», «Телефоны») показывать
  // нечего: базы у него нет вовсе, и рамка гасит весь список.
  const people = all ? [...OWN, ...OTHERS] : OWN;
  const state = levelState(base);
  if (!CLIENTS_PREVIEW_KEYS.includes(blockKey)) return null;
  // Зависимые строки говорят своё: список один, а меняют они в нём разное.
  const caption =
    state === "hidden"
      ? undefined
      : blockKey === "clients.scope"
        ? all
          ? "Видит всех клиентов компании"
          : "Видит только своих клиентов"
        : blockKey === "clients.contacts"
          ? phones
            ? "Видит номера клиентов"
            : "Номеров не видит"
          : undefined;
  return (
    <PreviewFrame
      state={state}
      caption={caption}
      captionOff={blockKey === "clients.contacts" && !phones}
    >
      <Card style={{ marginHorizontal: 16, marginTop: 8, paddingVertical: 8 }}>
        <SelectList>
          {people.map((person) => (
            // Номер закрыт — строки номера нет вовсе, как в его списке
            // клиентов (`ClientRow` не рисует пустой телефон).
            <SelectRow
              key={person.name}
              title={person.name}
              initial={person.name[0]}
              subtitle={phones ? formatPhoneForDisplay(person.phone, country) : undefined}
              onPress={noop}
            />
          ))}
        </SelectList>
      </Card>
      {base === "write" ? (
        <View style={{ marginHorizontal: 16, marginTop: 8 }}>
          <Button variant="secondary" label="Создать клиента" onPress={noop} />
        </View>
      ) : null}
    </PreviewFrame>
  );
}
