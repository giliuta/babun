import { useState } from "react";
import { View } from "react-native";

import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { parseMoneyInput } from "@/features/appointments/helpers";
import { useCreateService } from "@/features/services/queries";
import { useMoney } from "@/features/settings/currency";
import { notify } from "@/lib/notify";

// ПУСТОЙ КАТАЛОГ — НЕ ТУПИК. Первая запись у новой компании и любая команда с
// пустым прайсом упирались в белый лист: выбрать нечего, а завести услугу
// можно было только уйдя в Кабинет и вернувшись. После перехода на «услуга
// принадлежит одной команде» (2026-08-17) это стало обычным состоянием —
// команда, которой при разделении ничего не досталось.
//
// Блок ОДИН на оба каталога: лист выбора услуг в новой записи и тот же лист в
// записи из календаря. Раньше он жил приватной копией внутри одного экрана и
// был собран из своих `TextInput` с литералами радиуса — второй диалект формы
// в продукте, где поле ввода уже есть.
export function InlineServiceCreate({
  teamId,
  onCreated,
}: {
  /** Команда-владелец: услуга принадлежит ровно одной, и заводим её сразу той
   *  команде, на которую пишут запись. Без команды создавать нечего — такую
   *  услугу не покажет ни один каталог. */
  teamId: string | null;
  onCreated: (id: string) => void;
}) {
  const { symbol } = useMoney();
  const create = useCreateService();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");

  const submit = async () => {
    if (!name.trim() || !teamId) return;
    try {
      const svc = await create.mutateAsync({
        name: name.trim(),
        team_id: teamId,
        price: parseMoneyInput(price),
        duration_minutes: 60,
      });
      onCreated(svc.id);
    } catch (e) {
      notify("Не удалось создать услугу", (e as Error).message);
    }
  };

  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
      <Field
        label="Название"
        value={name}
        onChangeText={setName}
        autoFocus
      />
      <Field
        label={`Цена ${symbol}`}
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
      />
      <Button
        label="Создать услугу"
        onPress={() => void submit()}
        disabled={!name.trim() || !teamId || create.isPending}
        loading={create.isPending}
      />
    </View>
  );
}
