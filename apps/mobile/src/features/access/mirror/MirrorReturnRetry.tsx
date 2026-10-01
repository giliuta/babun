import { useEffect } from "react";
import { usePathname, useRouter, type Href } from "expo-router";

import { returnStep } from "./mirror-return";

/** Стоит внутри стека вкладки: после выхода из «его глазами» достраивает
 *  цепочку страниц, откуда вошли (`mirror-return.ts`). Стек вкладки на
 *  выходе собирается заново — эффект на его монтировании и делает работу. */
export function MirrorReturnRetry() {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    const step = returnStep(pathname);
    if (!step) return;
    if ("navigate" in step) {
      router.navigate(step.navigate as Href);
      return;
    }
    for (const href of step.push) router.push(href as Href);
  }, [pathname, router]);
  return null;
}
