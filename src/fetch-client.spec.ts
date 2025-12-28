import { afterEach, beforeEach, suite, expect, it, vi } from 'vitest';

import FetchClientError from './errors/fetch-client-error';
import FetchClientTimeoutError from './errors/fetch-client-timeout-error';
import FetchClient from './fetch-client';
import { AfterResponseHook, BeforeRequestHook } from './types';

let client: FetchClient;
const globalFetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();

beforeEach(() => {
  client = new FetchClient();
  globalThis.fetch = globalFetchMock;

  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

suite('setDefaults method', () => {
  it('updates state correctly via callback and object merge', () => {
    client.setDefaults((defaults) => ({ ...defaults, timeout: 8000 }));
    expect(client.getDefaults()).toEqual(expect.objectContaining({ timeout: 8000 }));
  });

  it('maintains state consistency across multiple sequential calls', () => {
    client.setDefaults({ redirect: 'follow' });
    client.setDefaults({ timeout: 6000 });
    client.setDefaults({ cache: 'no-cache' });

    expect(client.getDefaults()).toEqual(
      expect.objectContaining({ redirect: 'follow', timeout: 6000, cache: 'no-cache' })
    );
  });
});

suite('getDefaults method', () => {
  it('retrieves the current defaults accurately', () => {
    client.setDefaults({ mode: 'cors', timeout: 9000 });
    expect(client.getDefaults()).toEqual(expect.objectContaining({ mode: 'cors', timeout: 9000 }));
  });

  it('returns a deeply frozen defaults object', () => {
    const defaults = client.getDefaults();
    expect(Object.isFrozen(defaults)).toBe(true);
    expect(Object.isFrozen(defaults.headers)).toBe(true);
    expect(Object.isFrozen(defaults.searchParams)).toBe(true);
    expect(defaults.searchParams.every((entry) => Object.isFrozen(entry))).toBe(true);
  });
});

suite('event emission', () => {
  it('emits onDefaultsChanged with the updated state on every change', () => {
    const mockListener = vi.fn();
    client.addEventListener('onDefaultsChanged', mockListener);
    client.setDefaults({ timeout: 8000 });
    expect(mockListener).toHaveBeenCalledTimes(1);
    expect(mockListener).toHaveBeenLastCalledWith(expect.objectContaining({ timeout: 8000 }));
    client.setDefaults((d) => ({ ...d, cache: 'no-store' }));
    expect(mockListener).toHaveBeenCalledTimes(2);
    expect(mockListener).toHaveBeenLastCalledWith(expect.objectContaining({ cache: 'no-store' }));
  });

  it('does not emit onDefaultsChanged when the same defaults object is set', () => {
    const listener = vi.fn();
    client.addEventListener('onDefaultsChanged', listener);
    client.setDefaults((d) => d);
    expect(listener).not.toHaveBeenCalled();
  });
});

suite('header handling in defaults', () => {
  it('stores headers as a plain object in the defaults object', () => {
    client.setDefaults({ headers: { 'X-Custom-Header': 'Value' } });
    expect(client.getDefaults().headers).toEqual({ 'x-custom-header': 'Value' });
  });

  it('replaces values for existing keys when using the default merge strategy', () => {
    client.setDefaults({ headers: { 'X-Custom-Header': 'InitialValue' } });
    client.setDefaults({ headers: { 'X-Custom-Header': 'NewValue' } });
    // header keys are normalized to lowercase
    expect(client.getDefaults().headers).toEqual({ 'x-custom-header': 'NewValue' });
  });

  it('does not reflect external mutations to an object passed as headers', () => {
    const headers = { 'X-Test': '1' };
    client.setDefaults({ headers });
    headers['X-Test'] = '2';
    expect(client.getDefaults().headers['x-test']).toBe('1');
  });
});

suite('searchParams handling in defaults', () => {
  it('stores searchParams as a list of entries in the defaults object', () => {
    client.setDefaults({ searchParams: { foo: 'foo', bar: 'bar' } });
    expect(client.getDefaults().searchParams).toEqual(
      expect.arrayContaining([
        ['foo', 'foo'],
        ['bar', 'bar'],
      ])
    );
  });

  it('handles searchParams keys case-sensitively when setting defaults', () => {
    client.setDefaults({ searchParams: { Foo: 'Bar', foo: 'bar' } });
    expect(client.getDefaults().searchParams).toEqual([
      ['Foo', 'Bar'],
      ['foo', 'bar'],
    ]);
  });

  it('overwrites existing keys when using the default merge strategy', () => {
    client.setDefaults({
      searchParams: [
        ['foo', '1'],
        ['bar', 'A'],
      ],
    });
    client.setDefaults({
      searchParams: [
        ['foo', '2'],
        ['foo', '3'],
        ['baz', 'B'],
      ],
    });

    const searchParams = new URLSearchParams(client.getDefaults().searchParams);
    expect(searchParams.getAll('foo')).toEqual(['2', '3']);
    expect(searchParams.get('bar')).toBe('A');
    expect(searchParams.get('baz')).toBe('B');
  });

  it('preserves duplicates in searchParams from the new defaults', () => {
    client.setDefaults({
      searchParams: [
        ['foo', '1'],
        ['foo', '2'],
      ],
    });
    client.setDefaults({
      searchParams: [
        ['foo', '3'],
        ['bar', 'A'],
        ['foo', '4'],
      ],
    });

    const searchParams = new URLSearchParams(client.getDefaults().searchParams);
    const fooValues = searchParams.getAll('foo');
    const barValues = searchParams.getAll('bar');
    expect(fooValues).toEqual(['3', '4']);
    expect(barValues).toEqual(['A']);
  });
});

suite('custom mergeHeaders', () => {
  it('uses a custom merge strategy for headers when provided in setDefaults', () => {
    client.setDefaults({ headers: { 'X-Test': 'initial' } });
    client.setDefaults({
      mergeHeaders: (_, incoming) => new Headers(incoming),
      headers: { 'X-Test': 'overridden' },
    });
    expect(client.getDefaults().headers).toEqual({ 'x-test': 'overridden' });
  });

  it('persists the custom merge strategy for headers across multiple setDefaults calls', () => {
    client.setDefaults({
      mergeHeaders: (current, incoming) => {
        const merged = new Headers(current);
        new Headers(incoming).forEach((value, key) => merged.set(value, key));
        return merged;
      },
    });
    client.setDefaults({ headers: { 'X-Foo': 'X-Bar' } });
    client.setDefaults((d) => ({ ...d, headers: { 'X-Bar': 'X-Foo' } }));
    expect(client.getDefaults().headers).toEqual({ 'x-foo': 'x-bar', 'x-bar': 'x-foo' });
  });

  it('allows reverting to default merge strategy by passing null', () => {
    client.setDefaults({ mergeHeaders: () => new Headers() });
    client.setDefaults({ headers: { 'X-Test': '1' } });
    expect(client.getDefaults().headers).toEqual({});
    client.setDefaults({ mergeHeaders: null, headers: { 'X-Test': '2' } });
    expect(client.getDefaults().headers).toEqual({ 'x-test': '2' });
  });
});

suite('custom mergeSearchParams', () => {
  it('uses a custom merge strategy for searchParams when provided in setDefaults', () => {
    client.setDefaults({ searchParams: { a: '1' } });
    client.setDefaults({
      mergeSearchParams: (_, incoming) => new URLSearchParams(incoming),
      searchParams: { b: '2' },
    });
    const searchParams = new URLSearchParams(client.getDefaults().searchParams);
    expect(searchParams.get('b')).toBe('2');
  });

  it('persists the custom merge strategy for searchParams across multiple setDefaults calls', () => {
    client.setDefaults({
      mergeSearchParams: (current, incoming) => {
        const merged = new URLSearchParams(current);
        // Example: flips key and value for all incoming search params
        new URLSearchParams(incoming).forEach((value, key) => merged.set(value, key));
        return merged;
      },
    });
    client.setDefaults({ searchParams: { foo: 'bar' } });
    client.setDefaults((d) => ({ ...d, searchParams: { bar: 'foo' } }));
    const searchParams = new URLSearchParams(client.getDefaults().searchParams);
    expect(searchParams.get('foo')).toBe('bar');
    expect(searchParams.get('bar')).toBe('foo');
  });

  it('allows reverting to default merge strategy by passing null', () => {
    client.setDefaults({ mergeSearchParams: () => new URLSearchParams() });
    client.setDefaults({ searchParams: [['test', '1']] });
    expect(client.getDefaults().searchParams).toEqual([]);
    client.setDefaults({ mergeSearchParams: null, searchParams: [['test', '2']] });
    expect(client.getDefaults().searchParams).toEqual([['test', '2']]);
  });
});

suite('baseUrl handling in defaults', () => {
  it('resolves relative URLs against a base URL defined in defaults', async () => {
    globalFetchMock.mockResolvedValue(new Response('ok'));
    client.setDefaults({ baseUrl: 'https://api.example.com/v1/' });
    await client.fetch('users');
    expect(globalFetchMock).toHaveBeenCalledWith(
      new URL('https://api.example.com/v1/users'),
      expect.anything()
    );
  });

  it('overrides default base URL if a new base URL is provided in the request', async () => {
    globalFetchMock.mockResolvedValue(new Response('ok'));
    client.setDefaults({ baseUrl: 'https://api.default.com' });
    await client.fetch({ url: '/custom', baseUrl: 'https://api.custom.com' });
    expect(globalFetchMock).toHaveBeenCalledWith(
      new URL('https://api.custom.com/custom'),
      expect.anything()
    );
  });

  it('throws if no URL is resolved (no input and no base)', async () => {
    await expect(client.fetch('')).rejects.toThrow('No URL provided');
  });
});

suite('search params merging when making requests', () => {
  it('merges defaults, URL params, and request params correctly (priority check)', async () => {
    globalFetchMock.mockResolvedValue(new Response('ok'));
    client.setDefaults({
      baseUrl: 'https://api.example.com/v1/',
      searchParams: { sort: 'asc', limit: '10' },
    });
    // URL Params + Request Params
    // URL has 'sort=desc' (should override default)
    // Request has 'page=2'
    await client.fetch('products?sort=desc', {
      searchParams: { page: '2' },
    });
    const callArgs = globalFetchMock.mock.calls.at(0);
    if (!callArgs) {
      throw new Error('No fetch call recorded');
    }
    const url = callArgs.at(0);
    if (!(url instanceof URL)) {
      throw new Error('Expected URL instance');
    }
    expect(url.searchParams.get('limit')).toBe('10'); // From defaults
    expect(url.searchParams.get('sort')).toBe('desc'); // URL overrides default
    expect(url.searchParams.get('page')).toBe('2'); // From request config
  });

  it('handles multiple values for the same key correctly (array params)', async () => {
    globalFetchMock.mockResolvedValue(new Response('ok'));
    client.setDefaults({ baseUrl: 'https://api.example.com/v1/', searchParams: [['tags', 'a']] });
    await client.fetch('items', {
      searchParams: [
        ['tags', 'b'],
        ['tags', 'c'],
      ],
    });
    const callArgs = globalFetchMock.mock.calls.at(0);
    if (!callArgs) {
      throw new Error('No fetch call recorded');
    }
    const url = callArgs.at(0);
    if (!(url instanceof URL)) {
      throw new Error('Expected URL instance');
    }
    expect(url.searchParams.getAll('tags')).toEqual(['b', 'c']);
    // Should NOT contain 'a' because the key was overwritten
    expect(url.searchParams.getAll('tags')).not.toContain('a');
  });
});

suite('headers and body handling when making requests', () => {
  it('automatically sets Content-Type for JSON requests', async () => {
    globalFetchMock.mockResolvedValue(new Response('ok'));
    await client.fetch({
      url: 'https://api.com',
      json: { key: 'value' },
    });
    const callArgs = globalFetchMock.mock.calls.at(0);
    if (!callArgs) {
      throw new Error('No fetch call recorded');
    }
    const requestInit = callArgs.at(1);
    if (!requestInit) {
      throw new Error('No RequestInit recorded');
    }
    if (requestInit instanceof URL || typeof requestInit === 'string') {
      throw new Error('Expected RequestInit object');
    }
    const headers = new Headers(requestInit.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(requestInit.body).toBe(JSON.stringify({ key: 'value' }));
  });

  it('merges default headers with request headers', async () => {
    globalFetchMock.mockResolvedValue(new Response('ok'));
    client.setDefaults({ headers: { Authorization: 'Bearer token' } });
    await client.fetch('https://api.com', {
      headers: { 'X-Custom': '123' },
    });
    const callArgs = globalFetchMock.mock.calls.at(0);
    if (!callArgs) {
      throw new Error('No fetch call recorded');
    }
    const requestInit = callArgs.at(1);
    if (!requestInit) {
      throw new Error('No RequestInit recorded');
    }
    if (requestInit instanceof URL || typeof requestInit === 'string') {
      throw new Error('Expected RequestInit object');
    }
    const headers = new Headers(requestInit.headers);
    expect(headers.get('authorization')).toBe('Bearer token');
    expect(headers.get('x-custom')).toBe('123');
  });
});

suite('ReadableStream handling', () => {
  // Helper to create a simple ReadableStream from a string
  const createStream = (content: string) => {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(content));
        controller.close();
      },
    });
  };

  it('successfully sends a request with a ReadableStream body', async () => {
    globalFetchMock.mockResolvedValue(new Response('ok'));
    const stream = createStream('stream content');
    await client.fetch('https://api.com/upload', {
      method: 'POST',
      body: stream,
    });
    const requestInit = globalFetchMock.mock.calls[0][1] as RequestInit;
    expect(requestInit.body).toBeInstanceOf(ReadableStream);
    expect(requestInit.body).toBe(stream);
  });

  it('does not retry when the ReadableStream is locked', async () => {
    client.setDefaults({ retry: { limit: 1, delay: 10 } });
    const stream = createStream('data');
    globalFetchMock.mockImplementation(async (_, init) => {
      const body = init?.body;
      if (body instanceof ReadableStream && body.locked) {
        throw new TypeError('Body is locked');
      }
      if (body instanceof ReadableStream) {
        const reader = body.getReader();
        await reader.read();
      }
      // Network error after locking the stream
      throw new Error('Network Error');
    });
    const promise = client.fetch('https://api.com/data', { method: 'POST', body: stream });
    // Expect it to fail without retrying, since the stream is locked after first read
    await expect(promise).rejects.toThrow('Network Error');
    expect(globalFetchMock).toHaveBeenCalledTimes(1);
  });
});

suite('timeout handling', () => {
  beforeEach(() => {
    // Mock fetch to use AbortSignal on timeout testing
    globalFetchMock.mockImplementation((_, options) => {
      const signal = options?.signal;
      return new Promise((_, reject) => {
        if (signal?.aborted) {
          return reject(signal.reason || new DOMException('Aborted', 'AbortError'));
        }
        signal?.addEventListener('abort', () => {
          reject(signal.reason || new DOMException('Aborted', 'AbortError'));
        });
      });
    });
  });

  it('aborts the request if it exceeds the default timeout', async () => {
    client.setDefaults({ timeout: 100 });
    const promise = client.fetch('https://api.com');
    vi.advanceTimersByTime(101);
    await expect(promise).rejects.toThrow(FetchClientTimeoutError);
  });

  it('respects a custom timeout provided in the request', async () => {
    const promise = client.fetch('https://api.com', { timeout: 5000 });
    vi.advanceTimersByTime(5001);
    await expect(promise).rejects.toThrow(FetchClientTimeoutError);
  });

  it('allows disabling timeout by passing false', async () => {
    let aborted = false;
    globalFetchMock.mockImplementation((_, options) => {
      options?.signal?.addEventListener(
        'abort',
        () => {
          aborted = true;
        },
        { once: true }
      );
      return new Promise(() => {});
    });
    client.fetch('https://api.com', { timeout: false });
    vi.advanceTimersByTime(20000);
    expect(aborted).toBe(false);
  });

  it('does not treat user abort as timeout error', async () => {
    globalFetchMock.mockImplementation((_, options) => {
      return new Promise((_, reject) => {
        options?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError'))
        );
      });
    });
    client.setDefaults({ retry: { limit: 2 } });
    const controller = new AbortController();
    const promise = client.fetch('https://api.com', { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toThrow('Aborted');
    expect(globalFetchMock).toHaveBeenCalledTimes(1);
  });
});

suite('retry logic', () => {
  it('retries on network failure up to the limit', async () => {
    const error = new Error('Network Error');
    globalFetchMock
      .mockRejectedValueOnce(error) // Fail 1
      .mockRejectedValueOnce(error) // Fail 2
      .mockResolvedValue(new Response('ok')); // Success
    client.setDefaults({ retry: { limit: 2, delay: 10 } });
    const promise = client.fetch('https://api.com');
    await vi.advanceTimersByTimeAsync(30);
    const response = await promise;
    expect(globalFetchMock).toHaveBeenCalledTimes(3);
    expect(response.ok).toBe(true);
  });

  it('stops retrying if the error does not match retryOn predicate', async () => {
    globalFetchMock.mockRejectedValue(new Error('Critical Error'));
    const retryIfNotCritical = vi.fn(
      (_, err) => err instanceof Error && err.message !== 'Critical Error'
    );
    client.setDefaults({ retry: { limit: 3, retryOn: retryIfNotCritical } });
    await expect(client.fetch('https://api.com')).rejects.toThrow('Critical Error');
    expect(globalFetchMock).toHaveBeenCalledTimes(1);
    expect(retryIfNotCritical).toHaveBeenCalledTimes(1);
  });

  it('retries on error status codes (e.g., 503) if configured via logic', async () => {
    globalFetchMock.mockResolvedValueOnce(new Response(null, { status: 503, statusText: 'Busy' }));
    globalFetchMock.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const retryOn503Status = vi.fn(
      (_, err) => err instanceof FetchClientError && err.response?.status === 503
    );
    client.setDefaults({ retry: { limit: 1, retryOn: retryOn503Status } });
    const response = await client.fetch('https://api.com');
    expect(response.status).toBe(200);
    expect(globalFetchMock).toHaveBeenCalledTimes(2);
    expect(retryOn503Status).toHaveBeenCalledTimes(1);
  });

  it('respects retry delay logic', async () => {
    globalFetchMock.mockRejectedValueOnce(new Error('Fail')).mockResolvedValue(new Response('ok'));
    client.setDefaults({ retry: { limit: 1, delay: 1000 } });
    client.fetch('https://api.com');
    await vi.advanceTimersByTimeAsync(500);
    expect(globalFetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(501);
    expect(globalFetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry timeout when retryOn returns false', async () => {
    const doNotRetryOnTimeout = vi.fn((_, err) => {
      return !(err instanceof FetchClientTimeoutError);
    });
    client.setDefaults({ timeout: 100, retry: { limit: 2, retryOn: doNotRetryOnTimeout } });
    globalFetchMock.mockImplementation((_, options) => {
      return new Promise((_, reject) => {
        options?.signal?.addEventListener('abort', () => {
          reject(options?.signal?.reason || new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    const promise = client.fetch('https://api.com');
    vi.advanceTimersByTime(101);
    await expect(promise).rejects.toThrow(FetchClientTimeoutError);
    expect(globalFetchMock).toHaveBeenCalledTimes(1);
    expect(doNotRetryOnTimeout).toHaveBeenCalledWith(0, expect.any(FetchClientTimeoutError));
  });

  it('retries when timeout occurs and retryOn allows it', async () => {
    const allowRetryOnTimeout = vi.fn((_, err) => {
      return err instanceof FetchClientTimeoutError;
    });
    client.setDefaults({ timeout: 100, retry: { limit: 2, retryOn: allowRetryOnTimeout } });
    globalFetchMock.mockImplementation((_, options) => {
      return new Promise((_, reject) => {
        options?.signal?.addEventListener('abort', () => {
          reject(options?.signal?.reason || new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    const promise = client.fetch('https://api.com');
    const errorAssertion = expect(promise).rejects.toThrow(FetchClientTimeoutError);
    await vi.runAllTimersAsync();
    await errorAssertion;
    expect(globalFetchMock).toHaveBeenCalledTimes(3);
    expect(allowRetryOnTimeout).toHaveBeenCalledTimes(2);
    expect(allowRetryOnTimeout).toHaveBeenNthCalledWith(1, 0, expect.any(FetchClientTimeoutError));
    expect(allowRetryOnTimeout).toHaveBeenNthCalledWith(2, 1, expect.any(FetchClientTimeoutError));
  });
});

suite('response decoration & error handling', () => {
  it('decorates the response with the request object', async () => {
    globalFetchMock.mockResolvedValue(new Response('ok'));
    const response = await client.fetch('https://api.com', { method: 'POST' });
    expect(response.request).toEqual(expect.objectContaining({ method: 'POST' }));
  });

  it('throws FetchClientError for non-ok responses by default', async () => {
    globalFetchMock.mockResolvedValue(
      new Response('Not Found', { status: 404, statusText: 'Not Found' })
    );
    await expect(client.fetch('https://api.com')).rejects.toThrow(FetchClientError);
    try {
      await client.fetch('https://api.com');
    } catch (err) {
      if (err instanceof FetchClientError) {
        expect(err.response?.status).toBe(404);
        expect(err.response?.statusText).toBe('Not Found');
      } else {
        throw err; // Re-throw if it's not the expected error type
      }
    }
  });

  it('uses custom isResponseError to prevent throwing on specific statuses', async () => {
    globalFetchMock.mockResolvedValue(new Response('Created', { status: 201 })); // Default usually ok
    globalFetchMock.mockResolvedValueOnce(new Response('Bad Request', { status: 400 }));
    client.setDefaults({
      // Don't treat 400 as error
      isResponseError: (res) => res.status !== 400 && !res.ok,
    });
    const response = await client.fetch('https://api.com');
    expect(response.status).toBe(400);
  });
});

suite('abort signal integration', () => {
  it('aborts request when user signal is aborted', async () => {
    globalFetchMock.mockImplementation((_, options) => {
      return new Promise((_, reject) => {
        options?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError'))
        );
      });
    });
    const controller = new AbortController();
    const promise = client.fetch('https://api.com', { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toThrow('Aborted');
  });

  it('does not retry if the error is an AbortError (user cancelled)', async () => {
    const controller = new AbortController();
    globalFetchMock.mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    client.setDefaults({ retry: { limit: 3 } });
    const promise = client.fetch('https://api.com', { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toThrow('Aborted');
    expect(globalFetchMock).toHaveBeenCalledTimes(1); // Should not retry user aborts
  });
});

suite('beforeRequest hooks', () => {
  it('modifies the request config in beforeRequest hook', async () => {
    globalFetchMock.mockResolvedValue(new Response('ok'));
    const hook = vi.fn<Parameters<BeforeRequestHook>>(async (config) => {
      config.headers = { ...config.headers, 'X-Hooked': 'yes' };
      return config;
    });
    client.addHook('beforeRequest', hook);
    await client.fetch('https://api.com');
    const callArgs = globalFetchMock.mock.calls.at(0);
    if (!callArgs) {
      throw new Error('No fetch call recorded');
    }
    const requestInit = callArgs.at(1);
    if (!requestInit) {
      throw new Error('No RequestInit recorded');
    }
    if (requestInit instanceof URL || typeof requestInit === 'string') {
      throw new Error('Expected RequestInit object');
    }
    const headers = new Headers(requestInit.headers);
    expect(headers.get('x-hooked')).toBe('yes');
    expect(hook).toHaveBeenCalledOnce();
  });

  it('ignores beforeRequest hook when it returns nothing', async () => {
    globalFetchMock.mockResolvedValue(new Response('ok'));
    const hook = vi.fn<Parameters<BeforeRequestHook>>(() => {
      // Does not return anything
    });
    client.addHook('beforeRequest', hook);
    await client.fetch('https://api.com', { headers: { 'X-Original': 'true' } });
    const callArgs = globalFetchMock.mock.calls.at(0);
    if (!callArgs) {
      throw new Error('No fetch call recorded');
    }
    const requestInit = callArgs.at(1);
    if (!requestInit) {
      throw new Error('No RequestInit recorded');
    }
    if (requestInit instanceof URL || typeof requestInit === 'string') {
      throw new Error('Expected RequestInit object');
    }
    const headers = new Headers(requestInit.headers);
    expect(headers.get('x-original')).toBe('true');
    expect(headers.get('x-hooked')).toBeNull();
    expect(hook).toHaveBeenCalledOnce();
  });
});

suite('afterResponse hooks', () => {
  it('modifies the response in afterResponse hook', async () => {
    globalFetchMock.mockResolvedValue(new Response('original body'));
    const hook = vi.fn<Parameters<AfterResponseHook>>(async (_, response) => {
      const modifiedResponse = new Response('modified body', {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
      return modifiedResponse;
    });
    client.addHook('afterResponse', hook);
    const response = await client.fetch('https://api.com');
    const text = await response.text();
    expect(text).toBe('modified body');
    expect(hook).toHaveBeenCalledOnce();
  });

  it('ignores afterResponse hook when it returns nothing', async () => {
    globalFetchMock.mockResolvedValue(new Response('original body'));
    const hook = vi.fn<Parameters<AfterResponseHook>>(() => {
      // Does not return anything
    });
    client.addHook('afterResponse', hook);
    const response = await client.fetch('https://api.com');
    const text = await response.text();
    expect(text).toBe('original body');
    expect(hook).toHaveBeenCalledOnce();
  });
});

suite('hook handling', () => {
  it('removes a previously added hook', async () => {
    globalFetchMock.mockResolvedValue(new Response('ok'));

    const hook = vi.fn();
    client.addHook('beforeRequest', hook);
    client.removeHook('beforeRequest', hook);

    await client.fetch('https://api.com');

    expect(hook).not.toHaveBeenCalled();
  });

  it('handles multiple hooks of the same type correctly', async () => {
    globalFetchMock.mockResolvedValue(new Response('ok'));
    const hook1 = vi.fn<Parameters<BeforeRequestHook>>((config) => {
      config.headers = { ...config.headers, 'X-Hook-1': 'yes' };
      return config;
    });
    const hook2 = vi.fn<Parameters<BeforeRequestHook>>((config) => {
      config.headers = { ...config.headers, 'X-Hook-2': 'yes' };
      return config;
    });
    client.addHook('beforeRequest', hook1);
    client.addHook('beforeRequest', hook2);
    await client.fetch('https://api.com');
    const callArgs = globalFetchMock.mock.calls.at(0);
    if (!callArgs) {
      throw new Error('No fetch call recorded');
    }
    const requestInit = callArgs.at(1);
    if (!requestInit) {
      throw new Error('No RequestInit recorded');
    }
    if (requestInit instanceof URL || typeof requestInit === 'string') {
      throw new Error('Expected RequestInit object');
    }
    const headers = new Headers(requestInit.headers);
    expect(headers.get('x-hook-1')).toBe('yes');
    expect(headers.get('x-hook-2')).toBe('yes');
    expect(hook1).toHaveBeenCalledOnce();
    expect(hook2).toHaveBeenCalledOnce();
  });

  it('clears all hooks of a specific type', async () => {
    globalFetchMock.mockResolvedValue(new Response('ok'));
    const hook1 = vi.fn();
    const hook2 = vi.fn();
    client.addHook('afterResponse', hook1);
    client.addHook('afterResponse', hook2);
    client.clearHooks('afterResponse');
    await client.fetch('https://api.com');
    expect(hook1).not.toHaveBeenCalled();
    expect(hook2).not.toHaveBeenCalled();
  });

  it('clears all hooks when clearHooks is called without type', async () => {
    globalFetchMock.mockResolvedValue(new Response('ok'));
    const beforeHook = vi.fn();
    const afterHook = vi.fn();
    client.addHook('beforeRequest', beforeHook);
    client.addHook('afterResponse', afterHook);
    client.clearHooks();
    await client.fetch('https://api.com');
    expect(beforeHook).not.toHaveBeenCalled();
    expect(afterHook).not.toHaveBeenCalled();
  });
});
