// Short animations for the headset's feedback (SPEC.md phase 17, "Feel"):
// tools spring into the hand with a small overshoot, fly back to the fan
// along an arc, a fresh measurement line draws itself. Pure maths, driven by
// the frame loop's dt (never timers), so it runs in Node tests.
//
// Motion that reports an action stays short so it never slows you down:
// durations are capped at FEEDBACK_MAX unless a tween says it is `long`
// (the first-time introduction, a photo print floating for a moment).

export const FEEDBACK_MAX = 0.3; // seconds

// A spring that settles by t = 1: about 7% overshoot, then back.
const springRaw = (t) => 1 - Math.exp(-6.8 * t) * Math.cos(8 * t);
const SPRING_END = springRaw(1);

/** Easing curves: 0 at t = 0, exactly 1 at t = 1. */
export const ease = {
	linear: (t) => t,
	/** Fast start, gentle stop (cubic). */
	out: (t) => 1 - (1 - t) ** 3,
	/** Gentle start and stop (sine). */
	inOut: (t) => 0.5 - 0.5 * Math.cos(Math.PI * t),
	/** Smoother start and stop (no jolt at either end: speed and acceleration both start and end at 0). */
	smooth: (t) => t * t * t * (t * (6 * t - 15) + 10),
	/** Overshoots a little and settles: "springs into the hand". */
	spring: (t) => (t >= 1 ? 1 : springRaw(t) / SPRING_END),
};

/**
 * A point on an arc from `from` to `to` (THREE.Vector3s), rising `lift`
 * metres above the straight line at its middle: a quadratic curve, for
 * "flies back to the fan". Writes into `out` and returns it.
 */
export function arcPoint(from, to, lift, t, out) {
	const u = 1 - t;
	// Control point: the middle of the line, raised twice the lift (so the curve peaks at `lift`).
	const cx = (from.x + to.x) / 2, cy = (from.y + to.y) / 2 + 2 * lift, cz = (from.z + to.z) / 2;
	out.x = u * u * from.x + 2 * u * t * cx + t * t * to.x;
	out.y = u * u * from.y + 2 * u * t * cy + t * t * to.y;
	out.z = u * u * from.z + 2 * u * t * cz + t * t * to.z;
	return out;
}

/**
 * The running tweens. start() returns a handle for stop(). Each frame,
 * update(dt) calls every tween's step(eased, t) with t from 0 to 1, and
 * done() once when it ends. Nothing is allocated per frame.
 */
export class Tweens {
	constructor() {
		this.list = [];
	}

	/**
	 * @param duration  seconds (capped at FEEDBACK_MAX unless long)
	 * @param ease      an easing curve (ease.out by default)
	 * @param step(eased, t)  called every frame, and with 0 at once
	 * @param done()    called once at the end (not when stopped)
	 */
	start({ duration = 0.25, ease: curve = ease.out, step = null, done = null, long = false }) {
		const d = long ? duration : Math.min(duration, FEEDBACK_MAX);
		const tween = { t: 0, duration: Math.max(d, 1e-3), ease: curve, step, done, dead: false };
		this.list.push(tween);
		step?.(0, 0);
		return tween;
	}

	update(dt) {
		// Finished and stopped tweens are only marked here and dropped at the
		// end, so a callback may start, stop or clear tweens safely; a tween
		// started during this frame first moves in the next one.
		const n = this.list.length;
		this.updating = true;
		for (let i = 0; i < n; i++) {
			const tw = this.list[i];
			if (!tw || tw.dead) continue;
			tw.t = Math.min(tw.t + dt, tw.duration);
			const k = tw.t / tw.duration;
			tw.step?.(tw.ease(k), k);
			if (k >= 1) {
				tw.dead = true;
				tw.done?.(); // (may start another tween)
			}
		}
		this.updating = false;
		this.compact();
	}

	/** Stops a tween where it is; with finish, jumps it to the end first (and calls done). */
	stop(tween, { finish = false } = {}) {
		if (!tween || tween.dead || !this.list.includes(tween)) return;
		tween.dead = true;
		if (finish) { tween.step?.(1, 1); tween.done?.(); }
		if (!this.updating) this.compact();
	}

	/** Drops every tween (leaving VR). */
	clear() {
		for (const tw of this.list) tw.dead = true;
		if (!this.updating) this.compact();
	}

	get running() { return this.list.filter((tw) => !tw.dead).length; }

	/** Drops the finished and stopped tweens (in place: nothing allocated). */
	compact() {
		let j = 0;
		for (let i = 0; i < this.list.length; i++) if (!this.list[i].dead) this.list[j++] = this.list[i];
		this.list.length = j;
	}
}
