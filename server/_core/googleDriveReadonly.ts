import { createSign } from "node:crypto";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const TOKEN_AUDIENCE = "https://oauth2.googleapis.com/token";
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

export interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string | null;
  md5Checksum?: string | null;
  version?: string | number | null;
}

export interface DriveTextFileResult {
  text: string;
  metadata: DriveFileMetadata;
}

interface DriveFetchOptions {
  fetchImpl?: typeof fetch;
  accessTokenProvider?: () => Promise<string>;
}

interface ServiceAccountCredentials {
  clientEmail: string;
  privateKey: string;
}

let tokenCache:
  | {
      token: string;
      expiresAtMs: number;
    }
  | undefined;

function getServiceAccountCredentials(): ServiceAccountCredentials {
  const rawJson = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  if (rawJson) {
    let parsed: { client_email?: unknown; private_key?: unknown };
    try {
      parsed = JSON.parse(rawJson) as { client_email?: unknown; private_key?: unknown };
    } catch {
      throw new Error("Google Drive service account configuration is invalid JSON.");
    }
    if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") {
      throw new Error("Google Drive service account configuration must include client_email and private_key.");
    }
    return {
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key.replace(/\\n/g, "\n"),
    };
  }

  const clientEmail = process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_DRIVE_PRIVATE_KEY;
  if (!clientEmail || !privateKey) {
    throw new Error(
      "Google Drive service account credentials are not configured. Set GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON or GOOGLE_DRIVE_CLIENT_EMAIL and GOOGLE_DRIVE_PRIVATE_KEY.",
    );
  }

  return {
    clientEmail,
    privateKey: privateKey.replace(/\\n/g, "\n"),
  };
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function getGoogleDriveAccessToken(fetchImpl: typeof fetch): Promise<string> {
  const nowMs = Date.now();
  if (tokenCache && tokenCache.expiresAtMs > nowMs + 60_000) {
    return tokenCache.token;
  }

  const credentials = getServiceAccountCredentials();
  const issuedAt = Math.floor(nowMs / 1000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const claims = base64UrlJson({
    iss: credentials.clientEmail,
    scope: DRIVE_SCOPE,
    aud: TOKEN_AUDIENCE,
    iat: issuedAt,
    exp: issuedAt + 3600,
  });
  const signingInput = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(credentials.privateKey).toString("base64url");
  const assertion = `${signingInput}.${signature}`;

  const response = await fetchImpl(TOKEN_AUDIENCE, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(`Google Drive OAuth token request failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error("Google Drive OAuth token response did not include an access token.");
  }
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
  tokenCache = {
    token: payload.access_token,
    expiresAtMs: nowMs + expiresIn * 1000,
  };
  return payload.access_token;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

async function requireOk(response: Response, operation: string): Promise<Response> {
  if (!response.ok) {
    throw new Error(`${operation} failed with HTTP ${response.status}.`);
  }
  return response;
}

export async function fetchDriveTextFile(
  fileId: string,
  options: DriveFetchOptions = {},
): Promise<DriveTextFileResult> {
  if (!fileId.trim()) throw new Error("Google Drive file ID is required.");

  const fetchImpl = options.fetchImpl ?? fetch;
  const token = await (options.accessTokenProvider
    ? options.accessTokenProvider()
    : getGoogleDriveAccessToken(fetchImpl));
  const encodedId = encodeURIComponent(fileId);
  const metadataUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodedId}`);
  metadataUrl.searchParams.set("fields", "id,name,mimeType,modifiedTime,md5Checksum,version");
  metadataUrl.searchParams.set("supportsAllDrives", "true");

  const metadataResponse = await requireOk(
    await fetchImpl(metadataUrl, { headers: authHeaders(token) }),
    "Google Drive metadata read",
  );
  const metadata = (await metadataResponse.json()) as DriveFileMetadata;
  if (!metadata.id || !metadata.name || !metadata.mimeType) {
    throw new Error("Google Drive metadata response is missing required fields.");
  }

  let contentUrl: URL;
  if (metadata.mimeType === GOOGLE_DOC_MIME) {
    contentUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodedId}/export`);
    contentUrl.searchParams.set("mimeType", "text/plain");
  } else if (metadata.mimeType.startsWith("application/vnd.google-apps.")) {
    throw new Error(`Unsupported Google Workspace MIME type for curriculum text: ${metadata.mimeType}.`);
  } else {
    contentUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodedId}`);
    contentUrl.searchParams.set("alt", "media");
    contentUrl.searchParams.set("supportsAllDrives", "true");
  }

  const contentResponse = await requireOk(
    await fetchImpl(contentUrl, { headers: authHeaders(token) }),
    "Google Drive content read",
  );
  const text = await contentResponse.text();
  if (!text.trim()) {
    throw new Error("Google Drive curriculum source is empty.");
  }

  return { text, metadata };
}
