# FetchClient

A robust, strongly-typed, and feature-rich wrapper around the native Fetch API. Built with TypeScript, it provides a powerful toolkit for modern web applications, including an interceptor system (hooks), automatic retries with exponential backoff, timeout management, and immutable state handling.

![License MIT](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)

> **⚠️ Educational Project**: This library was developed as a comprehensive study project to deepen my understanding of HTTP client architectures, design patterns and TypeScript generics. While fully functional and tested, its primary purpose is academic.

## Features

- **Type-Safe**: Built entirely in TypeScript with generics for request and response bodies.
- **Hooks System**: Powerful `beforeRequest` and `afterResponse` interceptors to modify requests or inspect responses.
- **Automatic Retries**: Configurable retry logic with exponential backoff and custom predicates.
- **Timeout Handling**: Built-in support for request timeouts using `AbortController`.
- **Stream Safety**: Smart detection of locked `ReadableStream` bodies to prevent unsafe retries.
- **Event Driven**: Listen to events like `onDefaultsChanged` to react to configuration updates.
- **Immutable Defaults**: Configuration state is frozen and merged intelligently to prevent side effects by external mutations.
- **HTTP Shortcuts**: Semantic methods for `get`, `post`, `put`, `delete`, `patch`, etc.

## Installation

You can install the package via npm or yarn:

```bash
npm install fetch-client
# or
yarn add fetch-client
```

## Basic Usage

Import the class and create an instance. You can define a base URL and default headers.

```typescript
import FetchClient from 'fetch-client';

// 1. Create an instance
const client = new FetchClient({
  baseUrl: '[https://api.example.com/v1](https://api.example.com/v1)',
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

## Documentation

### HTTP Methods

The client provides shortcut methods for all standard HTTP verbs. It automatically handles JSON.stringify if you provide a json payload, or keeps the body as-is for FormData, Blob, or URLSearchParams.n

```typescript
// POST JSON
await client.post('/users', { json: { name: 'John Doe', age: 30 } });

// POST FormData (Content-Type header is automatically removed to let browser set boundary)
const formData = new FormData();
formData.append('file', fileInput.files[0]);
await client.post('/upload', { body: formData });

// PUT, PATCH, DELETE, HEAD, OPTIONS, TRACE, CONNECT
await client.delete('/users/1');
```

## Hooks (Interceptors)

You can intercept requests and responses. The addHook method returns a cleanup function to remove the hook later.

### Request Hooks

```typescript
const removeHook = client.addHook('beforeRequest', async (req) => {
  console.log(`Sending ${req.method} request to ${req.url}`);

  // You can modify the request object directly
  const token = await getFreshToken();
  req.headers.set('Authorization', `Bearer ${token}`);

  // If you want to replace the request entirely, return a new Request object
  return req;
});

// Later, you can remove this specific hook:
removeHook();
```

### Response Hooks

```typescript
const removeHook = client.addHook('afterResponse', (req, res) => {
  if (res.status === 401) {
    // Handle unauthorized access globally
    window.location.href = '/login';
  }
});

// Remove the hook when no longer needed
removeHook();
```

## Automatic Retries

Configure automatic retries for failed requests. You can define limits, delays, and conditions.

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

## Managing Defaults & Events

The client allows you to update default configurations at runtime. It uses a smart merge strategy for headers and search params.

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

The library throws specific error classes for better control.

```typescript
import FetchClient, { FetchClientError, FetchClientTimeoutError } from 'fetch-client';

try {
  await client.get('/risky-endpoint');
} catch (error) {
  if (error instanceof FetchClientTimeoutError) {
    console.error('Request took too long!');
  } else if (error instanceof FetchClientError) {
    console.error(`API Error: ${error.status} ${error.statusText}`);
    console.log('Original Request:', error.request);
  } else {
    console.error('Network or unexpected error', error);
  }
}
```

## Acknowledgements & Inspiration

This project is open-source and non-profit. The architecture and logic were heavily inspired by excellent open-source libraries in the JavaScript ecosystem. My goal was to implement their core concepts to better understand the internals of HTTP client design.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
