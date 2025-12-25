# Roadmap

## v0.2.0 — Unified API System ✅

- ✅ **tRPC-like Router Pattern** — Modules can define APIs using a tRPC-like router pattern with input/output schemas and metadata
- ✅ **Unified API Collector** — Automatic discovery and collection of module APIs from all installed modules (including external repositories)
- ✅ **API CLI** — Unified CLI access to all module APIs via `npm run api <module>.<procedure>`
- ✅ **MCP Module** — Module for listing MCP servers and their tools, calling MCP methods
- ✅ **Provider-less Modules** — Support for modules that don't require providers (e.g., `mcp`)
- ✅ **Environment Variable Loading** — Automatic loading of `.env` variables when collecting unified API
- ✅ **CLI Help Generation** — Automatic help generation with module descriptions and examples

## v0.3.0 — Enhanced Module System

- [ ] **Module API Documentation** — Auto-generate API documentation from router definitions
- [ ] **API Versioning** — Support for API versioning in module routers
- [ ] **API Testing Framework** — Standardized testing utilities for module APIs
- [ ] **GraphQL Support** — Optional GraphQL endpoint generation from routers

## v0.4.0 — Developer Experience

- [ ] **API Explorer** — Interactive web UI for exploring and testing module APIs
- [ ] **API Mocking** — Generate mock implementations for testing
- [ ] **API Validation** — Enhanced validation and error messages
- [ ] **Performance Monitoring** — Track API call performance and usage

## Future Considerations

- [ ] **API Gateway** — Central API gateway for all module APIs
- [ ] **Rate Limiting** — Built-in rate limiting for API calls
- [ ] **Authentication** — Standardized authentication for module APIs
- [ ] **WebSocket Support** — Real-time API updates via WebSockets

