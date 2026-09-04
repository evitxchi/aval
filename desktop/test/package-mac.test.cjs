"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createAsar } = require("../scripts/create-asar.cjs");

const desktopRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"));

function pngDimensions(filename) {
  const buffer = fs.readFileSync(filename);
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readAsar(archivePath) {
  const archive = fs.readFileSync(archivePath);
  const headerSize = archive.readUInt32LE(4);
  const headerPickle = archive.subarray(8, 8 + headerSize);
  const stringLength = headerPickle.readUInt32LE(4);
  const header = JSON.parse(headerPickle.subarray(8, 8 + stringLength).toString("utf8"));
  return { archive, header, payloadOffset: 8 + headerSize };
}

test("electron-builder uses the approved Aval DMG layout", () => {
  // Pinning an exact version here made every release bump a test failure;
  // what the DMG layout actually needs is a well-formed version string.
  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
  assert.equal(packageJson.build.dmg.background, "assets/dmg-background.png");
  assert.deepEqual(packageJson.build.dmg.window, { width: 660, height: 420 });
  assert.equal(packageJson.build.dmg.iconSize, 112);
  assert.equal(packageJson.build.dmg.iconTextSize, 13);
  assert.deepEqual(packageJson.build.dmg.contents, [
    { x: 175, y: 194, type: "file" },
    { x: 485, y: 194, type: "link", path: "/Applications" },
  ]);
});

test("production packaging cannot fall back to an unsigned or unnotarized app", () => {
  const { build } = packageJson;
  assert.equal(build.forceCodeSigning, true);
  assert.equal(build.mac.hardenedRuntime, true);
  assert.equal(build.mac.notarize, true);
  assert.equal(build.mac.entitlements, "build/entitlements.mac.plist");
  assert.equal(build.mac.entitlementsInherit, "build/entitlements.mac.inherit.plist");

  for (const filename of [build.mac.entitlements, build.mac.entitlementsInherit]) {
    const contents = fs.readFileSync(path.join(desktopRoot, filename), "utf8");
    assert.match(contents, /com\.apple\.security\.cs\.allow-jit/);
    assert.match(contents, /com\.apple\.security\.cs\.disable-library-validation/);
  }
});

test("DMG background provides standard and Retina assets", () => {
  assert.deepEqual(pngDimensions(path.join(desktopRoot, "assets", "dmg-background.png")), { width: 660, height: 420 });
  assert.deepEqual(pngDimensions(path.join(desktopRoot, "assets", "dmg-background@2x.png")), { width: 1320, height: 840 });
});

test("offline ASAR packer creates an integrity-addressed Electron archive", (context) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "aval-asar-test-"));
  context.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const source = path.join(temporary, "source");
  const destination = path.join(temporary, "app.asar");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "main.cjs"), "console.log('Aval');\n");
  fs.writeFileSync(path.join(source, "package.json"), '{"main":"main.cjs"}\n');

  const hash = createAsar(source, destination);
  const { archive, header, payloadOffset } = readAsar(destination);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash, crypto.createHash("sha256").update(JSON.stringify(header)).digest("hex"));
  assert.equal(header.files["main.cjs"].offset, "0");
  assert.equal(header.files["main.cjs"].integrity.algorithm, "SHA256");
  assert.equal(
    archive.subarray(payloadOffset, payloadOffset + header.files["main.cjs"].size).toString("utf8"),
    "console.log('Aval');\n",
  );
});

test("offline packaging uses a writable HFS volume and Finder metadata", () => {
  const packaging = fs.readFileSync(path.join(desktopRoot, "scripts", "package-offline-mac.sh"), "utf8");
  const finderLayout = fs.readFileSync(path.join(desktopRoot, "scripts", "configure-dmg.applescript"), "utf8");

  assert.match(packaging, /-fs HFS\+/);
  assert.match(packaging, /MOUNT_DIR="\/Volumes\/Aval"/);
  assert.doesNotMatch(packaging, /-mountpoint/);
  assert.match(packaging, /ln -s \/Applications/);
  assert.match(packaging, /configure-dmg\.applescript/);
  assert.match(packaging, /create-asar\.cjs/);
  assert.match(packaging, /Contents\/Resources\/app\.asar/);
  assert.match(packaging, /ElectronAsarIntegrity:Resources\/app\.asar:hash/);
  assert.match(packaging, /AVAL_DESKTOP_SMOKE_TEST=1/);
  assert.doesNotMatch(packaging, /makehybrid -udf/);
  assert.match(finderLayout, /background picture/);
  assert.match(finderLayout, /\{175, 194\}/);
  assert.match(finderLayout, /\{485, 194\}/);
});

test("the DMG ships a self-contained Codex runtime", () => {
  const { build } = packageJson;
  const resources = Object.fromEntries(build.extraResources.map((entry) => [entry.to, entry.from]));

  // resolveCodexExecutable() probes <resources>/bin/codex, so the vendored
  // binary has to land at exactly "bin" for a clean Mac to work offline.
  assert.match(resources.bin, /@openai\/codex-darwin-arm64\/vendor\/aarch64-apple-darwin\/bin$/);
  // codex resolves rg and its shell relative to its own directory.
  assert.ok(resources["codex-path"], "rg must ship alongside the codex binary");
  assert.ok(resources["codex-resources"], "codex-resources must ship alongside the codex binary");

  // The runtime ships once, via extraResources -- never also inside the asar.
  assert.ok(build.files.includes("!node_modules/**"));

  // The vendored runtime is arm64-only; an x64 DMG would ship a binary that
  // cannot run, so the targets pin the architecture.
  for (const target of build.mac.target) {
    assert.deepEqual(target.arch, ["arm64"], `${target.target} must be arm64-only`);
  }
});

test("the vendored Codex binary is present and executable", () => {
  const codex = path.join(desktopRoot, "node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex");
  assert.ok(fs.existsSync(codex), "run `npm ci` in desktop/ to install the Codex runtime");
  assert.doesNotThrow(() => fs.accessSync(codex, fs.constants.X_OK));
});

// A packaging config that only fails inside a five-minute electron-builder run
// is a config nobody checks. Validate it against the very schema the builder
// uses, so a bad option fails in milliseconds instead.
test("the packaging config satisfies the electron-builder schema", () => {
  const Ajv = require("ajv");
  const scheme = require("app-builder-lib/scheme.json");
  const validate = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true }).compile(scheme);
  const valid = validate(packageJson.build);
  const reasons = (validate.errors || []).map((e) => `${e.instancePath || "(root)"} ${e.message}`).join("; ");
  assert.ok(valid, `electron-builder would reject this config: ${reasons}`);
});
