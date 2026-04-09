import type { InternalState } from "@/types";

export function getResolvedLayoutKey(state: InternalState, item: any, index: number): string | undefined {
    const layoutKey = state.props.getLayoutKey?.(item, index);
    if (layoutKey === undefined || layoutKey === null) {
        return undefined;
    }

    return `${state.geometryCacheKey ?? "__no_geometry__"}|${layoutKey}`;
}
