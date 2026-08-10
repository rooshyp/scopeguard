import "dotenv/config";

import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { analyzeScope } from "./analyzer.js";
import { AnalyzerError } from "./errors.js";
import {
  AnalyzeRequestSchema,
  formatDecision,
  type AnalyzeRequest,
  type ScopeDecision,
} from "./schema.js";

const MAX_BODY_BYTES = 128 * 1024;
const DEFAULT_RATE_LIMIT = 12;
const DEFAULT_RATE_WINDOW_MS = 60_000;

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultPublicDirectory = resolve(moduleDirectory, "../public");

type ScopeAnalyzer = (request: AnalyzeRequest) => Promise<ScopeDecision>;
type SafeLogger = (entry: {
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
}) => void;

interface ServerOptions {
  analyze?: ScopeAnalyzer;
  publicDirectory?: string;
  logger?: SafeLogger | false;
  rateLimit?:
    | false
    | {
        limit: number;
        windowMs: number;
      };
}

interface ErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    fields?: Array<{ field: string; message: string }>;
  };
}

class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

class MemoryRateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  consume(key: string, now = Date.now()): { allowed: boolean; retryAfter: number } {
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfter: 0 };
    }

    if (existing.count >= this.limit) {
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1_000)),
      };
    }

    existing.count += 1;
    return { allowed: true, retryAfter: 0 };
  }
}

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

const staticRoutes: Record<string, string> = {
  "/": "index.html",
  "/index.html": "index.html",
  "/styles.css": "styles.css",
  "/app.js": "app.js",
  "/favicon.svg": "favicon.svg",
  "/robots.txt": "robots.txt",
};

function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Length", Buffer.byteLength(payload));
  response.end(payload);
}

function sendApiError(
  response: ServerResponse,
  requestId: string,
  status: number,
  code: string,
  message: string,
  fields?: Array<{ field: string; message: string }>,
): void {
  const body: ErrorBody = {
    error: {
      code,
      message,
      requestId,
      ...(fields && fields.length > 0 ? { fields } : {}),
    },
  };
  sendJson(response, status, body);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "INPUT_TOO_LARGE", "The submitted text is too large.");
  }

  const chunks: Buffer[] = [];
  let received = 0;
  let tooLarge = false;

  await new Promise<void>((resolvePromise, rejectPromise) => {
    request.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", resolvePromise);
    request.on("aborted", () =>
      rejectPromise(new HttpError(400, "REQUEST_ABORTED", "The request was interrupted.")),
    );
    request.on("error", rejectPromise);
  });

  if (tooLarge) {
    throw new HttpError(413, "INPUT_TOO_LARGE", "The submitted text is too large.");
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "The request body must be valid JSON.");
  }
}

function mapAnalyzerError(error: AnalyzerError): {
  status: number;
  code: string;
  message: string;
} {
  switch (error.code) {
    case "API_KEY_MISSING":
      return {
        status: 503,
        code: "CONFIGURATION_ERROR",
        message: "The analyzer is not configured yet. Add the server API key and try again.",
      };
    case "ANALYSIS_TIMEOUT":
      return {
        status: 504,
        code: "ANALYSIS_TIMEOUT",
        message: "The analysis took too long. Please try again.",
      };
    case "MODEL_OUTPUT_INVALID":
      return {
        status: 502,
        code: "MODEL_OUTPUT_INVALID",
        message: "The analysis could not be verified. Please try again.",
      };
    case "MODEL_UNAVAILABLE":
      return {
        status: 503,
        code: "MODEL_UNAVAILABLE",
        message: "The analysis service is temporarily unavailable. Please try again.",
      };
  }
}

async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  publicDirectory: string,
  pathname: string,
): Promise<number> {
  const fileName = staticRoutes[pathname];
  if (!fileName || (request.method !== "GET" && request.method !== "HEAD")) {
    response.statusCode = 404;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end("Not found");
    return 404;
  }

  const filePath = resolve(publicDirectory, fileName);
  try {
    const metadata = await stat(filePath);
    response.statusCode = 200;
    response.setHeader(
      "Content-Type",
      contentTypes[extname(filePath)] ?? "application/octet-stream",
    );
    response.setHeader("Content-Length", metadata.size);
    response.setHeader("Cache-Control", pathname === "/" ? "no-cache" : "public, max-age=3600");

    if (request.method === "HEAD") {
      response.end();
    } else {
      createReadStream(filePath).pipe(response);
    }
    return 200;
  } catch {
    response.statusCode = 404;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end("Not found");
    return 404;
  }
}

export function createScopeServer(options: ServerOptions = {}): Server {
  const analyze = options.analyze ?? analyzeScope;
  const publicDirectory = options.publicDirectory ?? defaultPublicDirectory;
  const logger = options.logger === undefined ? console.info : options.logger;
  const rateConfiguration =
    options.rateLimit === undefined
      ? { limit: DEFAULT_RATE_LIMIT, windowMs: DEFAULT_RATE_WINDOW_MS }
      : options.rateLimit;
  const rateLimiter = rateConfiguration
    ? new MemoryRateLimiter(rateConfiguration.limit, rateConfiguration.windowMs)
    : undefined;

  return createServer(async (request, response) => {
    const startedAt = Date.now();
    const requestId = randomUUID();
    const method = request.method ?? "GET";
    let pathname = request.url ?? "/";
    let status = 500;

    applySecurityHeaders(response);
    response.setHeader("X-Request-Id", requestId);

    try {
      let url: URL;
      try {
        url = new URL(request.url ?? "/", "http://localhost");
        pathname = url.pathname;
      } catch {
        sendApiError(response, requestId, 400, "INVALID_REQUEST_TARGET", "Invalid request URL.");
        status = 400;
        return;
      }

      if (pathname === "/api/health") {
        if (method !== "GET") {
          response.setHeader("Allow", "GET");
          sendApiError(response, requestId, 405, "METHOD_NOT_ALLOWED", "Use GET for this route.");
          status = 405;
          return;
        }
        sendJson(response, 200, { status: "ok", requestId });
        status = 200;
        return;
      }

      if (pathname === "/api/analyze") {
        if (method !== "POST") {
          response.setHeader("Allow", "POST");
          sendApiError(response, requestId, 405, "METHOD_NOT_ALLOWED", "Use POST for this route.");
          status = 405;
          return;
        }

        const contentType = request.headers["content-type"] ?? "";
        if (!contentType.toLowerCase().startsWith("application/json")) {
          sendApiError(
            response,
            requestId,
            415,
            "UNSUPPORTED_MEDIA_TYPE",
            "Send the request as application/json.",
          );
          status = 415;
          return;
        }

        if (rateLimiter) {
          const clientKey = request.socket.remoteAddress ?? "unknown";
          const rate = rateLimiter.consume(clientKey);
          if (!rate.allowed) {
            response.setHeader("Retry-After", String(rate.retryAfter));
            sendApiError(
              response,
              requestId,
              429,
              "RATE_LIMITED",
              "Too many analyses were requested. Please wait and try again.",
            );
            status = 429;
            return;
          }
        }

        const input = await readJsonBody(request);
        const parsed = AnalyzeRequestSchema.safeParse(input);
        if (!parsed.success) {
          const fields = parsed.error.issues.map((issue) => ({
            field: issue.path[0]?.toString() ?? "request",
            message: issue.message,
          }));
          sendApiError(
            response,
            requestId,
            400,
            "INVALID_INPUT",
            "Check the highlighted fields and try again.",
            fields,
          );
          status = 400;
          return;
        }

        const decision = await analyze(parsed.data);
        sendJson(response, 200, {
          ...decision,
          formatted: formatDecision(decision),
          requestId,
        });
        status = 200;
        return;
      }

      if (pathname.startsWith("/api/")) {
        sendApiError(response, requestId, 404, "NOT_FOUND", "API route not found.");
        status = 404;
        return;
      }

      status = await serveStatic(request, response, publicDirectory, pathname);
    } catch (error) {
      if (error instanceof HttpError) {
        sendApiError(response, requestId, error.status, error.code, error.message);
        status = error.status;
      } else if (error instanceof AnalyzerError) {
        const mapped = mapAnalyzerError(error);
        sendApiError(response, requestId, mapped.status, mapped.code, mapped.message);
        status = mapped.status;
      } else {
        sendApiError(
          response,
          requestId,
          500,
          "INTERNAL_ERROR",
          "Something went wrong. Please try again.",
        );
        status = 500;
      }
    } finally {
      if (logger) {
        logger({
          requestId,
          method,
          path: pathname,
          status,
          durationMs: Date.now() - startedAt,
        });
      }
    }
  });
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? 3000);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : 3000;
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entryUrl) {
  const port = parsePort(process.env.PORT);
  const host = process.env.HOST ?? "127.0.0.1";
  const server = createScopeServer();

  server.listen(port, host, () => {
    console.info(`ScopeGuard is running at http://${host}:${port}`);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
