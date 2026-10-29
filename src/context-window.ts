// Extension runtime policy, independent of model names and API flavors.
// The fallback is never saved as reported model capacity.
export const RUNTIME_CONTEXT_WINDOW = 65536;

export function automaticContextWindow(maximum?: number): number {
	return typeof maximum === "number" && Number.isFinite(maximum) && maximum > 0
		? Math.max(1, Math.floor(maximum / 2)) : RUNTIME_CONTEXT_WINDOW;
}

export function contextWindowSource(maximum?: number): string {
	return typeof maximum === "number" && Number.isFinite(maximum) && maximum > 0
		? "50%" : "runtime fallback";
}
