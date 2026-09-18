import { afterEach, describe, expect, it } from "vitest";
import { fetchDriveTextFile } from "./googleDriveReadonly";

type Call = { url: string; init: RequestInit };

function fakeFetchSequence(responses: Response[], calls: Call[]): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const response = responses.shift();
    if (!response) throw new Error("Unexpected fetch");
    return response;
  }) as typeof fetch;
}

const savedEnv = {
  json: process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON,
  email: process.env.GOOGLE_DRIVE_CLIENT_EMAIL,
  key: process.env.GOOGLE_DRIVE_PRIVATE_KEY,
};

afterEach(() => {
  if (savedEnv.json === undefined) delete process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  else process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON = savedEnv.json;
  if (savedEnv.email === undefined) delete process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
  else process.env.GOOGLE_DRIVE_CLIENT_EMAIL = savedEnv.email;
  if (savedEnv.key === undefined) delete process.env.GOOGLE_DRIVE_PRIVATE_KEY;
  else process.env.GOOGLE_DRIVE_PRIVATE_KEY = savedEnv.key;
});

describe("fetchDriveTextFile", () => {
  it("fetches stored Markdown through alt=media", async () => {
    const calls: Call[] = [];
    const fetchImpl = fakeFetchSequence(
      [
        new Response(
          JSON.stringify({
            id: "abc",
            name: "COMPLETE-CURRICULUM.md",
            mimeType: "text/markdown",
            modifiedTime: "2026-09-18T00:00:00Z",
            version: "7",
            md5Checksum: "deadbeef",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
        new Response("# curriculum", { status: 200 }),
      ],
      calls,
    );

    const result = await fetchDriveTextFile("abc", {
      fetchImpl,
      accessTokenProvider: async () => "token",
    });

    expect(result.text).toBe("# curriculum");
    expect(result.metadata.name).toBe("COMPLETE-CURRICULUM.md");
    expect(calls[1].url).toMatch(/alt=media/);
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe("Bearer token");
  });

  it("exports native Google Docs as text/plain", async () => {
    const calls: Call[] = [];
    const fetchImpl = fakeFetchSequence(
      [
        new Response(
          JSON.stringify({
            id: "doc1",
            name: "Curriculum",
            mimeType: "application/vnd.google-apps.document",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
        new Response("doc text", { status: 200 }),
      ],
      calls,
    );

    const result = await fetchDriveTextFile("doc1", {
      fetchImpl,
      accessTokenProvider: async () => "token",
    });

    expect(result.text).toBe("doc text");
    expect(calls[1].url).toMatch(/\/export\?/);
    expect(calls[1].url).toMatch(/mimeType=text%2Fplain/);
  });

  it("fails closed on Drive read errors", async () => {
    const calls: Call[] = [];
    const fetchImpl = fakeFetchSequence(
      [
        new Response(
          JSON.stringify({ id: "abc", name: "x.md", mimeType: "text/markdown" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
        new Response("forbidden", { status: 403 }),
      ],
      calls,
    );

    await expect(
      fetchDriveTextFile("abc", {
        fetchImpl,
        accessTokenProvider: async () => "token",
      }),
    ).rejects.toThrow(/403/);
  });

  it("fails with an explicit configuration error when service-account credentials are absent", async () => {
    delete process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
    delete process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
    delete process.env.GOOGLE_DRIVE_PRIVATE_KEY;

    await expect(
      fetchDriveTextFile("abc", {
        fetchImpl: (async () => {
          throw new Error("network should not run");
        }) as typeof fetch,
      }),
    ).rejects.toThrow(/service account/i);
  });
});
