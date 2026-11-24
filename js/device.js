// Which device the page runs on, in one place (code audit, A4). Browsers
// give no better signal than their name (the user agent), so this reads it
// once; everything that differs by device asks here.

/** True in a headset's own browser (Meta Quest Browser): no "Send to my Quest", no dropped files. */
export function isHeadsetBrowser(ua = globalThis.navigator?.userAgent ?? '') {
	return /OculusBrowser|\bQuest\b/i.test(ua);
}

/** True on a Quest 2 (a phone GPU): the camera's viewfinder draws half as often. */
export function isQuest2(ua = globalThis.navigator?.userAgent ?? '') {
	return /Quest 2/.test(ua);
}

/** This page's device. */
export const DEVICE = { headset: isHeadsetBrowser(), quest2: isQuest2() };
