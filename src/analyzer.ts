import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ZodIssue } from "zod";

import { AnalyzerError } from "./errors.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import {
  RawScopeDecisionSchema,
  ScopeDecisionSchema,
  type AnalyzeRequest,
  type ScopeDecision,
} from "./schema.js";

export interface RepairContext {
  previous_output: unknown;
  validation_errors: string[];
}

export interface ModelRunInput {
  request: AnalyzeRequest;
  repair?: RepairContext;
}

export type ModelRunner = (input: ModelRunInput) => Promise<unknown>;

export interface OpenAIRunnerOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

const sectionSeparators = [":", " —", " –", " -"];
const inScopeBoundaryPattern =
  /\b(?:not included|excluded|out of scope|not part of|does not include)\b/iu;
const tokenStopWords = new Set([
  "also",
  "and",
  "before",
  "could",
  "from",
  "have",
  "into",
  "please",
  "that",
  "the",
  "their",
  "this",
  "with",
  "would",
  "your",
]);

function looksLikeHeading(line: string): boolean {
  const value = line.trim();
  if (value.length < 2 || value.length > 120) return false;
  if (/^§\s*[\p{L}\p{N}IVX]+(?:[.):-]?|\s)/iu.test(value)) return true;
  if (/^(?:section|article|schedule|exhibit|appendix)\s+[\p{L}\p{N}IVX.-]+\b/iu.test(value)) {
    return true;
  }
  if (/^\d+(?:\.\d+)*(?:[.)])?\s+\p{Lu}/u.test(value)) return true;
  if (/[.!?]$/u.test(value)) return false;

  const words = value.split(/\s+/u);
  if (words.length > 8) return false;
  const meaningfulWords = words.filter((word) => !/^(?:and|of|or|the|to)$/iu.test(word));
  return (
    meaningfulWords.length > 0 &&
    meaningfulWords.every((word) => {
      const firstLetter = word.match(/\p{L}/u)?.[0];
      return firstLetter ? firstLetter === firstLetter.toLocaleUpperCase("en-US") : true;
    })
  );
}

function lineMatchesSection(line: string, section: string): boolean {
  const value = line.trim();
  return (
    value === section ||
    sectionSeparators.some((separator) => value.startsWith(`${section}${separator}`))
  );
}

function citationIsAnchored(
  sow: string,
  citation: ScopeDecision["sow_citations"][number],
): { valid: boolean; error?: string } {
  const lines = sow.split(/\r?\n/u);
  const headingIndexes = lines
    .map((line, index) => (looksLikeHeading(line) ? index : -1))
    .filter((index) => index >= 0);

  if (citation.section === "Unlabeled SOW passage") {
    if (headingIndexes.length > 0) {
      return {
        valid: false,
        error: "Unlabeled citations are not allowed when the SOW contains identifiable headings.",
      };
    }
    return sow.includes(citation.excerpt)
      ? { valid: true }
      : { valid: false, error: "The excerpt is not an exact contiguous quotation from the SOW." };
  }

  const matchingIndexes = headingIndexes.filter((index) =>
    lineMatchesSection(lines[index] ?? "", citation.section),
  );
  if (matchingIndexes.length === 0) {
    return { valid: false, error: "The section label is not an exact SOW heading." };
  }

  for (const index of matchingIndexes) {
    const nextHeading = headingIndexes.find((headingIndex) => headingIndex > index) ?? lines.length;
    const sectionText = lines.slice(index, nextHeading).join("\n");
    if (sectionText.includes(citation.excerpt)) {
      return { valid: true };
    }
  }

  return {
    valid: false,
    error: "The excerpt is not an exact contiguous quotation within the cited SOW section.",
  };
}

function stemToken(token: string): string {
  if (token.length > 5 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function significantTokens(value: string): Set<string> {
  const tokens = value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}]+/gu);
  return new Set(
    (tokens ?? [])
      .filter((token) => token.length >= 3 && !tokenStopWords.has(token))
      .map(stemToken),
  );
}

function hasInScopeEvidenceOverlap(decision: ScopeDecision, clientMessage: string): boolean {
  const messageTokens = significantTokens(clientMessage);
  const evidenceTokens = significantTokens(
    decision.sow_citations
      .map(({ section, excerpt }) => `${section} ${excerpt}`)
      .join(" "),
  );
  return [...messageTokens].some((token) => evidenceTokens.has(token));
}

function semanticErrors(raw: unknown, request: AnalyzeRequest): string[] {
  const parsed = ScopeDecisionSchema.safeParse(raw);
  if (!parsed.success) {
    return parsed.error.issues.map(issueToSafeMessage);
  }

  const errors: string[] = [];

  for (const [index, citation] of parsed.data.sow_citations.entries()) {
    const anchoring = citationIsAnchored(request.sow, citation);
    if (!anchoring.valid) {
      errors.push(`Citation ${index + 1}: ${anchoring.error}`);
    }

    if (!parsed.data.reasoning.includes(citation.section)) {
      errors.push(`Reasoning does not name citation ${index + 1}'s exact SOW section.`);
    }
  }

  if (
    parsed.data.classification === "IN_SCOPE" &&
    parsed.data.sow_citations.some(({ excerpt }) => inScopeBoundaryPattern.test(excerpt))
  ) {
    errors.push("An IN_SCOPE decision cannot rely on an explicit exclusion as affirmative evidence.");
  }

  if (
    parsed.data.classification === "IN_SCOPE" &&
    !hasInScopeEvidenceOverlap(parsed.data, request.client_message)
  ) {
    errors.push("IN_SCOPE evidence is not relevant to the request described in the reasoning.");
  }

  return errors;
}

function issueToSafeMessage(issue: ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join(".") : "output";
  return `${path}: ${issue.message}`;
}

function parseVerifiedDecision(raw: unknown, request: AnalyzeRequest): ScopeDecision {
  const errors = semanticErrors(raw, request);
  if (errors.length > 0) {
    throw new AnalyzerError("MODEL_OUTPUT_INVALID", errors.join(" "));
  }

  return ScopeDecisionSchema.parse(raw);
}

export function createOpenAIModelRunner(options: OpenAIRunnerOptions = {}): ModelRunner {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AnalyzerError(
      "API_KEY_MISSING",
      "OPENAI_API_KEY is not configured on the server.",
    );
  }

  const client = new OpenAI({ apiKey });
  const model = options.model ?? process.env.OPENAI_MODEL ?? "gpt-5.4-nano";
  const timeoutMs = options.timeoutMs ?? 45_000;

  return async ({ request, repair }) => {
    const payload = repair
      ? {
          ...request,
          correction_request: {
            instruction:
              "Correct the previous output using the validation errors. Re-read the SOW, keep all citations verbatim, and return the complete corrected object.",
            previous_output: repair.previous_output,
            validation_errors: repair.validation_errors,
          },
        }
      : request;

    try {
      const response = await client.responses.parse(
        {
          model,
          input: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify(payload) },
          ],
          text: {
            format: zodTextFormat(RawScopeDecisionSchema, "scope_decision"),
          },
          reasoning: { effort: "low" },
          max_output_tokens: 2_500,
          store: false,
        },
        { signal: AbortSignal.timeout(timeoutMs) },
      );

      if (!response.output_parsed) {
        throw new AnalyzerError(
          "MODEL_OUTPUT_INVALID",
          "The model did not return a structured decision.",
        );
      }

      return response.output_parsed;
    } catch (error) {
      if (error instanceof AnalyzerError) {
        throw error;
      }

      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
      ) {
        throw new AnalyzerError("ANALYSIS_TIMEOUT", "The analysis timed out.", {
          cause: error,
        });
      }

      throw new AnalyzerError("MODEL_UNAVAILABLE", "The model provider is unavailable.", {
        cause: error,
      });
    }
  };
}

export async function analyzeScope(
  request: AnalyzeRequest,
  runner?: ModelRunner,
): Promise<ScopeDecision> {
  const runModel = runner ?? createOpenAIModelRunner();
  const firstOutput = await runModel({ request });

  try {
    return parseVerifiedDecision(firstOutput, request);
  } catch (error) {
    if (!(error instanceof AnalyzerError) || error.code !== "MODEL_OUTPUT_INVALID") {
      throw error;
    }

    const validationErrors = semanticErrors(firstOutput, request);
    const repairedOutput = await runModel({
      request,
      repair: {
        previous_output: firstOutput,
        validation_errors: validationErrors,
      },
    });

    return parseVerifiedDecision(repairedOutput, request);
  }
}
