import assert from 'node:assert/strict';
import { isFashionOSPath } from '../fashion-proxy.mjs';

const inside = [
 '/workspace','/fashion-os','/dashboard','/studio','/operations','/manufacturing',
 '/workspace.html','/dashboard.html','/operations.html','/team.html',
 '/api/control','/api/team','/api/ops','/api/creative',
];
const outside = [
 '/','/admin','/admin.html','/api/products','/api/status','/api/admin/login',
 '/api/auth/login','/api/checkout/orders','/api/orders/track','/api/daily',
 '/api/control-extra','/api/control/secret','/src-internal/control.js',
 '/.well-known/security.txt','/assets/asryo.png','/index.html',
];
for (const route of inside) assert.equal(isFashionOSPath(route),true,route);
for (const route of outside) assert.equal(isFashionOSPath(route),false,route);
console.log('ASRYO Fashion OS gateway routes: '+inside.length+' internal; '+outside.length+' storefront unaffected.');
