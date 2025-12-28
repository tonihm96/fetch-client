import FetchClientError from './errors/fetch-client-error';
import FetchClientTimeoutError from './errors/fetch-client-timeout-error';
import FetchClientEventEmitter from './fetch-client-event-emitter';
import {
  AfterResponseHook,
  BeforeRequestHook,
  FetchClientDefaults,
  FetchClientHookMap,
  FetchClientInit,
  FetchClientRequest,
  FetchClientRequestWithURL,
  FetchClientResponse,
  FetchClientRetryOptions,
  URLSearchParamsInit,
  ValueOrCallback,
  FetchClientEventEmitterEventMap,
} from './types';

const DEFAULT_TIMEOUT = 10_000;

export default class FetchClient extends FetchClientEventEmitter<FetchClientEventEmitterEventMap> {
  constructor(defaults: FetchClientInit = {}) {
    super();
    this.setDefaults(defaults);
  }

  private defaults: FetchClientDefaults = {
    searchParams: [],
    headers: {},
    retry: false,
    timeout: DEFAULT_TIMEOUT,
    isResponseError: this.defaultIsResponseError,
  };

  private hooks = {
    beforeRequest: new Set<BeforeRequestHook>(),
    afterResponse: new Set<AfterResponseHook>(),
  };

  private defaultIsResponseError(response: Response): boolean {
    return !response.ok;
  }

  private defaultMergeHeaders(a?: HeadersInit, b?: HeadersInit): Headers {
    const merged = new Headers(a);
    new Headers(b).forEach((value, key) => merged.set(key, value));
    return merged;
  }

  private defaultMergeSearchParams(
    a?: URLSearchParamsInit,
    b?: URLSearchParamsInit
  ): URLSearchParams {
    const merged = new URLSearchParams(a);
    if (!b) return merged;

    const bParams = new URLSearchParams(b);
    const keysCleared = new Set<string>();

    bParams.forEach((value, key) => {
      if (!keysCleared.has(key)) {
        merged.delete(key); // Ensure existing keys are cleared before adding new ones
        keysCleared.add(key);
      }
      merged.append(key, value);
    });

    return merged;
  }

  private defaultResolveUrl(url?: string | URL, baseUrl?: string): URL {
    if (url instanceof URL) return url;
    if (!url) {
      if (!baseUrl) throw new Error('No URL provided');
      return new URL(baseUrl);
    }
    if (baseUrl) return new URL(url, baseUrl);
    return new URL(url);
  }

  private decorateResponse<ResponseBody, RequestBody = BodyInit>(
    response: Response,
    request: FetchClientRequest<RequestBody>
  ): FetchClientResponse<ResponseBody, RequestBody> {
    Object.defineProperty(response, 'request', {
      value: request,
      writable: false,
      configurable: false,
      enumerable: true,
    });
    return response as FetchClientResponse<ResponseBody, RequestBody>;
  }

  private async handleRetryDelay(
    options: FetchClientRetryOptions | false,
    attempt: number,
    error: unknown
  ): Promise<void> {
    if (!options || options.delay === undefined) return;

    const ms = typeof options.delay === 'function' ? options.delay(attempt, error) : options.delay;

    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private normalizeResponseStatusErrorMessage(status: number, statusText?: string): string {
    let message = `FetchClient: Response returned with error status ${status}`;
    if (statusText) {
      message += ` - ${statusText}`;
    }
    return message;
  }

  public removeHook<K extends keyof FetchClientHookMap>(hookName: K, hook: FetchClientHookMap[K]) {
    // @ts-expect-error - TypeScript cannot infer that FetchClientHookMap[K] is the correct type for the Set
    this.hooks[hookName].delete(hook);
  }

  public clearHooks<K extends keyof FetchClientHookMap>(hookName?: K) {
    if (hookName) {
      this.hooks[hookName].clear();
    } else {
      (Object.keys(this.hooks) as K[]).forEach((key) => this.hooks[key].clear());
    }
  }

  public addHook<K extends keyof FetchClientHookMap>(hookName: K, hook: FetchClientHookMap[K]) {
    // @ts-expect-error - TypeScript cannot infer that FetchClientHookMap[K] is the correct type for the Set
    this.hooks[hookName].add(hook);
    return () => this.removeHook(hookName, hook);
  }

  public setDefaults(defaults: ValueOrCallback<FetchClientInit>) {
    const resolvedDefaults = typeof defaults === 'function' ? defaults(this.defaults) : defaults;
    if (Object.is(resolvedDefaults, this.defaults)) return;

    //#region Merge Headers
    let mergeHeaders = this.defaults.mergeHeaders ?? this.defaultMergeHeaders;
    if (resolvedDefaults.mergeHeaders === null) {
      mergeHeaders = this.defaultMergeHeaders;
    } else if (resolvedDefaults.mergeHeaders !== undefined) {
      mergeHeaders = resolvedDefaults.mergeHeaders;
    }

    const mergedHeaders = mergeHeaders(this.defaults.headers, resolvedDefaults.headers);
    const headersObject = Object.fromEntries(mergedHeaders.entries());
    //#endregion

    //#region Merge Search Params
    let mergeSearchParams = this.defaults.mergeSearchParams ?? this.defaultMergeSearchParams;
    if (resolvedDefaults.mergeSearchParams === null) {
      mergeSearchParams = this.defaultMergeSearchParams;
    } else if (resolvedDefaults.mergeSearchParams !== undefined) {
      mergeSearchParams = resolvedDefaults.mergeSearchParams;
    }

    const mergedSearchParams = mergeSearchParams(
      this.defaults.searchParams,
      resolvedDefaults.searchParams
    );
    const searchParamsEntries = Array.from(mergedSearchParams.entries());
    //#endregion

    //#region Resolve URL
    let resolveUrl = this.defaults.resolveUrl ?? this.defaultResolveUrl;
    if (resolvedDefaults.resolveUrl === null) {
      resolveUrl = this.defaultResolveUrl;
    } else if (resolvedDefaults.resolveUrl !== undefined) {
      resolveUrl = resolvedDefaults.resolveUrl;
    }
    //#endregion

    this.defaults = {
      ...this.defaults,
      ...resolvedDefaults,
      headers: headersObject,
      searchParams: searchParamsEntries,
      mergeHeaders,
      mergeSearchParams,
      resolveUrl,
    };

    // Freeze everything to ensure immutability
    Object.freeze(this.defaults.headers);
    this.defaults.searchParams.forEach((entry) => Object.freeze(entry));
    Object.freeze(this.defaults.searchParams);
    Object.freeze(this.defaults);

    this.dispatchEvent('onDefaultsChanged', this.defaults);
  }

  public getDefaults(): Readonly<FetchClientDefaults> {
    return this.defaults;
  }

  private isReadableStream(body: unknown): body is ReadableStream {
    return body !== undefined && body !== null && body instanceof ReadableStream;
  }

  private async fetchWithTimeout<RequestBody = BodyInit>(
    fetchFn: typeof fetch,
    url: URL | string,
    input: FetchClientRequest<RequestBody>,
    timeout: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(new FetchClientTimeoutError(input));
    }, timeout);
    // Ensure all signals are respected
    const signals = [controller.signal];
    if (input.signal) {
      signals.push(input.signal);
    }
    const anySignal = AbortSignal.any(signals);

    try {
      const response = await fetchFn(url, { ...input, signal: anySignal });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  public async fetch<ResponseBody, RequestBody = BodyInit>(
    input: FetchClientRequestWithURL<RequestBody>
  ): Promise<FetchClientResponse<ResponseBody, RequestBody>>;
  public async fetch<ResponseBody, RequestBody = BodyInit>(
    input: string | URL,
    init?: FetchClientRequest<RequestBody>
  ): Promise<FetchClientResponse<ResponseBody, RequestBody>>;
  public async fetch<ResponseBody, RequestBody = BodyInit>(
    input: string | URL | FetchClientRequestWithURL<RequestBody>,
    init?: FetchClientRequest<RequestBody>
  ): Promise<FetchClientResponse<ResponseBody, RequestBody>> {
    // Determine if input is a Request object
    const isRequestObject =
      typeof input === 'object' && input !== null && 'url' in input && !(input instanceof URL);

    // Normalize input and init to a single config ob1ject
    const config = isRequestObject ? input : init || {};
    const inputUrl = isRequestObject ? input.url : input;

    // Resolve final URL
    const baseUrl = config.baseUrl ?? this.defaults.baseUrl;
    if (!this.defaults.resolveUrl) {
      throw new Error('No URL resolver defined in defaults.');
    }
    const resolvedUrl = this.defaults.resolveUrl(inputUrl, baseUrl);

    // Ensure mergeSearchParams function is defined
    if (!this.defaults.mergeSearchParams) {
      throw new Error('No searchParams merger defined in defaults.');
    }
    // Normalize all provided search parameters
    const defaultSearchParams = new URLSearchParams(this.defaults.searchParams);
    const urlSearchParams = resolvedUrl.searchParams;
    const configSearchParams = new URLSearchParams(config.searchParams);
    // Merge search parameters from defaults, URL, and current config
    const finalSearchParams = this.defaults.mergeSearchParams(
      this.defaults.mergeSearchParams(defaultSearchParams, urlSearchParams),
      configSearchParams
    );
    // Set the merged search parameters back to the final URL
    resolvedUrl.search = finalSearchParams.toString();

    // Ensure mergeHeaders function is defined
    if (!this.defaults.mergeHeaders) {
      throw new Error('No headers merger defined in defaults.');
    }
    // Merge headers from defaults and current config
    const mergedHeaders = this.defaults.mergeHeaders(this.defaults.headers, config.headers);

    // Handle JSON body if provided
    let resolvedBody = config.body;
    if (config.json !== undefined) {
      resolvedBody = JSON.stringify(config.json);
      // Ensure Content-Type header is set
      if (!mergedHeaders.has('content-type')) {
        mergedHeaders.set('content-type', 'application/json');
      }
    }

    // Ensure Content-Type header is not set for FormData bodies
    if (config.body instanceof FormData || resolvedBody instanceof FormData) {
      mergedHeaders.delete('content-type');
    }

    // Build the final request object
    let request: FetchClientRequestWithURL<RequestBody> = {
      ...this.defaults,
      ...config,
      url: resolvedUrl, // Assign resolved URL back to request
      searchParams: finalSearchParams,
      headers: mergedHeaders,
      body: resolvedBody ?? config.body,
    };

    const beforeRequestHooks = this.hooks.beforeRequest.values();
    const afterResponseHooks = this.hooks.afterResponse.values();

    for (const beforeRequest of beforeRequestHooks) {
      const result = await beforeRequest(request as FetchClientRequestWithURL);
      if (result) {
        request = result as FetchClientRequestWithURL<RequestBody>;
      }
    }

    // Normalize timeout value
    const timeout = request.timeout ?? this.defaults.timeout ?? DEFAULT_TIMEOUT;

    // Freeze request to ensure immutability but do not freeze headers and searchParams
    // as they are instantiated for the request itself and cannot be frozen
    if (request.retry) {
      Object.freeze(request.retry);
    }
    Object.freeze(request);

    // Resolve fetch function
    const fetchFn = request.fetch ?? fetch;

    // Resolve retry options
    const retryOptions = request.retry ?? this.defaults.retry;
    const maxAttempts = retryOptions ? retryOptions.limit : 0;

    let lastError: unknown;

    // Retry loop
    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      try {
        // Execute the fetch request with or without timeout
        let response: Response;

        const urlToSend = request.url;

        // Strictly check for false to allow 0 timeout
        if (timeout === false) {
          response = await fetchFn(urlToSend, request);
        } else {
          response = await this.fetchWithTimeout(fetchFn, urlToSend, request, timeout);
        }

        // Apply afterResponse hooks
        for (const afterResponse of afterResponseHooks) {
          const result = await afterResponse(request as FetchClientRequestWithURL, response);
          if (result) {
            response = result;
          }
        }

        // Resolve the error validation function
        const isResponseError =
          request.isResponseError ?? this.defaults.isResponseError ?? this.defaultIsResponseError;

        // Check if the response is an error (e.g., status 400, 500)
        if (isResponseError(response)) {
          const errorMessage = this.normalizeResponseStatusErrorMessage(
            response.status,
            response.statusText
          );

          const error = new FetchClientError(errorMessage, request, response);

          // Check if should retry for this error
          const shouldRetry =
            attempt < maxAttempts &&
            retryOptions &&
            (!retryOptions.retryOn || retryOptions.retryOn(attempt, error));

          if (shouldRetry) {
            await this.handleRetryDelay(retryOptions, attempt, error);
            continue;
          }

          throw error;
        }

        // Decorate response only once when returning
        return this.decorateResponse<ResponseBody, RequestBody>(response, request);
      } catch (error) {
        lastError = error;

        // If the error is a manual AbortError, do not retry
        const isAbortError = error instanceof Error && error.name === 'AbortError';
        // If it's a timeout error, we may want to retry
        const isInstanceofTimeoutError = error instanceof FetchClientTimeoutError;
        // Rethrow immediately if it's an abort error not caused by a timeout
        if (isAbortError && !isInstanceofTimeoutError) {
          throw error;
        }

        // Check if the request body is a stream that has already been used
        const isBodyUnusable = this.isReadableStream(request.body) && request.body.locked === true;

        // If the request body is a stream that has been used, do not retry
        if (isBodyUnusable) {
          throw error;
        }

        // Check if should retry for this error
        const shouldRetry =
          attempt < maxAttempts &&
          retryOptions &&
          (!retryOptions.retryOn || retryOptions.retryOn(attempt, error));

        if (shouldRetry) {
          await this.handleRetryDelay(retryOptions, attempt, error);
          continue;
        }

        throw error;
      }
    }

    throw lastError ?? new Error('Unknown fetch error');
  }

  //#region HTTP helper methods
  public async get<ResponseBody, RequestBody = BodyInit>(
    url: string | URL,
    init?: Omit<FetchClientRequest<RequestBody>, 'method'>
  ): Promise<FetchClientResponse<ResponseBody, RequestBody>> {
    return this.fetch<ResponseBody, RequestBody>(url, {
      ...init,
      method: 'GET',
    });
  }

  public async head<ResponseBody, RequestBody = BodyInit>(
    url: string | URL,
    init?: Omit<FetchClientRequest<RequestBody>, 'method'>
  ): Promise<FetchClientResponse<ResponseBody, RequestBody>> {
    return this.fetch<ResponseBody, RequestBody>(url, {
      ...init,
      method: 'HEAD',
    });
  }

  public async options<ResponseBody, RequestBody = BodyInit>(
    url: string | URL,
    init?: Omit<FetchClientRequest<RequestBody>, 'method'>
  ): Promise<FetchClientResponse<ResponseBody, RequestBody>> {
    return this.fetch<ResponseBody, RequestBody>(url, {
      ...init,
      method: 'OPTIONS',
    });
  }

  public async trace<ResponseBody, RequestBody = BodyInit>(
    url: string | URL,
    init?: Omit<FetchClientRequest<RequestBody>, 'method'>
  ): Promise<FetchClientResponse<ResponseBody, RequestBody>> {
    return this.fetch<ResponseBody, RequestBody>(url, {
      ...init,
      method: 'TRACE',
    });
  }

  public async put<ResponseBody, RequestBody = BodyInit>(
    url: string | URL,
    init?: Omit<FetchClientRequest<RequestBody>, 'method'>
  ): Promise<FetchClientResponse<ResponseBody, RequestBody>> {
    return this.fetch<ResponseBody, RequestBody>(url, {
      ...init,
      method: 'PUT',
    });
  }

  public async delete<ResponseBody, RequestBody = BodyInit>(
    url: string | URL,
    init?: Omit<FetchClientRequest<RequestBody>, 'method'>
  ): Promise<FetchClientResponse<ResponseBody, RequestBody>> {
    return this.fetch<ResponseBody, RequestBody>(url, {
      ...init,
      method: 'DELETE',
    });
  }

  public async post<ResponseBody, RequestBody = BodyInit>(
    url: string | URL,
    init?: Omit<FetchClientRequest<RequestBody>, 'method'>
  ): Promise<FetchClientResponse<ResponseBody, RequestBody>> {
    return this.fetch<ResponseBody, RequestBody>(url, {
      ...init,
      method: 'POST',
    });
  }

  public async patch<ResponseBody, RequestBody = BodyInit>(
    url: string | URL,
    init?: Omit<FetchClientRequest<RequestBody>, 'method'>
  ): Promise<FetchClientResponse<ResponseBody, RequestBody>> {
    return this.fetch<ResponseBody, RequestBody>(url, {
      ...init,
      method: 'PATCH',
    });
  }

  public async connect<ResponseBody, RequestBody = BodyInit>(
    url: string | URL,
    init?: Omit<FetchClientRequest<RequestBody>, 'method'>
  ): Promise<FetchClientResponse<ResponseBody, RequestBody>> {
    return this.fetch<ResponseBody, RequestBody>(url, {
      ...init,
      method: 'CONNECT',
    });
  }
  //#endregion
}
