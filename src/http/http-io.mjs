import { Encoding, ErrorMessage, HeaderValue, HttpHeader } from '../config/constants.mjs';
import { DeskError } from '../domain/errors.mjs';

const SECURITY_HEADERS = Object.freeze({
  [HttpHeader.NO_SNIFF]: HeaderValue.NO_SNIFF,
  [HttpHeader.FRAME_OPTIONS]: HeaderValue.DENY,
  [HttpHeader.REFERRER_POLICY]: HeaderValue.NO_REFERRER,
  [HttpHeader.CACHE_CONTROL]: HeaderValue.NO_STORE
});

export async function readJson(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw DeskError.payloadTooLarge();
    chunks.push(chunk);
  }
  return parseJson(Buffer.concat(chunks).toString(Encoding.UTF8));
}

function parseJson(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw DeskError.badRequest(ErrorMessage.INVALID_JSON);
  }
}

export function sendJson(response, status, body, requestId) {
  response.writeHead(status, { ...SECURITY_HEADERS, [HttpHeader.CONTENT_TYPE]: HeaderValue.JSON, [HttpHeader.REQUEST_ID]: requestId });
  response.end(JSON.stringify(body));
}

export function sendHtml(response, status, html, requestId) {
  response.writeHead(status, { ...SECURITY_HEADERS, [HttpHeader.CONTENT_TYPE]: HeaderValue.HTML, [HttpHeader.REQUEST_ID]: requestId });
  response.end(html);
}
