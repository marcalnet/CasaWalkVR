// Linking a computer and a headset so files opened on the computer open on the
// headset too (SPEC.md, "Getting files onto the Quest"). Used by "Send to my
// Quest" when the open model is a file on the computer, not a link.
//
//   computer   Sharer: makes up a random pairing name, sends it to the headset
//              inside the Web Launch link (?pair=), waits for the headset to
//              connect, then sends the model, and any model opened after it.
//   headset    Joiner: after the user presses Receive, connects to that name
//              and receives.
//
// The two devices find each other through a small public service (PeerJS's
// free server, set in config.js): only connection details pass through it.
// The model itself goes from one device to the other, encrypted by WebRTC;
// if a direct path is impossible, PeerJS's TURN relay passes the encrypted
// bytes along. The connection servers (Google's STUN, PeerJS's TURN) are named
// in config.js (CONFIG.pairing.config.iceServers) and handed to PeerJS with
// the rest of CONFIG.pairing. The pairing service is trusted to introduce the
// right two devices (each side's encryption fingerprint passes through it, so
// a dishonest service could put itself in the middle). It is only contacted
// when this feature is used: the PeerJS library is loaded then too.
//
// The protocol (what is sent, and the checks on what arrives) is in transfer.js.

import { CONFIG } from '../config.js';
import { sendModel, Receiver, newPairId, PROTOCOL, CHUNK } from './transfer.js';

const WAIT_FOR_HEADSET_MS = 10 * 60 * 1000; // a pairing name is good for 10 minutes
const CONNECT_TIMEOUT_MS = 30 * 1000;

let loading = null;
/** Loads the vendored PeerJS library (vendor/peerjs, MIT) once, on first use. */
function loadPeerJs() {
	if (window.peerjs?.Peer) return Promise.resolve(window.peerjs.Peer);
	loading ||= new Promise((resolve, reject) => {
		const s = document.createElement('script');
		s.src = './vendor/peerjs/peerjs.min.js';
		s.onload = () => (window.peerjs?.Peer ? resolve(window.peerjs.Peer) : reject(new Error('PeerJS did not start')));
		s.onerror = () => { loading = null; reject(new Error('the pairing library could not be loaded')); };
		document.head.append(s);
	});
	return loading;
}

const serverOptions = () => ({ ...CONFIG.pairing, debug: 0 });

/** A PeerJS connection as transfer.js sees it. */
const channelOf = (conn) => ({
	send: (data) => conn.send(data),
	// Bytes still waiting to leave: the browser's queue plus PeerJS's own.
	buffered: () => (conn.dataChannel?.bufferedAmount ?? 0) + (conn.bufferSize ?? 0) * CHUNK,
});

/** A readable sentence for a PeerJS error. */
function explain(err, side) {
	switch (err?.type) {
		case 'peer-unavailable': return side === 'headset'
			? 'Your computer is no longer waiting: press Send to my Quest on it again.'
			: 'The headset could not be reached.';
		case 'network': case 'server-error': case 'socket-error': case 'socket-closed':
			return 'The pairing service could not be reached. Check the internet connection, or use a Dropbox link instead.';
		case 'browser-incompatible': return 'This browser cannot make direct connections.';
		case 'unavailable-id': return 'That pairing name is taken: press Send to my Quest again.';
		default: return `The link failed (${err?.type || err?.message || 'unknown error'}).`;
	}
}

// ---------------------------------------------------------------------------
// Computer side
// ---------------------------------------------------------------------------

/**
 * Waits for the headset and sends it models.
 * onState({ phase, text, progress }):
 *   phase  'waiting' | 'linked' | 'sending' | 'closed' | 'error'
 */
export class Sharer {
	constructor({ onState = () => {} } = {}) {
		this.onState = onState;
		this.id = newPairId();
		this.peer = null;
		this.conn = null;
		this.ready = false; // the headset said hello
		this.queue = []; // models to send once linked: [{ files, name }]
		this.busy = false;
		this.phase = 'waiting';
	}

	get linked() { return this.ready && this.phase !== 'closed' && this.phase !== 'error'; }
	get active() { return this.phase !== 'closed' && this.phase !== 'error'; }

	state(phase, text, progress = null) {
		this.phase = phase;
		this.onState({ phase, text, progress });
	}

	/** Starts waiting for the headset under this.id. */
	async open() {
		this.state('waiting', 'Waiting for your headset: pick it on Meta’s page, then press Receive in the headset.');
		let Peer;
		try { Peer = await loadPeerJs(); } catch (e) { this.state('error', `Could not start the link: ${e.message}.`); return; }
		if (!this.active) return; // stopped meanwhile
		this.peer = new Peer(this.id, serverOptions());
		this.peer.on('connection', (conn) => this.accept(conn));
		this.peer.on('error', (e) => { if (!this.ready) this.fail(explain(e, 'computer')); });
		this.timer = setTimeout(() => { if (!this.ready) this.fail('Nobody connected within 10 minutes: press Send to my Quest again.'); }, WAIT_FOR_HEADSET_MS);
	}

	/** The headset connects: only the first connection is accepted. */
	accept(conn) {
		if (this.conn || conn.metadata?.app !== 'casawalk') { conn.close(); return; }
		this.conn = conn;
		conn.on('data', (data) => {
			if (typeof data !== 'string') return;
			let msg;
			try { msg = JSON.parse(data); } catch { return; }
			if (msg.t === 'hello') {
				this.ready = true;
				clearTimeout(this.timer);
				// Nobody else can connect from now on, and the pairing name is gone
				// from the service; the connection to the headset stays open.
				this.peer.disconnect();
				this.state('linked', 'Linked to your headset.');
				this.flush();
			} else if (msg.t === 'got') {
				this.state('linked', `Opened on your headset: “${this.lastName}”. Models you open here go there too, while this page stays open.`);
			}
		});
		conn.on('close', () => this.fail('The link to the headset closed.', 'closed'));
		conn.on('error', (e) => this.fail(explain(e, 'computer')));
	}

	/** Sends a model now if linked, otherwise as soon as the headset connects. Replaces anything still queued. */
	send(files, name) {
		this.queue = [{ files, name }];
		if (this.linked) this.flush();
	}

	async flush() {
		if (this.busy || !this.linked) return;
		this.busy = true;
		try {
			while (this.queue.length && this.linked) {
				const { files, name } = this.queue.shift();
				this.lastName = name;
				this.state('sending', `Sending “${name}” to your headset…`, 0);
				await sendModel(channelOf(this.conn), files, name, {
					onProgress: (sent, total) => this.state('sending', `Sending “${name}” to your headset… ${Math.round((100 * sent) / Math.max(1, total))}%`, sent / Math.max(1, total)),
				});
				if (this.linked) this.state('linked', `Sent “${name}”. It opens on your headset in a moment.`);
			}
		} catch (e) {
			this.fail(`Sending failed: ${e.message}`);
		} finally {
			this.busy = false;
		}
	}

	fail(text, phase = 'error') {
		if (!this.active) return;
		clearTimeout(this.timer);
		this.state(phase, text);
		this.close(true);
	}

	/** Ends the link (quietly if `silent`). */
	close(silent = false) {
		clearTimeout(this.timer);
		if (!silent && this.active) this.state('closed', 'Unlinked from the headset.');
		this.queue = [];
		try { this.conn?.close(); } catch { /* already closed */ }
		try { this.peer?.destroy(); } catch { /* already gone */ }
	}
}

// ---------------------------------------------------------------------------
// Headset side
// ---------------------------------------------------------------------------

/**
 * Connects to a waiting computer and receives its models.
 * onState({ phase, text, progress }): phase 'connecting' | 'linked' | 'receiving' | 'closed' | 'error'
 * onModel(files, name): a complete model arrived
 */
export class Joiner {
	constructor({ maxBytes, onState = () => {}, onModel = () => {} }) {
		this.onState = onState;
		this.phase = 'idle';
		this.receiver = new Receiver({
			maxBytes,
			onStart: ({ name }) => { this.name = name; this.state('receiving', `Receiving “${name}”…`, 0); },
			onProgress: (got, total) => this.state('receiving', `Receiving “${this.name}”… ${Math.round((100 * got) / Math.max(1, total))}%`, got / Math.max(1, total)),
			onModel: (files, name, id) => {
				try { this.conn?.send(JSON.stringify({ t: 'got', id })); } catch { /* closed meanwhile */ }
				this.state('linked', `Linked to your computer. Received “${name}”.`);
				onModel(files, name);
			},
			onError: (text) => this.state('linked', text),
		});
	}

	get active() { return this.phase !== 'closed' && this.phase !== 'error' && this.phase !== 'idle'; }

	state(phase, text, progress = null) {
		this.phase = phase;
		this.onState({ phase, text, progress });
	}

	/** Connects to the computer waiting under `pairId`. */
	async join(pairId) {
		this.state('connecting', 'Connecting to your computer…');
		let Peer;
		try { Peer = await loadPeerJs(); } catch (e) { this.state('error', `Could not start the link: ${e.message}.`); return; }
		this.peer = new Peer(newPairId(), serverOptions());
		this.peer.on('error', (e) => { if (this.phase === 'connecting') this.fail(explain(e, 'headset')); });
		this.timer = setTimeout(() => { if (this.phase === 'connecting') this.fail('Your computer did not answer. Check both are on the internet, then press Send to my Quest on it again.'); }, CONNECT_TIMEOUT_MS);
		this.peer.on('open', () => {
			const conn = this.peer.connect(pairId, { reliable: true, serialization: 'raw', metadata: { app: 'casawalk', v: PROTOCOL } });
			this.conn = conn;
			conn.on('open', () => {
				clearTimeout(this.timer);
				conn.send(JSON.stringify({ t: 'hello', v: PROTOCOL }));
				this.peer.disconnect(); // no longer needed: the connection stays open
				this.state('linked', 'Linked to your computer. Waiting for the model…');
			});
			conn.on('data', (data) => this.receiver.receive(data));
			conn.on('close', () => { if (this.active) this.fail('The link to your computer closed.', 'closed'); });
			conn.on('error', (e) => this.fail(explain(e, 'headset')));
		});
	}

	fail(text, phase = 'error') {
		clearTimeout(this.timer);
		this.state(phase, text);
		this.close();
	}

	close() {
		clearTimeout(this.timer);
		if (this.active) this.state('closed', 'Unlinked from your computer.');
		try { this.conn?.close(); } catch { /* already closed */ }
		try { this.peer?.destroy(); } catch { /* already gone */ }
	}
}
