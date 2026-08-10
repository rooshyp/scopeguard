import { describe, expect, it, vi } from "vitest";

import { analyzeScope, createOpenAIModelRunner, type ModelRunner } from "../src/analyzer.js";
import { AnalyzerError } from "../src/errors.js";
import {
  inScopeDecision,
  inScopeRequest,
  outOfScopeDecision,
  sampleRequest,
} from "./fixtures.js";

describe("analyzeScope", () => {
  it("accepts a structured decision with verbatim, section-grounded citations", async () => {
    const runner = vi.fn<ModelRunner>().mockResolvedValue(outOfScopeDecision);

    await expect(analyzeScope(sampleRequest, runner)).resolves.toEqual(outOfScopeDecision);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]?.[0].repair).toBeUndefined();
  });

  it("accepts an in-scope confirmation with affirmative, relevant evidence", async () => {
    const runner = vi.fn<ModelRunner>().mockResolvedValue(inScopeDecision);

    await expect(analyzeScope(inScopeRequest, runner)).resolves.toEqual(inScopeDecision);
  });

  it("makes one bounded repair when a citation is invented", async () => {
    const invalid = {
      ...outOfScopeDecision,
      sow_citations: [
        {
          section: "§9 Imaginary clause",
          excerpt: "Unlimited e-commerce work is excluded.",
        },
      ],
    };
    const runner = vi
      .fn<ModelRunner>()
      .mockResolvedValueOnce(invalid)
      .mockResolvedValueOnce(outOfScopeDecision);

    await expect(analyzeScope(sampleRequest, runner)).resolves.toEqual(outOfScopeDecision);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[1]?.[0].repair?.validation_errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("section label is not an exact SOW heading"),
      ]),
    );
  });

  it("rejects an excerpt attributed to the wrong SOW section", async () => {
    const invalid = {
      ...outOfScopeDecision,
      reasoning: "The request conflicts with §2 Deliverables.",
      sow_citations: [
        {
          section: "§2 Deliverables",
          excerpt: "E-commerce, payment processing, and product catalog setup are not included.",
        },
      ],
    };
    const runner = vi.fn<ModelRunner>().mockResolvedValue(invalid);

    await expect(analyzeScope(sampleRequest, runner)).rejects.toMatchObject({
      code: "MODEL_OUTPUT_INVALID",
    });
  });

  it("rejects IN_SCOPE when its evidence is an explicit exclusion", async () => {
    const invalid = {
      ...outOfScopeDecision,
      classification: "IN_SCOPE" as const,
      reasoning: "The shop is covered by §4 Exclusions.",
    };
    const runner = vi.fn<ModelRunner>().mockResolvedValue(invalid);

    await expect(analyzeScope(sampleRequest, runner)).rejects.toMatchObject({
      code: "MODEL_OUTPUT_INVALID",
    });
  });

  it("fails closed after one unsuccessful repair", async () => {
    const invalid = {
      ...outOfScopeDecision,
      sow_citations: [{ section: "§4 Exclusions", excerpt: "A fabricated quote." }],
    };
    const runner = vi.fn<ModelRunner>().mockResolvedValue(invalid);

    await expect(analyzeScope(sampleRequest, runner)).rejects.toMatchObject({
      code: "MODEL_OUTPUT_INVALID",
    } satisfies Partial<AnalyzerError>);
    expect(runner).toHaveBeenCalledTimes(2);
  });
});

describe("createOpenAIModelRunner", () => {
  it("requires a server-side API key", () => {
    expect(() => createOpenAIModelRunner({ apiKey: "" })).toThrowError(
      expect.objectContaining({ code: "API_KEY_MISSING" }),
    );
  });
});
