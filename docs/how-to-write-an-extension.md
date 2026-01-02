# How to write a Barducks extension (spec-first API)

This document describes the recommended structure for a Barducks extension that exposes an API through the unified CLI (`api-cli`).

## Recommended structure

```
extensions/<name>/
  MODULE.md
  spec.ts
  api.ts
  schemas/
    contract.ts
    ...
  providers/
    <provider-name>/
      PROVIDER.md
      index.ts
  scripts/
    <name>.ts
```

## Source of truth: `spec.ts`

`extensions/<name>/spec.ts` is the **single source of truth** for:

- tool names (procedures)
- input/output schemas
- metadata (title/description/help/examples)
- vendor namespaces (`vendor.<ns>.<method>`)
- CLI/provider wiring (`requiresProvider`, `providerType`)

Example:

```ts
import { z } from 'zod';
// NOTE: `tool-spec` helpers were removed during repo cleanup.
// Define your tool schemas directly with zod + `publicProcedure` in `api.ts`.
import { SomeInputSchema, SomeOutputSchema } from './schemas/contract.js';

export const myTools = defineTools({
  doThing: tool({
    input: SomeInputSchema,
    output: SomeOutputSchema,
    meta: {
      title: 'Do a thing',
      description: 'Does a thing using the configured provider',
      help: 'Use this when you need to do the thing.',
      examples: [{ command: 'api-cli my.doThing --foo bar' }]
    }
  })
} as const);

export const myVendorTools: VendorToolsSpec = {
  github: defineTools({
    vendorOnly: tool({
      input: z.object({}),
      output: z.object({ ok: z.literal(true) }),
      meta: {
        title: 'GitHub-only operation',
        description: 'Vendor-specific method (GitHub)',
        examples: [{ command: 'api-cli my.vendor.github.vendorOnly' }]
      }
    })
  })
} as const;

export const mySpec = {
  name: 'my',
  description: 'My extension description',
  requiresProvider: true,
  providerType: 'my',
  tools: myTools,
  vendorTools: myVendorTools
} as const;

export default mySpec;
```

## Thin router: `api.ts`

`extensions/<name>/api.ts` should be tiny and generated from the spec:

```ts
#!/usr/bin/env node
import { makeProviderRouter } from '../../src/lib/make-provider-router.js';
import { myTools, myVendorTools } from './spec.js';

export const myRouter = makeProviderRouter({
  tools: myTools,
  vendorTools: myVendorTools
});
```

## Provider implementation: `defineProvider(...)`

Providers should be defined with `defineProvider(...)` to avoid duplicating `manifest.tools` and vendor lists.

```ts
import { defineProvider } from '../../../../src/lib/define-provider.js';
import { MY_PROVIDER_PROTOCOL_VERSION } from '../../schemas/contract.js';

const tools = {
  async doThing(input: { foo: string }) {
    return { ok: true };
  }
};

const vendor = {
  github: {
    async vendorOnly() {
      return { ok: true };
    }
  }
};

export default defineProvider({
  type: 'my',
  name: 'my-provider',
  version: '0.1.0',
  protocolVersion: MY_PROVIDER_PROTOCOL_VERSION,
  tools,
  vendor,
  auth: { type: 'none', requiredTokens: [] },
  capabilities: []
});
```

## Calling tools via unified CLI

- Universal tools: `api-cli <module>.<tool> ...`
- Vendor tools: `api-cli <module>.vendor.<namespace>.<tool> ...`

Examples:

- `api-cli ci.fetchPR --prId 123`
- `api-cli ci.vendor.github.fetchSomething --help`

