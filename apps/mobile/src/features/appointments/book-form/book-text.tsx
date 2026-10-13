import { Text as NativeText, type TextProps } from "react-native";

// Booking is information-dense. Dynamic Type stays enabled, but a bounded
// multiplier prevents headers, totals and calendar controls from colliding at
// accessibility sizes; VoiceOver still reads the full native text.
export function Text({ maxFontSizeMultiplier = 1.3, ...props }: TextProps) {
  return (
    <NativeText maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} />
  );
}
