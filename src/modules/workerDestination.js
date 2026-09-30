(function (global) {
    'use strict';

    function requireRecord(value, name) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new TypeError(`${name} is required.`);
        }
    }

    function parseAllowedDecision(decision, name) {
        requireRecord(decision, name);
        if (decision.status !== 'allowed'
            || decision.redirectPolicy !== 'block-all'
            || decision.proxyMode !== 'direct'
            || decision.hasCredentials === true
            || decision.reason
            || decision.originClass === 'blocked'
            || !decision.resolvedUrl) {
            throw new TypeError(`${name} is not an allowed direct destination decision.`);
        }

        const url = new URL(decision.resolvedUrl);
        const localHttp = url.protocol === 'http:'
            && ['localhost', 'loopback'].includes(decision.addressClass);
        if ((!localHttp && url.protocol !== 'https:')
            || url.username || url.password
            || url.origin !== decision.origin
            || url.protocol.replace(':', '').toLowerCase() !== decision.scheme
            || url.hostname.toLowerCase() !== decision.host
            || (url.port || '') !== decision.port) {
            throw new TypeError(`${name} does not match its normalized URL.`);
        }
        if (['link-local', 'private-literal'].includes(decision.addressClass)
            && decision.consent !== 'private-explicitly-approved') {
            throw new TypeError(`${name} lacks private-address approval.`);
        }
        return url;
    }

    function requireAllowedRequest(input) {
        requireRecord(input, 'worker destination input');
        const templateUrl = parseAllowedDecision(
            input.templateDecision,
            'template destination decision'
        );
        const expandedUrl = parseAllowedDecision(
            input.destinationDecision,
            'expanded destination decision'
        );
        const requestUrl = new URL(input.requestUrl);

        if (templateUrl.origin !== expandedUrl.origin
            || expandedUrl.origin !== requestUrl.origin
            || expandedUrl.href !== requestUrl.href) {
            throw new TypeError('Expanded destination origin or URL does not match its approval.');
        }
        return expandedUrl.href;
    }

    const api = Object.freeze({ requireAllowedRequest });
    global.WorkerDestination = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(globalThis);
