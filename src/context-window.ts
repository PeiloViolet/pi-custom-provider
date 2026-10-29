// A model may report a default window separately from capacity. Otherwise use
// its reported context window. Missing model metadata stays unknown.
export function defaultContextWindow(maximum?: number, reportedDefault?: number): number | undefined {
	const capacity = typeof maximum === "number" && maximum > 0 ? maximum : undefined;
	const window = typeof reportedDefault === "number" && reportedDefault > 0 ? reportedDefault : capacity;
	return window === undefined ? undefined : capacity === undefined ? window : Math.min(window, capacity);
}
