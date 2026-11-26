// A test helper (not a test): a GLB's node tree as three.js objects, positions and
// indices only (no textures), so the controller models can be measured in Node.
import fs from 'node:fs';
import * as THREE from 'three';

/** A GLB's JSON and binary chunk. */
export function readGlb(file) {
	const b = fs.readFileSync(file), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
	const jl = dv.getUint32(12, true);
	return { json: JSON.parse(b.subarray(20, 20 + jl).toString()), bin: b.subarray(20 + jl + 8) };
}

/** A GLB's node tree as three.js objects (names, transforms, meshes with positions and indices; no textures). */
export function sceneOf(file) {
	const { json: j, bin } = readGlb(file);
	const acc = (i) => {
		const a = j.accessors[i], v = j.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
		const C = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[a.componentType];
		const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
		return new C(bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + a.count * n * C.BYTES_PER_ELEMENT));
	};
	const node = (i) => {
		const nd = j.nodes[i];
		let o;
		if (nd.mesh != null) {
			const p = j.meshes[nd.mesh].primitives[0], g = new THREE.BufferGeometry();
			g.setAttribute('position', new THREE.BufferAttribute(acc(p.attributes.POSITION), 3));
			if (p.attributes.NORMAL != null) g.setAttribute('normal', new THREE.BufferAttribute(acc(p.attributes.NORMAL), 3));
			if (p.attributes.TEXCOORD_0 != null) g.setAttribute('uv', new THREE.BufferAttribute(acc(p.attributes.TEXCOORD_0), 2));
			g.setIndex(new THREE.BufferAttribute(acc(p.indices), 1));
			o = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
		} else o = new THREE.Object3D();
		o.name = nd.name ?? '';
		if (nd.translation) o.position.fromArray(nd.translation);
		if (nd.rotation) o.quaternion.fromArray(nd.rotation);
		if (nd.scale) o.scale.fromArray(nd.scale);
		for (const c of nd.children ?? []) o.add(node(c));
		return o;
	};
	const scene = new THREE.Group();
	for (const r of j.scenes[j.scene ?? 0].nodes) scene.add(node(r));
	return scene;
}

