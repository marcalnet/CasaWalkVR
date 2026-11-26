// Send to my Quest (computers and phones) and Receive (headset), split from
// js/main.js (stage B2). Browser-only: Meta's "Open in VR" page, and the
// direct computer-to-headset link (js/pairing.js, loaded only when used).
//
// js/main.js calls init() once and tells it about the open model's files
// (setFiles) and each newly opened model (passOn); a model received during VR
// waits here (takePending) until the session ends.

import { CONFIG } from '../../config.js';
import { checkLink, sendToQuestUrl } from '../links.js';
import { isPairId } from '../transfer.js';
import { Sharer, Joiner } from '../pairing.js';
import { setCollapsed } from './welcome.js';

const $ = (id) => document.getElementById(id);
let page = null; // { setStatus, load, current, renderer }

let currentFiles = null; // the open model's files, on a computer (Send to my Quest passes them on)
let sharer = null; // computer: the link to the headset (pairing.js), while there is one
let sharerState = null; // its last { phase, text }
let joiner = null; // headset: the link to the computer
let pendingModel = null; // headset: a model received during VR, opened on leaving it

export function init(ctx) { page = ctx; }

/** The computer's link to the headset, and the headset's to the computer (for the test hooks). */
export const links = { get sharer() { return sharer; }, get joiner() { return joiner; } };

/** The open model's files (on a computer: Send to my Quest can pass them on), or null. */
export function setFiles(files) { currentFiles = files; }

/** A model just opened: linked to the headset, it gets this one too. */
export function passOn(files, label) { if (sharer?.linked) sharer.send(files, label); }

/** The model received during VR, if any (taken: opened as the session ends). */
export function takePending() { const m = pendingModel; pendingModel = null; return m; }

/**
 * What "Send to my Quest" would send right now, and the line under the button
 * that says so:
 *   - a model opened from a link, from Recent with a link, or the example: its
 *     link, through Meta's Web Launch (nothing else involved)
 *   - a model opened from a file on this computer: the file itself, directly
 *     to the headset (Web Launch carries a pairing name; pairing.js)
 *   - no model open: the link in the link box, or just the viewer
 */
export function sendable() {
	const current = page.current;
	if (current) {
		const name = `“${current.label}”`;
		if (current.source?.url) return { link: current.source.url, note: `Sends ${name} to your headset: nothing to type there.` };
		if (currentFiles) return { files: currentFiles, note: `Sends ${name} straight to your headset. Keep this page open until it arrives.` };
	}
	const typed = $('link-input').value.trim();
	return typed ? { link: typed, note: 'Sends the link you pasted to your headset: nothing to type there.' }
		: { link: '', note: 'Opens this viewer on your headset. Open a model first to send it too.' };
}

/** The line under Send to my Quest: what it would send, or how the link is doing (with Unlink). */
export function renderSendNote() {
	const note = $('send-note');
	if (!note) return;
	if (sharer?.active) {
		const stop = document.createElement('button');
		stop.className = 'link-stop';
		stop.textContent = 'Unlink';
		stop.addEventListener('click', () => { sharer.close(); });
		note.replaceChildren(`${sharerState?.text ?? ''} `, stop);
	} else {
		note.textContent = sharerState && sharerState.phase !== 'linked' && sharerState.phase !== 'sending' && sharerState.phase !== 'waiting'
			? `${sharerState.text} ${sendable().note}` : sendable().note;
	}
}

/** Opens Meta's "Open in VR" page for this viewer, with the open model's link, or a link to send its file directly. */
export function sendToQuest() {
	const current = page.current, setStatus = page.setStatus;
	// Already linked (or waiting): send the open model again over the same link.
	if (sharer?.active) {
		if (current && currentFiles) sharer.send(currentFiles, current.label);
		return;
	}
	const s = sendable();
	if (s.files) {
		const sh = new Sharer({ onState: (st) => { sharerState = st; renderSendNote(); if (st.phase === 'error') setStatus(st.text, true); } });
		// (Opened straight away, inside the click: a tab opened later would be blocked.)
		const url = sendToQuestUrl(location.href, { pair: sh.id });
		if (url) {
			window.open(url, '_blank', 'noopener,noreferrer');
			setStatus('Meta’s “Open in VR” page opened in a new tab. Pick your headset there, then press Receive in the headset. Keep this page open.');
		} else {
			// A local test server (http): Web Launch needs https, so open this address on the other device by hand.
			const local = new URL(location.href);
			local.searchParams.delete('model');
			local.searchParams.set('pair', sh.id);
			if (window.__casawalk) window.__casawalk.pairUrl = local.toString(); // (?test only)
			setStatus(`Testing locally: open ${local} on the other device and press Receive there.`);
		}
		sharer = sh;
		sh.open();
		sh.send(s.files, current.label);
		return;
	}
	if (s.link) {
		const link = checkLink(s.link, location.href);
		if (!link.ok) { setStatus(link.error, true); return; }
	}
	const url = sendToQuestUrl(location.href, s.link);
	if (!url) { setStatus('Send to my Quest only works from the https address of this page, not from a local test server.', true); return; }
	window.open(url, '_blank', 'noopener,noreferrer');
	setStatus(s.link
		? 'Meta’s “Open in VR” page opened in a new tab. Pick your headset there: the viewer opens on it with the model’s link ready. If it does not load by itself, press Load.'
		: 'Meta’s “Open in VR” page opened in a new tab. Pick your headset there to open the viewer on it.');
}

/**
 * ?pair=<name>: this page was opened by Send to my Quest on a computer, which
 * is waiting to send a model directly. Nothing connects until Receive is
 * pressed: like a ?model= link from another site, it could have been put in
 * the address by anyone.
 */
export function initReceive() {
	const pair = new URLSearchParams(location.search).get('pair');
	if (!isPairId(pair)) return;
	setCollapsed(false);
	$('pair-box').hidden = false;
	$('pair-receive').addEventListener('click', () => {
		$('pair-receive').hidden = true;
		$('pair-stop').hidden = false;
		// Out of the address bar, so a reload or a bookmark does not try again.
		const clean = new URL(location.href);
		clean.searchParams.delete('pair');
		history.replaceState(null, '', clean);
		joiner = new Joiner({
			maxBytes: CONFIG.maxDownloadMB * 1048576,
			onState: ({ phase, text }) => {
				$('pair-text').textContent = text;
				if (phase === 'closed' || phase === 'error') $('pair-stop').hidden = true;
			},
			onModel: (files, name) => {
				if (page.renderer.xr.isPresenting) {
					pendingModel = { files, name };
					$('pair-text').textContent = `Received “${name}”: it opens when you leave VR.`;
					return;
				}
				page.load(files, name, { type: 'sent' }).catch(() => {});
			},
		});
		joiner.join(pair);
	});
	$('pair-stop').addEventListener('click', () => joiner?.close());
}
