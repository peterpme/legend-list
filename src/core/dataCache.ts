import { POSITION_OUT_OF_VIEW } from "@/constants";
import { peek$, type StateContext, set$ } from "@/state/state";
import type { DatasetSnapshot, InternalState } from "@/types";

const MAX_DATASET_SNAPSHOTS = 10;

export function buildDatasetSnapshotKey(
    dataCacheKey: InternalState["props"]["dataCacheKey"],
    dataVersion: InternalState["props"]["dataVersion"],
    geometryCacheKey: string | undefined,
) {
    if (dataCacheKey === undefined || geometryCacheKey === undefined) {
        return undefined;
    }

    const versionKey = dataVersion === undefined || dataVersion === null ? "__noversion__" : String(dataVersion);
    return `${String(dataCacheKey)}|${versionKey}|${geometryCacheKey}`;
}

export function saveDatasetSnapshot(
    state: InternalState,
    snapshotKey: string,
    metadata?: {
        dataLength?: number;
        dataVersion?: InternalState["props"]["dataVersion"];
        geometryCacheKey?: string | undefined;
    },
) {
    const snapshot: DatasetSnapshot = {
        dataLength: metadata?.dataLength ?? state.props.data.length,
        dataVersion: metadata?.dataVersion ?? state.props.dataVersion,
        geometryCacheKey: metadata?.geometryCacheKey ?? state.geometryCacheKey ?? "__no_geometry__",
        columns: new Map(state.columns),
        idCache: [...state.idCache],
        indexByKey: new Map(state.indexByKey),
        positions: new Map(state.positions),
        sizes: new Map(state.sizes),
        sizesKnown: new Map(state.sizesKnown),
        totalSize: state.totalSize,
    };

    state.datasetSnapshots.delete(snapshotKey);
    state.datasetSnapshots.set(snapshotKey, snapshot);
    pruneSnapshots(state);
}

export function restoreDatasetSnapshot(ctx: StateContext, state: InternalState, snapshotKey: string): boolean {
    const snapshot = state.datasetSnapshots.get(snapshotKey);
    if (!snapshot) {
        return false;
    }

    state.idCache = [...snapshot.idCache];
    state.indexByKey = new Map(snapshot.indexByKey);
    state.positions = new Map(snapshot.positions);
    state.sizes = new Map(snapshot.sizes);
    state.sizesKnown = new Map(snapshot.sizesKnown);
    state.columns = new Map(snapshot.columns);
    state.totalSize = snapshot.totalSize;
    set$(ctx, "totalSize", state.totalSize);

    resetContainerAssignments(ctx, state);
    return true;
}

export function resetContainerAssignments(ctx: StateContext, state: InternalState) {
    const numContainers = peek$(ctx, "numContainers") || 0;

    state.containerItemKeys.clear();
    state.containerItemTypes.clear();
    state.stickyContainerPool.clear();
    state.stickyContainers.clear();
    state.activeStickyIndex = undefined;
    state.idsInView = [];
    state.startBuffered = -1;
    state.endBuffered = -1;
    state.startNoBuffer = -1;
    state.endNoBuffer = -1;
    state.startBufferedId = undefined;
    state.firstFullyOnScreenIndex = -1;
    state.scrollForNextCalculateItemsInView = undefined;
    state.minIndexSizeChanged = undefined;

    for (let i = 0; i < numContainers; i++) {
        set$(ctx, `containerItemKey${i}`, undefined);
        set$(ctx, `containerItemData${i}`, undefined);
        set$(ctx, `containerPosition${i}`, POSITION_OUT_OF_VIEW);
        set$(ctx, `containerColumn${i}`, -1);
        set$(ctx, `containerSticky${i}`, false);
        set$(ctx, `containerStickyOffset${i}`, undefined);
    }
}

export function pruneSnapshots(state: InternalState) {
    while (state.datasetSnapshots.size > MAX_DATASET_SNAPSHOTS) {
        const firstKey = state.datasetSnapshots.keys().next().value as string | undefined;
        if (firstKey === undefined) {
            break;
        }
        state.datasetSnapshots.delete(firstKey);
    }
}
