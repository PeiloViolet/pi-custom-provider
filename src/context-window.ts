// Application default shared by every model. Only a known capacity can lower
// it; protocol fallback values are not advertised model capacities.
export function defaultContextWindow(maximum?: number): number {
	return maximum && maximum > 0 ? Math.min(262144, maximum) : 262144;
}
