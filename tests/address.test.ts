import assert from "node:assert/strict";
import test from "node:test";
import { parseMxAddress, parseUsAddress } from "../lib/integrations/address.ts";

test("parseUsAddress splits number/street/city/state/zip from a comma-separated address", () => {
  const parsed = parseUsAddress("123 Main St, Springfield, IL 62704");
  assert.equal(parsed.confidence, "high");
  assert.equal(parsed.streetNumber, "123");
  assert.equal(parsed.streetName, "Main St");
  assert.equal(parsed.city, "Springfield");
  assert.equal(parsed.state, "IL");
  assert.equal(parsed.postalCode, "62704");
  assert.equal(parsed.unit, undefined);
});

test("parseUsAddress extracts a unit and strips it from the street name", () => {
  const parsed = parseUsAddress("456 Oak Ave Apt 4B, Austin, TX 78701");
  assert.equal(parsed.streetName, "Oak Ave");
  assert.equal(parsed.unit, "4B");
  assert.equal(parsed.city, "Austin");
  assert.equal(parsed.state, "TX");
  assert.equal(parsed.postalCode, "78701");
});

test("parseUsAddress recovers city even when state/zip run into the same segment as city", () => {
  const parsed = parseUsAddress("123 Main St, Springfield IL 62704");
  assert.equal(parsed.city, "Springfield");
  assert.equal(parsed.state, "IL");
  assert.equal(parsed.postalCode, "62704");
});

test("parseUsAddress reports low confidence rather than guessing on an unparseable string", () => {
  const parsed = parseUsAddress("PO Box 123");
  assert.equal(parsed.confidence, "low");
  assert.equal(parsed.city, undefined);
  assert.equal(parsed.raw, "PO Box 123");
});

test("parseMxAddress splits street/exterior number/colonia/city/state/postal code", () => {
  const parsed = parseMxAddress("Calle Reforma 123, Colonia Centro, 06000 Ciudad de México, CDMX");
  assert.equal(parsed.confidence, "high");
  assert.equal(parsed.street, "Calle Reforma");
  assert.equal(parsed.exteriorNumber, "123");
  assert.equal(parsed.colonia, "Centro");
  assert.equal(parsed.city, "Ciudad de México");
  assert.equal(parsed.state, "CDMX");
  assert.equal(parsed.postalCode, "06000");
});

test("parseMxAddress reports low confidence without a postal code to anchor the parse", () => {
  const parsed = parseMxAddress("Av. Insurgentes Sur 1457");
  assert.equal(parsed.confidence, "low");
});
