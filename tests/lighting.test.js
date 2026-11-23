import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunAngles, sunDirection, hourAngleAt } from '../js/lighting.js';

const DEG = Math.PI / 180;

test('equinox sun in London: noon due south at 38.5°, morning in the south-east', () => {
	const lat = 51.5 * DEG;
	const noon = sunAngles(lat, 0);
	assert.ok(Math.abs(noon.elevation / DEG - 38.5) < 0.1);
	assert.ok(Math.abs(noon.azimuth / DEG - 180) < 0.1);
	const morning = sunAngles(lat, -45 * DEG);
	assert.ok(morning.azimuth / DEG > 90 && morning.azimuth / DEG < 180, `azimuth ${morning.azimuth / DEG}`);
	assert.ok(morning.elevation > 20 * DEG && morning.elevation < 30 * DEG);
	const h = hourAngleAt(lat, 5 * DEG);
	assert.ok(Math.abs(sunAngles(lat, h).elevation / DEG - 5) < 0.01);
	assert.ok(sunAngles(lat, h).azimuth / DEG > 180); // west
});

test('southern hemisphere: noon sun is due north', () => {
	assert.ok(Math.abs(sunAngles(-33.9 * DEG, 0).azimuth) < 1e-6);
});

test('sun direction follows the compass north', () => {
	// North up the plan (-z): the noon sun comes from the south (+z).
	const d0 = sunDirection({ northDirection: 0, latitude: 51.5 * DEG }, 'noon');
	assert.ok(d0.z > 0.7 && Math.abs(d0.x) < 1e-6 && d0.y > 0.5);
	// North to the plan's right (+x): the noon sun comes from -x; the morning sun (east = +z) from +z.
	const c = { northDirection: Math.PI / 2, latitude: 51.5 * DEG };
	assert.ok(sunDirection(c, 'noon').x < -0.7);
	assert.ok(sunDirection(c, 'morning').z > 0.3);
	assert.ok(Math.abs(sunDirection(c, 'night').length() - 1) < 1e-9);
});

test('ceilings get a small lift of their own; walls sharing the material keep theirs', async () => {
	const THREE = await import('three');
	const { Lighting } = await import('../js/lighting.js');
	const shared = new THREE.MeshLambertMaterial({ color: 0xbbaa99 });
	const wall = new THREE.Mesh(new THREE.BoxGeometry(), shared);
	const ceiling = new THREE.Mesh(new THREE.BoxGeometry(), shared);
	const layer = new THREE.Group(); layer.add(ceiling);
	Lighting.prototype.liftCeilings.call({}, layer, 0.2);
	assert.notEqual(ceiling.material, shared, 'the ceiling has its own copy');
	assert.equal(wall.material.emissive.getHex(), 0x000000, 'the wall is unchanged');
	assert.ok(ceiling.material.emissive.r > 0.05, 'the ceiling glows a little in its own colour');
});
