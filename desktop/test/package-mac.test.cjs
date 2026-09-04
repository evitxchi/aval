"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const desktopRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"));

function pngDimensions(filename) {
  const buffer = fs.readFileSync(filename);
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test("electron-builder uses the approved Aval DMG layout", () => {
  assert.equal(packageJson.version, "0.1.2");
  assert.equal(packageJson.build.dmg.background, "assets/dmg-background.png");
  assert.deepEqual(packageJson.build.dmg.window.size, { width: 660, height: 420 });
  assert.equal(packageJson.build.dmg.iconSize, 112);
  assert.equal(packageJson.build.dmg.iconTextSize, 13);
  assert.deepEqual(packageJson.build.dmg.contents, [
    { x: 175, y: 194, type: "file" },
    { x: 485, y: 194, type: "link", path: "/Applications" },
  ]);
});

test("DMG background provides standard and Retina assets", () => {
  assert.deepEqual(pngDimensions(path.join(desktopRoot, "assets", "dmg-background.png")), { width: 660, height: 420 });
  assert.deepEqual(pngDimensions(path.join(desktopRoot, "assets", "dmg-background@2x.png")), { width: 1320, height: 840 });
});

test("offline packaging uses a writable HFS volume and Finder metadata", () => {
  const packaging = fs.readFileSync(path.join(desktopRoot, "scripts", "package-offline-mac.sh"), "utf8");
  const finderLayout = fs.readFileSync(path.join(desktopRoot, "scripts", "configure-dmg.applescript"), "utf8");

  assert.match(packaging, /-fs HFS\+/);
  assert.match(packaging, /MOUNT_DIR="\/Volumes\/Aval"/);
  assert.doesNotMatch(packaging, /-mountpoint/);
  assert.match(packaging, /ln -s \/Applications/);
  assert.match(packaging, /configure-dmg\.applescript/);
  assert.doesNotMatch(packaging, /makehybrid -udf/);
  assert.match(finderLayout, /background picture/);
  assert.match(finderLayout, /\{175, 194\}/);
  assert.match(finderLayout, /\{485, 194\}/);
});
