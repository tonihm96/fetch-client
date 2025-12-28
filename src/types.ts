export type ValueOrCallback<T> = T | ((value: T) => T);

export type URLSearchParamsInit = ConstructorParameters<typeof URLSearchParams>[0];

export type FetchClientEventEmitterEventMap = {
  onDefaultsChanged: (defaults: FetchClientDefaults) => void;
};

export interface FetchClientRetryOptions {
  limit: number;
  delay?: number | ((attempt: number, error: unknown) => number);
  retryOn?: (attempt: number, error: unknown) => boolean;
}

export interface FetchClientResponse<ResponseBody = unknown, RequestBody = BodyInit>
  extends Response {
  request: FetchClientRequest<RequestBody>;
  json: () => Promise<ResponseBody>;
}

export type BeforeRequestHook<RequestBody = BodyInit> = (
  request: FetchClientRequestWithURL<RequestBody>
) =>
  | FetchClientRequestWithURL<RequestBody>
  | Promise<FetchClientRequestWithURL<RequestBody>>
  | void
  | Promise<void>
  | undefined
  | Promise<undefined>;

export type AfterResponseHook<RequestBody = BodyInit> = (
  request: FetchClientRequestWithURL<RequestBody>,
  response: Response
) => Response | Promise<Response> | void | Promise<void> | undefined | Promise<undefined>;

export type FetchClientHookMap = {
  /**
   * A hook that is called before the request is sent.
   * @param request The request object.
   * @returns The modified request object.
   */
  beforeRequest: BeforeRequestHook;
  /**
   * A hook that is called after the response is received.
   * @param response The response object.
   * @returns The modified response object.
   */
  afterResponse: AfterResponseHook;
};

export interface FetchClientRequest<RequestBody = BodyInit> extends RequestInit {
  /**
   * A custom fetch function to be used for the request.
   */
  fetch?: typeof fetch;
  /**
   * The request body parsed as JSON.
   */
  json?: RequestBody;
  /**
   * The search parameters to be appended to the request URL.
   */
  searchParams?: URLSearchParamsInit;
  /**
   * The base URL to be used for the request.
   */
  baseUrl?: string;
  /**
   * Number of milliseconds a request can take before automatically being terminated.
   *
   * If set to false, the request will not time out.
   * @throws FetchClientTimeoutError if request takes longer than the specified timeout.
   * @default false
   */
  timeout?: false | number;
  /**
   * Retry options for the request.
   */
  retry?: false | FetchClientRetryOptions;
  /**
   * A function to determine whether a response should be treated as an error.
   *
   * @default (response) => !response.ok
   * @param response The response to be evaluated.
   * @returns True if the response should be treated as an error, false otherwise.
   */
  isResponseError?: (response: Response) => boolean;
  /**
   * A custom merge strategy for searchParams when provided in setDefaults.
   * If set to null, it reverts to the default merge strategy.
   * @default undefined
   * @param a The current searchParams.
   * @param b The incoming searchParams.
   * @returns A URLSearchParams object containing the merged search parameters.
   */
  mergeSearchParams?:
    | null
    | ((a?: URLSearchParamsInit, b?: URLSearchParamsInit) => URLSearchParams);
  /**
   * A custom merge strategy for headers when provided in setDefaults.
   * If set to null, it reverts to the default merge strategy.
   * @default undefined
   * @param a The current headers.
   * @param b The incoming headers.
   * @returns A Headers object containing the merged headers.
   */
  mergeHeaders?: null | ((a?: HeadersInit, b?: HeadersInit) => Headers);
  /**
   * A function to resolve the final URL for the request.
   * If set to null, the default URL resolution strategy is used (simply concatenating baseUrl and url).
   * @default undefined
   * @param url The request URL.
   * @param baseUrl The base URL to be used for the request.
   * @returns A URL object representing the final request URL.
   */
  resolveUrl?: null | ((url?: string | URL, baseUrl?: string) => URL);
}

export interface FetchClientRequestWithURL<RequestBody = BodyInit>
  extends FetchClientRequest<RequestBody> {
  url: URL | string;
}

export interface FetchClientInit
  extends Omit<FetchClientRequest<BodyInit>, 'json' | 'body' | 'method' | 'signal'> {
  headers?: HeadersInit;
  searchParams?: URLSearchParamsInit;
}

export interface FetchClientDefaults extends FetchClientInit {
  headers: Record<string, string>;
  searchParams: string[][];
}
