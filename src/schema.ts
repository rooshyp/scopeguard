import { z } from "zod";

export const MAX_SOW_LENGTH = 80_000;
export const MAX_CLIENT_MESSAGE_LENGTH = 10_000;

const safeText = (label: string, maximum: number) =>
  z
    .string({ error: `${label} must be text.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(maximum, `${label} is too long.`)
    .refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value), {
      message: `${label} contains unsupported control characters.`,
    });

export const AnalyzeRequestSchema = z
  .object({
    sow: safeText("SOW", MAX_SOW_LENGTH),
    client_message: safeText("Client message", MAX_CLIENT_MESSAGE_LENGTH),
  })
  .strict();

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export const SowCitationSchema = z
  .object({
    section: z.string().trim().min(2).max(120),
    excerpt: z.string().trim().min(12).max(400),
  })
  .strict();

export const RawScopeDecisionSchema = z
  .object({
    classification: z.enum(["IN_SCOPE", "OUT_OF_SCOPE", "AMBIGUOUS"]),
    reasoning: z.string().trim().min(1).max(600),
    sow_citations: z.array(SowCitationSchema).min(1).max(6),
    draft_reply: z.string().trim().min(1).max(1_500),
  })
  .strict();

export const ScopeDecisionSchema = RawScopeDecisionSchema.superRefine((value, context) => {
  const citationKeys = value.sow_citations.map(
    ({ section, excerpt }) =>
      `${section.normalize("NFKC").toLocaleLowerCase("en-US")}\u0000${excerpt
        .normalize("NFKC")
        .replace(/\s+/gu, " ")
        .toLocaleLowerCase("en-US")}`,
  );

  if (new Set(citationKeys).size !== citationKeys.length) {
    context.addIssue({
      code: "custom",
      path: ["sow_citations"],
      message: "Duplicate citations are not allowed.",
    });
  }
});

export type ScopeDecision = z.infer<typeof ScopeDecisionSchema>;

export function formatDecision(decision: ScopeDecision): string {
  const citations = decision.sow_citations
    .map(({ section, excerpt }) => `[${section}: “${excerpt}”]`)
    .join(" ");
  const reasoning = citations ? `${decision.reasoning} ${citations}` : decision.reasoning;

  return [
    `CLASSIFICATION: ${decision.classification}`,
    `REASONING: ${reasoning}`,
    `DRAFT_REPLY: ${decision.draft_reply}`,
  ].join("\n");
}
