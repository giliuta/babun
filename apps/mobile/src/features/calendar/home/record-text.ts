import type { Appointment } from "@babun/shared/local/appointments";

/** «Чистка, x2 Диагностика» — web AgendaView service summary. */
export function serviceSummary(
  a: Appointment,
  serviceNameById: ReadonlyMap<string, string>,
): string {
  // ИМЯ БЕРЁТСЯ ИЗ СНИМКА ЗАПИСИ, И ТОЛЬКО ПОТОМ ИЗ КАТАЛОГА.
  //
  // `services[].serviceName` — имя НА ДЕНЬ ВИЗИТА: его кладут при
  // сохранении именно затем, чтобы прошлая работа продолжала называться
  // так, как её назвали тогда. Каталог отвечает «как называется сейчас»,
  // а на стёртой услуге не отвечает вовсе — и лента печатала «Услуга
  // удалена» поверх работы, которую бригада делала и за которую взяли
  // деньги. Каталог остаётся вторым источником: у записей до 25 августа
  // 2026 снимка ещё нет.
  const snapshot = a.services ?? [];
  if (snapshot.length > 0) {
    return snapshot
      .map((line) => {
        const name =
          line.serviceName?.trim() ||
          serviceNameById.get(line.serviceId) ||
          "Услуга удалена";
        const q = line.quantity > 1 ? line.quantity : 1;
        return q > 1 ? `x${q} ${name}` : name;
      })
      .join(", ");
  }
  const qty = new Map<string, number>();
  for (const id of a.service_ids) qty.set(id, (qty.get(id) ?? 0) + 1);
  return [...qty.entries()]
    .map(([id, q]) => {
      const name = serviceNameById.get(id) ?? "Услуга удалена";
      return q > 1 ? `x${q} ${name}` : name;
    })
    .join(", ");
}
