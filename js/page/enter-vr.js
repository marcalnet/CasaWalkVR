// The page's Enter VR button (split from js/main.js, stage B2): shown only
// when the browser supports it (passthrough is chosen in the headset), with
// Send to my Quest beside it on computers and phones. Browser-only.
//
// js/main.js calls initEnterVR() once; updateXRButtons() redraws the buttons
// whenever loading starts or ends, or VR support becomes known.

import { XRExperience } from '../xr.js';
import { DEVICE } from '../device.js';
import { layoutWelcomeSoon } from './welcome.js';
import { sendToQuest, renderSendNote } from './send.js';

const $ = (id) => document.getElementById(id);
let page = null; // { current, loading, setStatus, xr, controls }
let xrSupport = { vr: false, ar: false };
let xrChecked = false; // the browser has answered whether it supports VR

/** True in a headset's own browser (Meta Quest Browser), where "Send to my Quest" and dropping files make no sense. */
const ON_HEADSET = DEVICE.headset;

export function updateXRButtons() {
	layoutWelcomeSoon(); // (called whenever loading starts or ends, or VR support becomes known)
	const box = $('xr-buttons');
	box.replaceChildren();
	// On a computer or phone: a button that opens this viewer on the user's
	// Quest (with the pasted link), so nothing has to be typed in the headset.
	const send = () => {
		const b = document.createElement('button');
		b.id = 'send-quest';
		b.className = xrSupport.vr || xrSupport.ar ? 'outline' : 'xr';
		b.textContent = 'Send to my Quest';
		b.title = 'Opens this viewer on your headset through Meta’s “Open in VR” page. A link is passed to Meta to do this; a file goes directly from this computer to the headset.';
		b.addEventListener('click', sendToQuest);
		const note = document.createElement('span');
		note.className = 'hint';
		note.id = 'send-note';
		return [b, note];
	};
	if (!xrSupport.vr && !xrSupport.ar) {
		if (xrChecked && !ON_HEADSET) { box.append(...send()); renderSendNote(); }
		else if (xrChecked) { const note = document.createElement('span'); note.className = 'hint'; note.textContent = 'This browser cannot enter VR.'; box.append(note); }
		return;
	}
	// One button: an AR-capable session can switch between VR and passthrough
	// from the in-headset menu.
	const kind = xrSupport.ar ? 'ar' : 'vr';
	const b = document.createElement('button');
	b.className = 'xr';
	// Simple headset glyph, then the label.
	b.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 7h16a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-4.2l-2.1-2.4a2.3 2.3 0 0 0-3.4 0L8.2 17H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zm3.5 3a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zm9 0a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5z"/></svg>';
	b.append('Enter VR →'); // → : forward, deeper (left to right is forward, in the headset too)
	const where = document.createElement('span');
	where.className = 'where';
	where.textContent = 'Starts at the scale model';
	b.append(where);
	b.disabled = !page.current || page.loading > 0;
	b.title = page.current ? '' : 'Open a model first';
	b.addEventListener('click', async () => {
		try {
			page.controls.enabled = false;
			await page.xr.start(kind);
		} catch (e) {
			page.controls.enabled = true;
			console.error(e);
			page.setStatus(`Could not start VR: ${e.message}`, true);
		}
	});
	box.append(b);
	if (!ON_HEADSET) { box.append(...send()); renderSendNote(); } // e.g. a PC with a headset attached: both ways in
}

/** Asks the browser whether it can enter VR, then draws the buttons. */
export function initEnterVR(ctx) {
	page = ctx;
	XRExperience.supported().then((s) => { xrSupport = s; xrChecked = true; updateXRButtons(); });
}
