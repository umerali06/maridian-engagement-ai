type OcrResponse = {
  text?: string;
  error?: string;
};

export function isOcrConfigured() {
  return Boolean(process.env.OCR_HTTP_ENDPOINT);
}

export async function extractTextWithOcr({
  buffer,
  filename,
  mimeType,
}: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}) {
  const endpoint = process.env.OCR_HTTP_ENDPOINT;
  if (!endpoint) return "";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.OCR_HTTP_TOKEN
        ? { Authorization: `Bearer ${process.env.OCR_HTTP_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      filename,
      mime_type: mimeType,
      file_base64: buffer.toString("base64"),
    }),
  });

  const result = (await response.json().catch(() => ({}))) as OcrResponse;
  if (!response.ok) {
    throw new Error(result.error || `OCR request failed with status ${response.status}`);
  }

  return cleanOcrText(result.text || "");
}

function cleanOcrText(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}
