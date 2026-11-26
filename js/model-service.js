// The model service (the code audit's stage B1): one place that turns files
// or a link into a finished model, so the page, and later the headset, only
// call it. It owns:
//   - reading: openFiles() (js/formats.js), with progress said through onStatus;
//   - superseding: when another model is opened before one finishes, the
//     older one is dropped (its files freed) and open() answers null;
//   - the merge (js/optimise.js), or the model as loaded with ?nomerge;
//   - freeing: the model shown before is disposed when the new one is ready,
//     or first, when asked (freeFirst: in the headset the memory's peak is then
//     the new home alone);
//   - links: checking, storage services (Google Drive, OneDrive) and the
//     download, with its size limit and its plain-words errors.
// No page code: no DOM, no view. What a model means for the view (where it
// stands, its lamps, the headset) stays with the caller (js/main.js).
// Runs in Node tests (tests/model-service.test.js).

import { openFiles, UserError } from './formats.js';
import { optimiseModel, unmergedModel } from './optimise.js';
import { checkLink, fileNameOf, resolveOneDrive, resolveGoogleDrive, looksLikeWebPage, LinkError } from './links.js';

export class ModelService {
	/**
	 * config: { maxDownloadMB, googleApiKey } (js/config.js); onStatus(text,
	 * isError): what is happening, in a line; onFree(): the old model left the
	 * view (the caller clears where it hung).
	 */
	constructor({ config, onStatus = () => {}, onFree = () => {} } = {}) {
		this.config = config ?? {};
		this.onStatus = onStatus;
		this.onFree = onFree;
		this.current = null; // the model shown: openFiles()'s result, with root replaced by the merged model
		this.seq = 0; // the newest open() call
		this.loading = 0; // opens in progress
	}

	/** Frees the model shown (geometry, materials, textures, its files) and tells the caller. */
	dispose() {
		const current = this.current;
		if (!current) return;
		current.root.traverse((o) => {
			if (o.geometry) o.geometry.dispose();
			const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
			for (const m of mats) { m.map?.dispose(); m.dispose(); }
		});
		current.store?.dispose();
		this.onFree();
		this.current = null;
	}

	/**
	 * Opens [{ name, bytes }] as a model and makes it the one shown. Returns it
	 * ({ ...openFiles() result, label, source, root, layers, merged }), or null
	 * when a newer open() came first. On an error, the error says whether this
	 * was the newest call (error.latest).
	 *   source: { type: 'link', url } | { type: 'file' } | { type: 'recent', url?, id } | { type: 'sent' }
	 *   read: openFiles() options (units, triangleLimit, simplifyAbove, objParser)
	 *   nomerge, fold: the merge (?nomerge, ?nofold)
	 *   freeFirst: free the model shown before reading (onFreed() then)
	 *   onStart(): the open has begun (loading counts it)
	 */
	async open(files, label, source = { type: 'file' }, { read = {}, nomerge = false, fold = true, freeFirst = false, onStart = null, onFreed = null } = {}) {
		const seq = ++this.seq;
		const superseded = (result) => { if (seq === this.seq) return false; result.store?.dispose(); return true; };
		this.onStatus(`Opening ${label}…`);
		this.loading++;
		try {
			onStart?.();
			if (this.current && freeFirst) { this.dispose(); onFreed?.(); }
			const result = await openFiles(files, { ...read, onProgress: (t) => { if (seq === this.seq) this.onStatus(t); } });
			if (superseded(result)) return null;
			this.onStatus('Optimising for Quest…');
			await new Promise((r) => setTimeout(r, 0)); // let the status paint
			if (superseded(result)) return null;
			// ?nomerge (debugging only): the scene exactly as loaded.
			const merged = nomerge ? unmergedModel(result.root) : optimiseModel(result.root, { fold });
			this.dispose();
			this.current = { ...result, label, source, root: merged.group, layers: merged.layers, merged: merged.stats };
			return this.current;
		} catch (e) {
			if (e && typeof e === 'object') e.latest = seq === this.seq;
			throw e;
		} finally {
			this.loading--;
		}
	}

	/** True while `seq` (a value of this.seq) is the newest open() call. */
	isLatest(seq) { return seq === this.seq; }

	/**
	 * Downloads a link's model file: { name, bytes }. Checks the link first
	 * (js/links.js), finds a storage service's file, keeps to the size limit,
	 * and says what is wrong in plain words (said through onStatus, and thrown
	 * as a UserError). base: the page's address (same-site links); wayRound():
	 * what to do instead when a link can't be downloaded from here.
	 */
	async fetchLink(url, { base, wayRound = () => '' } = {}) {
		const fail = (text) => { this.onStatus(text, true); return new UserError(text); };
		url = url.trim();
		const link = checkLink(url, base);
		if (!link.ok) throw fail(link.error);
		if (link.problem) throw fail(link.blocked ? `${link.problem} ${wayRound()}` : link.problem);
		const service = link.service;
		if (link.googleDrive && !this.config.googleApiKey) throw fail(`This copy of the viewer is not set up for Google Drive links (config.js has no Google API key). ${wayRound()}`);
		let name = fileNameOf(link.url);
		this.onStatus(`Downloading ${link.googleDrive || link.oneDrive ? `from ${service}` : name}…`);
		let bytes;
		try {
			let from = link.url;
			let size = 0;
			let init = {};
			if (link.googleDrive) ({ url: from, name, size, init } = await resolveGoogleDrive(link.googleDrive, this.config.googleApiKey));
			if (link.oneDrive) ({ url: from, name, size } = await resolveOneDrive(link.oneDrive));
			bytes = await this.download(from, name, size, init);
			// A private link usually answers with a sign-in page instead of the file.
			if (looksLikeWebPage(bytes)) {
				throw new UserError(service
					? `${service} sent a web page instead of the file: the link is probably not public. Share it with “Anyone with the link” and copy the link again.`
					: 'That link opens a web page, not a model file. Use a link that downloads the file itself.');
			}
		} catch (e) {
			let text;
			if (e instanceof UserError || e instanceof LinkError) text = e.message;
			else if (/^HTTP (401|403|404)/.test(e.message)) text = `${service || 'That site'} would not give the file (${e.message}). Check the link is shared with “Anyone with the link”.`;
			else if (e instanceof TypeError) text = `${service || 'That site'} does not let other websites download this file. ${wayRound()}`;
			else text = `Could not download that link (${e.message}).`;
			this.onStatus(text, true);
			throw e instanceof UserError ? e : new UserError(text);
		}
		return { name, bytes };
	}

	/**
	 * Downloads a URL into bytes, saying the progress through onStatus.
	 * no-store: after editing the home on the Mac, always get the new version.
	 */
	async download(url, name, expectedSize = 0, init = {}) {
		// A size limit, so a wrong or hostile link cannot fill the memory.
		const maxMB = this.config.maxDownloadMB, max = maxMB * 1048576;
		const tooBig = () => new UserError(`That file is larger than ${maxMB} MB, which is too large to open here.`);
		if (expectedSize > max) throw tooBig();
		// No cookies and no "where from" header go to the other site (Google Drive
		// is the exception: its key is checked against this site's origin).
		const res = await fetch(url, { cache: 'no-store', referrerPolicy: 'no-referrer', ...init, credentials: 'omit' });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const total = expectedSize || Number(res.headers.get('Content-Length')) || 0;
		if (total > max) { res.body?.cancel().catch(() => {}); throw tooBig(); }
		if (!res.body) {
			const all = new Uint8Array(await res.arrayBuffer());
			if (all.length > max) throw tooBig();
			return all;
		}
		const reader = res.body.getReader();
		const chunks = [];
		let got = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			got += value.length;
			if (got > max) { reader.cancel().catch(() => {}); throw tooBig(); }
			const mb = (n) => (n / 1048576).toFixed(1);
			this.onStatus(total ? `Downloading ${name}… ${Math.min(100, Math.round((got / total) * 100))}% of ${mb(total)} MB` : `Downloading ${name}… ${mb(got)} MB`);
		}
		const bytes = new Uint8Array(got);
		let off = 0;
		for (const c of chunks) { bytes.set(c, off); off += c.length; }
		return bytes;
	}
}
