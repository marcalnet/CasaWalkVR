// Controller vibration (SPEC.md phase 17, "Feel"): one meaning, one feel,
// everywhere ("consistent in every detail"). A light tick when touching a
// tool, a firm click when taking or returning it or placing a measuring
// point, the shutter's double knock, and a faint buzz while the marker draws.
//
// WebXR exposes the Touch controllers' motors as
// inputSource.gamepad.hapticActuators[0].pulse(strength 0..1, milliseconds),
// as three.js's own haptics example uses; a controller without one is
// simply silent. Timing comes from the frame loop's dt, never timers.

export const PATTERNS = {
	tick: [{ at: 0, strength: 0.15, ms: 12 }],
	click: [{ at: 0, strength: 0.5, ms: 25 }],
	shutter: [{ at: 0, strength: 0.6, ms: 18 }, { at: 0.06, strength: 0.35, ms: 25 }],
	close: [{ at: 0, strength: 0.3, ms: 15 }], // the wings closed by a pull at empty space (build 120, M1): softer than a click
	deny: [{ at: 0, strength: 0.12, ms: 10 }, { at: 0.06, strength: 0.12, ms: 10 }], // a disabled key, an invalid teleport
};

/** The marker's buzz: a faint pulse repeated while it draws (each pulse outlasts the gap, so it feels continuous). */
export const BUZZ = { strength: 0.08, ms: 50, every: 0.04 };

/** Sends one pulse to a controller ({ source: XRInputSource }), if it can vibrate. */
export function pulse(c, strength, ms) {
	const motor = c?.source?.gamepad?.hapticActuators?.[0];
	if (!motor?.pulse) return false;
	try {
		motor.pulse(strength, ms)?.catch?.(() => {});
	} catch { return false; /* (a controller that dropped out) */ }
	return true;
}

export class Haptics {
	constructor() {
		this.queue = []; // later pulses of a pattern: { c, at (seconds from now), strength, ms }
		this.buzzing = []; // { c, wait }
	}

	/** Plays a named pattern on a controller. */
	play(c, name) {
		for (const p of PATTERNS[name] ?? []) {
			if (p.at <= 0) pulse(c, p.strength, p.ms);
			else this.queue.push({ c, at: p.at, strength: p.strength, ms: p.ms, fresh: true });
		}
	}

	/** Starts or stops the drawing buzz on a controller. */
	buzz(c, on) {
		const i = this.buzzing.findIndex((b) => b.c === c);
		if (on && i < 0) this.buzzing.push({ c, wait: 0 });
		if (!on && i >= 0) this.buzzing.splice(i, 1);
	}

	/** Once a frame. */
	update(dt) {
		for (let i = this.queue.length - 1; i >= 0; i--) {
			const q = this.queue[i];
			if (q.fresh) { q.fresh = false; continue; } // (queued this frame: this frame's time doesn't count)
			q.at -= dt;
			if (q.at > 0) continue;
			pulse(q.c, q.strength, q.ms);
			this.queue[i] = this.queue[this.queue.length - 1];
			this.queue.pop();
		}
		for (const b of this.buzzing) {
			b.wait -= dt;
			if (b.wait > 0) continue;
			pulse(b.c, BUZZ.strength, BUZZ.ms);
			b.wait = BUZZ.every;
		}
	}

	/** Silence (leaving VR). */
	stop() {
		this.queue.length = 0;
		this.buzzing.length = 0;
	}
}
