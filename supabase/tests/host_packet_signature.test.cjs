const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
(async () => {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const packet = { room_id: '11111111-1111-4111-8111-111111111111', host_account_id: '22222222-2222-4222-8222-222222222222', kind: 'host_state', playback_seq: 12, sent_at: Date.now(), position_seconds: 105.25, playback_state: 'paused', playback_rate: 1, media: { type: 'anime', title: 'Pause test', episode_index: 5, source_index: 1, language: 'sub' } };
  const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(JSON.stringify(packet)));
  const publicDer = await webcrypto.subtle.exportKey('spki', pair.publicKey);
  const imported = await webcrypto.subtle.importKey('spki', publicDer, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const onWire = JSON.parse(JSON.stringify({ ...packet, signature: Buffer.from(signature).toString('base64') }));
  const { signature: received, ...unsigned } = onWire;
  assert.equal(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, imported, Buffer.from(received, 'base64'), new TextEncoder().encode(JSON.stringify(unsigned))), true);
  assert.equal(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, imported, Buffer.from(received, 'base64'), new TextEncoder().encode(JSON.stringify({ ...unsigned, playback_state: 'playing' }))), false);
  console.log('PASS signed P-256 packet survives JSON transport');
  console.log('PASS modified playback state is rejected');
})().catch(error => { console.error(error); process.exit(1); });
