import type { InternalState } from "@/types";
import { getResolvedLayoutKey } from "@/utils/getResolvedLayoutKey";
import { roundSize } from "@/utils/helpers";

export function getItemSize(state: InternalState, key: string, index: number, data: any, useAverageSize?: boolean) {
    const {
        sizesKnown,
        sizes,
        scrollingTo,
        averageSizes,
        props: { estimatedItemSize, getEstimatedItemSize, getFixedItemSize, getItemType },
    } = state;
    const sizeKnown = sizesKnown.get(key);
    if (sizeKnown !== undefined) {
        return sizeKnown;
    }

    let size: number | undefined;

    const itemType = getItemType ? (getItemType(data, index) ?? "") : "";

    if (getFixedItemSize) {
        size = getFixedItemSize(index, data, itemType);
        if (size !== undefined) {
            sizesKnown.set(key, size);
            sizes.set(key, size);
            return size;
        }
    }

    const resolvedLayoutKey = getResolvedLayoutKey(state, data, index);
    if (resolvedLayoutKey !== undefined) {
        const layoutSize = state.layoutSizeCache.get(resolvedLayoutKey);
        if (layoutSize !== undefined && layoutSize > 0) {
            sizesKnown.set(key, layoutSize);
            sizes.set(key, layoutSize);
            return layoutSize;
        }
    }

    // useAverageSize will be false if getEstimatedItemSize is defined
    if (size === undefined && useAverageSize && sizeKnown === undefined && !scrollingTo) {
        // Use item type specific average if available
        const averageSizeForType = averageSizes[itemType]?.avg;
        if (averageSizeForType !== undefined) {
            size = roundSize(averageSizeForType);
        }
    }

    if (size === undefined) {
        size = sizes.get(key)!;

        if (size !== undefined) {
            return size;
        }
    }

    if (size === undefined) {
        // Get estimated size if we don't have an average or already cached size
        size = getEstimatedItemSize ? getEstimatedItemSize(index, data, itemType) : estimatedItemSize!;
    }

    // Save to rendered sizes
    sizes.set(key, size);
    return size;
}
