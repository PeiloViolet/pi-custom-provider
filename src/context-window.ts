// Extension runtime policy, independent of model names and API flavors.
// This value is never saved as a model-reported default or maximum capacity.
export const RUNTIME_CONTEXT_WINDOW = 65536;

export function defaultContextWindow(maximum?: number, reportedDefault?: number): number {
	const capacity = typeof maximum === "number" && Number.isFinite(maximum) && maximum > 0 ? maximum : undefined;
	const window = typeof reportedDefault === "number" && Number.isFinite(reportedDefault) && reportedDefault > 0 ? reportedDefault : undefined;
	if (window !== undefined) return capacity === undefined ? window : Math.min(window, capacity);
	return capacity === undefined ? RUNTIME_CONTEXT_WINDOW : Math.max(1, Math.floor(capacity / 2));
}

export function contextWindowSource(maximum?: number, reportedDefault?: number): string {
	if (typeof reportedDefault === "number" && Number.isFinite(reportedDefault) && reportedDefault > 0) return "model default";
	if (typeof maximum === "number" && Number.isFinite(maximum) && maximum > 0) return "half capacity";
	return "runtime fallback";
}
