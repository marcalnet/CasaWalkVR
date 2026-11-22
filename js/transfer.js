// Sending a model from a computer to the headset over a direct connection
// (SPEC.md, "Getting files onto the Quest"). This file is the protocol only:
// what is said over the connection, in what order, and the checks the
// receiving side makes. It knows nothing about PeerJS or the DOM, so the Node
// tests can run it over a fake connection; js/pairing.js wires it up.
//
// Over one connection, in order:
//   receiver -> sender   {"t":"hello","v":1}              ready to receive
//   sender -> receiver   {"t":"model","id","name","files":[{"name","size"}]}
//   sender -> receiver   binary pieces: every file's bytes, back to back
//   sender -> receiver   {"t":"end","id"}
//   receiver -> sender   {"t":"got","id"}                  received in full
// A connection can carry any number of models, one after another.
//
// The bytes travel only between the two devices (WebRTC encrypts them). What
// arrives is untrusted, like any file: names and sizes are checked here, and
// the model then goes through the same loader and limits as a picked file.

export const PROTOCOL = 1;
export const CHUNK = 16 * 1024; // bytes per piece: safe between every browser pair
const HIGH_WATER = 1024 * 1024; // pause sending while this much is still queued
const MAX_FILES = 2000; // an OBJ with its textures is a handful; a .sh3d is one
const MAX_NAME = 255;

// Pairing names: "casawalk-" and 26 random base-32 characters (130 bits), so
// nobody can guess one. Lowercase letters and digits only, as PeerJS requires.
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const PAIR_RE = /^casawalk-[a-z2-7]{26}$/;

/** A new random pairing name. */
export function newPairId() {
	const bytes = crypto.getRandomValues(new Uint8Array(26));
	return `casawalk-${[...bytes].map((b) => ALPHABET[b & 31]).join('')}`;
}

/** True for a well-formed pairing name (anything else in ?pair= is ignored). */
export function isPairId(s) { return typeof s === 'string' && PAIR_RE.test(s); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Sends one model.
 * @param channel  { send(string|ArrayBuffer), buffered(): bytes still queued }
 * @param files    [{ name, bytes: Uint8Array }]
 * @param name     what to call it on the headset
 * @param opts     { onProgress(sentBytes, totalBytes), id }
 * @returns the model's id (the receiver answers {"t":"got"} with it)
 */
export async function sendModel(channel, files, name, { onProgress = () => {}, id = Math.random().toString(36).slice(2, 10) } = {}) {
	const total = files.reduce((n, f) => n + f.bytes.byteLength, 0);
	channel.send(JSON.stringify({ t: 'model', id, name: String(name), files: files.map((f) => ({ name: String(f.name), size: f.bytes.byteLength })) }));
	let sent = 0;
	for (const f of files) {
		for (let at = 0; at < f.bytes.byteLength; at += CHUNK) {
			// Let the connection drain instead of queueing the whole file in memory.
			while (channel.buffered() > HIGH_WATER) await sleep(15);
			const piece = f.bytes.subarray(at, Math.min(at + CHUNK, f.bytes.byteLength));
			channel.send(piece.slice().buffer); // (a copy: an ArrayBuffer of exactly this piece)
			sent += piece.byteLength;
			onProgress(sent, total);
		}
	}
	channel.send(JSON.stringify({ t: 'end', id }));
	return id;
}

/**
 * The receiving side: feed it every message as it arrives (receive(data)).
 *   onStart({ id, name, files, total })   a model is on its way
 *   onProgress(gotBytes, totalBytes)
 *   onModel(files, name, id)              complete: [{ name, bytes }]
 *   onError(message)                      the model was refused or broken
 */
export class Receiver {
	constructor({ maxBytes, onStart = () => {}, onProgress = () => {}, onModel = () => {}, onError = () => {} }) {
		Object.assign(this, { maxBytes, onStart, onProgress, onModel, onError });
		this.current = null; // { id, name, files, total, buffer, got }
	}

	receive(data) {
		if (typeof data === 'string') return this.message(data);
		const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
		if (!bytes) return this.fail('Something unexpected arrived from the computer.');
		const m = this.current;
		if (!m) return; // pieces of a model that was refused: ignored
		if (m.got + bytes.byteLength > m.total) return this.fail('The computer sent more than it announced.');
		m.buffer.set(bytes, m.got);
		m.got += bytes.byteLength;
		this.onProgress(m.got, m.total);
	}

	message(text) {
		let msg;
		try { msg = JSON.parse(text); } catch { return this.fail('Something unexpected arrived from the computer.'); }
		if (msg?.t === 'model') return this.start(msg);
		if (msg?.t === 'end') return this.end(msg);
		// (Other messages are for the sender, or from a newer version: ignored.)
	}

	start(msg) {
		const files = Array.isArray(msg.files) ? msg.files : null;
		const ok = files && files.length > 0 && files.length <= MAX_FILES
			&& files.every((f) => typeof f?.name === 'string' && f.name.length > 0 && f.name.length <= MAX_NAME && Number.isSafeInteger(f.size) && f.size >= 0)
			&& typeof msg.name === 'string' && typeof msg.id === 'string' && msg.id.length <= 64;
		if (!ok) return this.fail('The computer sent a model this viewer does not understand.');
		const total = files.reduce((n, f) => n + f.size, 0);
		if (total > this.maxBytes) {
			this.current = null;
			return this.fail(`“${msg.name}” is larger than ${Math.round(this.maxBytes / 1048576)} MB, which is too large to open here.`);
		}
		this.current = { id: msg.id, name: msg.name.slice(0, MAX_NAME) || 'model', files: files.map((f) => ({ name: f.name, size: f.size })), total, buffer: new Uint8Array(total), got: 0 };
		this.onStart({ id: msg.id, name: this.current.name, files: this.current.files, total });
		this.onProgress(0, total);
	}

	end(msg) {
		const m = this.current;
		if (!m || msg.id !== m.id) return;
		this.current = null;
		if (m.got !== m.total) return this.fail(`“${m.name}” arrived incomplete.`);
		let at = 0;
		const files = m.files.map((f) => { const bytes = m.buffer.subarray(at, at + f.size); at += f.size; return { name: f.name, bytes }; });
		this.onModel(files, m.name, m.id);
	}

	fail(message) {
		this.current = null;
		this.onError(message);
	}
}
