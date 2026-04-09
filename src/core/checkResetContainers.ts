import { calculateItemsInView } from "@/core/calculateItemsInView";
import { doMaintainScrollAtEnd } from "@/core/doMaintainScrollAtEnd";
import type { StateContext } from "@/state/state";
import type { InternalState, MaintainScrollAtEndOptions } from "@/types";
import { checkAtBottom } from "@/utils/checkAtBottom";
import { checkAtTop } from "@/utils/checkAtTop";
import { updateAveragesOnDataChange } from "@/utils/updateAveragesOnDataChange";

export function checkResetContainers(
    ctx: StateContext,
    state: InternalState,
    isFirst: boolean,
    didDataChange: boolean,
    previousData: readonly unknown[] | undefined,
) {
    if (state) {
        // Preserve averages for items that are considered equal before updating data
        if (!isFirst && didDataChange && previousData) {
            updateAveragesOnDataChange(state, previousData, state.props.data);
        }
        const { maintainScrollAtEnd } = state.props;

        if (!isFirst) {
            calculateItemsInView(ctx, state, {
                dataChanged: true,
                doMVCP: true,
                restoredDataSnapshot: state.pendingDataSnapshotRestore !== undefined,
            });

            const shouldMaintainScrollAtEnd =
                maintainScrollAtEnd === true || (maintainScrollAtEnd as MaintainScrollAtEndOptions).onDataChange;

            const didMaintainScrollAtEnd = shouldMaintainScrollAtEnd && doMaintainScrollAtEnd(ctx, state, false);

            // Reset the endReached flag if new data has been added and we didn't
            // just maintain the scroll at end
            if (!didMaintainScrollAtEnd && previousData && state.props.data.length > previousData.length) {
                state.isEndReached = false;
            }

            if (!didMaintainScrollAtEnd) {
                checkAtTop(state);
                checkAtBottom(ctx, state);
            }
        }
    }
}
