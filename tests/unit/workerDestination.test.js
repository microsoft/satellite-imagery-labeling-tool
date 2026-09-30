import assert from 'node:assert/strict';
import { test } from 'node:test';

await import('../../src/modules/workerDestination.js');

function decision(url, overrides = {}) {
    const parsed = new URL(url);
    return {
        resolvedUrl: parsed.href,
        scheme: parsed.protocol.replace(':', ''),
        host: parsed.hostname,
        port: parsed.port,
        origin: parsed.origin,
        hasCredentials: false,
        addressClass: 'unknown-hostname',
        originClass: 'reviewed-default',
        consent: 'not-required',
        proxyMode: 'direct',
        redirectPolicy: 'block-all',
        status: 'allowed',
        reason: null,
        ...overrides
    };
}

test('requires matching allowed template and expanded destination decisions', () => {
    const templateDecision = decision('https://data.example/items/template-value');
    const destinationDecision = decision('https://data.example/items/1,2,3,4');

    assert.equal(globalThis.WorkerDestination.requireAllowedRequest({
        templateDecision,
        destinationDecision,
        requestUrl: destinationDecision.resolvedUrl
    }), destinationDecision.resolvedUrl);
});

test('rejects missing decisions, redirects, and expansion origin changes', () => {
    const templateDecision = decision('https://data.example/items/template-value');
    const destinationDecision = decision('https://data.example/items/1,2,3,4');

    assert.throws(() => globalThis.WorkerDestination.requireAllowedRequest({
        requestUrl: destinationDecision.resolvedUrl
    }));
    assert.throws(() => globalThis.WorkerDestination.requireAllowedRequest({
        templateDecision,
        destinationDecision: {
            ...destinationDecision,
            redirectPolicy: 'validate-each-hop'
        },
        requestUrl: destinationDecision.resolvedUrl
    }));
    assert.throws(() => globalThis.WorkerDestination.requireAllowedRequest({
        templateDecision,
        destinationDecision: decision('https://other.example/items/1,2,3,4'),
        requestUrl: 'https://other.example/items/1,2,3,4'
    }));
});

test('requires explicit approval for private literals', () => {
    const privateDecision = decision('https://10.0.0.7/data', {
        addressClass: 'private-literal',
        originClass: 'task-introduced'
    });
    assert.throws(() => globalThis.WorkerDestination.requireAllowedRequest({
        templateDecision: privateDecision,
        destinationDecision: privateDecision,
        requestUrl: privateDecision.resolvedUrl
    }));

    const approved = {
        ...privateDecision,
        consent: 'private-explicitly-approved'
    };
    assert.equal(globalThis.WorkerDestination.requireAllowedRequest({
        templateDecision: approved,
        destinationDecision: approved,
        requestUrl: approved.resolvedUrl
    }), approved.resolvedUrl);
});
