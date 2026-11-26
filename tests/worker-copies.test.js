// The worker copies in vendor/worker/ (scripts/worker-copies.js) stay in step
// with the vendored addons: the same source, 'three' imported by relative path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { WORKER_COPIES, workerCopy } from '../scripts/worker-copies.js';

const VENDOR = path.resolve(import.meta.dirname, '../vendor');

test('each worker copy is its addon with \'three\' by relative path, and nothing else changed', () => {
	for (const [name, rel] of Object.entries(WORKER_COPIES)) {
		const copy = fs.readFileSync(path.join(VENDOR, 'worker', name), 'utf8');
		assert.equal(copy, workerCopy(fs.readFileSync(path.join(VENDOR, 'three/addons', rel), 'utf8')), `${name}: run npm run vendor`);
		assert.match(copy, /from '\.\.\/three\/three\.module\.js'/);
	}
});
