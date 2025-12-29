# FetchClient

A TypeScript wrapper for the native Fetch API. This library implements standard HTTP client features such as interceptors, automatic retries, and timeout management on top of the browser's native capabilities.

![License MIT](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)

> **Note**: This is an educational project. It was created to study HTTP client architectures, design patterns, and TypeScript generics. While the code is tested and functional, it is primarily intended for academic and learning purposes.
## Key Functionality

- **TypeScript Support**: Uses generics for request and response body typing.
- **Interceptors**: Supports `beforeRequest` and `afterResponse` hooks.
- **Retry Logic**: Implements exponential backoff and configurable retry predicates.
- **Timeouts**: Wraps `AbortController` to handle request timeouts.
- **Stream Handling**: Checks for locked `ReadableStream` bodies before retrying.
- **Configuration**: Allows runtime updates to default headers and settings (immutable state).
- **Shortcuts**: Helper methods for standard HTTP verbs (`get`, `post`, `put`, `delete`, etc.).

## Installation

You can install the package via npm or yarn:

```bash
npm install fetch-client
# or
yarn add fetch-client
```

## Usage

Initialize the client with default options.

```typescript
import FetchClient from 'fetch-client';

// 1. Create an instance
const client = new FetchClient({
  baseUrl: 'https://api.example.com/v1',
  headers: {
    Authorization: 'Bearer YOUR_TOKEN',
  },
  timeout: 5000, // Global timeout of 5 seconds
});

// 2. Define your data types
interface User {
  id: number;
  name: string;
}

// 3. Make requests
try {
  // GET request with generic return type
  const response = await client.get<User>('/users/1');

  // The response object is an extension of the native Response
  const user = await response.json();
  console.log(user.name);
} catch (error) {
  console.error(error);
}
```

### HTTP Methods

The client handles body serialization based on input type.

```typescript
// POST JSON (automatically stringifies and sets Content-Type)
await client.post('/users', { json: { name: 'John Doe', age: 30 } });

// POST FormData (browser sets boundary automatically)
const formData = new FormData();
formData.append('file', fileInput.files[0]);
await client.post('/upload', { body: formData });

// PUT, PATCH, DELETE, HEAD, OPTIONS, TRACE, CONNECT
await client.delete('/users/1');
```

## Interceptors (Hooks)

Hooks allow code execution before the request is sent or after the response is received.

### Request Hooks

```typescript
const removeHook = client.addHook('beforeRequest', async (req) => {
  // Modify the request instance
  req.headers.set('Authorization', `Bearer ${await getToken()}`);
  return req;
});

// Cleanup
removeHook();
```

### Response Hooks

```typescript
const removeHook = client.addHook('afterResponse', (req, res) => {
  if (res.status === 401) {
    // Handle unauthorized responses globally
  }
});

// Cleanup
removeHook();
```

## Retries

Retries can be configured via the `retry` object.

```typescript
const client = new FetchClient({
  retry: {
    limit: 3, // Retry up to 3 times
    // Exponential backoff: 1s, 2s, 3s...
    delay: (attempt) => attempt * 1000,
    // Custom predicate: Retry only on network errors or 503 status
    retryOn: (attempt, error) => {
      if (error instanceof TypeError) return true; // Network error
      if (error instanceof FetchClientError && error.response?.status === 503) return true;
      return false;
    },
  },
});
```

## Defaults & Events

Defaults can be updated at runtime. The `onDefaultsChanged` event triggers when the configuration changes.

```typescript
// Listen to changes
client.addEventListener('onDefaultsChanged', (newDefaults) => {
  console.log('Client configuration updated:', newDefaults);
});

// Update defaults (e.g., after user login)
client.setDefaults({
  headers: { 'X-Tenant-ID': '123' },
});
// Or
client.setDefaults((previous) => ({
  ...previous,
  headers: { 'X-Tenant-ID': '123' },
}));

// Retrieve current read-only defaults
const config = client.getDefaults();
```

## Error Handling

The library exposes specific error classes.

```typescript
import FetchClient, { FetchClientError, FetchClientTimeoutError } from 'fetch-client';

try {
  await client.get('/endpoint');
} catch (error) {
  if (error instanceof FetchClientTimeoutError) {
    // Handle timeout
  } else if (error instanceof FetchClientError) {
    // Handle HTTP error (4xx, 5xx)
    console.log(error.status, error.statusText);
  }
}
```

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
