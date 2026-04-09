import { describe, expect, it, spyOn } from "bun:test";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import "../setup";

import { LegendList } from "../../src/components/LegendList";
import * as dataCacheModule from "../../src/core/dataCache";

describe("LegendList snapshot switches", () => {
    it("saves and restores dataset snapshots across repeated filter switches", () => {
        const saveSpy = spyOn(dataCacheModule, "saveDatasetSnapshot");
        const restoreSpy = spyOn(dataCacheModule, "restoreDatasetSnapshot");

        const renderItem = (_props: any) => null;
        const spotData = [
            { id: "spot-1", kind: "spot" },
            { id: "spot-2", kind: "spot" },
        ];
        const futuresData = [
            { id: "futures-1", kind: "spot" },
            { id: "futures-2", kind: "spot" },
        ];

        let renderer: TestRenderer.ReactTestRenderer;
        act(() => {
            renderer = TestRenderer.create(
                <LegendList
                    data={spotData}
                    dataCacheKey="spot"
                    dataVersion="v1"
                    estimatedItemSize={100}
                    getLayoutKey={(item) => item.kind}
                    keyExtractor={(item) => item.id}
                    renderItem={renderItem}
                />,
            );
        });

        act(() => {
            renderer!.update(
                <LegendList
                    data={futuresData}
                    dataCacheKey="futures"
                    dataVersion="v1"
                    estimatedItemSize={100}
                    getLayoutKey={(item) => item.kind}
                    keyExtractor={(item) => item.id}
                    renderItem={renderItem}
                />,
            );
        });

        act(() => {
            renderer!.update(
                <LegendList
                    data={spotData}
                    dataCacheKey="spot"
                    dataVersion="v1"
                    estimatedItemSize={100}
                    getLayoutKey={(item) => item.kind}
                    keyExtractor={(item) => item.id}
                    renderItem={renderItem}
                />,
            );
        });

        expect(saveSpy.mock.calls.length).toBe(2);
        expect(restoreSpy.mock.calls.length).toBe(2);
        expect(saveSpy.mock.calls[0][1]).toContain("spot|v1|");
        expect(saveSpy.mock.calls[1][1]).toContain("futures|v1|");
        expect(restoreSpy.mock.calls[0][2]).toContain("futures|v1|");
        expect(restoreSpy.mock.calls[1][2]).toContain("spot|v1|");

        act(() => {
            renderer!.unmount();
        });
    });
});
