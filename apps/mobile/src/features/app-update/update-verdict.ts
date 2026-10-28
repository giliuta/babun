// «ВЫШЛО ОБНОВЛЕНИЕ» — ЧИСТОЕ ПРАВИЛО (приложение само говорит, что нужно
// обновиться, когда обновление вышло).
//
// Сервер (`app_release`) держит по платформе две версии: последнюю вышедшую
// и минимальную допустимую. Установленная ниже минимальной — дальше не
// пускаем («force»); ниже последней — плашка с кнопкой в магазин («soft»).

type UpdateVerdict = "force" | "soft" | "none";

/** Сравнение «1.0.10» и «1.0.9» по числам, а не по буквам. */
export function compareVersions(a: string, b: string): number {
  const pa = a.trim().split(".").map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.trim().split(".").map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function updateVerdict(input: {
  current: string | null | undefined;
  latest: string | null | undefined;
  min: string | null | undefined;
}): UpdateVerdict {
  const current = input.current?.trim();
  // Версия сборки неизвестна — молчим: ложное «обновитесь» хуже пропущенного.
  if (!current) return "none";
  if (input.min && compareVersions(current, input.min) < 0) return "force";
  if (input.latest && compareVersions(current, input.latest) < 0) return "soft";
  return "none";
}
