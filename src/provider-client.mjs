import { AppConfig } from './config/config.mjs';
import { ErrorMessage, HeaderValue, HttpHeader, HttpMethod, HttpStatus, ProviderErrorKind } from './config/constants.mjs';

const PATH = Object.freeze({ MESSAGES: '/messages', CLIENT_REF_QUERY: '?clientRef=' });

const providerError = (message, kind) => Object.assign(new Error(message), { kind });

const kindOf = status => (status === HttpStatus.SERVICE_UNAVAILABLE ? ProviderErrorKind.NOT_ACCEPTED : ProviderErrorKind.UNKNOWN);

export class ProviderClient {
  constructor(baseUrl = AppConfig.get().provider.baseUrl, { timeoutMs = AppConfig.get().provider.timeoutMs } = {}) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  async send(payload) {
    const response = await this.#request(PATH.MESSAGES, {
      method: HttpMethod.POST,
      headers: { [HttpHeader.CONTENT_TYPE]: HeaderValue.JSON },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw providerError(ErrorMessage.PROVIDER_UNCONFIRMED, kindOf(response.status));
    return response.json();
  }

  async lookup(clientRef) {
    const response = await this.#request(PATH.MESSAGES + PATH.CLIENT_REF_QUERY + encodeURIComponent(clientRef), { method: HttpMethod.GET });
    if (!response.ok) throw providerError(ErrorMessage.PROVIDER_LOOKUP_UNAVAILABLE, ProviderErrorKind.UNKNOWN);
    return response.json();
  }

  async #request(path, init) {
    try {
      return await fetch(this.baseUrl + path, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      throw providerError(error.message, ProviderErrorKind.UNKNOWN);
    }
  }
}
