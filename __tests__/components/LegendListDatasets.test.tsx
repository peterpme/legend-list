import React from "react";

import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import renderer from "react-test-renderer";
import "../setup";

const datasetLayerPropsLog: any[] = [];

beforeAll(() => {
    mock.module("react-native", () => {
        class AnimatedValue<T = number> {
            private _value: T;

            constructor(value: T) {
                this._value = value;
            }

            setValue(value: T) {
                this._value = value;
            }
        }

        const View = ({ children, ...props }: any) => React.createElement("View", props, children);
        const ScrollView = React.forwardRef(({ children, ...props }: any, ref) =>
            React.createElement("ScrollView", { ...props, ref }, children),
        );

        return {
            Animated: {
                Value: AnimatedValue,
                ScrollView,
                View: ({ children, ...props }: any) => React.createElement("AnimatedView", props, children),
                event: (_args: any, config?: { listener?: (...args: any[]) => void }) => (event: any) =>
                    config?.listener?.(event),
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
                        return style.reduce((acc, value) => ({ ...acc, ...(value || {}) }), {});
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
            React.useImperativeHandle(
                ref,
                () => ({
                    activate: () => {},
                    getCtx: () => undefined,
                    getState: () => undefined,
                    onScrollOffset: () => {},
                    setFooterSize: () => {},
                    setHeaderSize: () => {},
                    setViewportLayout: () => {},
                }),
                [],
            );
            return React.createElement("DatasetLayer", props);
        });

        return { DatasetLayer };
    });
});

describe("LegendListDatasets", () => {
    beforeEach(() => {
        datasetLayerPropsLog.length = 0;
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
});
