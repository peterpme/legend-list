import type { ForwardedRef } from "react";
import * as React from "react";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    Animated,
    type LayoutRectangle,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
    Platform,
    RefreshControl,
    type ScrollView,
    type ScrollViewProps,
    StyleSheet,
    View,
} from "react-native";

import { DatasetLayer, type DatasetLayerHandle } from "@/components/DatasetLayer";
import { LayoutView } from "@/components/LayoutView";
import { ENABLE_DEBUG_VIEW, IsNewArchitecture } from "@/constants";
import { finishScrollTo } from "@/core/finishScrollTo";
import { scrollTo } from "@/core/scrollTo";
import { scrollToIndex } from "@/core/scrollToIndex";
import { useCombinedRef } from "@/hooks/useCombinedRef";
import { useOnLayoutSync } from "@/hooks/useOnLayoutSync";
import { listen$, peek$, type StateContext, set$ } from "@/state/state";
import type { LegendListDatasetsProps, LegendListRef, ScrollState } from "@/types";
import { typedForwardRef, typedMemo } from "@/types";
import { createColumnWrapperStyle } from "@/utils/createColumnWrapperStyle";
import { getComponent } from "@/utils/getComponent";
import { getId } from "@/utils/getId";
import { extractPadding, warnDevOnce } from "@/utils/helpers";
import { useThrottledOnScroll } from "@/utils/throttledOnScroll";

// Style applied to wrapper of each inactive dataset layer so it doesn't affect
// scroll content size while keeping native layout warm for instant reactivation.
const INACTIVE_LAYER_STYLE = StyleSheet.create({
    wrapper: {
        left: 0,
        opacity: 0,
        pointerEvents: "none",
        position: "absolute",
        right: 0,
        top: 0,
    },
}).wrapper;

const noopOnScroll = () => {};

// Stagger inactive dataset mounts by this many ms so the active dataset gets
// the first frame's worth of work before siblings start allocating containers.
const DATASET_STAGGER_MS = 32;

function useLayerValue(
    ctx: StateContext | undefined,
    key: "alignItemsPaddingTop" | "scrollAdjust" | "scrollAdjustUserOffset",
) {
    const [value, setValue] = useState(() => (ctx ? (peek$(ctx, key) ?? 0) : 0));

    useEffect(() => {
        if (!ctx) {
            setValue(0);
            return;
        }

        setValue(peek$(ctx, key) ?? 0);
        return listen$(ctx, key, (next) => setValue(next ?? 0));
    }, [ctx, key]);

    return value;
}

function ActivePadding({ ctx }: { ctx: StateContext | undefined }) {
    const paddingTop = useLayerValue(ctx, "alignItemsPaddingTop");
    return <View style={{ paddingTop }} />;
}

function ActiveScrollAdjust({ ctx, horizontal }: { ctx: StateContext | undefined; horizontal: boolean }) {
    const bias = 10_000_000;
    const scrollAdjust = useLayerValue(ctx, "scrollAdjust");
    const scrollAdjustUserOffset = useLayerValue(ctx, "scrollAdjustUserOffset");
    const scrollOffset = scrollAdjust + scrollAdjustUserOffset + bias;

    return (
        <View
            style={{
                height: 0,
                left: horizontal ? scrollOffset : 0,
                position: "absolute",
                top: horizontal ? 0 : scrollOffset,
                width: 0,
            }}
        />
    );
}

export const LegendListDatasets = typedMemo(
    typedForwardRef(function LegendListDatasets<T>(
        props: LegendListDatasetsProps<T>,
        forwardedRef: ForwardedRef<LegendListRef>,
    ) {
        const {
            datasets,
            activeDatasetKey,
            datasetStaggerMs = DATASET_STAGGER_MS,
            renderItem,
            alignItemsAtEnd,
            columnWrapperStyle,
            contentContainerStyle: contentContainerStyleProp,
            drawDistance,
            enableAverages,
            estimatedListSize,
            extraData,
            getEstimatedItemSize,
            getFixedItemSize,
            getItemType,
            horizontal,
            initialContainerPoolRatio,
            initialHeaderSize,
            initialScrollIndex,
            initialScrollOffset,
            itemsAreEqual,
            ItemSeparatorComponent,
            keyExtractor,
            ListEmptyComponent,
            ListHeaderComponent,
            ListHeaderComponentStyle,
            ListFooterComponent,
            ListFooterComponentStyle,
            maintainScrollAtEnd,
            maintainScrollAtEndThreshold,
            maintainVisibleContentPosition,
            numColumns,
            onEndReached,
            onEndReachedThreshold,
            onItemSizeChanged,
            onLayout: onLayoutProp,
            onLoad,
            onMomentumScrollEnd,
            onRefresh,
            onScroll: onScrollProp,
            onStartReached,
            onStartReachedThreshold,
            onStickyHeaderChange,
            onViewableItemsChanged,
            progressViewOffset,
            recycleItems,
            refreshControl,
            refreshing,
            refScrollView,
            renderScrollComponent,
            scrollEventThrottle,
            snapToIndices,
            stickyHeaderConfig,
            stickyIndices,
            style: styleProp,
            suggestEstimatedItemSize,
            viewabilityConfig,
            viewabilityConfigCallbackPairs,
            waitForInitialLayout,
            ...rest
        } = props;

        const refScroller = useRef<ScrollView>(null);
        const combinedRef = useCombinedRef(refScroller, refScrollView);
        const sharedAnimatedScrollY = useRef(new Animated.Value(0)).current;

        // Track current scroll offset so we can pass it to a newly-activated dataset
        const currentScrollRef = useRef(0);

        const layerRefs = useRef(new Map<string, DatasetLayerHandle | null>());
        const layerRefCallbacks = useRef(new Map<string, (handle: DatasetLayerHandle | null) => void>());
        const lastViewportLayoutRef = useRef<LayoutRectangle | undefined>(undefined);
        const lastHeaderSizeRef = useRef<number | undefined>(undefined);
        const lastFooterSizeRef = useRef<number | undefined>(undefined);
        const activatedActiveKeyRef = useRef<string | undefined>(undefined);

        const activeIndex = datasets.findIndex((d) => d.key === activeDatasetKey);
        const resolvedActiveIndex = activeIndex >= 0 ? activeIndex : 0;
        const activeDataset = resolvedActiveIndex >= 0 ? datasets[resolvedActiveIndex] : undefined;
        const resolvedActiveDatasetKey = activeDataset?.key;

        if (ENABLE_DEBUG_VIEW && datasets.length > 0 && activeIndex === -1) {
            warnDevOnce(
                `LegendListDatasets.activeDatasetKey.${activeDatasetKey}`,
                `LegendListDatasets: activeDatasetKey "${activeDatasetKey}" does not match any dataset key. Falling back to the first dataset.`,
            );
        }

        // Stable ref so imperative handle methods always see the current active dataset
        const activeKeyRef = useRef<string | undefined>(resolvedActiveDatasetKey);
        activeKeyRef.current = resolvedActiveDatasetKey;

        const prevActiveDatasetKeyRef = useRef(resolvedActiveDatasetKey);
        const [activeCtx, setActiveCtx] = useState<StateContext | undefined>(undefined);

        // Mount the active dataset immediately, then progressively mount the
        // remaining datasets on a stagger so they don't compete with the active
        // one for the first frames of work.
        const [mountedKeys, setMountedKeys] = useState<Set<string>>(() => {
            const initial = new Set<string>();
            if (resolvedActiveDatasetKey) initial.add(resolvedActiveDatasetKey);
            return initial;
        });

        useEffect(() => {
            // Always make sure the active key is mounted right away.
            if (resolvedActiveDatasetKey && !mountedKeys.has(resolvedActiveDatasetKey)) {
                setMountedKeys((prev) => {
                    if (prev.has(resolvedActiveDatasetKey)) return prev;
                    const next = new Set(prev);
                    next.add(resolvedActiveDatasetKey);
                    return next;
                });
            }

            const pending = datasets.filter((d) => !mountedKeys.has(d.key) && d.key !== resolvedActiveDatasetKey);
            if (pending.length === 0) return;

            const timeouts: ReturnType<typeof setTimeout>[] = [];
            pending.forEach((dataset, i) => {
                const delay = (i + 1) * datasetStaggerMs;
                timeouts.push(
                    setTimeout(() => {
                        setMountedKeys((prev) => {
                            if (prev.has(dataset.key)) return prev;
                            const next = new Set(prev);
                            next.add(dataset.key);
                            return next;
                        });
                    }, delay),
                );
            });

            return () => {
                for (const t of timeouts) clearTimeout(t);
            };
        }, [datasets, resolvedActiveDatasetKey, mountedKeys, datasetStaggerMs]);

        const throttledOnScrollProp = useThrottledOnScroll(onScrollProp ?? noopOnScroll, scrollEventThrottle ?? 0);
        const activeOnScrollProp = scrollEventThrottle && onScrollProp ? throttledOnScrollProp : onScrollProp;

        const contentContainerStyle = useMemo(
            () => ({ ...(StyleSheet.flatten(contentContainerStyleProp) || {}) }),
            [contentContainerStyleProp],
        );
        const style = useMemo(() => ({ ...(StyleSheet.flatten(styleProp) || {}) }), [styleProp]);
        const ScrollComponent = useMemo(
            () =>
                renderScrollComponent
                    ? React.forwardRef((scrollProps: ScrollViewProps, ref) =>
                          renderScrollComponent({ ...scrollProps, ref } as any),
                      )
                    : Animated.ScrollView,
            [renderScrollComponent],
        );
        const resolvedColumnWrapperStyle = useMemo(
            () => columnWrapperStyle || createColumnWrapperStyle(contentContainerStyle),
            [columnWrapperStyle, contentContainerStyle],
        );
        const stylePaddingTopState = extractPadding(style, contentContainerStyle, "Top");
        const stylePaddingBottomState = extractPadding(style, contentContainerStyle, "Bottom");

        const getActiveLayer = useCallback(() => {
            const key = activeKeyRef.current;
            return key ? (layerRefs.current.get(key) ?? undefined) : undefined;
        }, []);

        const activateLayer = useCallback((key: string, handle: DatasetLayerHandle | null | undefined) => {
            if (!handle || activatedActiveKeyRef.current === key) {
                return;
            }

            handle.activate(currentScrollRef.current);
            activatedActiveKeyRef.current = key;
            setActiveCtx(handle.getCtx());
        }, []);

        const applyLayerMeasurements = useCallback((key: string, handle: DatasetLayerHandle) => {
            const viewportLayout = lastViewportLayoutRef.current;
            if (viewportLayout) {
                handle.setViewportLayout(viewportLayout);
            }

            const isActive = key === activeKeyRef.current;
            const headerSize = lastHeaderSizeRef.current;
            if (headerSize !== undefined) {
                handle.setHeaderSize(headerSize, isActive, false);
            }

            const footerSize = lastFooterSizeRef.current;
            if (footerSize !== undefined) {
                handle.setFooterSize(footerSize);
            }
        }, []);

        const getLayerRef = useCallback(
            (key: string) => {
                let refCallback = layerRefCallbacks.current.get(key);
                if (!refCallback) {
                    refCallback = (handle: DatasetLayerHandle | null) => {
                        if (handle) {
                            layerRefs.current.set(key, handle);
                            applyLayerMeasurements(key, handle);
                            if (key === activeKeyRef.current && refScroller.current) {
                                activateLayer(key, handle);
                            }
                        } else {
                            layerRefs.current.delete(key);
                        }
                    };
                    layerRefCallbacks.current.set(key, refCallback);
                }
                return refCallback;
            },
            [activateLayer, applyLayerMeasurements],
        );

        const getActiveCtx = useCallback(() => getActiveLayer()?.getCtx(), [getActiveLayer]);

        const getActiveState = useCallback(() => getActiveLayer()?.getState(), [getActiveLayer]);

        // When active dataset changes, tell the newly active layer to catch up
        useLayoutEffect(() => {
            const prev = prevActiveDatasetKeyRef.current;
            prevActiveDatasetKeyRef.current = resolvedActiveDatasetKey;
            if (prev !== resolvedActiveDatasetKey) {
                activatedActiveKeyRef.current = undefined;
            }
            if (resolvedActiveDatasetKey) {
                activateLayer(resolvedActiveDatasetKey, layerRefs.current.get(resolvedActiveDatasetKey));
            }
        }, [activateLayer, resolvedActiveDatasetKey]);

        useEffect(() => {
            setActiveCtx(getActiveCtx());
        }, [resolvedActiveDatasetKey, getActiveCtx]);

        const onScrollListener = useCallback(
            (event: NativeSyntheticEvent<NativeScrollEvent>) => {
                const offset = event.nativeEvent.contentOffset[horizontal ? "x" : "y"];
                currentScrollRef.current = offset;
                const key = activeKeyRef.current;
                if (key) {
                    layerRefs.current.get(key)?.onScroll(event);
                }
            },
            [horizontal],
        );

        const onScrollHandler = useMemo(() => {
            if (stickyIndices?.length) {
                return Animated.event(
                    [{ nativeEvent: { contentOffset: { [horizontal ? "x" : "y"]: sharedAnimatedScrollY } } }],
                    {
                        listener: onScrollListener,
                        useNativeDriver: true,
                    },
                );
            }
            return onScrollListener;
        }, [horizontal, onScrollListener, sharedAnimatedScrollY, stickyIndices?.length]);

        const onLayoutChange = useCallback((layout: LayoutRectangle) => {
            const viewportLayout = { height: layout.height, width: layout.width, x: 0, y: 0 };
            lastViewportLayoutRef.current = viewportLayout;
            // Propagate viewport size to ALL layers so each can allocate containers
            for (const ref of layerRefs.current.values()) {
                ref?.setViewportLayout(viewportLayout);
            }
        }, []);

        const { onLayout } = useOnLayoutSync({
            onLayoutChange,
            onLayoutProp,
            ref: refScroller as unknown as React.RefObject<View>,
        });

        const onLayoutHeader = useCallback(
            (rect: LayoutRectangle, fromLayoutEffect: boolean) => {
                const size = rect[horizontal ? "width" : "height"];
                lastHeaderSizeRef.current = size;
                for (const [key, ref] of layerRefs.current) {
                    ref?.setHeaderSize(size, key === activeKeyRef.current, fromLayoutEffect);
                }
            },
            [horizontal],
        );

        const onLayoutFooter = useCallback(
            (rect: LayoutRectangle) => {
                const size = rect[horizontal ? "width" : "height"];
                lastFooterSizeRef.current = size;
                for (const ref of layerRefs.current.values()) {
                    ref?.setFooterSize(size);
                }
            },
            [horizontal],
        );

        // Subscribe to the active dataset's snapToOffsets so the ScrollView stays in sync
        const [snapOffsets, setSnapOffsets] = useState<number[] | undefined>(undefined);
        useEffect(() => {
            const ctx = getActiveCtx();
            setActiveCtx(ctx);
            if (!snapToIndices) {
                setSnapOffsets(undefined);
                return;
            }
            if (!ctx) return;
            setSnapOffsets(peek$(ctx, "snapToOffsets"));
            return listen$(ctx, "snapToOffsets", setSnapOffsets);
        }, [resolvedActiveDatasetKey, getActiveCtx, snapToIndices]);

        // Wire up the imperative ref — delegates to the active dataset's ctx/state
        useImperativeHandle(forwardedRef, () => {
            const scrollIndexIntoView = (options: Parameters<LegendListRef["scrollIndexIntoView"]>[0]) => {
                const ctx = getActiveCtx();
                const state = getActiveState();
                if (!ctx || !state) return;
                const { index, ...rest } = options;
                const { startNoBuffer, endNoBuffer } = state;
                if (index < startNoBuffer || index > endNoBuffer) {
                    const viewPosition = index < startNoBuffer ? 0 : 1;
                    scrollToIndex(ctx, state, { ...rest, index, viewPosition });
                }
            };

            return {
                flashScrollIndicators: () => refScroller.current!.flashScrollIndicators(),
                getNativeScrollRef: () => refScroller.current!,
                getScrollableNode: () => refScroller.current!.getScrollableNode(),
                getScrollResponder: () => refScroller.current!.getScrollResponder(),
                getState: (): ScrollState => {
                    const state = getActiveState();
                    if (!state) return {} as ScrollState;
                    return {
                        activeStickyIndex: state.activeStickyIndex,
                        contentLength: state.totalSize,
                        data: state.props.data,
                        end: state.endNoBuffer,
                        endBuffered: state.endBuffered,
                        isAtEnd: state.isAtEnd,
                        isAtStart: state.isAtStart,
                        positionAtIndex: (index: number) => state.positions.get(getId(state, index))!,
                        positions: state.positions,
                        scroll: state.scroll,
                        scrollLength: state.scrollLength,
                        sizeAtIndex: (index: number) => state.sizesKnown.get(getId(state, index))!,
                        sizes: state.sizesKnown,
                        start: state.startNoBuffer,
                        startBuffered: state.startBuffered,
                    };
                },
                scrollIndexIntoView,
                scrollItemIntoView: ({ item, ...options }) => {
                    const state = getActiveState();
                    if (!state) return;
                    const index = state.props.data.indexOf(item);
                    if (index !== -1) scrollIndexIntoView({ index, ...options });
                },
                scrollToEnd: (options) => {
                    const ctx = getActiveCtx();
                    const state = getActiveState();
                    if (!ctx || !state) return;
                    const index = state.props.data.length - 1;
                    if (index !== -1) {
                        const paddingBottom = state.props.stylePaddingBottom || 0;
                        const footerSize = peek$(ctx, "footerSize") || 0;
                        scrollToIndex(ctx, state, {
                            index,
                            viewOffset: -paddingBottom - footerSize + (options?.viewOffset || 0),
                            viewPosition: 1,
                            ...options,
                        });
                    }
                },
                scrollToIndex: (params) => {
                    const ctx = getActiveCtx();
                    const state = getActiveState();
                    if (ctx && state) scrollToIndex(ctx, state, params);
                },
                scrollToItem: ({ item, ...options }) => {
                    const ctx = getActiveCtx();
                    const state = getActiveState();
                    if (!ctx || !state) return;
                    const index = state.props.data.indexOf(item);
                    if (index !== -1) scrollToIndex(ctx, state, { index, ...options });
                },
                scrollToOffset: (params) => {
                    const state = getActiveState();
                    if (state) scrollTo(state, params);
                },
                setScrollProcessingEnabled: (enabled: boolean) => {
                    const state = getActiveState();
                    if (state) state.scrollProcessingEnabled = enabled;
                },
                setVisibleContentAnchorOffset: (value: number | ((value: number) => number)) => {
                    const ctx = getActiveCtx();
                    if (!ctx) return;
                    const val = typeof value === "function" ? value(peek$(ctx, "scrollAdjustUserOffset") || 0) : value;
                    set$(ctx, "scrollAdjustUserOffset", val);
                },
            };
        }, [getActiveCtx, getActiveState]);

        const onMomentumScrollEndHandler = useCallback(
            (event: NativeSyntheticEvent<NativeScrollEvent>) => {
                const finishActiveScroll = () => {
                    const state = getActiveState();
                    if (state) {
                        finishScrollTo(state);
                    }
                };

                if (IsNewArchitecture) {
                    requestAnimationFrame(finishActiveScroll);
                } else {
                    setTimeout(finishActiveScroll, 1000);
                }

                onMomentumScrollEnd?.(event);
            },
            [getActiveState, onMomentumScrollEnd],
        );

        // Stabilize callbacks via refs so that un-memoized inline functions in the
        // parent don't invalidate sharedLayerProps and re-render all dataset layers.
        const renderItemRef = useRef(renderItem);
        renderItemRef.current = renderItem;
        const stableRenderItem = useCallback((p: any) => (renderItemRef.current as any)(p), []);

        const keyExtractorRef = useRef(keyExtractor);
        keyExtractorRef.current = keyExtractor;
        const stableKeyExtractor = keyExtractor
            ? useCallback(
                  (item: any, index: number, datasetKey: string) => keyExtractorRef.current!(item, index, datasetKey),
                  [],
              )
            : undefined;

        const onEndReachedRef = useRef(onEndReached);
        onEndReachedRef.current = onEndReached;
        const stableOnEndReached = onEndReached
            ? useCallback((info: any) => onEndReachedRef.current?.(info), [])
            : undefined;

        const onStartReachedRef = useRef(onStartReached);
        onStartReachedRef.current = onStartReached;
        const stableOnStartReached = onStartReached
            ? useCallback((info: any) => onStartReachedRef.current?.(info), [])
            : undefined;

        const onViewableItemsChangedRef = useRef(onViewableItemsChanged);
        onViewableItemsChangedRef.current = onViewableItemsChanged;
        const stableOnViewableItemsChanged = onViewableItemsChanged
            ? useCallback((info: any) => onViewableItemsChangedRef.current?.(info), [])
            : undefined;

        // Structural/layout props that legitimately need to re-propagate when changed.
        // Callbacks are excluded — they're stabilized via refs above.
        const sharedLayerProps = useMemo(
            () => ({
                alignItemsAtEnd,
                animatedScrollY: sharedAnimatedScrollY,
                columnWrapperStyle: resolvedColumnWrapperStyle,
                contentContainerStyle,
                drawDistance,
                enableAverages,
                estimatedListSize,
                extraData,
                getEstimatedItemSize,
                getFixedItemSize,
                getItemType,
                horizontal,
                ItemSeparatorComponent,
                initialContainerPoolRatio,
                initialHeaderSize,
                initialScrollIndex,
                initialScrollOffset,
                itemsAreEqual,
                keyExtractor: stableKeyExtractor,
                maintainScrollAtEnd,
                maintainScrollAtEndThreshold,
                maintainVisibleContentPosition,
                numColumns,
                onEndReached: stableOnEndReached,
                onEndReachedThreshold,
                onItemSizeChanged,
                onLoad,
                onScroll: activeOnScrollProp,
                onStartReached: stableOnStartReached,
                onStartReachedThreshold,
                onStickyHeaderChange,
                onViewableItemsChanged: stableOnViewableItemsChanged,
                recycleItems,
                renderItem: stableRenderItem,
                snapToIndices,
                stickyHeaderConfig,
                stickyIndices,
                stylePaddingBottom: stylePaddingBottomState,
                stylePaddingTop: stylePaddingTopState,
                suggestEstimatedItemSize,
                viewabilityConfig,
                viewabilityConfigCallbackPairs,
                waitForInitialLayout,
            }),
            [
                alignItemsAtEnd,
                contentContainerStyle,
                drawDistance,
                enableAverages,
                estimatedListSize,
                extraData,
                getEstimatedItemSize,
                getFixedItemSize,
                getItemType,
                horizontal,
                ItemSeparatorComponent,
                initialContainerPoolRatio,
                initialHeaderSize,
                initialScrollIndex,
                initialScrollOffset,
                itemsAreEqual,
                maintainScrollAtEnd,
                maintainScrollAtEndThreshold,
                maintainVisibleContentPosition,
                numColumns,
                onEndReachedThreshold,
                onItemSizeChanged,
                onLoad,
                activeOnScrollProp,
                onStartReachedThreshold,
                onStickyHeaderChange,
                recycleItems,
                resolvedColumnWrapperStyle,
                sharedAnimatedScrollY,
                snapToIndices,
                stylePaddingBottomState,
                stylePaddingTopState,
                stickyHeaderConfig,
                stickyIndices,
                suggestEstimatedItemSize,
                viewabilityConfig,
                viewabilityConfigCallbackPairs,
                waitForInitialLayout,
            ],
        );

        const showEmpty = ListEmptyComponent && activeDataset && activeDataset.data.length === 0;

        return (
            <ScrollComponent
                {...rest}
                contentContainerStyle={[contentContainerStyle, horizontal ? { height: "100%" } : {}]}
                horizontal={horizontal}
                maintainVisibleContentPosition={maintainVisibleContentPosition ? { minIndexForVisible: 0 } : undefined}
                onLayout={onLayout}
                onMomentumScrollEnd={onMomentumScrollEndHandler}
                onScroll={onScrollHandler}
                ref={combinedRef}
                refreshControl={
                    refreshControl
                        ? stylePaddingTopState > 0
                            ? React.cloneElement(refreshControl, {
                                  progressViewOffset:
                                      (refreshControl.props.progressViewOffset || 0) + stylePaddingTopState,
                              })
                            : refreshControl
                        : onRefresh && (
                              <RefreshControl
                                  onRefresh={onRefresh}
                                  progressViewOffset={(progressViewOffset || 0) + stylePaddingTopState}
                                  refreshing={!!refreshing}
                              />
                          )
                }
                scrollEventThrottle={Platform.OS === "web" ? 16 : undefined}
                snapToOffsets={snapOffsets}
                style={style}
            >
                {maintainVisibleContentPosition && <ActiveScrollAdjust ctx={activeCtx} horizontal={!!horizontal} />}
                <ActivePadding ctx={activeCtx} />
                {ListHeaderComponent && (
                    <LayoutView onLayoutChange={onLayoutHeader} style={ListHeaderComponentStyle}>
                        {getComponent(ListHeaderComponent)}
                    </LayoutView>
                )}
                {showEmpty && getComponent(ListEmptyComponent)}
                {datasets.map((dataset) => {
                    if (!mountedKeys.has(dataset.key)) return null;
                    const isActive = dataset.key === resolvedActiveDatasetKey;
                    return (
                        <View key={dataset.key} style={isActive ? undefined : INACTIVE_LAYER_STYLE}>
                            <DatasetLayer
                                {...sharedLayerProps}
                                data={dataset.data}
                                datasetKey={dataset.key}
                                dataVersion={dataset.dataVersion}
                                ref={getLayerRef(dataset.key)}
                                refScroller={refScroller}
                            />
                        </View>
                    );
                })}
                {ListFooterComponent && (
                    <LayoutView onLayoutChange={onLayoutFooter} style={ListFooterComponentStyle}>
                        {getComponent(ListFooterComponent)}
                    </LayoutView>
                )}
            </ScrollComponent>
        );
    }),
);
