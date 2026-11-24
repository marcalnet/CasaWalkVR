// The safety net in the headset (code audit, stage A1): when something goes
// wrong in VR, the user sees a calm card instead of a frozen picture, and is
// never stuck.
//
//   frame(fn)   runs one frame's work (XRExperience.update) and catches what
//               it throws. A first error shows the card ("Something went
//               wrong", ← Back returns to the page) for CARD_TIME seconds and
//               the app goes on. MAX_ERRORS errors within WINDOW seconds: the
//               frame's work stops, the card says it is returning to the
//               page, and the session ends END_DELAY seconds later.
//   fail(e)     an error from elsewhere (the page's uncaught errors and
//               rejected promises while in VR): counted the same way.
//   lastError   { message, where } of the last one, for the page's status
//               line once VR has closed.
//
// The graphics context being lost and the session being hidden by Meta's
// menu are handled by the caller (js/main.js, js/xr.js), which reports them
// here. Pure: the card and the ending are hooks, so it runs in Node tests.

export const SAFETY = {
	CARD_TIME: 6, // seconds the card stays after a lone error
	WINDOW: 2, // errors counted over this many seconds ...
	MAX_ERRORS: 5, // ... this many, and the session ends
	END_DELAY: 1.5, // seconds the "returning to the page" card shows before the session ends
};

/** A short, plain description of an error (or anything thrown). */
export function describeError(e) {
	const text = e instanceof Error ? `${e.name === 'Error' ? '' : `${e.name}: `}${e.message}` : String(e?.message ?? e);
	return text.replace(/\s+/g, ' ').trim().slice(0, 160) || 'an unknown error';
}

export class SafetyNet {
	/**
	 * hooks: showCard(ending) (ending: true when the session is about to end),
	 * hideCard(), endSession(); log(e) (default console.error).
	 */
	constructor({ showCard = () => {}, hideCard = () => {}, endSession = () => {}, log = (e) => console.error(e) } = {}) {
		Object.assign(this, { showCard, hideCard, endSession, log });
		this.reset();
	}

	/** A new session: nothing counted, nothing showing. (lastError stays for the page.) */
	reset() {
		this.clock = 0;
		this.times = []; // when recent errors happened (clock seconds)
		this.cardFor = 0; // seconds the card still shows (0: hidden)
		this.ending = null; // seconds until the session ends, once it is ending
		this.errors = 0; // errors this session
	}

	/** Runs one frame's work, catching its errors. dt: seconds since the last frame. */
	frame(dt, fn) {
		this.clock += dt;
		if (this.ending === null) {
			try { fn(); } catch (e) { this.fail(e, 'frame'); }
		}
		this.tick(dt);
	}

	/** Counts an error; shows the card, or starts ending the session. */
	fail(e, where = 'page') {
		this.log(e);
		this.errors++;
		this.lastError = { message: describeError(e), where };
		if (this.ending !== null) return;
		this.times.push(this.clock);
		while (this.times.length && this.clock - this.times[0] > SAFETY.WINDOW) this.times.shift();
		if (this.times.length >= SAFETY.MAX_ERRORS) {
			this.ending = SAFETY.END_DELAY;
			this.cardFor = Infinity;
			this.showCard(true);
		} else {
			if (!this.cardFor) this.showCard(false);
			this.cardFor = SAFETY.CARD_TIME;
		}
	}

	/** The card's timer, and the ending. */
	tick(dt) {
		if (this.ending !== null) {
			this.ending -= dt;
			if (this.ending <= 0 && !this.ended) { this.ended = true; this.endSession(); }
			return;
		}
		if (this.cardFor > 0) {
			this.cardFor = Math.max(0, this.cardFor - dt);
			if (!this.cardFor) this.hideCard();
		}
	}

	/** True when the session ended because of errors (until the next session). */
	get failed() { return !!this.ended; }

	/** Called when a session starts. */
	begin() { this.reset(); this.ended = false; }
}
