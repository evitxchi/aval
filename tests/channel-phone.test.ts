import assert from "node:assert/strict";
import test from "node:test";
import { normalisePhone, sameNumber } from "../lib/channels/phone.ts";

// Phone normalisation is the identity key. Two spellings of one number that
// normalise differently become two identities, and the second one resolves to
// no organization — so an operator whose number Meta happens to spell with the
// Mexican `1` silently stops being recognised. These tests pin the spellings
// we actually receive.

test("plain E.164 passes through", () => {
  assert.equal(normalisePhone("+12125551234"), "+12125551234");
});

test("a number with no leading plus gains one", () => {
  // Meta's `from` field is bare digits, never prefixed.
  assert.equal(normalisePhone("12125551234"), "+12125551234");
});

test("formatting characters are stripped", () => {
  assert.equal(normalisePhone("+1 (212) 555-1234"), "+12125551234");
  assert.equal(normalisePhone(" +1 212.555.1234 "), "+12125551234");
});

test("the 00 international prefix is replaced with +", () => {
  assert.equal(normalisePhone("0012125551234"), "+12125551234");
});

// The case this function exists for.
test("a Mexican mobile resolves to one identity whether or not it carries the 1", () => {
  const withOne = normalisePhone("+5215512345678");
  const withoutOne = normalisePhone("+525512345678");
  assert.equal(withOne, "+525512345678");
  assert.equal(withoutOne, "+525512345678");
  assert.equal(withOne, withoutOne, "both spellings must be the same identity");
});

test("the Mexican 1 is stripped regardless of input formatting", () => {
  for (const spelling of ["5215512345678", "+52 1 55 1234 5678", "00 52 1 55-1234-5678", "+52(1)5512345678"]) {
    assert.equal(normalisePhone(spelling), "+525512345678", spelling);
  }
});

test("a Mexican landline is untouched", () => {
  // 12 digits, no `1` to strip — the rule must not fire here.
  assert.equal(normalisePhone("+525512345678"), "+525512345678");
});

test("a Mexican number that merely starts with 1 after the country code keeps it when the length is already national", () => {
  // 52 + 10 digits where the national number itself begins with 1. Stripping
  // here would corrupt a real number, so the rule is length-gated, not
  // prefix-gated.
  assert.equal(normalisePhone("+521512345678"), "+521512345678");
});

test("a non-Mexican 13-digit number keeps every digit", () => {
  // Germany, +49. Nothing about the MX rule may leak into another country.
  assert.equal(normalisePhone("+4915112345678"), "+4915112345678");
});

test("invalid input is rejected rather than guessed at", () => {
  for (const bad of ["", "   ", "+", "abc", "+1234", "1234567", "+1234567890123456", "+0123456789"]) {
    assert.equal(normalisePhone(bad), null, JSON.stringify(bad));
  }
});

test("an embedded newline or control character is rejected, not stripped", () => {
  // A header-injection shape must never be silently cleaned into a valid
  // number — refusing is the safe answer.
  assert.equal(normalisePhone("+1212555\n1234"), null);
  assert.equal(normalisePhone("+1212555\r\n1234"), null);
});

test("sameNumber compares on the normalised form", () => {
  assert.equal(sameNumber("+5215512345678", "525512345678"), true);
  assert.equal(sameNumber("+12125551234", "+12125554321"), false);
  assert.equal(sameNumber("not a number", "+12125551234"), false);
  assert.equal(sameNumber("not a number", "also not a number"), false, "two unparseable values are not a match");
});
