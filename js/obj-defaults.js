// Sweet Home 3D's defaults for OBJ models (pure data and rules, no DOM, no three.js).
//
// 1. Materials an OBJ names but no .mtl defines. Sweet Home 3D's own OBJ
//    reader falls back to a built-in table of 134 named materials (its
//    catalogue windows, for example, use "white" for the frame and "flltgrey"
//    for the glass, with no .mtl at all). The values below are that table's,
//    read from Sweet Home 3D 7's OBJLoader (com.eteks.sweethome3d.j3d), whose
//    comment says the table comes from Java 3D's DefaultMaterials. Only the
//    values are taken (facts, cited); none of the code. `d` is the opacity
//    (Sweet Home 3D uses a transparency of 1 − d); materials with illum 1 or
//    less have no highlight (Ks 0). Ka (ambient) is left out: three.js has no
//    use for it. A .mtl that defines the name always wins.
//
// 2. Window panes. Sweet Home 3D makes a part see-through by its name: any
//    part whose name starts with "sweethome3d_window_pane" (this also covers
//    "_on_hinge_" and "_on_rail_" panes) gets a transparency of 0.5, unless its
//    material already has a transparency of its own (ModelManager,
//    updateShapeNamesAndWindowPanesTransparency, and its
//    WINDOW_PANE_TRANSPARENCY_ATTRIBUTES constant). Mirrors
//    ("sweethome3d_window_mirror…") are left as they are.

/** Name, Kd (diffuse colour), Ks (highlight), Ns (shininess), d (opacity). */
export const SH3D_DEFAULT_MATERIALS = [
	['amber', '0.5755 0.2678 0', '0.3 0.3 0.3', 60, 1],
	['amber_trans', '0.5755 0.2678 0', '0.3 0.3 0.3', 60, 0.16],
	['charcoal', '0.0041 0.0041 0.0041', '0.3 0.3 0.3', 60, 1],
	['lavendar', '0.2187 0.0906 0.3469', '0.3 0.3 0.3', 60, 1],
	['navy_blue', '0 0 0.0531', '0.1878 0.1878 0.1878', 91.47, 1],
	['pale_green', '0.0712 0.3796 0.049', '0.1878 0.1878 0.1878', 91.47, 1],
	['pale_pink', '0.6531 0.2053 0.416', '0.1878 0.1878 0.1878', 91.47, 1],
	['pale_yellow', '0.6898 0.6211 0.1999', '0.1878 0.1878 0.1878', 91.47, 1],
	['peach', '0.6367 0.1829 0.0156', '0.1878 0.1878 0.1878', 91.47, 1],
	['periwinkle', '0 0.0396 0.8286', '0.1878 0.1878 0.1878', 91.47, 1],
	['redwood', '0.2571 0.033 0', '0.1878 0.1878 0.1878', 91.47, 1],
	['smoked_glass', '0.0041 0.0041 0.0041', '0.1878 0.1878 0.1878', 91.47, 0.02],
	['aqua_filter', '0.3743 0.6694 0.5791', '0.1878 0.1878 0.1878', 91.47, 0.02],
	['yellow_green', '0.1875 0.4082 0.0017', '0.1878 0.1878 0.1878', 91.47, 1],
	['bluetint', '0.0468 0.7115 0.9551', '0.3184 0.3184 0.3184', 60, 0.43],
	['plasma', '1 0.0776 0.4478', '0.3 0.3 0.3', 60, 0.25],
	['emerald', '0.047 1 0', '0.2 0.2 0.2', 60, 0.25],
	['ruby', '1 0 0', '0.2 0.2 0.2', 60, 0.25],
	['sapphire', '0.0235 0 1', '0.2 0.2 0.2', 60, 0.25],
	['white', '1 1 1', '0.3 0.3 0.3', 60, 1],
	['red', '0.7714 0 0', '0.8857 0 0', 136.43, 1],
	['blue_pure', '0 0 1', '0 0 0.5', 65.89, 1],
	['lime', '0 1 0', '0 0.5 0', 65.89, 1],
	['green', '0 0.25 0', '0 0.25 0', 65.89, 1],
	['yellow', '1 0.6667 0', '1 0.6667 0', 65.89, 1],
	['purple', '0.5 0 1', '0.5 0 1', 65.89, 1],
	['orange', '1 0.1667 0', '1 0.1667 0', 65.89, 1],
	['grey', '0.1837 0.1837 0.1837', '0.5 0.5 0.5', 65.89, 1],
	['rubber', '0.01 0.01 0.01', '0.1 0.1 0.1', 65.89, 1],
	['flaqua', '0 0.5 0.5', '0 0 0', 0, 1],
	['flblack', '0.0041 0.0041 0.0041', '0 0 0', 0, 1],
	['flblue_pure', '0 0 0.7102', '0 0 0', 0, 1],
	['flgrey', '0.5 0.5 0.5', '0 0 0', 0, 1],
	['fllime', '0 1 0', '0 0 0', 0, 1],
	['florange', '1 0.1667 0', '0 0 0', 0, 1],
	['flpurple', '0.3755 0 0.751', '0 0 0', 0, 1],
	['flred', '1 0 0', '0 0 0', 0, 1],
	['flyellow', '1 0.6667 0', '0 0 0', 0, 1],
	['pink', '0.9878 0.1695 0.6702', '0.7429 0.2972 0.2972', 106.2, 1],
	['flbrown', '0.1102 0.012 0.0013', '0 0 0', 0, 1],
	['brown', '0.0857 0.0147 0', '0.1633 0.024 0', 65.89, 1],
	['glass', '0.4873 0.4919 0.5306', '0.6406 0.6939 0.902', 200, 1],
	['flesh', '0.5265 0.4127 0.3374', '0.3 0.3 0.3', 60, 1],
	['aqua', '0 0.5 0.5', '0.5673 0.5673 0.5673', 60, 1],
	['black', '0.002 0.002 0.002', '0.5184 0.5184 0.5184', 157.36, 1],
	['silver', '0.6163 0.6163 0.6163', '0.3 0.3 0.3', 60, 1],
	['dkblue_pure', '0 0 0.1347', '0 0 0.5673', 65.89, 1],
	['fldkblue_pure', '0 0 0.1347', '0 0 0', 0, 1],
	['dkgreen', '0.0058 0.0245 0', '0 0.049 0', 60, 1],
	['dkgrey', '0.049 0.049 0.049', '0.3 0.3 0.3', 60, 1],
	['ltbrown', '0.2776 0.1143 0.0531', '0.3 0.1235 0.0574', 60, 1],
	['fldkgreen', '0.0058 0.0245 0', '0 0 0', 0, 1],
	['flltbrown', '0.2776 0.1143 0.0531', '0 0 0', 0, 1],
	['tan', '0.6612 0.5221 0.2186', '0.502 0.4118 0.2152', 60, 1],
	['fltan', '0.6612 0.4567 0.1295', '0 0 0', 0, 1],
	['brzskin', '0.3796 0.2898 0.2122', '0.3 0.3 0.3', 25, 1],
	['lips', '0.9265 0.2612 0.2898', '0.3 0.3 0.3', 25, 1],
	['redorange', '0.7551 0.0185 0', '0.4694 0.3224 0.1667', 132.56, 1],
	['blutan', '0.0776 0.2571 0.2041', '0.1467 0.1469 0.0965', 25, 1],
	['bluteal', '0.0776 0.2571 0.2041', '0.1467 0.1469 0.0965', 25, 1],
	['pinktan', '0.6857 0.2571 0.2163', '0.1467 0.1469 0.0965', 25, 1],
	['brnhair', '0.0898 0.0302 0.011', '0.1306 0.0819 0.0352', 60.47, 1],
	['blondhair', '0.5714 0.3283 0.0443', '0.7755 0.4602 0.0918', 4.65, 1],
	['flblonde', '0.5714 0.3283 0.0443', '0 0 0', 0, 1],
	['yelloworng', '0.8857 0.249 0', '0.3 0.3 0.3', 60, 1],
	['bone', '0.9 0.7626 0.4261', '0.8939 0.7609 0.5509', 200, 1],
	['teeth', '0.9837 0.7959 0.4694', '0 0 0', 0, 1],
	['brass', '0.4776 0.1959 0', '0.5796 0.5796 0.5796', 134.88, 1],
	['dkred', '0.2286 0 0', '0.249 0 0', 60, 1],
	['taupe', '0.2041 0.1227 0.1058', '0.3 0.3 0.3', 84.5, 1],
	['dkteal', '0 0.0653 0.0449', '0.3 0.3 0.3', 55.04, 1],
	['dkdkgrey', '0.0122 0.0122 0.0122', '0.3 0.3 0.3', 60, 1],
	['dkblue', '0 0.0041 0.0571', '0.3 0.3 0.3', 60, 1],
	['gold', '1 0.4898 0', '0.7184 0.3695 0.3695', 123.26, 1],
	['redbrick', '0.3306 0.0398 0.0081', '0 0 0', 0, 1],
	['flmustard', '0.8898 0.3531 0.0073', '0 0 0', 0, 1],
	['flpinegreen', '0.1061 0.2163 0.0857', '0 0 0', 0, 1],
	['fldkred', '0.2286 0.0082 0.0082', '0 0 0', 0, 1],
	['fldkgreen2', '0.0245 0.0694 0.0041', '0 0 0', 0, 1],
	['flmintgreen', '0.1306 0.2898 0.1673', '0 0 0', 0, 1],
	['olivegreen', '0.025 0.0367 0', '0.2257 0.2776 0.1167', 97.67, 1],
	['skin', '0.1102 0.0328 0.0139', '0.3 0.3 0.3', 17.83, 1],
	['redbrown', '0.2816 0.006 0', '0.3714 0.3714 0.3714', 141.09, 1],
	['deepgreen', '0 0.0204 0.005', '0.3 0.3 0.3', 113.18, 1],
	['flltolivegreen', '0.0393 0.0531 0.01', '0 0 0', 0, 1],
	['jetflame', '0.951 0.4939 0.098', '0.8531 0.5222 0', 132.56, 1],
	['brownskn', '0.0204 0.0082 0', '0.0735 0.0508 0.0321', 20.16, 1],
	['greenskn', '0 0.0735 0', '0.049 0.1224 0.0898', 46.51, 1],
	['ltgrey', '0.3837 0.3837 0.3837', '0.5 0.5 0.5', 65.89, 1],
	['bronze', '0.0653 0.0367 0.0122', '0.0776 0.0408 0', 137.21, 1],
	['bone1', '0.9837 0.7959 0.4694', '0 0 0', 0, 1],
	['flwhite1', '1 1 1', '0 0 0', 0, 1],
	['flwhite', '0.9837 0.9309 0.8392', '0.8082 0.729 0.5708', 200, 1],
	['shadow', '0.035 0.0248 0.0194', '0 0 0', 0, 0.25],
	['fldkolivegreen', '0.0151 0.0204 0.0038', '0 0 0', 0, 1],
	['fldkdkgrey', '0.0122 0.0122 0.0122', '0 0 0', 0, 1],
	['lcdgreen', '0.5878 1 0.5061', '0.3 0.3 0.3', 60, 1],
	['brownlips', '0.1429 0.0653 0.0408', '0.3 0.3 0.3', 25, 1],
	['muscle', '0.4204 0.0721 0.0856', '0.1184 0.1184 0.1184', 25.58, 1],
	['flltgrey', '0.8245 0.8245 0.8245', '0 0 0', 0, 1],
	['offwhite.warm', '0.8367 0.6898 0.449', '0.3 0.3 0.3', 60, 1],
	['offwhite.cool', '0.8367 0.6812 0.5703', '0.3 0.3 0.3', 60, 1],
	['yellowbrt', '1 0.7837 0', '0.3 0.3 0.3', 60, 1],
	['chappie', '0.5837 0.1796 0.0367', '0.3 0.3 0.3', 60, 1],
	['archwhite', '0.9959 0.9959 0.9959', '0 0 0', 0, 1],
	['archwhite2', '0.8408 0.8408 0.8408', '0 0 0', 0, 1],
	['lighttan', '0.702 0.421 0.2206', '0.8286 0.8057 0.5851', 177.52, 1],
	['lighttan2', '0.3143 0.187 0.0962', '0.8286 0.8057 0.5851', 177.52, 1],
	['lighttan3', '0.1796 0.0829 0.0139', '0.8286 0.8057 0.5851', 177.52, 1],
	['lightyellow', '1 0.9542 0.3388', '1 0.906 0', 177.52, 1],
	['lighttannew', '0.7878 0.607 0.3216', '0.8286 0.8057 0.5851', 177.52, 1],
	['default', '0.7102 0.702 0.6531', '0.3 0.3 0.3', 128, 1],
	['ship2', '1 1 1', '0.1143 0.1143 0.1143', 60, 1],
	['dkpurple', '0.0245 0 0.049', '0.1266 0 0.2531', 65.89, 1],
	['dkorange', '0.7143 0.035 0', '0.7102 0.087 0', 65.89, 1],
	['mintgrn', '0.0245 0.4776 0.0816', '0.0245 0.4776 0.0816', 65.89, 1],
	['fgreen', '0 0.0449 0.0004', '0.0062 0.0694 0', 106.2, 1],
	['glassblutint', '0.5551 0.8 0.773', '0.7969 0.9714 0.9223', 60, 0.67],
	['bflesh', '0.0245 0.0081 0.0021', '0.0531 0.046 0.0153', 20.16, 1],
	['meh', '0.5551 0.8 0.773', '0.7969 0.9714 0.9223', 183.72, 0.25],
	['violet', '0.0287 0.0269 0.1347', '0.2267 0.4537 0.6612', 96.9, 1],
	['iris', '0 0.0572 0.3184', '0.8041 0.6782 0.1477', 188.37, 1],
	['blugrn', '0.0811 0.6408 0.2775', '0.1467 0.1469 0.0965', 25, 1],
	['glasstransparent', '0.4694 0.4694 0.4694', '0.6082 0.6082 0.6082', 200, 0.25],
	['fleshtransparent', '0.6898 0.2942 0.1295', '0.7388 0.4614 0.4614', 6.2, 0.25],
	['fldkgrey', '0.0939 0.0939 0.0939', '0 0 0', 0, 1],
	['sky_blue', '0.1241 0.5931 0.8', '0.049 0.049 0.049', 13.95, 1],
	['fldkpurple', '0.1612 0 0.3347', '0 0 0', 13.95, 1],
	['dkbrown', '0.0087 0.0038 0.0016', '0.237 0.2147 0.1821', 60, 1],
	['bone2', '0.9837 0.862 0.6504', '0 0 0', 0, 1],
	['bluegrey', '0.1881 0.2786 0.2898', '0.3 0.3 0.3', 14.73, 1],
	['metal', '0.9 0.7626 0.4261', '0.8939 0.884 0.8683', 200, 1],
	['sand_stone', '0.1256 0.1138 0.0965', '0.237 0.2147 0.1821', 60, 1],
	['hair', '0.0008 0.0007 0.0006', '0 0 0', 60, 1],
];

const BY_NAME = new Map(SH3D_DEFAULT_MATERIALS.map((row) => [row[0], row]));

/** Sweet Home 3D's opacity for a window pane whose material has none of its own. */
export const WINDOW_PANE_OPACITY = 0.5;
export const WINDOW_PANE_PREFIX = 'sweethome3d_window_pane';

/** True for a part Sweet Home 3D shows as see-through window glass. */
export function isWindowPaneName(name) {
	return typeof name === 'string' && name.startsWith(WINDOW_PANE_PREFIX);
}

/** The material names an OBJ uses (its `usemtl` lines), in order, once each. */
export function usedMaterialNames(objText) {
	return [...new Set([...objText.matchAll(/^[ \t]*usemtl[ \t]+(.+?)[ \t]*$/gm)].map((m) => m[1]))];
}

/** The material names a .mtl defines (its `newmtl` lines). */
export function definedMaterialNames(mtlText) {
	return new Set([...mtlText.matchAll(/^[ \t]*newmtl[ \t]+(.+?)[ \t]*$/gm)].map((m) => m[1]));
}

/**
 * MTL text for the names in `used` that `defined` lacks and the table has,
 * or '' when there are none. Appended to the model's own .mtl (or used alone
 * when it has none), so a name the model defines is never replaced.
 */
export function defaultMtlFor(used, defined = new Set()) {
	let out = '';
	for (const name of used) {
		if (defined.has(name) || !BY_NAME.has(name)) continue;
		const [, kd, ks, ns, d] = BY_NAME.get(name);
		out += `newmtl ${name}\nKd ${kd}\nKs ${ks}\nNs ${ns}\n${d < 1 ? `d ${d}\n` : ''}\n`;
	}
	return out;
}
