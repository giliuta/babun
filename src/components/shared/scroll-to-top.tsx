"use client";

import { useState, useEffect } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const container = document.querySelector("[data-scroll-area]") ?? window;
    function handleScroll() {
      const scrollY =
        container === window
          ? window.scrollY
          : (container as HTMLElement).scrollTop;
      setVisible(scrollY > 300);
    }
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  function scrollTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <Button
      variant="outline"
      size="icon"
      className={cn(
        "fixed bottom-6 right-6 z-50 h-9 w-9 rounded-full shadow-lg transition-all duration-200",
        visible
          ? "translate-y-0 opacity-100"
          : "translate-y-4 opacity-0 pointer-events-none",
      )}
      onClick={scrollTop}
    >
      <ArrowUp className="h-4 w-4" />
    </Button>
  );
}
