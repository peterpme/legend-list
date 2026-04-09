import { describe, expect, it, spyOn } from "bun:test";
import "../setup";

import { checkResetContainers } from "../../src/core/checkResetContainers";
import * as calculateItemsInViewModule from "../../src/core/calculateItemsInView";
import * as updateAveragesModule from "../../src/utils/updateAveragesOnDataChange";
import type { StateContext } from "../../src/state/state";
import type { InternalState } from "../../src/types";
import { createMockContext } from "../__mocks__/createMockContext";
import { createMockState } from "../__mocks__/createMockState";

describe("checkResetContainers", () => {
    it("uses the explicit previousData snapshot when updating averages", () => {
        const updateAveragesSpy = spyOn(updateAveragesModule, "updateAveragesOnDataChange").mockImplementation(() => {});
        const calculateItemsInViewSpy = spyOn(calculateItemsInViewModule, "calculateItemsInView").mockImplementation(
            () => {},
        );

        const mockCtx: StateContext = createMockContext({
            numContainers: 2,
        });
        const previousData = [{ id: "old" }];
        const currentData = [{ id: "new" }];
        const mockState: InternalState = createMockState({
            props: {
                data: currentData,
                maintainScrollAtEnd: false,
            },
        });

        checkResetContainers(mockCtx, mockState, false, true, previousData);

        expect(updateAveragesSpy).toHaveBeenCalledWith(mockState, previousData, currentData);
        const call = calculateItemsInViewSpy.mock.calls[0];
        expect(call[2].dataChanged).toBe(true);
        expect(call[2].doMVCP).toBe(true);
    });

    it("passes restoredDataSnapshot through to calculateItemsInView when pending restore is set", () => {
        const calculateItemsInViewSpy = spyOn(calculateItemsInViewModule, "calculateItemsInView").mockImplementation(
            () => {},
        );

        const mockCtx: StateContext = createMockContext({
            numContainers: 2,
        });
        const mockState: InternalState = createMockState({
            pendingDataSnapshotRestore: "spot|v1|geo-a",
            props: {
                data: [{ id: "a" }],
                maintainScrollAtEnd: false,
            },
        });

        checkResetContainers(mockCtx, mockState, false, true, [{ id: "old" }]);

        const call = calculateItemsInViewSpy.mock.calls[0];
        expect(call[2]).toEqual({
            dataChanged: true,
            doMVCP: true,
            restoredDataSnapshot: true,
        });
    });
});
