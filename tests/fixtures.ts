import type { AnalyzeRequest, ScopeDecision } from "../src/schema.js";

export const sampleSow = `§1 Project
Design and build a five-page informational website.

§2 Deliverables
The project includes exactly five pages: Home, About, Services, Work, and Contact.

§3 Revisions
Two consolidated revision rounds are included.

§4 Exclusions
E-commerce, payment processing, and product catalog setup are not included.

§5 Schedule
Final delivery is due October 18, subject to timely client feedback.

§6 Payment
A 50% deposit is due before work begins. The remaining balance is due at final delivery.`;

export const sampleRequest: AnalyzeRequest = {
  sow: sampleSow,
  client_message: "Could you add a ten-product shop and checkout before launch?",
};

export const inScopeRequest: AnalyzeRequest = {
  sow: sampleSow,
  client_message: "Please revise the Services page headline during the first revision round.",
};

export const inScopeDecision: ScopeDecision = {
  classification: "IN_SCOPE",
  reasoning:
    "The Services page is a listed deliverable in §2 Deliverables, and the first revision is within §3 Revisions.",
  sow_citations: [
    {
      section: "§2 Deliverables",
      excerpt:
        "The project includes exactly five pages: Home, About, Services, Work, and Contact.",
    },
    {
      section: "§3 Revisions",
      excerpt: "Two consolidated revision rounds are included.",
    },
  ],
  draft_reply:
    "Absolutely—this headline revision is covered, and I’ll proceed with no scope change needed.",
};

export const outOfScopeDecision: ScopeDecision = {
  classification: "OUT_OF_SCOPE",
  reasoning:
    "The requested shop and checkout conflict with the e-commerce boundary in §4 Exclusions.",
  sow_citations: [
    {
      section: "§4 Exclusions",
      excerpt: "E-commerce, payment processing, and product catalog setup are not included.",
    },
  ],
  draft_reply:
    "Thanks for the idea—I’d be happy to help with the shop. The current SOW excludes e-commerce and payment processing, so I can prepare an added quote and schedule for your approval.",
};
