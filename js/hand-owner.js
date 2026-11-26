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
//   board       a wing is open: its hands are its
//   wrist menu  the wrist menu is open, or the point is at the orb (the
//               other hand's: the orb rides the wearer's own wrist)
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
export const LADDER = ['tool', 'board', 'wrist menu', 'key', 'fan', 'model'];

/**
 * Why hand c's pinch (or pull) at point p may not aim, or null: the first
 * owner in LADDER that claims it. s: the frame's snapshot
 * ({ held: { c, at } | null, board, wristOpen, orb: { at, wearer } | null,
 * doors: { near(p, m) } | null, tools: [points], model: Box3 | null });
 * touching: c's fingertip is on a key (its touch ring shows).
 */
export function aimOwner(c, p, s, touching = false) {
	const NEAR = OWNER.NEAR;
	if (s.held?.c === c) return 'tool';
	if (s.board) return 'board';
	if (s.wristOpen) return 'wrist menu';
	if (!p) return null;
	if (s.held?.at && s.held.at.distanceTo(p) < NEAR + OWNER.HELD_SPREAD) return 'tool';
	if (touching) return 'key';
	if (s.orb && s.orb.wearer !== c && s.orb.at.distanceTo(p) < NEAR) return 'wrist menu';
	if (s.doors?.near(p, NEAR)) return 'key';
	if (s.tools?.some((t) => t.distanceTo(p) < NEAR)) return 'fan';
	if (s.model && s.model.distanceToPoint(p) < NEAR) return 'model';
	return null;
}
