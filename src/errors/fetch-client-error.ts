import { FetchClientRequest } from '../types';

/**
 * Custom error class for FetchClient-related errors.
 * @template RequestBody - The type of the body content, defaults to `BodyInit`.
 */
export default class FetchClientError<RequestBody = BodyInit> extends Error {
  response?: Response;
  request?: FetchClientRequest<RequestBody>;
  status?: number;
  statusText?: string;

  constructor(message: string, request?: FetchClientRequest<RequestBody>, response?: Response) {
    super(message);
    this.name = FetchClientError.name;
    this.response = response;
    this.request = request;
    this.status = response?.status;
    this.statusText = response?.statusText;
  }
}
