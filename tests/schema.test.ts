import { describe, expect, it } from "vitest";

import {
  AnalyzeRequestSchema,
  ScopeDecisionSchema,
  formatDecision,
} from "../src/schema.js";
import { outOfScopeDecision } from "./fixtures.js";

describe("AnalyzeRequestSchema", () => {
  it("trims valid inputs", () => {
    const parsed = AnalyzeRequestSchema.parse({
      sow: "  §1 Scope\nOne landing page.  ",
      client_message: "  Please change the headline.  ",
    });

    expect(parsed).toEqual({
      sow: "§1 Scope\nOne landing page.",
      client_message: "Please change the headline.",
    });
  });

  it("rejects missing, extra, and control-character input", () => {
    expect(() => AnalyzeRequestSchema.parse({ sow: "Scope only" })).toThrow();
    expect(() =>
      AnalyzeRequestSchema.parse({
        sow: "Scope only",
        client_message: "A request",
        override: true,
      }),
    ).toThrow();
    expect(() =>
      AnalyzeRequestSchema.parse({
        sow: "Scope\u0000only",
        client_message: "A request",
      }),
    ).toThrow();
  });
});

describe("ScopeDecisionSchema", () => {
  it("requires source evidence for every decision", () => {
    const ambiguous = {
      classification: "AMBIGUOUS",
      reasoning: "The revision status is not supplied.",
      sow_citations: [],
      draft_reply: "Thanks. Can we confirm the revision status?",
    };

    expect(ScopeDecisionSchema.safeParse(ambiguous).success).toBe(false);
  });

  it("rejects an in-scope result without citations", () => {
    const inScope = {
      classification: "IN_SCOPE",
      reasoning: "The requested headline edit is covered by the included revision round.",
      sow_citations: [],
      draft_reply: "Absolutely—this is covered, and I’ll proceed with no scope change needed.",
    };

    expect(ScopeDecisionSchema.safeParse(inScope).success).toBe(false);
  });

  it("rejects trivial section labels and excerpts", () => {
    const trivial = {
      classification: "OUT_OF_SCOPE",
      reasoning: "The request conflicts with a.",
      sow_citations: [{ section: "a", excerpt: "a" }],
      draft_reply: "Thanks. I can prepare a separate quote.",
    };

    expect(ScopeDecisionSchema.safeParse(trivial).success).toBe(false);
  });
});

describe("formatDecision", () => {
  it("renders the exact three-field output contract with grounded citations", () => {
    expect(formatDecision(outOfScopeDecision)).toBe(
      `CLASSIFICATION: OUT_OF_SCOPE\nREASONING: The requested shop and checkout conflict with the e-commerce boundary in §4 Exclusions. [§4 Exclusions: “E-commerce, payment processing, and product catalog setup are not included.”]\nDRAFT_REPLY: Thanks for the idea—I’d be happy to help with the shop. The current SOW excludes e-commerce and payment processing, so I can prepare an added quote and schedule for your approval.`,
    );
  });
});
