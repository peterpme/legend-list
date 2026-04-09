import { beforeEach, describe, expect, it } from "bun:test";
import "../setup";

import { buildDatasetSnapshotKey, pruneSnapshots, restoreDatasetSnapshot, saveDatasetSnapshot } from "../../src/core/dataCache";
import { POSITION_OUT_OF_VIEW } from "../../src/constants";
import type { StateContext } from "../../src/state/state";
import type { InternalState } from "../../src/types";
import { createMockContext } from "../__mocks__/createMockContext";
import { createMockState } from "../__mocks__/createMockState";

describe("dataCache", () => {
    let mockCtx: StateContext;
    let mockState: InternalState;

    beforeEach(() => {
        mockCtx = createMockContext({
            numContainers: 2,
        });
        mockState = createMockState({
            idCache: ["item_0", "item_1"],
            indexByKey: new Map([
                ["item_0", 0],
                ["item_1", 1],
            ]),
            layoutSizeCache: new Map(),
            positions: new Map([
                ["item_0", 0],
                ["item_1", 100],
            ]),
            props: {
                data: [{ id: 0 }, { id: 1 }],
                dataCacheKey: "spot",
                dataVersion: "v1",
                horizontal: false,
            },
            sizes: new Map([
                ["item_0", 100],
                ["item_1", 120],
            ]),
            sizesKnown: new Map([
                ["item_0", 100],
                ["item_1", 120],
            ]),
            totalSize: 220,
        });
        mockState.geometryCacheKey = "v|1|0|0|0|300";
    });

    it("builds stable snapshot keys", () => {
        expect(buildDatasetSnapshotKey("spot", "v1", "geo-a")).toBe("spot|v1|geo-a");
        expect(buildDatasetSnapshotKey(undefined, "v1", "geo-a")).toBeUndefined();
        expect(buildDatasetSnapshotKey("spot", "v1", undefined)).toBeUndefined();
    });

    it("restores the snapshot and clears container state", () => {
        saveDatasetSnapshot(mockState, "spot|v1|geo-a", {
            dataLength: 2,
            dataVersion: "v1",
            geometryCacheKey: "geo-a",
        });

        mockState.idCache = [];
        mockState.indexByKey = new Map();
        mockState.positions = new Map();
        mockState.sizes = new Map();
        mockState.sizesKnown = new Map();
        mockState.totalSize = 0;
        mockState.containerItemKeys.add("item_0");
        mockState.containerItemTypes.set(0, "row");
        mockState.stickyContainerPool.add(0);
        mockState.stickyContainers.set(0, 1);
        mockState.activeStickyIndex = 0;
        mockState.idsInView = ["item_0"];
        mockState.startBuffered = 3;
        mockState.endBuffered = 4;
        mockState.startNoBuffer = 3;
        mockState.endNoBuffer = 4;
        mockState.startBufferedId = "item_0";
        mockState.scrollForNextCalculateItemsInView = { top: 0, bottom: 100 };
        mockState.minIndexSizeChanged = 1;
        mockCtx.values.set("containerItemKey0", "item_0");
        mockCtx.values.set("containerItemData0", { id: 0 });
        mockCtx.values.set("containerPosition0", 50);
        mockCtx.values.set("containerColumn0", 1);
        mockCtx.values.set("containerSticky0", true);
        mockCtx.values.set("containerStickyOffset0", 10);
        mockCtx.values.set("totalSize", 0);

        const restored = restoreDatasetSnapshot(mockCtx, mockState, "spot|v1|geo-a");

        expect(restored).toBe(true);
        expect(mockState.idCache).toEqual(["item_0", "item_1"]);
        expect(mockState.indexByKey.get("item_1")).toBe(1);
        expect(mockState.positions.get("item_1")).toBe(100);
        expect(mockState.sizes.get("item_1")).toBe(120);
        expect(mockState.sizesKnown.get("item_1")).toBe(120);
        expect(mockState.totalSize).toBe(220);
        expect(mockState.containerItemKeys.size).toBe(0);
        expect(mockState.containerItemTypes.size).toBe(0);
        expect(mockState.stickyContainerPool.size).toBe(0);
        expect(mockState.stickyContainers.size).toBe(0);
        expect(mockState.activeStickyIndex).toBeUndefined();
        expect(mockState.idsInView).toEqual([]);
        expect(mockState.startBuffered).toBe(-1);
        expect(mockState.endBuffered).toBe(-1);
        expect(mockState.startNoBuffer).toBe(-1);
        expect(mockState.endNoBuffer).toBe(-1);
        expect(mockState.startBufferedId).toBeUndefined();
        expect(mockState.scrollForNextCalculateItemsInView).toBeUndefined();
        expect(mockState.minIndexSizeChanged).toBeUndefined();
        expect(mockCtx.values.get("containerItemKey0")).toBeUndefined();
        expect(mockCtx.values.get("containerPosition0")).toBe(POSITION_OUT_OF_VIEW);
        expect(mockCtx.values.get("containerSticky0")).toBe(false);
        expect(mockCtx.values.get("containerStickyOffset0")).toBeUndefined();
        expect(mockCtx.values.get("totalSize")).toBe(220);
    });

    it("prunes old snapshots", () => {
        for (let i = 0; i < 12; i++) {
            saveDatasetSnapshot(mockState, `spot|v${i}|geo-a`, {
                dataLength: 2,
                dataVersion: `v${i}`,
                geometryCacheKey: "geo-a",
            });
        }

        pruneSnapshots(mockState);

        expect(mockState.datasetSnapshots.size).toBeLessThanOrEqual(10);
        expect(mockState.datasetSnapshots.has("spot|v0|geo-a")).toBe(false);
    });
});
