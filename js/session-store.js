// What belongs to this VR session only (the shared-headset principle, SPEC.md
// "Design principles"; the next-build asks, section 4): several people use one
// headset, and the app can't tell them apart, so teaching and who you are
// start fresh with every Enter VR. (General's "New visitor" did it too, with the
// headset on, until build 215's B4: the user took it out.)
// Nothing here is stored. (What you see, the home's light and view, is
// remembered: js/settings.js, scope 'remembered'.)
//
//   tips     the pause's tips seen and learnt (keys 'id:kind': js/pause.js)
//   tipsOff  ?tipwait's Skip tips was pressed: no more tips this session
//   target   the first-target ring was shown inside
//   cycle    ?tips: the next tip in turn
//   cued     the tools whose control-part ring pulsed (the first take)
//   tabs     the tab each place's board last showed (the first opening at
//            each place shows How to move)
// Pure: runs in Node tests.

export class SessionStore {
	constructor() { this.start(); }

	/** A fresh session: Enter VR. */
	start() {
		this.tips = { seen: new Set(), learnt: new Set() };
		this.tipsOff = false;
		this.target = false;
		this.cycle = 0;
		this.tabs = {};
		this.cued = new Set(); // the tools whose control part's ring has pulsed this session (js/tool-dial.js)
	}
}
