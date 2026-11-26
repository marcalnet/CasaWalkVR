// The page's welcome (split from js/main.js, stage B2): three steps with
// arrows over the empty view until a model is open, the files card folding
// away, and files or a link dropped anywhere on the page (computers).
// Browser-only: page layout.
//
// js/main.js calls initWelcome() and initDrop() where it always set them up,
// and passes the page's shared parts (page: current, loading, setStatus, load).

import { DEVICE } from '../device.js';

const $ = (id) => document.getElementById(id);
let page = null; // { current, loading, setStatus, load }

/**
 * Places the two welcome notes by what they point at: 1 the files card, 2
 * the display card. Three layouts:
 *   below  (preferred) each note sits under its card, with an arrow up to it
 *   side   a card is too tall to leave room beneath it: the notes go between
 *          the cards instead, level with the Open file button and the options
 *   stack  cards stacked (narrow windows): both notes in the gap between them
 */
function layoutWelcome() {
	if (!page) return;
	const w = $('welcome');
	const show = !page.current && page.loading === 0;
	w.hidden = !show;
	if (!show) return;
	const p = $('panel').getBoundingClientRect(), v = $('view').getBoundingClientRect();
	const [one, two] = w.querySelectorAll('.step'), note = w.querySelector('.note');
	w.querySelector('.drop').hidden = !CAN_DROP; // "Drop a file here to start": computers only
	const H = window.innerHeight, strip = v.left - p.right;
	const place = (el, left, top, width) => Object.assign(el.style, { left: `${left}px`, top: `${top}px`, width: `${width}px` });
	note.hidden = false;

	if (v.top > p.bottom) {
		// Stacked: the gap between the files card (top) and the display card (bottom).
		w.dataset.layout = 'stack';
		const top = p.bottom + 8, height = v.top - 8 - top;
		for (const el of [one, two, note]) Object.assign(el.style, { left: '', top: '', width: '' });
		Object.assign(w.style, { left: '0px', top: `${top}px`, width: '100%', height: `${Math.max(0, height)}px` });
		w.hidden = height < 60 || w.scrollHeight > height + 1; // no room: better nothing than cut-off notes
		return;
	}
	Object.assign(w.style, { left: '0px', top: '0px', width: '100%', height: `${H}px` });

	// Preferred: each note under its card.
	w.dataset.layout = 'below';
	place(one, p.left, p.bottom + 12, p.width);
	place(two, v.left, v.bottom + 12, v.width);
	let bottom = Math.max(p.bottom + 12 + one.offsetHeight, v.bottom + 12 + two.offsetHeight);
	// The centre lines: in the middle of the space left below the notes.
	const centred = (from) => Math.max(from + 26, (from + H - note.offsetHeight) / 2);
	place(note, 0, 0, window.innerWidth);
	note.style.top = `${centred(bottom)}px`;

	if (bottom > H - 6 && strip >= 240) {
		// No room under a card (a long Recent list, a short window): between the cards.
		w.dataset.layout = 'side';
		const width = Math.min(strip, 350);
		one.style.width = two.style.width = `${width}px`; // (set first: their heights depend on it)
		const centre = (el) => { const r = el.getBoundingClientRect(); return r.height ? (r.top + r.bottom) / 2 : 0; };
		const top1 = Math.max(4, (centre($('open-file')) || centre($('collapse'))) - one.offsetHeight / 2);
		// Note 2 points at the middle of the options; if the strip is too narrow
		// for the notes to pass each other, it moves down below note 1.
		const options = ($('time').getBoundingClientRect().top + document.querySelector('#view .switches').getBoundingClientRect().bottom) / 2;
		let top2 = Math.max(4, options - two.offsetHeight / 2);
		if (strip < 2 * width) top2 = Math.max(top2, top1 + one.offsetHeight + 10);
		place(one, p.right, top1, width);
		place(two, v.left - width, top2, width);
		bottom = Math.max(top1 + one.offsetHeight, top2 + two.offsetHeight);
		place(note, p.right, 0, strip);
		note.style.top = `${centred(bottom)}px`;
	}
	note.hidden = note.offsetTop + note.offsetHeight > H - 6; // (the last line goes first when space runs out)
	w.hidden = bottom > H - 6; // a very short window: no room at all
}
/** True where files can be dragged in with a mouse: computers, not headsets or phones. */
const CAN_DROP = !DEVICE.headset && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
let welcomeQueued = false;
/** Lays the welcome out after the page has settled (several changes in one frame cost one layout). */
export function layoutWelcomeSoon() {
	if (welcomeQueued) return;
	welcomeQueued = true;
	requestAnimationFrame(() => { welcomeQueued = false; layoutWelcome(); });
}

/** Folds the files card away (c true) or opens it. */
export function setCollapsed(c) {
	$('panel').classList.toggle('collapsed', c);
	$('collapse').textContent = c ? '+' : '–';
	$('collapse').setAttribute('aria-expanded', String(!c));
	$('collapse').title = c ? 'Show this panel' : 'Hide this panel';
}

/** The welcome's layout triggers, the files card's fold key, and the display card's height. */
export function initWelcome(ctx) {
	page = ctx;
	window.addEventListener('resize', layoutWelcomeSoon);
	document.fonts?.ready.then(layoutWelcomeSoon); // the notes change size when their font arrives
	if ('ResizeObserver' in window) { const ro = new ResizeObserver(layoutWelcomeSoon); ro.observe($('panel')); ro.observe($('view')); }
	$('collapse').addEventListener('click', () => setCollapsed(!$('panel').classList.contains('collapsed')));
	// Narrow windows put the display card at the bottom: the files card and the
	// model details stop above it, whatever its height.
	const viewHeight = () => document.documentElement.style.setProperty('--view-h', `${$('view').offsetHeight}px`);
	if ('ResizeObserver' in window) new ResizeObserver(viewHeight).observe($('view'));
	viewHeight();
}

/**
 * Dropping files anywhere on the page opens them (computers). While files are
 * dragged over the window a "Drop to open" frame shows; a dragged link goes
 * into the link box instead and waits for Load.
 */
export function initDrop() {
	const draggingFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
	window.addEventListener('dragover', (e) => {
		e.preventDefault(); // (also stops the browser from navigating to a dropped file)
		if (draggingFiles(e)) { e.dataTransfer.dropEffect = 'copy'; $('dropzone').hidden = false; }
	});
	window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) $('dropzone').hidden = true; }); // left the window
	window.addEventListener('drop', async (e) => {
		e.preventDefault();
		$('dropzone').hidden = true;
		const picked = [...(e.dataTransfer?.files || [])];
		if (!picked.length) {
			const dropped = (e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '').split('\n')[0].trim();
			if (/^https?:\/\//i.test(dropped)) {
				setCollapsed(false);
				$('link-input').value = dropped;
				$('open-link').classList.add('primary');
				page.setStatus('Link dropped. Press Load to open it.');
			}
			return;
		}
		const files = await Promise.all(picked.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))).catch(() => null);
		if (!files) { page.setStatus('Those files could not be read.', true); return; }
		page.load(files, picked.length === 1 ? picked[0].name : `${picked.length} files`, { type: 'file' }).catch(() => {});
	});
}
