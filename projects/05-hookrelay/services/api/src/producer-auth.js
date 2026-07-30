import crypto from "node:crypto";

export function generateProducerApiKey() {
  return `hrp_${crypto.randomBytes(24).toString("hex")}`;
}

export function hashProducerApiKey(apiKey) {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

export function producerApiKeyPreview(apiKey) {
  return `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;
}

export function publicProducerApiKey(key) {
  return {
    key_id: key.key_id,
    owner_id: key.owner_id,
    name: key.name,
    status: key.status,
    key_preview: key.key_preview,
    rotated_from_key_id: key.rotated_from_key_id,
    revoked_at: key.revoked_at,
    created_at: key.created_at,
    updated_at: key.updated_at
  };
}

export function extractProducerApiKey(request) {
  const headerKey = request.headers["x-hookrelay-api-key"];
  if (typeof headerKey === "string" && headerKey.trim()) {
    return headerKey.trim();
  }

  const authorization = request.headers.authorization;
  if (typeof authorization !== "string") {
    return null;
  }

  const [scheme, value] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value?.trim()) {
    return null;
  }

  return value.trim();
}
