import React from "react";
import renderer from "react-test-renderer";

import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import "../setup";

const calculateItemsInViewMock = mock(() => {});

beforeAll(() => {
    mock.module("@/core/calculateItemsInView", () => ({
        calculateItemsInView: calculateItemsInViewMock,
    }));

    mock.module("@/components/Containers", () => ({
        Containers: () => null,
    }));

    mock.module("@/core/doInitialAllocateContainers", () => ({
        doInitialAllocateContainers: () => true,
    }));

    mock.module("@/core/checkResetContainers", () => ({
        checkResetContainers: () => {},
    }));

    mock.module("@/core/updateItemPositions", () => ({
        updateItemPositions: () => {},
    }));

    mock.module("@/core/updateItemSize", () => ({
        updateItemSize: () => {},
    }));

    mock.module("@/core/viewability", () => ({
        setupViewability: () => undefined,
    }));

    mock.module("@/utils/updateSnapToOffsets", () => ({
        updateSnapToOffsets: () => {},
    }));
});

describe("DatasetLayer", () => {
    beforeEach(() => {
        calculateItemsInViewMock.mockClear();
    });

    it("uses the shared scroll position without recalculating when activation is clean", async () => {
        const { DatasetLayer } = await import("../../src/components/DatasetLayer");

        const scrollTo = mock(() => {});
        const refScroller = {
            current: {
                scrollTo,
            },
        } as any;

        const handleRef = React.createRef<any>();

        renderer.create(
            <DatasetLayer
                active={false}
                animatedScrollY={{} as any}
                data={[{ id: "item-1" }]}
                datasetKey="spots"
                ref={handleRef}
                refScroller={refScroller}
                renderItem={() => null}
                stylePaddingBottom={0}
                stylePaddingTop={0}
            />,
        );

        const handle = handleRef.current;
        expect(handle).toBeDefined();

        const state = handle.getState();
        state.scroll = 120;
        state.needsActivationRecalc = false;
        state.dataChangeNeedsScrollUpdate = false;
        calculateItemsInViewMock.mockClear();

        handle.activate(10);

        expect(state.scroll).toBe(10);
        expect(scrollTo).not.toHaveBeenCalled();
        expect(calculateItemsInViewMock).not.toHaveBeenCalled();
    });
});
