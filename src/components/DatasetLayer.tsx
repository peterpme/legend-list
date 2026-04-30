import type { ForwardedRef } from "react";
import * as React from "react";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import {
    type Animated,
    Dimensions,
    type LayoutRectangle,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
    Platform,
    type ScrollView,
} from "react-native";

import { Containers } from "@/components/Containers";
import { IsNewArchitecture } from "@/constants";
import { calculateItemsInView } from "@/core/calculateItemsInView";
import { checkResetContainers } from "@/core/checkResetContainers";
import { doInitialAllocateContainers } from "@/core/doInitialAllocateContainers";
import { handleLayout } from "@/core/handleLayout";
import { onScroll as handleScroll } from "@/core/onScroll";
import { ScrollAdjustHandler } from "@/core/ScrollAdjustHandler";
import { scrollToIndex } from "@/core/scrollToIndex";
import { updateItemPositions } from "@/core/updateItemPositions";
import { updateItemSize } from "@/core/updateItemSize";
import { useWrapIfItem } from "@/core/useWrapIfItem";
import { setupViewability } from "@/core/viewability";
import { peek$, type StateContext, StateProvider, set$, useStateContext } from "@/state/state";
import type { DatasetEntry, InternalState, LegendListDatasetsProps, ScrollIndexWithOffset } from "@/types";
import { typedForwardRef, typedMemo } from "@/types";
import { checkAtBottom } from "@/utils/checkAtBottom";
import { checkAtTop } from "@/utils/checkAtTop";
import { getId } from "@/utils/getId";
import { getRenderedItem } from "@/utils/getRenderedItem";
import { requestAdjust } from "@/utils/requestAdjust";
import { setPaddingTop } from "@/utils/setPaddingTop";
import { updateSnapToOffsets } from "@/utils/updateSnapToOffsets";

const DEFAULT_DRAW_DISTANCE = 250;
const DEFAULT_ITEM_SIZE = 100;

export interface DatasetLayerHandle {
    /** Route a scroll offset to this dataset (only called for active dataset) */
    onScrollOffset: (offset: number) => void;
    /** Route a native scroll event to this dataset (only called for active dataset) */
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
    /** Propagate viewport layout from the parent ScrollView */
    setViewportLayout: (layout: LayoutRectangle) => void;
    /** Propagate the shared header size to this dataset's ctx */
    setHeaderSize: (size: number, active?: boolean, fromLayoutEffect?: boolean) => void;
    /** Propagate the shared footer size to this dataset's ctx */
    setFooterSize: (size: number) => void;
    /** Called when this dataset switches from inactive → active */
    activate: (scrollOffset: number) => void;
    /** Access to the StateContext for ref delegation */
    getCtx: () => StateContext;
    /** Access to the InternalState for ref delegation */
    getState: () => InternalState;
}

// Props for the inner headless layer — shared props from LegendListDatasetsProps
// plus the per-dataset data/dataVersion and the parent scroll ref.
export type DatasetLayerProps<T> = Omit<
    LegendListDatasetsProps<T>,
    | "activeDatasetKey"
    | "datasets"
    | "ListHeaderComponent"
    | "ListHeaderComponentStyle"
    | "ListFooterComponent"
    | "ListFooterComponentStyle"
    | "onLayout"
    | "refScrollView"
    | "style"
> & {
    active: boolean;
    animatedScrollY: Animated.Value;
    data: ReadonlyArray<T>;
    dataVersion?: DatasetEntry<T>["dataVersion"];
    datasetKey?: string;
    estimatedItemSize?: number;
    refScroller: React.RefObject<ScrollView>;
    stylePaddingBottom: number;
    stylePaddingTop: number;
};

const DatasetLayerInner = typedForwardRef(function DatasetLayerInner<T>(
    props: DatasetLayerProps<T>,
    ref: ForwardedRef<DatasetLayerHandle>,
) {
    const {
        active,
        alignItemsAtEnd = false,
        animatedScrollY,
        columnWrapperStyle,
        data: dataProp = [],
        dataVersion,
        datasetKey,
        drawDistance = DEFAULT_DRAW_DISTANCE,
        enableAverages = true,
        estimatedItemSize: estimatedItemSizeProp,
        estimatedListSize,
        extraData,
        getEstimatedItemSize,
        getFixedItemSize,
        getItemType,
        horizontal,
        initialContainerPoolRatio = 2,
        initialHeaderSize,
        initialScrollIndex: initialScrollIndexProp,
        initialScrollOffset: initialScrollOffsetProp,
        itemsAreEqual,
        keyExtractor: keyExtractorProp,
        maintainScrollAtEnd = false,
        maintainScrollAtEndThreshold = 0.1,
        maintainVisibleContentPosition = true,
        numColumns: numColumnsProp = 1,
        onEndReached,
        onEndReachedThreshold = 0.5,
        onItemSizeChanged,
        onLoad,
        onScroll: onScrollProp,
        onStartReached,
        onStartReachedThreshold = 0.5,
        onStickyHeaderChange,
        onViewableItemsChanged,
        recycleItems = false,
        refScroller,
        renderItem,
        snapToIndices,
        stylePaddingBottom,
        stylePaddingTop,
        stickyIndices,
        suggestEstimatedItemSize,
        viewabilityConfig,
        viewabilityConfigCallbackPairs,
        waitForInitialLayout,
        stickyHeaderConfig,
        ItemSeparatorComponent,
    } = props;

    // Build initialScroll the same way LegendListInner does
    const initialScroll: ScrollIndexWithOffset | undefined =
        initialScrollIndexProp || initialScrollOffsetProp
            ? typeof initialScrollIndexProp === "object"
                ? { index: initialScrollIndexProp.index || 0, viewOffset: initialScrollIndexProp.viewOffset || 0 }
                : { index: initialScrollIndexProp || 0, viewOffset: initialScrollOffsetProp || 0 }
            : undefined;

    // Track whether we've applied the initial scroll for this dataset
    const hasAppliedInitialScrollRef = useRef(false);

    const ctx = useStateContext();
    if (initialHeaderSize !== undefined && !ctx.internalState) {
        ctx.values.set("headerSize", initialHeaderSize);
    }
    ctx.animatedScrollY = animatedScrollY;
    ctx.columnWrapperStyle = columnWrapperStyle;

    const estimatedItemSize = estimatedItemSizeProp ?? DEFAULT_ITEM_SIZE;
    const scrollBuffer = (drawDistance ?? DEFAULT_DRAW_DISTANCE) || 1;
    const keyExtractor = keyExtractorProp ?? ((_item: any, index: number) => index.toString());
    const resolvedDatasetKey = datasetKey ?? "";
    const keyExtractorWithDataset = useMemo(
        () => (item: T, index: number) => keyExtractor(item, index, resolvedDatasetKey),
        [keyExtractor, resolvedDatasetKey],
    );
    const getEstimatedItemSizeWithDataset = useMemo(
        () =>
            getEstimatedItemSize
                ? (index: number, item: T, type: string | undefined) =>
                      getEstimatedItemSize(index, item, type, resolvedDatasetKey)
                : undefined,
        [getEstimatedItemSize, resolvedDatasetKey],
    );
    const getFixedItemSizeWithDataset = useMemo(
        () =>
            getFixedItemSize
                ? (index: number, item: T, type: string | undefined) =>
                      getFixedItemSize(index, item, type, resolvedDatasetKey)
                : undefined,
        [getFixedItemSize, resolvedDatasetKey],
    );
    const getItemTypeWithDataset = useMemo(
        () => (getItemType ? (item: T, index: number) => getItemType(item, index, resolvedDatasetKey) : undefined),
        [getItemType, resolvedDatasetKey],
    );

    const refState = useRef<InternalState>();

    if (!refState.current) {
        if (!ctx.internalState) {
            const initialScrollLength = (estimatedListSize ??
                (IsNewArchitecture ? { height: 0, width: 0 } : Dimensions.get("window")))[
                horizontal ? "width" : "height"
            ];

            ctx.internalState = {
                activeStickyIndex: undefined,
                averageSizes: {},
                columns: new Map(),
                containerItemKeys: new Set(),
                containerItemTypes: new Map(),
                dataChangeNeedsScrollUpdate: false,
                enableScrollForNextCalculateItemsInView: true,
                endBuffered: -1,
                endNoBuffer: -1,
                endReachedBlockedByTimer: false,
                firstFullyOnScreenIndex: -1,
                idCache: [],
                idsInView: [],
                indexByKey: new Map(),
                initialScroll,
                isAtEnd: false,
                isAtStart: false,
                isEndReached: false,
                isStartReached: false,
                lastBatchingAction: Date.now(),
                lastLayout: undefined,
                loadStartTime: Date.now(),
                minIndexSizeChanged: 0,
                nativeMarginTop: 0,
                needsActivationRecalc: false,
                positions: new Map(),
                props: {} as any,
                queuedCalculateItemsInView: 0,
                refScroller: undefined as any,
                scroll: 0,
                scrollAdjustHandler: new ScrollAdjustHandler(ctx),
                scrollForNextCalculateItemsInView: undefined,
                scrollHistory: [],
                scrollLength: initialScrollLength,
                scrollPending: 0,
                scrollPrev: 0,
                scrollPrevTime: 0,
                scrollProcessingEnabled: true,
                scrollTime: 0,
                sizes: new Map(),
                sizesKnown: new Map(),
                startBuffered: -1,
                startNoBuffer: -1,
                startReachedBlockedByTimer: false,
                stickyContainerPool: new Set(),
                stickyContainers: new Map(),
                timeoutSizeMessage: 0,
                timeouts: new Set(),
                totalSize: 0,
                viewabilityConfigCallbackPairs: undefined as never,
            };

            set$(ctx, "maintainVisibleContentPosition", maintainVisibleContentPosition);
            set$(ctx, "extraData", extraData);
        }
        refState.current = ctx.internalState;
    }

    const state = refState.current!;
    const isFirst = !state.props.renderItem;

    const didDataChange = state.props.dataVersion !== dataVersion || state.props.data !== dataProp;
    if (didDataChange) {
        state.dataChangeNeedsScrollUpdate = true;
        state.needsActivationRecalc = true;
    }

    // Keep initialScroll in sync with props so calculateItemsInView uses it correctly
    state.initialScroll = initialScroll;

    state.props = {
        alignItemsAtEnd,
        data: dataProp,
        datasetKey,
        dataVersion,
        enableAverages,
        estimatedItemSize,
        getEstimatedItemSize: useWrapIfItem(getEstimatedItemSizeWithDataset),
        getFixedItemSize: useWrapIfItem(getFixedItemSizeWithDataset),
        getItemType: useWrapIfItem(getItemTypeWithDataset),
        horizontal: !!horizontal,
        initialContainerPoolRatio,
        initialScroll,
        itemsAreEqual,
        keyExtractor: useWrapIfItem(keyExtractorWithDataset),
        maintainScrollAtEnd,
        maintainScrollAtEndThreshold,
        maintainVisibleContentPosition,
        numColumns: numColumnsProp,
        onEndReached,
        onEndReachedThreshold,
        onItemSizeChanged,
        onLoad,
        onScroll: onScrollProp,
        onStartReached,
        onStartReachedThreshold,
        onStickyHeaderChange,
        recycleItems: !!recycleItems,
        renderItem: renderItem!,
        scrollBuffer,
        snapToIndices,
        stickyIndicesArr: stickyIndices ?? [],
        stickyIndicesSet: useMemo(() => new Set(stickyIndices ?? []), [stickyIndices?.join(",")]),
        stylePaddingBottom,
        stylePaddingTop,
        suggestEstimatedItemSize: !!suggestEstimatedItemSize,
    };

    state.refScroller = refScroller;

    const memoizedLastItemKeys = useMemo(() => {
        if (!dataProp.length) return [];
        return Array.from({ length: Math.min(numColumnsProp, dataProp.length) }, (_, i) =>
            getId(state, dataProp.length - 1 - i),
        );
    }, [dataProp, dataVersion, numColumnsProp]);

    const initializeStateVars = useCallback(() => {
        set$(ctx, "lastItemKeys", memoizedLastItemKeys);
        set$(ctx, "numColumns", numColumnsProp);
        const prevPaddingTop = peek$(ctx, "stylePaddingTop");
        setPaddingTop(ctx, state, { stylePaddingTop });
        refState.current!.props.stylePaddingBottom = stylePaddingBottom;

        let paddingDiff = stylePaddingTop - prevPaddingTop;
        if (prevPaddingTop !== undefined && prevPaddingTop !== stylePaddingTop) {
            state.needsActivationRecalc = true;
        }
        if (maintainVisibleContentPosition && paddingDiff && prevPaddingTop !== undefined && Platform.OS === "ios") {
            if (state.scroll < 0) {
                paddingDiff += state.scroll;
            }
            requestAdjust(ctx, state, paddingDiff);
        }
    }, [maintainVisibleContentPosition, memoizedLastItemKeys, numColumnsProp, stylePaddingBottom, stylePaddingTop]);

    if (isFirst) {
        initializeStateVars();
        updateItemPositions(ctx, state, /*dataChanged*/ true);
    }

    useLayoutEffect(() => {
        const didAllocateContainers = dataProp.length > 0 && doInitialAllocateContainers(ctx, state);
        if (!didAllocateContainers) {
            checkResetContainers(ctx, state, isFirst, dataProp);
        }
    }, [dataProp, dataVersion, numColumnsProp]);

    useLayoutEffect(() => {
        if (snapToIndices) {
            updateSnapToOffsets(ctx, state);
        }
    }, [snapToIndices]);

    useLayoutEffect(() => {
        set$(ctx, "extraData", extraData);
    }, [extraData]);

    useLayoutEffect(initializeStateVars, [
        dataVersion,
        memoizedLastItemKeys.join(","),
        numColumnsProp,
        stylePaddingBottom,
        stylePaddingTop,
    ]);

    useEffect(() => {
        const viewability = setupViewability({
            onViewableItemsChanged,
            viewabilityConfig,
            viewabilityConfigCallbackPairs,
        });
        state.viewabilityConfigCallbackPairs = viewability;
        state.enableScrollForNextCalculateItemsInView = !viewability;
    }, [viewabilityConfig, viewabilityConfigCallbackPairs, onViewableItemsChanged]);

    useEffect(() => {
        const timeout = setTimeout(() => {
            state.scrollAdjustHandler.setMounted();
        }, 0);
        return () => {
            clearTimeout(timeout);
        };
    }, []);

    useImperativeHandle(
        ref,
        () => ({
            activate(scrollOffset: number) {
                // Apply initialScroll the first time this dataset becomes active
                if (initialScroll && !hasAppliedInitialScrollRef.current) {
                    hasAppliedInitialScrollRef.current = true;
                    scrollToIndex(ctx, state, {
                        animated: false,
                        index: initialScroll.index,
                        viewOffset: initialScroll.viewOffset,
                    });
                } else {
                    state.scroll = scrollOffset;
                }
                if (state.needsActivationRecalc || state.dataChangeNeedsScrollUpdate) {
                    calculateItemsInView(ctx, state, {
                        dataChanged: state.dataChangeNeedsScrollUpdate,
                        doMVCP: false,
                    });
                    state.dataChangeNeedsScrollUpdate = false;
                    state.needsActivationRecalc = false;
                }
            },
            getCtx() {
                return ctx;
            },
            getState() {
                return state;
            },
            onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
                handleScroll(ctx, state, event);
            },
            onScrollOffset(offset: number) {
                state.scroll = offset;
                state.lastBatchingAction = Date.now();
                state.dataChangeNeedsScrollUpdate = false;
                calculateItemsInView(ctx, state);
                checkAtBottom(ctx, state);
                checkAtTop(state);
            },
            setFooterSize(size: number) {
                if (peek$(ctx, "footerSize") !== size) {
                    state.needsActivationRecalc = true;
                }
                set$(ctx, "footerSize", size);
            },
            setHeaderSize(size: number, active?: boolean, fromLayoutEffect?: boolean) {
                if (peek$(ctx, "headerSize") !== size) {
                    state.needsActivationRecalc = true;
                }
                set$(ctx, "headerSize", size);

                if (active && initialScroll?.index !== undefined && hasAppliedInitialScrollRef.current) {
                    if (IsNewArchitecture && Platform.OS !== "android") {
                        if (fromLayoutEffect) {
                            scrollToIndex(ctx, state, { ...initialScroll, animated: false });
                        }
                    } else {
                        setTimeout(() => {
                            scrollToIndex(ctx, state, { ...initialScroll, animated: false });
                        }, 17);
                    }
                }
            },
            setViewportLayout(layout: LayoutRectangle) {
                handleLayout(ctx, state, layout, () => {});
            },
        }),
        [],
    );

    const fns = useMemo(
        () => ({
            getRenderedItem: (key: string) => getRenderedItem(ctx, state, key),
            updateItemSize: (itemKey: string, sizeObj: { width: number; height: number }) =>
                updateItemSize(ctx, state, itemKey, sizeObj),
        }),
        [],
    );

    return (
        <ActivityOrFragment mode={active ? "visible" : "hidden"}>
            <Containers
                getRenderedItem={fns.getRenderedItem}
                horizontal={!!horizontal}
                ItemSeparatorComponent={ItemSeparatorComponent}
                recycleItems={!!recycleItems}
                stickyHeaderConfig={stickyHeaderConfig}
                updateItemSize={fns.updateItemSize}
                waitForInitialLayout={waitForInitialLayout}
            />
        </ActivityOrFragment>
    );
});

// React.Activity is stable in React 19 but may not be in @types/react yet.
// Fall back to a plain passthrough when unavailable (e.g. React 18 / old-arch).
const Activity = (React as any).Activity as
    | React.ComponentType<{ mode: "visible" | "hidden"; children: React.ReactNode }>
    | undefined;

function ActivityOrFragment({ mode, children }: { mode: "visible" | "hidden"; children: React.ReactNode }) {
    if (Activity) {
        return <Activity mode={mode}>{children}</Activity>;
    }
    return <>{children}</>;
}

// Memoized so that when LegendListDatasets re-renders (e.g. because the active
// dataset's data changed), sibling DatasetLayers whose data and active flag
// haven't changed are skipped entirely.
export const DatasetLayer = typedMemo(
    typedForwardRef(function DatasetLayer<T>(
        props: DatasetLayerProps<T>,
        ref: ForwardedRef<DatasetLayerHandle>,
    ) {
        return (
            <StateProvider>
                <DatasetLayerInner ref={ref} {...props} />
            </StateProvider>
        );
    }),
);
