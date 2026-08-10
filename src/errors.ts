export type AnalyzerErrorCode =
  | "API_KEY_MISSING"
  | "MODEL_OUTPUT_INVALID"
  | "MODEL_UNAVAILABLE"
  | "ANALYSIS_TIMEOUT";

export class AnalyzerError extends Error {
  readonly code: AnalyzerErrorCode;

  constructor(code: AnalyzerErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AnalyzerError";
    this.code = code;
  }
}
