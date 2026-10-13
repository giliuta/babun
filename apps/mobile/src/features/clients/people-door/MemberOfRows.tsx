import { SwipeRow } from "@/components/ui/SwipeRow";
import { MemberOfLine } from "@/features/clients/MemberOfLine";
import type { useMemberOf } from "@/features/clients/use-client-links";
import { useThemeColors } from "@/theme/colors";

/** «Чей он» rows under the name — built by `useClientPeople`. */
export function MemberOfRows({
  memberOf,
  isDraft,
  removeDraftLink,
  openGroup,
}: {
  memberOf: ReturnType<typeof useMemberOf>;
  isDraft: boolean;
  removeDraftLink: (groupId: string) => void;
  openGroup: (groupId: string) => void;
}) {
  const t = useThemeColors();
  return memberOf.unnamed ? (
    // Связи есть, назвать нечем — говорим словами, тише обычной строки, и
    // без шеврона: вести пока некуда.
    <MemberOfLine
      line={memberOf.unnamed === "failed" ? "Связи не загрузились" : "Связи загружаются…"}
    />
  ) : (
    <>
      {memberOf.data.map((row) =>
        isDraft ? (
          <SwipeRow
            key={row.key}
            label="Убрать"
            color={t.danger}
            onAction={() => removeDraftLink(row.groupId)}
            accessibilityLabel={`Убрать связь ${row.line}`}
          >
            <MemberOfLine line={row.line} />
          </SwipeRow>
        ) : (
          <MemberOfLine
            key={row.key}
            line={row.line}
            onOpen={() => openGroup(row.groupId)}
          />
        ),
      )}
    </>
  );
}
