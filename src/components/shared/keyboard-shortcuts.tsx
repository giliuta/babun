"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const shortcuts: Record<string, string> = {
  "g o": "/orders",
  "g c": "/clients",
  "g k": "/calendar",
  "g b": "/crews",
  "g f": "/finance",
  "g i": "/inbox",
  "g r": "/reports",
  "g s": "/settings",
};

export function KeyboardShortcuts() {
  const router = useRouter();

  useEffect(() => {
    let buffer = "";
    let timer: ReturnType<typeof setTimeout>;

    function handleKeydown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      clearTimeout(timer);
      buffer += e.key;
      timer = setTimeout(() => {
        buffer = "";
      }, 500);

      const path = shortcuts[buffer];
      if (path) {
        e.preventDefault();
        router.push(path);
        buffer = "";
      }
    }

    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [router]);

  return null;
}
