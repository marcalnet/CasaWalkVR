// Apple Vision Pro's look-and-pinch (SPEC.md C0, "Apple Vision Pro: kept
// possible, not a target"): visionOS gives `transient-pointer` input sources,
// a ray from the eyes that exists only while a pinch is held. Isolated here:
// one pinch (a select) acts once along that ray. It can't be tried on a Quest;
// the decisions are tested in Node (act()).
//
//   the open settings board: presses what the ray is on
//   the doors at the scale model: presses the door (← Back needs its hold: a
//                                 pinch can't, so it does nothing)
//   at the scale model: on a room, steps inside there (the dive)
//   inside: on a floor you can stand on, teleports there (the fade)

import * as THREE from 'three';
import { worldNormal } from './xr-targets.js';

/** Starts listening on a session (a no-op for any other kind of input). */
export function attachTransientPointer(xr, session) {
	if (!session?.addEventListener) return;
	session.addEventListener('select', (e) => {
		const src = e.inputSource;
		if (src?.targetRayMode !== 'transient-pointer') return;
		if (xr.hidden || xr.layerFx) return; // (the system's menu covers the app, or a move between layers is under way: a pinch acts on nothing)
		const ref = xr.renderer.xr.getReferenceSpace?.();
		const pose = ref && e.frame?.getPose?.(src.targetRaySpace, ref);
		if (!pose) return;
		const m = new THREE.Matrix4().fromArray(pose.transform.matrix).premultiply(xr.rig.matrixWorld);
		const origin = new THREE.Vector3().setFromMatrixPosition(m);
		const dir = new THREE.Vector3(0, 0, -1).transformDirection(m);
		act(xr, origin, dir);
	});
}

/**
 * One pinch along a world ray. Returns what it did: 'board', 'door', 'inside',
 * 'teleport' or null.
 */
export function act(xr, origin, dir) {
	const ray = xr.raycaster;
	ray.set(origin, dir.clone().normalize());
	ray.far = 30;
	// The board.
	for (const panel of xr.ui.openPanels()) { // (the wings)
		const hit = ray.intersectObject(panel.mesh, false)[0];
		if (hit) {
			const target = panel.hitTest(hit.uv);
			const action = target && panel.press(target);
			if (action) xr.menuAction(action);
			return 'board';
		}
	}
	if (xr.mode === 'dollhouse') {
		const d = xr.modes.dollhouse;
		const faces = d.doors.list.filter((k) => k.group.visible).map((k) => k.face);
		const door = ray.intersectObjects(faces, false)[0];
		if (door) {
			const k = door.object.userData.key;
			if (k.spec?.hold) return null; // (← Back is held: a single pinch never leaves VR)
			const a = d.doors.press(k, null);
			if (a) xr.menuAction(a.id);
			return 'door';
		}
		const hit = ray.intersectObjects(xr.targets().pointable, false)[0];
		const floor = hit ? xr.findFloor(hit.point, 0.01) : null;
		if (!floor) return null;
		const spot = d.landing(floor);
		xr.goLayer('in', () => xr.setMode('walk', spot.model, spot.yaw), spot.model);
		return 'inside';
	}
	if (xr.mode === 'walk') {
		const t = xr.targets();
		const hit = ray.intersectObjects(t.solid, false)[0];
		if (!hit || !t.walkable.has(hit.object) || worldNormal(hit).y < 0.7) return null;
		xr.modes.walk.go(hit.point);
		return 'teleport';
	}
	return null;
}
