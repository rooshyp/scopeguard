import { createConnection, type AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalyzerError } from "../src/errors.js";
import { createScopeServer } from "../src/server.js";
import { outOfScopeDecision, sampleRequest } from "./fixtures.js";

const openServers: ReturnType<typeof createScopeServer>[] = [];

async function startServer(
  options: Parameters<typeof createScopeServer>[0] = {},
): Promise<{ baseUrl: string; server: ReturnType<typeof createScopeServer> }> {
  const server = createScopeServer({ logger: false, rateLimit: false, ...options });
  openServers.push(server);
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, server };
}

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolvePromise, rejectPromise) =>
          server.close((error) => (error ? rejectPromise(error) : resolvePromise())),
        ),
    ),
  );
});

describe("HTTP server", () => {
  it("serves the app and health endpoint with security headers", async () => {
    const { baseUrl } = await startServer();

    const page = await fetch(baseUrl);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await page.text()).toContain("Know what you’re saying");

    const health = await fetch(`${baseUrl}/api/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("returns 400 for a malformed raw request target and remains healthy", async () => {
    const { baseUrl, server } = await startServer();
    const address = server.address() as AddressInfo;
    const rawResponse = await new Promise<string>((resolvePromise, rejectPromise) => {
      const socket = createConnection(address.port, "127.0.0.1");
      let data = "";
      socket.setEncoding("utf8");
      socket.on("connect", () =>
        socket.write("GET http://[::1 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"),
      );
      socket.on("data", (chunk) => {
        data += chunk;
      });
      socket.on("end", () => resolvePromise(data));
      socket.on("error", rejectPromise);
    });

    expect(rawResponse).toContain("400 Bad Request");
    expect(rawResponse).toContain("INVALID_REQUEST_TARGET");
    expect((await fetch(`${baseUrl}/api/health`)).status).toBe(200);
  });

  it("returns a verified decision in both structured and exact text formats", async () => {
    const analyze = vi.fn().mockResolvedValue(outOfScopeDecision);
    const { baseUrl } = await startServer({ analyze });

    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sampleRequest),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject(outOfScopeDecision);
    expect(body.formatted).toMatch(/^CLASSIFICATION: OUT_OF_SCOPE\nREASONING:/u);
    expect(analyze).toHaveBeenCalledWith(sampleRequest);
  });

  it("rejects invalid input without invoking the analyzer", async () => {
    const analyze = vi.fn().mockResolvedValue(outOfScopeDecision);
    const { baseUrl } = await startServer({ analyze });

    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sow: "", client_message: "Please add a store." }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.fields).toContainEqual(
      expect.objectContaining({ field: "sow", message: expect.any(String) }),
    );
    expect(analyze).not.toHaveBeenCalled();
  });

  it("enforces media type and body-size boundaries", async () => {
    const analyze = vi.fn().mockResolvedValue(outOfScopeDecision);
    const { baseUrl } = await startServer({ analyze });

    const wrongType = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "not json",
    });
    expect(wrongType.status).toBe(415);

    const tooLarge = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sow: "x".repeat(140_000), client_message: "A request" }),
    });
    expect(tooLarge.status).toBe(413);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("maps analyzer failures to safe API errors", async () => {
    const analyze = vi.fn().mockRejectedValue(
      new AnalyzerError("MODEL_OUTPUT_INVALID", "Sensitive provider validation detail"),
    );
    const { baseUrl } = await startServer({ analyze });

    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sampleRequest),
    });
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error.code).toBe("MODEL_OUTPUT_INVALID");
    expect(JSON.stringify(body)).not.toContain("Sensitive provider validation detail");
  });

  it("rate-limits repeated analysis calls per client", async () => {
    const analyze = vi.fn().mockResolvedValue(outOfScopeDecision);
    const { baseUrl } = await startServer({
      analyze,
      rateLimit: { limit: 1, windowMs: 60_000 },
    });

    const request = () =>
      fetch(`${baseUrl}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sampleRequest),
      });

    expect((await request()).status).toBe(200);
    const limited = await request();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(analyze).toHaveBeenCalledTimes(1);
  });
});
