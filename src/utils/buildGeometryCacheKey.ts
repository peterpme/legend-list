import type { ColumnWrapperStyle } from "@/types";
import { roundSize } from "@/utils/helpers";

export function buildGeometryCacheKey({
    horizontal,
    numColumns,
    columnWrapperStyle,
    otherAxisSize,
}: {
    horizontal: boolean;
    numColumns: number;
    columnWrapperStyle: ColumnWrapperStyle | undefined;
    otherAxisSize: number | undefined;
}) {
    const { gap, columnGap, rowGap } = columnWrapperStyle ?? {};
    const normalizedOtherAxisSize = otherAxisSize === undefined ? "__no_other_axis__" : roundSize(otherAxisSize);

    return [
        horizontal ? "h" : "v",
        numColumns,
        gap === undefined ? 0 : roundSize(gap),
        columnGap === undefined ? 0 : roundSize(columnGap),
        rowGap === undefined ? 0 : roundSize(rowGap),
        normalizedOtherAxisSize,
    ].join("|");
}
