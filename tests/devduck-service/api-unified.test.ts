import test from 'node:test';
import assert from 'node:assert/strict';

import { getUnifiedAPI } from '../../scripts/lib/api.js';
import { devduckServiceRouter } from '../../scripts/lib/api/devduckService.js';

test('devduckService: is included in unified API and exposes procedures', async () => {
  const api = await getUnifiedAPI();
  assert.ok(api.devduckService, 'devduckService router should be present');
  assert.strictEqual(api.devduckService, devduckServiceRouter);

  const procedures = (devduckServiceRouter as any).procedures;
  assert.ok(procedures);
  assert.ok(procedures.ping);
  assert.ok(procedures.processStart);
  assert.ok(procedures.processStop);
  assert.ok(procedures.processStatus);
  assert.ok(procedures.processReadSession);
});

