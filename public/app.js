const form = document.querySelector("#scope-form");
const sowInput = document.querySelector("#sow");
const messageInput = document.querySelector("#client-message");
const sowFileInput = document.querySelector("#sow-file");
const analyzeButton = document.querySelector("#analyze-button");
const loadExampleButton = document.querySelector("#load-example");
const newReviewButton = document.querySelector("#new-review");
const formError = document.querySelector("#form-error");
const sowError = document.querySelector("#sow-error");
const messageError = document.querySelector("#message-error");
const sowCount = document.querySelector("#sow-count");
const messageCount = document.querySelector("#message-count");
const emptyResult = document.querySelector("#empty-result");
const resultContent = document.querySelector("#result-content");
const loadingResult = document.querySelector("#loading-result");
const resultPanel = document.querySelector("#result-panel");
const decisionTitle = document.querySelector("#decision-title");
const classificationBadge = document.querySelector("#classification-badge");
const reasoning = document.querySelector("#reasoning");
const citationsSection = document.querySelector("#citations-section");
const citationsContainer = document.querySelector("#citations");
const citationCount = document.querySelector("#citation-count");
const draftReply = document.querySelector("#draft-reply");
const copyReplyButton = document.querySelector("#copy-reply");
const copyAssessmentButton = document.querySelector("#copy-assessment");
const liveStatus = document.querySelector("#live-status");

const example = {
  sow: `§1 Project
Design and build a five-page informational website for Northstar Studio.

§2 Deliverables
The project includes exactly five pages: Home, About, Services, Work, and Contact. Deliverables include responsive layouts, supplied-copy placement, and a working contact form.

§3 Revisions
Two consolidated revision rounds are included. A revision changes an approved deliverable and does not add a new feature or page.

§4 Exclusions
E-commerce, payment processing, product catalog setup, and ongoing content entry are not included.

§5 Schedule
Final delivery is due October 18, subject to the client providing consolidated feedback within two business days of each review.

§6 Payment
A 50% deposit is due before work begins. The remaining 50% is due at final delivery.`,
  client_message:
    "The site is looking great. Could you also add a shop with ten products, a cart, and Stripe checkout before launch?",
};

const classificationLabels = {
  IN_SCOPE: "In scope",
  OUT_OF_SCOPE: "Out of scope",
  AMBIGUOUS: "Ambiguous",
};

const decisionHeadings = {
  IN_SCOPE: "This request is covered.",
  OUT_OF_SCOPE: "A scope change is needed.",
  AMBIGUOUS: "The scope needs clarification.",
};

let currentDecision = null;
let loading = false;

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function updateCounts() {
  sowCount.textContent = `${formatNumber(sowInput.value.length)} / 80,000`;
  messageCount.textContent = `${formatNumber(messageInput.value.length)} / 10,000`;
}

function updateReadyState() {
  const ready = sowInput.value.trim().length > 0 && messageInput.value.trim().length > 0;
  analyzeButton.disabled = loading || !ready;
}

function clearFieldError(input, errorElement) {
  input.removeAttribute("aria-invalid");
  errorElement.textContent = "";
}

function onInput(input, errorElement) {
  clearFieldError(input, errorElement);
  hideFormError();
  updateCounts();
  updateReadyState();
}

function validateInputs() {
  let valid = true;

  if (!sowInput.value.trim()) {
    sowInput.setAttribute("aria-invalid", "true");
    sowError.textContent = "Paste the signed agreement.";
    valid = false;
  }

  if (!messageInput.value.trim()) {
    messageInput.setAttribute("aria-invalid", "true");
    messageError.textContent = "Paste the incoming client message.";
    valid = false;
  }

  if (!valid) {
    const firstInvalid = form.querySelector('[aria-invalid="true"]');
    firstInvalid?.focus();
  }

  return valid;
}

function setLoading(isLoading) {
  loading = isLoading;
  form.classList.toggle("is-loading", isLoading);
  resultPanel.setAttribute("aria-busy", String(isLoading));
  loadingResult.hidden = !isLoading;
  loadingResult.setAttribute("aria-hidden", String(!isLoading));
  form.querySelector(".button-label").textContent = isLoading ? "Checking scope" : "Check scope";
  updateReadyState();
}

function showFormError(message) {
  formError.textContent = message;
  formError.hidden = false;
}

function hideFormError() {
  formError.hidden = true;
  formError.textContent = "";
}

function showFieldErrors(fields = []) {
  for (const field of fields) {
    if (field.field === "sow") {
      sowInput.setAttribute("aria-invalid", "true");
      sowError.textContent = field.message;
    }
    if (field.field === "client_message") {
      messageInput.setAttribute("aria-invalid", "true");
      messageError.textContent = field.message;
    }
  }
}

function renderCitations(citations) {
  citationsContainer.replaceChildren();

  if (citations.length === 0) {
    citationCount.textContent = "None required";
    const empty = document.createElement("p");
    empty.className = "no-citations";
    empty.textContent = "No boundary clause is needed for this in-scope confirmation.";
    citationsContainer.append(empty);
    return;
  }

  citationCount.textContent = `${citations.length} ${citations.length === 1 ? "clause" : "clauses"}`;
  for (const citation of citations) {
    const card = document.createElement("div");
    card.className = "citation-card";

    const section = document.createElement("strong");
    section.textContent = citation.section;

    const excerpt = document.createElement("q");
    excerpt.textContent = citation.excerpt;

    card.append(section, excerpt);
    citationsContainer.append(card);
  }
}

function renderDecision(decision) {
  currentDecision = decision;
  emptyResult.hidden = true;
  resultContent.hidden = false;
  resultPanel.setAttribute("aria-labelledby", "decision-title");

  decisionTitle.textContent = decisionHeadings[decision.classification] ?? "Review complete";
  classificationBadge.textContent = classificationLabels[decision.classification] ?? decision.classification;
  classificationBadge.className = `classification-badge classification-${decision.classification
    .toLowerCase()
    .replaceAll("_", "-")}`;
  reasoning.textContent = decision.reasoning;
  draftReply.value = decision.draft_reply;
  renderCitations(decision.sow_citations);
  resizeReply();

  liveStatus.textContent = `Analysis complete: ${classificationLabels[decision.classification]}.`;
  decisionTitle.focus({ preventScroll: true });
  resultPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function buildFormattedAssessment() {
  if (!currentDecision) return "";
  const citationText = currentDecision.sow_citations
    .map(({ section, excerpt }) => `[${section}: “${excerpt}”]`)
    .join(" ");
  const fullReasoning = citationText
    ? `${currentDecision.reasoning} ${citationText}`
    : currentDecision.reasoning;

  return [
    `CLASSIFICATION: ${currentDecision.classification}`,
    `REASONING: ${fullReasoning}`,
    `DRAFT_REPLY: ${draftReply.value.trim()}`,
  ].join("\n");
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const fallback = document.createElement("textarea");
  fallback.value = text;
  fallback.setAttribute("readonly", "");
  fallback.style.position = "fixed";
  fallback.style.opacity = "0";
  document.body.append(fallback);
  fallback.select();
  const copied = document.execCommand("copy");
  fallback.remove();
  if (!copied) throw new Error("Copy failed");
}

async function copyWithFeedback(button, text, successLabel) {
  const label = button.querySelector(".copy-label");
  const original = label ? label.textContent : button.textContent;

  try {
    await copyText(text);
    if (label) label.textContent = successLabel;
    else button.textContent = successLabel;
    liveStatus.textContent = `${successLabel}.`;
  } catch {
    liveStatus.textContent = "Copy failed. Select the text and copy it manually.";
  }

  window.setTimeout(() => {
    if (label) label.textContent = original;
    else button.textContent = original;
  }, 2_000);
}

function resizeReply() {
  draftReply.style.height = "auto";
  draftReply.style.height = `${Math.max(142, draftReply.scrollHeight)}px`;
}

function resetReview() {
  form.reset();
  currentDecision = null;
  resultContent.hidden = true;
  emptyResult.hidden = false;
  resultPanel.setAttribute("aria-labelledby", "result-title");
  loadingResult.hidden = true;
  hideFormError();
  clearFieldError(sowInput, sowError);
  clearFieldError(messageInput, messageError);
  updateCounts();
  updateReadyState();
  liveStatus.textContent = "New review started.";
  sowInput.focus();
}

sowInput.addEventListener("input", () => onInput(sowInput, sowError));
messageInput.addEventListener("input", () => onInput(messageInput, messageError));
draftReply.addEventListener("input", resizeReply);

loadExampleButton.addEventListener("click", () => {
  sowInput.value = example.sow;
  messageInput.value = example.client_message;
  clearFieldError(sowInput, sowError);
  clearFieldError(messageInput, messageError);
  hideFormError();
  updateCounts();
  updateReadyState();
  liveStatus.textContent = "Example SOW and client request loaded.";
  messageInput.focus();
});

sowFileInput.addEventListener("change", async () => {
  const [file] = sowFileInput.files;
  if (!file) return;

  const allowedExtension = /\.(txt|md)$/iu.test(file.name);
  if (!allowedExtension || file.size > 100_000) {
    showFormError("Choose a plain-text .txt or .md file smaller than 100 KB.");
    sowFileInput.value = "";
    return;
  }

  try {
    const text = await file.text();
    if (text.length > 80_000) {
      throw new Error("File contains too much text");
    }
    sowInput.value = text;
    onInput(sowInput, sowError);
    liveStatus.textContent = `${file.name} imported.`;
    sowInput.focus();
  } catch {
    showFormError("That file could not be imported. Paste the agreement text instead.");
  } finally {
    sowFileInput.value = "";
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideFormError();
  if (!validateInputs() || loading) return;

  setLoading(true);
  liveStatus.textContent = "Checking the request against the agreement.";

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sow: sowInput.value,
        client_message: messageInput.value,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = payload?.error;
      showFieldErrors(error?.fields);
      throw new Error(error?.message ?? "The analysis could not be completed. Please try again.");
    }

    renderDecision(payload);
  } catch (error) {
    const message =
      error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")
        ? "The analysis timed out. Your text is still here—please try again."
        : error instanceof Error
          ? error.message
          : "The analysis could not be completed. Please try again.";
    showFormError(message);
    liveStatus.textContent = `Analysis failed. ${message}`;
  } finally {
    setLoading(false);
  }
});

copyReplyButton.addEventListener("click", () => {
  void copyWithFeedback(copyReplyButton, draftReply.value.trim(), "Copied");
});

copyAssessmentButton.addEventListener("click", () => {
  void copyWithFeedback(copyAssessmentButton, buildFormattedAssessment(), "Assessment copied");
});

newReviewButton.addEventListener("click", resetReview);

updateCounts();
updateReadyState();
