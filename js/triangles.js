// How many triangles a home will have, counted from the raw file bytes
// before anything is built (heavy homes, step 1): a heavy home is refused calmly instead of freezing or crashing
// the Quest's browser tab. Pure and fast (no text decoded, no objects per
// vertex): about 0.6 s for 7 million OBJ faces on a Mac. Node-testable.
//
// OBJ: each "f" record with n corners is n - 2 triangles. GLB: the counts its
// JSON header declares (indices, or positions, per triangle primitive), once
// per node that uses the mesh. Sweet Home 3D: each piece's model counted once
// and multiplied by the pieces that use it. Formats it cannot count (COLLADA,
// 3DS) give null: they load as before.

const F = 0x66, SPACE = 0x20, TAB = 0x09, LF = 0x0a, CR = 0x0d;

/** Triangles in OBJ bytes (a Uint8Array): one pass over the bytes. */
export function objTriangles(bytes) {
	let total = 0, i = 0;
	const n = bytes.length;
	while (i < n) {
		// The start of a line: skip leading blanks.
		while (i < n && (bytes[i] === SPACE || bytes[i] === TAB)) i++;
		if (i + 1 < n && bytes[i] === F && (bytes[i + 1] === SPACE || bytes[i + 1] === TAB)) {
			// A face: count its corners (runs of non-blank characters after the "f").
			let corners = 0, inToken = false;
			for (i += 1; i < n && bytes[i] !== LF && bytes[i] !== CR; i++) {
				const blank = bytes[i] === SPACE || bytes[i] === TAB;
				if (!blank && !inToken) corners++;
				inToken = !blank;
				// (A line continued with a backslash is rare in exported files: counted as one face.)
			}
			if (corners >= 3) total += corners - 2;
		}
		// To the next line.
		while (i < n && bytes[i] !== LF) i++;
		i++;
	}
	return total;
}

/** Triangles a GLB (Uint8Array) declares in its JSON chunk, or null if it cannot be read. */
export function glbTriangles(bytes) {
	try {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		if (view.getUint32(0, true) !== 0x46546c67) return null; // "glTF"
		const jsonLength = view.getUint32(12, true);
		if (view.getUint32(16, true) !== 0x4e4f534a) return null; // "JSON"
		const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
		return gltfTriangles(json);
	} catch {
		return null;
	}
}

/** Triangles a glTF JSON object declares: each triangle primitive, once per node using its mesh. */
export function gltfTriangles(json) {
	const accessors = json.accessors ?? [];
	const perMesh = (json.meshes ?? []).map((m) => (m.primitives ?? []).reduce((sum, p) => {
		const mode = p.mode ?? 4;
		const count = p.indices !== undefined ? accessors[p.indices]?.count : accessors[p.attributes?.POSITION]?.count;
		if (!count) return sum;
		if (mode === 4) return sum + Math.floor(count / 3); // triangles
		if (mode === 5 || mode === 6) return sum + Math.max(0, count - 2); // strip, fan
		return sum; // points and lines draw no triangles
	}, 0));
	const uses = new Array(perMesh.length).fill(0);
	for (const node of json.nodes ?? []) if (node.mesh !== undefined && node.mesh < uses.length) uses[node.mesh]++;
	return perMesh.reduce((sum, t, i) => sum + t * Math.max(1, uses[i]), 0);
}

/** Triangles in a model's bytes by what they are (OBJ, GLB), or null if unknown. kind: sniff()'s answer. */
export function modelTriangles(bytes, kind) {
	if (kind === 'glb') return glbTriangles(bytes);
	if (kind === 'gltf') { try { return gltfTriangles(JSON.parse(new TextDecoder().decode(bytes))); } catch { return null; } }
	if (kind === 'obj') return objTriangles(bytes);
	return null; // (COLLADA, 3DS, a model zipped inside the home)
}

/**
 * Triangles of a Sweet Home 3D home's furniture: each model entry counted
 * once (count(ref) returns its triangles, or null), times the pieces that use
 * it. Walls, floors and rooms are a few thousand at most: left out. Returns
 * { triangles, unknown (pieces whose model could not be counted), models (ref -> { triangles, uses }) }.
 */
export function homeTriangles(pieces, count) {
	const uses = new Map();
	for (const p of pieces) if (p.model) uses.set(p.model, (uses.get(p.model) ?? 0) + 1);
	let triangles = 0, unknown = 0;
	const models = new Map(); // ref -> { triangles, uses } (the counted ones)
	for (const [ref, n] of uses) {
		const t = count(ref);
		if (t === null || t === undefined) unknown += n;
		else { triangles += t * n; models.set(ref, { triangles: t, uses: n }); }
	}
	return { triangles, unknown, models };
}

/** What to do with a home of `triangles`: 'load', 'heavy' (load, and say it may run slowly), or 'refuse'. */
export function triangleVerdict(triangles, { warning, limit }) {
	if (triangles > limit) return 'refuse';
	if (triangles > warning) return 'heavy';
	return 'load';
}

/** The calm message for a home that is too heavy (millions with one decimal). */
export function tooHeavyMessage(triangles, limit) {
	const m = (v) => (v / 1e6).toFixed(1).replace(/\.0$/, '');
	return `This home has ${m(triangles)} million triangles: more than the ${m(limit)} million CasaWalk can open on a Quest. A Quest 2 shows about 1 million smoothly. Use lighter furniture in Sweet Home 3D, or open it on a computer.`;
}
