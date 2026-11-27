// Who owns a hand (the code audit's step 3: one hand arbiter; the interaction
// harmony's ladder). A pinch, a pull or a press belongs to the first thing in
// LADDER that claims the hand at that point; only a hand nothing claims may
// aim a teleport or step inside. Its rules are data (LADDER, OWNER); what can
// claim a hand is read once a frame into a snapshot (XRExperience.claims), so
// every place asks the same question of the same picture instead of measuring
// each other.
//
//   tool        a hand holding a tool never aims; nor does a point within
//               reach of the held tool (the other hand working with it)
//   dial        a tool's dial is open: the other hand's pinch and trigger are its
//   board       a wing is open: its hands are its
//   hand keys   the point at the main hand's keys, ← Back and Settings (the
//               other hand's: they float over their own hand; build 215's C8,
//               where the orb and its arc were)
//   key         a fingertip on a key (its touch ring shows), or the point at
//               a live door or level key
//   fan         the point within reach of a tool in the fan (ladder rule 5:
//               "the tools beat aims within 15 cm of a tool")
//   model       at the scale model, the point at the model
// Pure: runs in Node tests.

import { CLAIM } from './xr-targets.js';

export const OWNER = {
	NEAR: CLAIM.near, // a point this close to something is that thing's (m)
	HELD_SPREAD: 0.05, // ... plus this round a held tool (it reaches past the hand that holds it)
};

/** The ladder, in order: the first that claims a hand owns it. */
export const LADDER = ['tool', 'dial', 'board', 'hand keys', 'key', 'fan', 'model'];

/**
 * Why hand c's pinch (or pull) at point p may not aim, or null: the first
 * owner in LADDER that claims it. s: the frame's snapshot
 * ({ held: { c, at } | null, dial (a tool's options row shows), board, keys: { near(p, m), wearer } | null,
 * doors: { near(p, m) } | null, tools: [points], model: Box3 | null });
 * touching: c's fingertip is on a key (its touch ring shows).
 */
export function aimOwner(c, p, s, touching = false) {
	const NEAR = OWNER.NEAR;
	if (s.held?.c === c) return 'tool';
	if (s.dial) return 'dial';
	if (s.board) return 'board';
	if (!p) return null;
	if (s.held?.at && s.held.at.distanceTo(p) < NEAR + OWNER.HELD_SPREAD) return 'tool';
	if (touching) return 'key';
	if (s.keys && s.keys.wearer !== c && s.keys.near(p, NEAR)) return 'hand keys';
	if (s.doors?.near(p, NEAR)) return 'key';
	if (s.tools?.some((t) => t.distanceTo(p) < NEAR)) return 'fan';
	if (s.model && s.model.distanceToPoint(p) < NEAR) return 'model';
	return null;
}
