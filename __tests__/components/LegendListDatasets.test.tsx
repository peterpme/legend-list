import React from "react";
import renderer from "react-test-renderer";

import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import "../setup";

const datasetLayerPropsLog: any[] = [];
const datasetLayerHandles = new Map<string, any>();
const activationLog: Array<{ key: string; offset: number }> = [];

beforeAll(() => {
    mock.module("react-native", () => {
        class AnimatedValue<T = number> {
            value: T;

            constructor(value: T) {
                this.value = value;
            }

            setValue(value: T) {
                this.value = value;
            }
        }

        const View = ({ children, ...props }: any) => React.createElement("View", props, children);
        const ScrollView = React.forwardRef(({ children, ...props }: any, ref) =>
            React.createElement("ScrollView", { ...props, ref }, children),
        );

        return {
            Animated: {
                event: (_args: any, config?: { listener?: (...args: any[]) => void }) => (event: any) =>
                    config?.listener?.(event),
                ScrollView,
                Value: AnimatedValue,
                View: ({ children, ...props }: any) => React.createElement("AnimatedView", props, children),
            },
            Dimensions: {
                get: () => ({ fontScale: 2, height: 667, scale: 2, width: 375 }),
            },
            Platform: {
                OS: "ios",
                select: (spec: any) => spec.ios ?? spec.default,
            },
            RefreshControl: (props: any) => React.createElement("RefreshControl", props),
            ScrollView,
            StyleSheet: {
                create: <T extends Record<string, any>>(styles: T): T => styles,
                flatten: (style: any) => {
                    if (Array.isArray(style)) {
                        return Object.assign({}, ...style.filter(Boolean));
                    }
                    return style || {};
                },
            },
            View,
        };
    });

    mock.module("@/components/LayoutView", () => ({
        LayoutView: ({ children, ...props }: any) => React.createElement("LayoutView", props, children),
    }));

    mock.module("@/components/DatasetLayer", () => {
        const DatasetLayer = React.forwardRef((props: any, ref) => {
            datasetLayerPropsLog.push(props);
            const datasetKey = props.datasetKey;
            const handle = {
                activate: mock((offset: number) => activationLog.push({ key: datasetKey, offset })),
                getCtx: mock(() => undefined),
                getState: mock(() => undefined),
                onScroll: mock(() => {}),
                onScrollOffset: mock(() => {}),
                setFooterSize: mock(() => {}),
                setHeaderSize: mock(() => {}),
                setViewportLayout: mock(() => {}),
            };
            datasetLayerHandles.set(datasetKey, handle);
            React.useImperativeHandle(ref, () => handle, [handle]);
            return React.createElement("DatasetLayer", props);
        });

        return { DatasetLayer };
    });
});

describe("LegendListDatasets", () => {
    beforeEach(() => {
        datasetLayerPropsLog.length = 0;
        datasetLayerHandles.clear();
        activationLog.length = 0;
    });

    it("activates only the dataset matching activeDatasetKey", async () => {
        const { LegendListDatasets } = await import("../../src/components/LegendListDatasets");

        renderer.create(
            <LegendListDatasets
                activeDatasetKey="futures"
                datasets={[
                    { data: [{ id: "spot-1" }], key: "spots" },
                    { data: [{ id: "futures-1" }], key: "futures" },
                ]}
                keyExtractor={(item: any) => item.id}
                renderItem={() => null}
            />,
        );

        const propsByDatasetKey = new Map(datasetLayerPropsLog.map((props) => [props.datasetKey, props]));

        expect(propsByDatasetKey.get("spots")?.active).toBe(false);
        expect(propsByDatasetKey.get("futures")?.active).toBe(true);
    });

    it("switches active datasets by activeDatasetKey without rebuilding the datasets array", async () => {
        const { LegendListDatasets } = await import("../../src/components/LegendListDatasets");
        const datasets = [
            { data: [{ id: "spot-1" }], key: "spots" },
            { data: [{ id: "futures-1" }], key: "futures" },
        ];

        const tree = renderer.create(
            <LegendListDatasets
                activeDatasetKey="spots"
                datasets={datasets}
                keyExtractor={(item: any) => item.id}
                renderItem={() => null}
            />,
        );

        datasetLayerPropsLog.length = 0;

        tree.update(
            <LegendListDatasets
                activeDatasetKey="futures"
                datasets={datasets}
                keyExtractor={(item: any) => item.id}
                renderItem={() => null}
            />,
        );

        const propsByDatasetKey = new Map(datasetLayerPropsLog.map((props) => [props.datasetKey, props]));

        expect(propsByDatasetKey.get("spots")?.active).toBe(false);
        expect(propsByDatasetKey.get("futures")?.active).toBe(true);
    });

    it("falls back to the first dataset when activeDatasetKey is missing", async () => {
        const { LegendListDatasets } = await import("../../src/components/LegendListDatasets");

        renderer.create(
            <LegendListDatasets
                activeDatasetKey="missing"
                datasets={[
                    { data: [{ id: "spot-1" }], key: "spots" },
                    { data: [{ id: "futures-1" }], key: "futures" },
                ]}
                keyExtractor={(item: any) => item.id}
                renderItem={() => null}
            />,
        );

        const propsByDatasetKey = new Map(datasetLayerPropsLog.map((props) => [props.datasetKey, props]));

        expect(propsByDatasetKey.get("spots")?.active).toBe(true);
        expect(propsByDatasetKey.get("futures")?.active).toBe(false);
    });

    it("activates the initially active dataset on mount", async () => {
        const { LegendListDatasets } = await import("../../src/components/LegendListDatasets");

        renderer.create(
            <LegendListDatasets
                activeDatasetKey="spots"
                datasets={[
                    { data: [{ id: "spot-1" }], key: "spots" },
                    { data: [{ id: "futures-1" }], key: "futures" },
                ]}
                keyExtractor={(item: any) => item.id}
                renderItem={() => null}
            />,
        );

        expect(activationLog).toEqual([{ key: "spots", offset: 0 }]);
    });

    it("keeps dataset layers mounted while showing the empty component", async () => {
        const { LegendListDatasets } = await import("../../src/components/LegendListDatasets");

        renderer.create(
            <LegendListDatasets
                activeDatasetKey="spots"
                datasets={[
                    { data: [], key: "spots" },
                    { data: [{ id: "futures-1" }], key: "futures" },
                ]}
                keyExtractor={(item: any) => item.id}
                ListEmptyComponent={() => React.createElement("Empty")}
                renderItem={() => null}
            />,
        );

        const propsByDatasetKey = new Map(datasetLayerPropsLog.map((props) => [props.datasetKey, props]));

        expect(propsByDatasetKey.get("spots")?.active).toBe(true);
        expect(propsByDatasetKey.get("futures")?.active).toBe(false);
    });

    it("replays viewport and header/footer measurements to layers mounted later", async () => {
        const { LegendListDatasets } = await import("../../src/components/LegendListDatasets");
        const Header = () => React.createElement("Header");
        const Footer = () => React.createElement("Footer");

        const tree = renderer.create(
            <LegendListDatasets
                activeDatasetKey="spots"
                datasets={[{ data: [{ id: "spot-1" }], key: "spots" }]}
                keyExtractor={(item: any) => item.id}
                ListFooterComponent={Footer}
                ListHeaderComponent={Header}
                renderItem={() => null}
            />,
        );

        const scrollView = tree.root.findByType("ScrollView");
        scrollView.props.onLayout({ nativeEvent: { layout: { height: 600, width: 320, x: 0, y: 0 } } });

        const layoutViews = tree.root.findAllByType("LayoutView");
        layoutViews[0].props.onLayoutChange({ height: 48, width: 320, x: 0, y: 0 }, true);
        layoutViews[1].props.onLayoutChange({ height: 24, width: 320, x: 0, y: 576 }, true);

        tree.update(
            <LegendListDatasets
                activeDatasetKey="spots"
                datasets={[
                    { data: [{ id: "spot-1" }], key: "spots" },
                    { data: [{ id: "futures-1" }], key: "futures" },
                ]}
                keyExtractor={(item: any) => item.id}
                ListFooterComponent={Footer}
                ListHeaderComponent={Header}
                renderItem={() => null}
            />,
        );

        const futuresHandle = datasetLayerHandles.get("futures");
        expect(futuresHandle.setViewportLayout).toHaveBeenCalledWith({ height: 600, width: 320, x: 0, y: 0 });
        expect(futuresHandle.setHeaderSize).toHaveBeenCalledWith(48, false, false);
        expect(futuresHandle.setFooterSize).toHaveBeenCalledWith(24);
    });

    it("uses renderScrollComponent for the shared scroll view", async () => {
        const { LegendListDatasets } = await import("../../src/components/LegendListDatasets");
        const renderScrollComponent = (scrollProps: any) => React.createElement("CustomScroll", scrollProps);

        const tree = renderer.create(
            <LegendListDatasets
                activeDatasetKey="spots"
                datasets={[{ data: [{ id: "spot-1" }], key: "spots" }]}
                keyExtractor={(item: any) => item.id}
                renderItem={() => null}
                renderScrollComponent={renderScrollComponent}
            />,
        );

        expect(tree.root.findByType("CustomScroll")).toBeDefined();
    });
});
