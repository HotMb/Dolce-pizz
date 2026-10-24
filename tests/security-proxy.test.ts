import assert from 'node:assert/strict';
import test from 'node:test';
import {applySecurityHeaders} from '../lib/security-headers';

test('proxy applies the browser security baseline to application responses', () => {
  const headers = applySecurityHeaders(new Headers());
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
  assert.match(headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.match(headers.get('content-security-policy') || '', /object-src 'none'/);
});
