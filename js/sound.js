// Sound effects synthesised with Web Audio (SPEC.md phase 17, "Feel"): no
// recordings to download or licence. One sound per meaning, everywhere: a
// light tick, the meter's beep, the camera's mechanical shutter, the marker's
// soft squeak, and a whoosh when a tool flies back to the fan.
//
// A recipe is plain data (so it can be checked in Node): layers of a tone or
// of filtered noise, each with a volume envelope [[seconds, level], ...]
// that starts and ends at 0. schedule() plays a recipe on any audio context,
// live or offline (the emulated-headset test renders them offline).
//
// The Quest Browser only lets a page make sound after a tap or click, so
// unlock() is called inside the click on Enter VR. To save the headset's
// battery the context pauses after a few quiet seconds (unless the ambience
// plays) and wakes on the next effect, and it is suspended when the session
// ends. Levels (the Sound setting, from milestone B):
// off, effects, or effects and the ambience (milestone H plays the ambience
// into the `ambience` bus).

export const LEVELS = ['off', 'effects', 'all'];
const IDLE = 3; // seconds without a sound before the audio context pauses

export const RECIPES = {
	// A light tick: touching a tool, a menu-like click.
	tick: { layers: [{ tone: 'triangle', hz: 1800, env: [[0, 0], [0.002, 0.3], [0.025, 0]] }] },
	// The laser meter's beep.
	beep: { layers: [{ tone: 'sine', hz: 2900, env: [[0, 0], [0.005, 0.32], [0.07, 0.32], [0.09, 0]] }] },
	// A mechanical shutter: a sharp click with a little body, then the second curtain.
	shutter: { layers: [
		{ noise: true, band: 2500, q: 1.2, env: [[0, 0], [0.001, 0.45], [0.02, 0]] },
		{ tone: 'sine', hz: [180, 90], env: [[0, 0], [0.002, 0.25], [0.05, 0]] },
		{ at: 0.06, noise: true, band: 3500, q: 1.5, env: [[0, 0], [0.001, 0.3], [0.025, 0]] },
	] },
	// A felt tip on a surface: soft, high, short.
	squeak: { layers: [
		{ noise: true, band: [1800, 2600], q: 4, env: [[0, 0], [0.02, 0.15], [0.1, 0.12], [0.14, 0]] },
		{ tone: 'triangle', hz: [1100, 1300], env: [[0, 0], [0.02, 0.04], [0.12, 0.03], [0.14, 0]] },
	] },
	// Air moving past: a tool flying back.
	whoosh: { layers: [{ noise: true, band: [400, 1800], q: 0.8, env: [[0, 0], [0.12, 0.35], [0.3, 0]] }] },
	// Milestone C0 (SPEC.md, "C0. Hands and touch"): touch keys, the menus, moving.
	// A key clicks: a short dry click with a little body.
	press: { layers: [
		{ noise: true, band: 3000, q: 1.5, env: [[0, 0], [0.001, 0.35], [0.015, 0]] },
		{ tone: 'sine', hz: 220, env: [[0, 0], [0.002, 0.25], [0.03, 0]] },
	] },
	// A key springs back: the same, quieter and higher.
	release: { layers: [{ noise: true, band: 4000, q: 1.5, env: [[0, 0], [0.001, 0.14], [0.015, 0]] }] },
	// No: a disabled key, a teleport onto red. A low dull knock.
	deny: { layers: [{ tone: 'sine', hz: 140, env: [[0, 0], [0.004, 0.4], [0.06, 0]] }] },
	// A menu or the board opens: two soft rising notes; closes: falling.
	open: { layers: [
		{ tone: 'triangle', hz: 660, env: [[0, 0], [0.005, 0.18], [0.04, 0]] },
		{ at: 0.045, tone: 'triangle', hz: 880, env: [[0, 0], [0.005, 0.18], [0.04, 0]] },
	] },
	close: { layers: [
		{ tone: 'triangle', hz: 880, env: [[0, 0], [0.005, 0.15], [0.04, 0]] },
		{ at: 0.045, tone: 'triangle', hz: 660, env: [[0, 0], [0.005, 0.15], [0.04, 0]] },
	] },
	// Grabbing the model or the space: soft low noise.
	grab: { layers: [{ noise: true, band: [300, 800], q: 0.9, env: [[0, 0], [0.01, 0.25], [0.05, 0]] }] },
	// The model lands on the plinth, or the zoom settles on a scale: a wooden knock.
	settle: { layers: [
		{ tone: 'sine', hz: 500, env: [[0, 0], [0.002, 0.3], [0.07, 0]] },
		{ noise: true, band: 1200, q: 2, env: [[0, 0], [0.001, 0.12], [0.02, 0]] },
	] },
	// The teleport arc appears: a soft rising blip.
	aim: { layers: [{ tone: 'sine', hz: [500, 900], env: [[0, 0], [0.01, 0.15], [0.06, 0]] }] },
	// Going one layer deeper (stepping inside), and back up (to the scale model): a soft falling whoosh, and rising.
	dive: { layers: [{ noise: true, band: [1800, 400], q: 0.8, env: [[0, 0], [0.08, 0.3], [0.3, 0]] }] },
	surface: { layers: [{ noise: true, band: [400, 1800], q: 0.8, env: [[0, 0], [0.08, 0.3], [0.3, 0]] }] },
	// A teleport or stepping inside: soft air, shorter and lower than whoosh.
	step: { layers: [{ noise: true, band: [300, 1100], q: 0.8, env: [[0, 0], [0.07, 0.3], [0.18, 0]] }] },
};

/** A layer's envelope level at `t` seconds from its start (linear between points; 0 outside). */
export function envelopeAt(env, t) {
	if (t <= env[0][0] || t >= env[env.length - 1][0]) return 0;
	for (let i = 1; i < env.length; i++) {
		const [t1, v1] = env[i];
		if (t <= t1) {
			const [t0, v0] = env[i - 1];
			return v0 + (v1 - v0) * (t - t0) / Math.max(1e-9, t1 - t0);
		}
	}
	return 0;
}

/** How long a recipe sounds, in seconds. */
export function recipeLength(recipe) {
	return Math.max(...recipe.layers.map((l) => (l.at ?? 0) + l.env[l.env.length - 1][0]));
}

const noiseBuffers = new WeakMap(); // one second of white noise per audio context

function noiseBuffer(ctx) {
	let b = noiseBuffers.get(ctx);
	if (b) return b;
	b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
	const data = b.getChannelData(0);
	let x = 12345; // seeded, so every sound is the same every time
	for (let i = 0; i < data.length; i++) {
		x = (x * 1664525 + 1013904223) >>> 0;
		data[i] = x / 2147483648 - 1;
	}
	noiseBuffers.set(ctx, b);
	return b;
}

/** Sets a frequency: a number, or [from, to] swept over `len` seconds. */
function setFrequency(param, hz, t0, len) {
	if (Array.isArray(hz)) {
		param.setValueAtTime(hz[0], t0);
		param.exponentialRampToValueAtTime(hz[1], t0 + len);
	} else {
		param.setValueAtTime(hz, t0);
	}
}

/** Plays `recipe` on audio context `ctx` into node `dest`, starting at `when` (context time), at `gain`. */
export function schedule(ctx, recipe, dest, when = ctx.currentTime, gain = 1) {
	for (const layer of recipe.layers) {
		const t0 = when + (layer.at ?? 0);
		const len = layer.env[layer.env.length - 1][0];
		let source, out;
		if (layer.noise) {
			source = ctx.createBufferSource();
			source.buffer = noiseBuffer(ctx);
			source.loop = true;
			out = source;
			if (layer.band) {
				const filter = ctx.createBiquadFilter();
				filter.type = 'bandpass';
				filter.Q.value = layer.q ?? 1;
				setFrequency(filter.frequency, layer.band, t0, len);
				source.connect(filter);
				out = filter;
			}
		} else {
			source = ctx.createOscillator();
			source.type = layer.tone ?? 'sine';
			setFrequency(source.frequency, layer.hz, t0, len);
			out = source;
		}
		const env = ctx.createGain();
		env.gain.setValueAtTime(0, t0);
		for (const [t, v] of layer.env) env.gain.linearRampToValueAtTime(v * gain, t0 + t);
		out.connect(env).connect(dest);
		source.onended = () => env.disconnect();
		source.start(t0);
		source.stop(t0 + len + 0.01);
	}
}

export class Sound {
	constructor() {
		this.ctx = null; // made on the first unlock(), inside a click
		this.level = 'all';
		this.master = this.effects = this.ambience = null;
		this.ambient = false; // the ambience is playing (milestone H): never pause
		this.quiet = 0; // seconds since the last effect
		this.paused = false; // suspended (or being suspended) by us
	}

	/** Call inside a click or tap (Enter VR): makes or resumes the audio context. */
	unlock() {
		const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
		if (!Ctx) return;
		if (!this.ctx) {
			try { this.ctx = new Ctx(); } catch { return; }
			this.master = this.ctx.createGain();
			this.master.connect(this.ctx.destination);
			this.effects = this.ctx.createGain();
			this.ambience = this.ctx.createGain();
			this.effects.connect(this.master);
			this.ambience.connect(this.master);
			this.setLevel(this.level);
		}
		this.wake();
	}

	/** Once a frame: pauses the audio context after IDLE quiet seconds. */
	update(dt) {
		if (!this.ctx || this.paused || this.ambient) return;
		this.quiet += dt;
		if (this.quiet > IDLE) this.suspend();
	}

	/** Pauses all sound (quiet for a while, or the session ended): saves the headset's battery. */
	suspend() {
		if (!this.ctx || this.paused) return;
		this.paused = true;
		this.ctx.suspend?.().catch(() => {});
	}

	/** Resumes the audio context (after a pause, or a pause still under way). */
	wake() {
		this.quiet = 0;
		this.paused = false;
		this.ctx?.resume?.().catch(() => {});
	}

	/** off | effects | all (effects and ambience). */
	setLevel(level) {
		this.level = LEVELS.includes(level) ? level : 'all';
		if (!this.ctx) return;
		this.effects.gain.value = this.level === 'off' ? 0 : 1;
		this.ambience.gain.value = this.level === 'all' ? 1 : 0;
	}

	/** Plays a named effect now (silently does nothing before unlock, or with sound off). */
	play(name, gain = 1) {
		const recipe = RECIPES[name];
		if (!recipe || !this.ctx || this.level === 'off' || this.ctx.state === 'closed') return;
		// A paused context wakes (allowed once the page has had a click); the
		// sound starts as soon as it runs.
		if (this.paused || this.ctx.state !== 'running') this.wake();
		else this.quiet = 0;
		schedule(this.ctx, recipe, this.effects, this.ctx.currentTime, gain);
	}
}
