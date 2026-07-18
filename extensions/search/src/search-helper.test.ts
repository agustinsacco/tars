import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createPinnedLookup,
    fetchWebPage,
    isPrivateAddress,
    resolvePublicTarget
} from './search-helper.js';

test('private address detection covers local IPv4 and IPv6 ranges', () => {
    // ARRANGE
    const privateAddresses = [
        '127.0.0.1',
        '10.0.0.1',
        '169.254.169.254',
        '::1',
        '::7f00:1',
        'fd00::1',
        'fec0::1'
    ];

    // ACT
    const results = privateAddresses.map(isPrivateAddress);

    // ASSERT
    assert.deepEqual(
        results,
        privateAddresses.map(() => true)
    );
    assert.equal(isPrivateAddress('8.8.8.8'), false);
    assert.equal(isPrivateAddress('2001:4860:4860::8888'), false);
});

test('page fetching rejects direct private-network targets before making a request', async () => {
    // ARRANGE
    const privateUrl = 'http://127.0.0.1:8080/admin';

    // ACT & ASSERT
    await assert.rejects(fetchWebPage(privateUrl), /Private and local network targets are blocked/);
});

test('page fetching rejects non-http protocols', async () => {
    // ARRANGE
    const fileUrl = 'file:///etc/passwd';

    // ACT & ASSERT
    await assert.rejects(fetchWebPage(fileUrl), /Only HTTP and HTTPS URLs are supported/);
});

test('bracketed IPv6 literals are normalized and blocked before DNS', async () => {
    // ARRANGE
    let lookupCalled = false;

    // ACT & ASSERT
    await assert.rejects(
        resolvePublicTarget(new URL('http://[::1]/admin'), async () => {
            lookupCalled = true;
            return [];
        }),
        /Private and local network targets are blocked/
    );
    assert.equal(lookupCalled, false);
});

test('IPv4-compatible and deprecated site-local IPv6 targets are blocked before DNS', async () => {
    // ARRANGE
    let lookupCalled = false;
    const lookup = async () => {
        lookupCalled = true;
        return [];
    };

    // ACT & ASSERT
    await assert.rejects(
        resolvePublicTarget(new URL('http://[::127.0.0.1]/admin'), lookup),
        /Private and local network targets are blocked/
    );
    await assert.rejects(
        resolvePublicTarget(new URL('http://[fec0::1]/admin'), lookup),
        /Private and local network targets are blocked/
    );
    assert.equal(lookupCalled, false);
});

test('socket lookup stays pinned to the address that passed validation', async () => {
    // ARRANGE
    let resolverCalls = 0;
    const target = await resolvePublicTarget(new URL('https://rebind.example/'), async () => {
        resolverCalls += 1;
        return [{ address: '93.184.216.34', family: 4 }];
    });
    const pinnedLookup = createPinnedLookup(target);

    // ACT
    const pinnedAddress = await new Promise<string>((resolve, reject) => {
        pinnedLookup('rebind.example', { all: false }, (error, address) => {
            if (error) reject(error);
            else resolve(String(address));
        });
    });

    // ASSERT
    assert.equal(resolverCalls, 1);
    assert.equal(pinnedAddress, '93.184.216.34');
});
