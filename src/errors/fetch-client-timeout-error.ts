import FetchClientError from '../errors/fetch-client-error';
import { FetchClientRequest } from '../types';

/**
 * Custom error class for timeout errors in FetchClient.
 * @template RequestBody - The type of the body content, defaults to `BodyInit`.
 */
export default class FetchClientTimeoutError<
  RequestBody = BodyInit
> extends FetchClientError<RequestBody> {
  constructor(request: FetchClientRequest<RequestBody>) {
    super('Request timed out');
    this.name = FetchClientTimeoutError.name;
    this.request = request;
  }
}
