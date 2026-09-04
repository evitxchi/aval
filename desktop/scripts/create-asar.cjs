#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const BLOCK_SIZE = 4 * 1024 * 1024;

function usage() {
  throw new Error("Usage: create-asar.cjs <source-directory> <destination.asar>");
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function integrityFor(buffer) {
  const blocks = [];
  for (let offset = 0; offset < buffer.length; offset += BLOCK_SIZE) {
    blocks.push(sha256(buffer.subarray(offset, Math.min(offset + BLOCK_SIZE, buffer.length))));
  }
  if (blocks.length === 0) blocks.push(sha256(buffer));
  return { algorithm: "SHA256", hash: sha256(buffer), blockSize: BLOCK_SIZE, blocks };
}

function pickleUInt32(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32LE(4, 0);
  buffer.writeUInt32LE(value, 4);
  return buffer;
}

function pickleString(value) {
  const string = Buffer.from(value, "utf8");
  const paddedLength = Math.ceil(string.length / 4) * 4;
  const buffer = Buffer.alloc(8 + paddedLength);
  buffer.writeUInt32LE(4 + paddedLength, 0);
  buffer.writeUInt32LE(string.length, 4);
  string.copy(buffer, 8);
  return buffer;
}

function collectDirectory(root, directory, payloads, offset) {
  const files = Object.create(null);
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, "en"));

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const target = fs.realpathSync(absolute);
      const relative = path.relative(root, target);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`ASAR symlink escapes its source directory: ${absolute}`);
      }
      files[entry.name] = { link: relative.split(path.sep).join("/") };
      continue;
    }
    if (entry.isDirectory()) {
      const nested = collectDirectory(root, absolute, payloads, offset);
      files[entry.name] = { files: nested.files };
      offset = nested.offset;
      continue;
    }
    if (!entry.isFile()) throw new Error(`Unsupported ASAR entry: ${absolute}`);

    const content = fs.readFileSync(absolute);
    const stat = fs.statSync(absolute);
    const metadata = {
      size: content.length,
      offset: String(offset),
      integrity: integrityFor(content),
    };
    if ((stat.mode & 0o100) !== 0) metadata.executable = true;
    files[entry.name] = metadata;
    payloads.push(content);
    offset += content.length;
  }

  return { files, offset };
}

function createAsar(sourceDirectory, destination) {
  const source = path.resolve(sourceDirectory);
  const output = path.resolve(destination);
  if (!fs.statSync(source).isDirectory()) usage();
  if (output === source || output.startsWith(`${source}${path.sep}`)) {
    throw new Error("The ASAR destination must be outside its source directory.");
  }

  const payloads = [];
  const header = collectDirectory(source, source, payloads, 0);
  const headerString = JSON.stringify({ files: header.files });
  const headerPickle = pickleString(headerString);
  const archive = Buffer.concat([pickleUInt32(headerPickle.length), headerPickle, ...payloads]);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, archive);
  return sha256(Buffer.from(headerString, "utf8"));
}

module.exports = { createAsar, integrityFor, pickleString, pickleUInt32 };

if (require.main === module) {
  const [, , sourceDirectory, destination] = process.argv;
  if (!sourceDirectory || !destination) usage();
  process.stdout.write(`${createAsar(sourceDirectory, destination)}\n`);
}
