// Touch keys (milestone C0.2, SPEC.md "C0. Hands and touch"): a fingertip,
// or a controller's tip, presses a key like a real key. Pure: no three.js
// objects and no page, so the rules are tested in Node.
//
// Every key is a face on a panel. Each frame the caller measures, for one
// fingertip and one panel, how far the tip's front is in front of the face
// (depth, metres, along the face's normal; negative is pushed in), whether it
// is over the face (inside, with a small margin) and how far it moved
// sideways since the last frame (lateral, metres). stepTouch() turns that
// into the press:
//
//   away      nowhere near
//   hover     over the face, within HOVER in front: a ring shows under the tip
//   contact   touching: the face moves in with the finger (sound tick)
//   pressed   pushed CLICK in: the action runs once (sound press); the face
//             stays at its stop however deep the finger goes
//   (release) the finger comes back to RELEASE in front: the key springs back
//             and can click again (hysteresis: jitter never clicks twice)
//   blocked   it arrived from the side, from behind, or too fast: ignored
//             until it has left the key and come back to the front
//
// Only a tip that came from the front counts: it must have hovered first,
// and move in at an angle within MAX_ANGLE of the normal, slower than
// MAX_SPEED. Losing the hand is reset(): nothing completes on a loss.

export const TOUCH = {
	RADIUS: 0.009, // the fingertip (or controller tip) is a sphere this big, metres
	HOVER: 0.06, // hover zone in front of a face
	MARGIN: 0.005, // around a face's outline, still over it
	CLICK: 0.008, // pushed this far in: click
	STOP: 0.012, // the face stops here
	RELEASE: 0.015, // back this far in front: released, armed again
	MAX_ANGLE: Math.PI / 3, // from the normal (60°)
	MAX_SPEED: 1.5, // m/s at contact; faster is passing through
	KEY_GAP: 0.2, // one click per key per 0.2 s
	PANEL_GAP: 0.15, // one panel never takes two clicks from the same hand within 0.15 s
};

/** A fresh touch state, for one fingertip on one panel. */
export function touchState() {
	return { phase: 'away', depth: null, push: 0 };
}

/** Forgets a touch (the hand was lost or switched): nothing completes. */
export function reset(s) {
	s.phase = 'away';
	s.depth = null;
	s.push = 0;
}

/**
 * One frame of one fingertip on one panel. sample: { depth, inside, lateral,
 * dt }. Returns the events of this frame, in order: 'hover', 'contact',
 * 'click', 'release', 'leave', 'block' (an empty list when nothing changed).
 */
export function stepTouch(s, { depth, inside, lateral = 0, dt = 1 / 72 }) {
	const ev = [];
	const prev = s.depth;
	s.depth = depth;
	const front = depth > 0 && depth <= TOUCH.HOVER;
	switch (s.phase) {
		case 'away':
			if (inside && front) { s.phase = 'hover'; ev.push('hover'); }
			else if (inside && depth <= 0) { s.phase = 'blocked'; ev.push('block'); } // came from the side or from behind
			break;
		case 'blocked':
			// Ignored until it has left the key and come back to the front.
			if (!inside) s.phase = 'away';
			else if (depth > TOUCH.RELEASE) {
				s.phase = front ? 'hover' : 'away';
				if (front) ev.push('hover');
			}
			break;
		case 'hover':
			if (!inside || depth > TOUCH.HOVER) { s.phase = 'away'; ev.push('leave'); break; }
			if (depth <= 0) {
				const inward = prev === null ? 0 : prev - depth; // metres moved towards the face this frame
				const fast = inward / Math.max(dt, 1e-3) > TOUCH.MAX_SPEED;
				const slanted = Math.atan2(lateral, Math.max(inward, 1e-6)) > TOUCH.MAX_ANGLE;
				if (prev === null || fast || slanted) { s.phase = 'blocked'; ev.push('block'); break; }
				s.phase = 'contact';
				ev.push('contact');
				if (depth <= -TOUCH.CLICK) { s.phase = 'pressed'; ev.push('click'); }
			}
			break;
		case 'contact':
			if (!inside) { s.phase = 'away'; ev.push('leave'); }
			else if (depth > 0) s.phase = 'hover';
			else if (depth <= -TOUCH.CLICK) { s.phase = 'pressed'; ev.push('click'); }
			break;
		case 'pressed':
			if (!inside) { s.phase = 'away'; ev.push('release', 'leave'); }
			else if (depth >= TOUCH.RELEASE) { s.phase = depth <= TOUCH.HOVER ? 'hover' : 'away'; ev.push('release'); }
			break;
	}
	// How far the face is pushed in (for drawing): with the finger, to its stop.
	s.push = s.phase === 'contact' || s.phase === 'pressed' ? Math.min(Math.max(-depth, 0), TOUCH.STOP) : 0;
	return ev;
}

/** The hover ring's size under the fingertip: 2.5 cm far out, 1 cm at the face (metres, diameter). */
export function ringSize(depth) {
	const t = Math.min(Math.max(depth / TOUCH.HOVER, 0), 1);
	return 0.01 + t * 0.015;
}
