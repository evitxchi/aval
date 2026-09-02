/**
 * Heuristic address normalization for the free-text addresses that arrive
 * from PMS/accounting connectors (AppFolio, Buildium, QuickBooks, etc.),
 * which don't agree on a single address shape.
 *
 * A GitHub sourcing pass (docs/DECISIONS.md) found the strong tools for
 * this — libpostal, usaddress — are C/Python, not embeddable in a
 * Cloudflare Worker; running them would mean a sidecar service. This is a
 * deliberately smaller, dependency-free heuristic covering the two markets
 * Aval supports (US, MX — see docs/DECISIONS.md's market decision) that's
 * honest about its limits: `confidence: "low"` means don't trust the
 * component split, only the original `raw` string.
 */

export interface ParsedUsAddress {
  market: "us";
  raw: string;
  confidence: "high" | "low";
  streetNumber?: string;
  streetName?: string;
  unit?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}

export interface ParsedMxAddress {
  market: "latam";
  raw: string;
  confidence: "high" | "low";
  street?: string;
  exteriorNumber?: string;
  colonia?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}

const UNIT_PATTERN = /\b(?:apt|apartment|unit|suite|ste|#)\.?\s*([a-z0-9-]+)\b/i;
const US_STATE_ZIP_PATTERN = /([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/i;
const LEADING_NUMBER_PATTERN = /^(\d+[a-z]?)\s+(.*)$/i;

export function parseUsAddress(rawInput: string): ParsedUsAddress {
  const raw = rawInput.trim();
  const segments = raw.split(",").map((segment) => segment.trim()).filter(Boolean);

  if (segments.length < 2) {
    return { market: "us", raw, confidence: "low" };
  }

  const stateZipMatch = US_STATE_ZIP_PATTERN.exec(segments.at(-1) ?? "");
  if (!stateZipMatch) {
    return { market: "us", raw, confidence: "low" };
  }
  const state = stateZipMatch[1].toUpperCase();
  const postalCode = stateZipMatch[2];

  // "123 Main St, Springfield, IL 62704" -> city is the segment before state/zip.
  // "123 Main St, Springfield IL 62704" -> city is what's left of the last segment after stripping state/zip.
  const lastSegmentRemainder = segments.at(-1)!.slice(0, stateZipMatch.index).trim();
  const city = lastSegmentRemainder || segments.at(-2);

  const streetLine = segments[0];
  const unitMatch = UNIT_PATTERN.exec(raw);
  const streetLineWithoutUnit = unitMatch ? streetLine.replace(UNIT_PATTERN, "").trim() : streetLine;
  const numberMatch = LEADING_NUMBER_PATTERN.exec(streetLineWithoutUnit);

  return {
    market: "us",
    raw,
    confidence: "high",
    streetNumber: numberMatch?.[1],
    streetName: (numberMatch?.[2] ?? streetLineWithoutUnit) || undefined,
    unit: unitMatch?.[1],
    city: city || undefined,
    state,
    postalCode,
  };
}

const MX_POSTAL_CODE_PATTERN = /\bC\.?P\.?\s*(\d{5})\b|\b(\d{5})\b/i;
const MX_COLONIA_PATTERN = /\b(?:colonia|col\.)\s+([^,]+)/i;

export function parseMxAddress(rawInput: string): ParsedMxAddress {
  const raw = rawInput.trim();
  const segments = raw.split(",").map((segment) => segment.trim()).filter(Boolean);

  if (segments.length < 2) {
    return { market: "latam", raw, confidence: "low" };
  }

  const postalMatch = MX_POSTAL_CODE_PATTERN.exec(raw);
  const postalCode = postalMatch?.[1] ?? postalMatch?.[2];
  const coloniaMatch = MX_COLONIA_PATTERN.exec(raw);

  const streetSegment = segments[0];
  const numberMatch = /^(.*?)\s+(\d+[a-z]?)$/i.exec(streetSegment);

  // City/state are whatever's left after street and colonia segments — this
  // is the weakest part of the heuristic (Mexican addresses vary more in
  // segment order than US ones), hence confidence stays "high" only when a
  // postal code was actually found to anchor the parse.
  const remainingSegments = segments.filter((segment) => segment !== streetSegment && !MX_COLONIA_PATTERN.test(segment));
  const city = remainingSegments[0]?.replace(MX_POSTAL_CODE_PATTERN, "").trim();
  const state = remainingSegments.at(-1)?.replace(MX_POSTAL_CODE_PATTERN, "").trim();

  return {
    market: "latam",
    raw,
    confidence: postalCode ? "high" : "low",
    street: (numberMatch?.[1] ?? streetSegment) || undefined,
    exteriorNumber: numberMatch?.[2],
    colonia: coloniaMatch?.[1]?.trim(),
    city: city || undefined,
    state: state && state !== city ? state : undefined,
    postalCode,
  };
}

export function normalizeAddress(raw: string, market: "us" | "latam"): ParsedUsAddress | ParsedMxAddress {
  return market === "us" ? parseUsAddress(raw) : parseMxAddress(raw);
}
