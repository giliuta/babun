import { Phone } from "lucide-react";
import { cn } from "@/lib/utils";

interface PhoneLinkProps {
  phone: string;
  className?: string;
  showIcon?: boolean;
}

export function PhoneLink({
  phone,
  className,
  showIcon = true,
}: PhoneLinkProps) {
  const cleaned = phone.replace(/[^+\d]/g, "");
  return (
    <a
      href={`tel:${cleaned}`}
      className={cn(
        "inline-flex items-center gap-1 font-mono text-sm hover:text-primary transition-colors",
        className,
      )}
    >
      {showIcon && <Phone className="h-3 w-3" />}
      {phone}
    </a>
  );
}
