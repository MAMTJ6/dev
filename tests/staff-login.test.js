// Plain-node unit tests for admin/staff/staff-pin-pure.js's exported pure
// functions — no framework, no live deploy, no Supabase needed. Same
// "exported for ad-hoc node testing" convention as api/publish-news.test.js.
// Run with:
//
//   node api/staff-login.test.js
//
// Exits non-zero if any assertion fails.

const assert = require('assert');
const {
    isValidPinFormat,
    derivePinHashHex,
    generatePinAndHash,
    verifyPin,
    computeLockoutUpdate,
    isLocked,
    LOCKOUT_THRESHOLD,
} = require('../admin/staff/staff-pin-pure.js');

let passed = 0, failed = 0;
async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`  ok — ${name}`);
    } catch (e) {
        failed++;
        console.error(`  FAIL — ${name}`);
        console.error(`    ${e.message}`);
    }
}

async function main() {
    // ── isValidPinFormat ─────────────────────────────────────────────────────
    console.log('isValidPinFormat');
    await test('accepts exactly 6 digits', () => {
        assert.strictEqual(isValidPinFormat('123456'), true);
    });
    await test('rejects 5 digits', () => {
        assert.strictEqual(isValidPinFormat('12345'), false);
    });
    await test('rejects 7 digits', () => {
        assert.strictEqual(isValidPinFormat('1234567'), false);
    });
    await test('rejects non-numeric characters', () => {
        assert.strictEqual(isValidPinFormat('12a456'), false);
    });
    await test('rejects non-string input', () => {
        assert.strictEqual(isValidPinFormat(123456), false);
        assert.strictEqual(isValidPinFormat(null), false);
        assert.strictEqual(isValidPinFormat(undefined), false);
    });

    // ── generatePinAndHash / verifyPin round-trip ───────────────────────────
    console.log('generatePinAndHash / verifyPin round-trip');
    await test('generated PIN is 6 digits', async () => {
        const { pin } = await generatePinAndHash();
        assert.strictEqual(isValidPinFormat(pin), true);
    });
    await test('pin_hash has the salt:hash composite format', async () => {
        const { pin_hash } = await generatePinAndHash();
        const parts = pin_hash.split(':');
        assert.strictEqual(parts.length, 2);
        assert.match(parts[0], /^[0-9a-f]{32}$/);   // 16-byte salt, hex
        assert.match(parts[1], /^[0-9a-f]{64}$/);   // 256-bit derived key, hex
    });
    await test('the generated PIN verifies successfully against its own hash', async () => {
        const { pin, pin_hash } = await generatePinAndHash();
        assert.strictEqual(await verifyPin(pin, pin_hash), true);
    });
    await test('a wrong PIN fails verification against a real hash', async () => {
        const { pin, pin_hash } = await generatePinAndHash();
        const wrongPin = pin === '000000' ? '111111' : '000000';
        assert.strictEqual(await verifyPin(wrongPin, pin_hash), false);
    });
    await test('two calls to generatePinAndHash produce different salts (even if the PIN happens to repeat)', async () => {
        const a = await generatePinAndHash();
        const b = await generatePinAndHash();
        assert.notStrictEqual(a.pin_hash.split(':')[0], b.pin_hash.split(':')[0]);
    });
    await test('verifyPin rejects a malformed stored hash instead of throwing', async () => {
        assert.strictEqual(await verifyPin('123456', 'not-a-real-hash'), false);
        assert.strictEqual(await verifyPin('123456', null), false);
        assert.strictEqual(await verifyPin('123456', ''), false);
    });
    await test('verifyPin rejects a malformed submitted pin instead of throwing', async () => {
        const { pin_hash } = await generatePinAndHash();
        assert.strictEqual(await verifyPin('abc', pin_hash), false);
        assert.strictEqual(await verifyPin('', pin_hash), false);
    });
    await test('derivePinHashHex is deterministic for the same pin+salt (verification actually works)', async () => {
        const saltHex = '00112233445566778899aabbccddeeff'.slice(0, 32);
        const h1 = await derivePinHashHex('654321', saltHex);
        const h2 = await derivePinHashHex('654321', saltHex);
        assert.strictEqual(h1, h2);
    });

    // ── computeLockoutUpdate ─────────────────────────────────────────────────
    console.log('computeLockoutUpdate');
    const now = new Date('2026-08-01T12:00:00Z');
    await test('increments failed_pin_attempts by 1', () => {
        const out = computeLockoutUpdate(0, now);
        assert.strictEqual(out.failed_pin_attempts, 1);
    });
    await test(`does not lock before reaching the threshold (${LOCKOUT_THRESHOLD})`, () => {
        const out = computeLockoutUpdate(LOCKOUT_THRESHOLD - 2, now);
        assert.strictEqual(out.failed_pin_attempts, LOCKOUT_THRESHOLD - 1);
        assert.strictEqual(out.locked_until, null);
    });
    await test(`locks exactly at the threshold (${LOCKOUT_THRESHOLD})`, () => {
        const out = computeLockoutUpdate(LOCKOUT_THRESHOLD - 1, now);
        assert.strictEqual(out.failed_pin_attempts, LOCKOUT_THRESHOLD);
        assert.ok(out.locked_until);
        assert.ok(new Date(out.locked_until).getTime() > now.getTime());
    });
    await test('treats a null/undefined current count as 0', () => {
        const out = computeLockoutUpdate(undefined, now);
        assert.strictEqual(out.failed_pin_attempts, 1);
    });

    // ── isLocked ─────────────────────────────────────────────────────────────
    console.log('isLocked');
    await test('false when locked_until is null', () => {
        assert.strictEqual(isLocked({ locked_until: null }, now), false);
    });
    await test('false when locked_until is in the past', () => {
        assert.strictEqual(isLocked({ locked_until: '2020-01-01T00:00:00Z' }, now), false);
    });
    await test('true when locked_until is in the future', () => {
        assert.strictEqual(isLocked({ locked_until: '2099-01-01T00:00:00Z' }, now), true);
    });
    await test('false for a missing/undefined staff row', () => {
        assert.strictEqual(isLocked(null, now), false);
        assert.strictEqual(isLocked(undefined, now), false);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

main();
