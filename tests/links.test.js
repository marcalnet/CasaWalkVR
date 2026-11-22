// Share links from storage services (js/links.js): which address is
// downloaded, what is refused with advice, and the OneDrive resolve steps
// (over a fake fetch: the tests never touch the network).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareLink, checkLink, resolveOneDrive, resolveGoogleDrive, looksLikeWebPage, LinkError, ONEDRIVE_TOKEN_URL, ONEDRIVE_SHARES_URL, GOOGLE_DRIVE_API } from '../js/links.js';

const page = 'https://example.github.io/CasaWalk/';

test('Google Drive: every share link form gives the file id', () => {
	for (const link of [
		'https://drive.google.com/file/d/1AbC-d_E/view?usp=sharing',
		'https://drive.google.com/file/d/1AbC-d_E/view?usp=drive_link',
		'https://drive.google.com/file/u/0/d/1AbC-d_E/view',
		'https://drive.google.com/open?id=1AbC-d_E',
		'https://drive.google.com/uc?export=download&id=1AbC-d_E',
		'https://docs.google.com/uc?id=1AbC-d_E',
		'  https://drive.google.com/file/d/1AbC-d_E/view  ',
	]) {
		const s = shareLink(link);
		assert.equal(s.service, 'Google Drive', link);
		assert.deepEqual(s.googleDrive, { id: '1AbC-d_E' }, link);
		assert.equal(s.problem, undefined, link);
	}
	// Older shared files need their resource key.
	assert.deepEqual(shareLink('https://drive.google.com/file/d/1AbC/view?resourcekey=0-xyz').googleDrive, { id: '1AbC', resourceKey: '0-xyz' });
	assert.deepEqual(checkLink('https://drive.google.com/file/d/1AbC/view', page).googleDrive, { id: '1AbC' });
	// Folders and documents are not model files.
	assert.match(shareLink('https://drive.google.com/drive/folders/1Xyz?usp=sharing').problem, /folder/);
	assert.match(shareLink('https://docs.google.com/document/d/1Xyz/edit').problem, /not a file/);
	// An id that is not an id is never passed on.
	assert.ok(shareLink('https://drive.google.com/open?id=a%2Fb').problem);
	// Look-alike hosts are just other sites.
	assert.equal(shareLink('https://drive.google.com.evil.example/file/d/1AbC/view').service, '');
});

test('Dropbox: files become direct downloads, folders are refused', () => {
	const s = shareLink('https://www.dropbox.com/scl/fi/abc/home.sh3d?rlkey=k&dl=0');
	assert.equal(new URL(s.url).hostname, 'dl.dropboxusercontent.com');
	assert.equal(new URL(s.url).searchParams.get('dl'), '1');
	assert.equal(s.service, 'Dropbox');
	assert.match(shareLink('https://www.dropbox.com/scl/fo/abc/xyz?rlkey=k&dl=0').problem, /folder/);
});

test('OneDrive: the share link becomes a share id for the anonymous API', () => {
	const link = 'https://1drv.ms/u/c/abc123/EaBcDeF?e=xyz';
	const s = shareLink(link);
	assert.equal(s.service, 'OneDrive');
	assert.equal(s.oneDrive, `u!${Buffer.from(link).toString('base64url')}`);
	// Copied from the address bar after opening: the id is the "redeem" value.
	const redeem = Buffer.from(link).toString('base64');
	assert.equal(shareLink(`https://onedrive.live.com/?redeem=${encodeURIComponent(redeem)}&cid=ABC`).oneDrive, `u!${Buffer.from(link).toString('base64url')}`);
	// Older links work the same way.
	assert.ok(shareLink('https://1drv.ms/u/s!AbCdEf').oneDrive);
	assert.match(shareLink('https://1drv.ms/f/c/abc123/EgXyz').problem, /folder/);
	// checkLink passes the share id on.
	assert.equal(checkLink(link, page).oneDrive, s.oneDrive);
});

test('GitHub file pages become raw downloads', () => {
	assert.equal(shareLink('https://github.com/me/homes/blob/main/plans/My%20home.sh3d').url, 'https://raw.githubusercontent.com/me/homes/main/plans/My%20home.sh3d');
	assert.equal(shareLink('https://github.com/me/homes/raw/refs/heads/main/a.sh3d').url, 'https://raw.githubusercontent.com/me/homes/refs/heads/main/a.sh3d');
});

test('Services that never allow downloads are named, with advice', () => {
	for (const [link, name] of [
		['https://contoso-my.sharepoint.com/:u:/g/personal/x/EabcDEF', 'OneDrive for work or school'],
		['https://www.icloud.com/iclouddrive/0abcDEF#home', 'iCloud Drive'],
		['https://app.box.com/s/abcdef', 'Box'],
		['https://we.tl/t-abc', 'WeTransfer'],
		['https://mega.nz/file/abc#key', 'MEGA'],
	]) {
		const c = checkLink(link, page);
		assert.equal(c.ok, true, link);
		assert.equal(c.service, name, link);
		assert.equal(c.blocked, true, link);
		assert.ok(c.problem, link);
	}
	// Any other https link is tried as it is.
	const other = checkLink('https://files.example/home.sh3d', page);
	assert.deepEqual([other.url, other.service, other.problem, other.blocked], ['https://files.example/home.sh3d', '', undefined, undefined]);
});

/** A fake fetch: answers from a table of handlers, recording every call. */
function fakeFetch(handlers) {
	const calls = [];
	const fn = async (url, opts = {}) => {
		calls.push({ url, opts });
		const h = handlers.find(([prefix]) => url.startsWith(prefix));
		const [status, body] = h ? h[1](url, opts) : [404, {}];
		return { ok: status >= 200 && status < 300, status, json: async () => body };
	};
	return { fn, calls };
}

test('OneDrive resolve: guest token, then the item, then its download address', async () => {
	const f = fakeFetch([
		[ONEDRIVE_TOKEN_URL, () => [200, { authScheme: 'badger', token: 'T0K' }]],
		[ONEDRIVE_SHARES_URL, () => [200, { name: 'My home.sh3d', size: 1234, '@content.downloadUrl': 'https://my.microsoftpersonalcontent.com/dl?tempauth=x' }]],
	]);
	const r = await resolveOneDrive('u!aHR0cHM6Ly8xZHJ2Lm1zL3UvYy9h', f.fn);
	assert.deepEqual(r, { url: 'https://my.microsoftpersonalcontent.com/dl?tempauth=x', name: 'My home.sh3d', size: 1234 });
	assert.equal(f.calls[0].opts.method, 'POST');
	assert.equal(f.calls[1].url, `${ONEDRIVE_SHARES_URL}u!aHR0cHM6Ly8xZHJ2Lm1zL3UvYy9h/driveitem`);
	assert.equal(f.calls[1].opts.headers.Authorization, 'Badger T0K');
	// No cookies and no referrer go to Microsoft.
	for (const c of f.calls) { assert.equal(c.opts.credentials, 'omit'); assert.equal(c.opts.referrerPolicy, 'no-referrer'); }
});

test('OneDrive resolve: private links, folders and odd answers become clear messages', async () => {
	const token = [ONEDRIVE_TOKEN_URL, () => [200, { token: 'T' }]];
	const item = (status, body) => fakeFetch([token, [ONEDRIVE_SHARES_URL, () => [status, body]]]).fn;
	await assert.rejects(resolveOneDrive('u!x', item(403, {})), (e) => e instanceof LinkError && /Anyone with the link/.test(e.message));
	await assert.rejects(resolveOneDrive('u!x', item(200, { folder: { childCount: 2 } })), /folder/);
	await assert.rejects(resolveOneDrive('u!x', item(200, { name: 'a', '@content.downloadUrl': 'http://plain.example/x' })), /did not give a download/);
	await assert.rejects(resolveOneDrive('u!x', item(200, { name: 'a', '@content.downloadUrl': 'javascript:alert(1)' })), /did not give a download/);
	await assert.rejects(resolveOneDrive('u!x', fakeFetch([[ONEDRIVE_TOKEN_URL, () => [500, {}]]]).fn), /did not answer/);
	// A missing name or size is filled in, never trusted as is.
	const r = await resolveOneDrive('u!x', item(200, { size: 'big', '@content.downloadUrl': 'https://x.example/d' }));
	assert.deepEqual([r.name, r.size], ['OneDrive file', 0]);
});

test('Google Drive resolve: name and size first, then the download, with the key', async () => {
	const f = fakeFetch([[GOOGLE_DRIVE_API, (url) => [200, new URL(url).searchParams.get('alt') ? {} : { name: 'My home.sh3d', size: '2048', mimeType: 'application/octet-stream' }]]]);
	const r = await resolveGoogleDrive({ id: '1AbC', resourceKey: '0-xyz' }, 'KEY', f.fn);
	assert.equal(r.name, 'My home.sh3d');
	assert.equal(r.size, 2048);
	const u = new URL(r.url);
	assert.equal(u.origin + u.pathname, `${GOOGLE_DRIVE_API}1AbC`);
	assert.equal(u.searchParams.get('alt'), 'media');
	assert.equal(u.searchParams.get('key'), 'KEY');
	// The resource key travels in the header Google asks for; only the origin is sent as referrer; never cookies.
	assert.equal(r.init.headers['X-Goog-Drive-Resource-Keys'], '1AbC/0-xyz');
	assert.equal(r.init.referrerPolicy, 'strict-origin');
	assert.equal(r.init.credentials, 'omit');
	assert.equal(new URL(f.calls[0].url).searchParams.get('fields'), 'name,size,mimeType');
});

test('Google Drive resolve: private files, folders, documents and a bad key become clear messages', async () => {
	const answer = (status, body) => fakeFetch([[GOOGLE_DRIVE_API, () => [status, body]]]).fn;
	await assert.rejects(resolveGoogleDrive({ id: 'x' }, 'K', answer(404, {})), (e) => e instanceof LinkError && /Anyone with the link/.test(e.message));
	await assert.rejects(resolveGoogleDrive({ id: 'x' }, 'K', answer(403, { error: { errors: [{ reason: 'forbidden' }] } })), /not set up for Google Drive/);
	await assert.rejects(resolveGoogleDrive({ id: 'x' }, 'K', answer(400, { error: { status: 'INVALID_ARGUMENT' } })), /not set up for Google Drive/);
	await assert.rejects(resolveGoogleDrive({ id: 'x' }, 'K', answer(200, { mimeType: 'application/vnd.google-apps.folder' })), /folder/);
	await assert.rejects(resolveGoogleDrive({ id: 'x' }, 'K', answer(200, { mimeType: 'application/vnd.google-apps.document' })), /Google document/);
	await assert.rejects(resolveGoogleDrive({ id: 'x' }, 'K', answer(503, {})), /did not answer/);
});

test('A web page that arrives instead of a file is recognised', () => {
	const bytes = (s) => new TextEncoder().encode(s);
	assert.equal(looksLikeWebPage(bytes('\n <!DOCTYPE html><html><head>')), true);
	assert.equal(looksLikeWebPage(bytes('<html lang="en">')), true);
	assert.equal(looksLikeWebPage(bytes('PK\x03\x04 zip')), false);
	assert.equal(looksLikeWebPage(bytes('# OBJ file\nv 0 0 0')), false);
	assert.equal(looksLikeWebPage(bytes('<?xml version="1.0"?><COLLADA>')), false);
});
