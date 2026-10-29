// Normalize decorated relay IDs for catalog lookup. This does not infer model
// capabilities or load any model-specific metadata.
export function normalizeModelIdCandidates(modelId: string): string[] {
	const candidates: string[] = [];
	const push = (v: string) => {
		if (v && !candidates.includes(v)) candidates.push(v);
	};
	const raw = modelId.trim();
	push(raw);
	const lower = raw.toLowerCase();
	push(lower);
	const withoutAt = lower.split("@")[0];
	push(withoutAt);
	const withoutSuffix = withoutAt.replace(/\[1m\]$/i, "");
	push(withoutSuffix);
	push(withoutSuffix.replace(/-20\d{6}$/, ""));
	push(withoutSuffix.replace(/-\d{2,9}$/, ""));
	push(withoutSuffix.replace(/-(?:latest|recent|free|preview|stable|thinking|reasoning|turbo|hi|highspeed|dev|beta|auto|labs)$/, ""));
	const lastSegment = withoutSuffix.split("/").pop() ?? "";
	if (lastSegment && lastSegment !== withoutSuffix) {
		push(lastSegment);
		push(lastSegment.replace(/-20\d{6}$/, ""));
	}
	return candidates;
}
