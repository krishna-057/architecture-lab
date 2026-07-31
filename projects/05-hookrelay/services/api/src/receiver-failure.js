export const receiverFailureClasses = [
  "receiver_http_4xx",
  "receiver_http_5xx",
  "receiver_http_other",
  "receiver_timeout",
  "receiver_network",
  "internal_error"
];

function errorCode(error) {
  return error?.code ?? error?.cause?.code ?? null;
}

export function classifyReceiverFailure({ responseStatus = null, error = null } = {}) {
  if (Number.isInteger(responseStatus)) {
    if (responseStatus >= 400 && responseStatus <= 499) {
      return "receiver_http_4xx";
    }
    if (responseStatus >= 500 && responseStatus <= 599) {
      return "receiver_http_5xx";
    }
    return "receiver_http_other";
  }

  const code = errorCode(error);
  if (error?.name === "AbortError" || code === "ETIMEDOUT" || code === "UND_ERR_HEADERS_TIMEOUT") {
    return "receiver_timeout";
  }

  if (
    error instanceof TypeError ||
    ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"].includes(code)
  ) {
    return "receiver_network";
  }

  return "internal_error";
}
