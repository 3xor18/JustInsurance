import { Encoding, ErrorMessage, HeaderValue, HttpHeader, HttpStatus } from '../config/constants.mjs';
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

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function parseJson(text) {
  if (!text) return {};
  const parsed = tryParse(text);
  if (!isPlainObject(parsed)) throw DeskError.badRequest(ErrorMessage.INVALID_BODY);
  return parsed;
}

function tryParse(text) {
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

export function sendPage(request, response, page, requestId) {
  const headers = { ...SECURITY_HEADERS, [HttpHeader.CACHE_CONTROL]: HeaderValue.REVALIDATE, [HttpHeader.ETAG]: page.etag, [HttpHeader.REQUEST_ID]: requestId };
  if (request.headers[HttpHeader.IF_NONE_MATCH] === page.etag) {
    response.writeHead(HttpStatus.NOT_MODIFIED, headers);
    return response.end();
  }
  response.writeHead(HttpStatus.OK, { ...headers, [HttpHeader.CONTENT_TYPE]: HeaderValue.HTML });
  return response.end(page.body);
}
