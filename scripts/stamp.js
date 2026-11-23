// Stamps the build: writes js/version.js with a build number and the time,
// so the page (bottom left) and the headset's Help say which build is
// running, and a cached copy can tell a newer one is live. Run it right
// before committing what you will push:
//   npm run stamp
// The number is the commit count it will be once committed (git rev-list
// --count HEAD, plus one): it can't hold its own commit's hash, which only
// exists after the commit. No build step: the file is plain JavaScript.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
let n = 0;
try { n = Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()) + 1; } catch { n = 0; }
const date = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const text = `// Written by scripts/stamp.js (npm run stamp) before each push: which build this is.
// number: the commit count once committed; date: when it was stamped (UTC).
export const BUILD = { number: ${n}, date: '${date}' };
`;
fs.writeFileSync(path.join(root, 'js/version.js'), text);
console.log(`js/version.js: build ${n}, ${date}`);
