const ADDRESS_CLASSES = new Set([
    'public',
    'localhost',
    'loopback',
    'link-local',
    'private-literal',
    'unknown-hostname',
    'not-applicable'
]);

const CONSENTS = new Set([
    'not-required',
    'task-link-action',
    'task-load-approved',
    'private-explicitly-approved',
    'denied'
]);

function classifyAddress(hostname) {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost')) {
        return 'localhost';
    }
    if (host === '::1' || host.startsWith('127.')) {
        return 'loopback';
    }
    if (/^169\.254\./.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) {
        return 'link-local';
    }
    if (/^10\./.test(host)
        || /^192\.168\./.test(host)
        || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
        || /^fc[0-9a-f]{2}:/i.test(host)
        || /^fd[0-9a-f]{2}:/i.test(host)) {
        return 'private-literal';
    }
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')) {
        return 'public';
    }
    return 'unknown-hostname';
}

function normalizeOrigins(origins) {
    return new Set((origins ?? []).map(value => {
        try {
            return new URL(value).origin;
        } catch {
            return null;
        }
    }).filter(Boolean));
}

function freezeTemplateContext(value, placeholders, preExpansionDecision) {
    const used = [...String(value).matchAll(/\{([a-zA-Z0-9_-]+)\}/g)].map(match => match[1]);
    const allowed = new Set(placeholders ?? []);
    const unsupported = used.filter(name => !allowed.has(name));
    return {
        used,
        unsupported,
        parseValue: String(value).replace(/\{[a-zA-Z0-9_-]+\}/g, 'template-value'),
        context: used.length === 0 ? undefined : Object.freeze({
            allowedPlaceholders: Object.freeze([...allowed]),
            usedPlaceholders: Object.freeze(used),
            preExpansionDecision
        })
    };
}

export function createDestinationDecision(originalValue, options = {}) {
    const consent = CONSENTS.has(options.consent) ? options.consent : 'not-required';
    const template = freezeTemplateContext(
        originalValue,
        options.allowedPlaceholders,
        options.preExpansionDecision
    );
    let url;
    let reason = null;

    if (template.unsupported.length > 0) {
        reason = 'unsupported-template-placeholder';
    } else {
        try {
            url = new URL(template.parseValue, options.baseUrl ?? globalThis.location?.href);
        } catch {
            reason = 'invalid-url';
        }
    }

    const scheme = url?.protocol.replace(':', '').toLowerCase() ?? '';
    const host = url?.hostname.toLowerCase() ?? '';
    const port = url?.port || '';
    const origin = url?.origin ?? '';
    const hasCredentials = Boolean(url && (url.username || url.password));
    const addressClass = url ? classifyAddress(host) : 'not-applicable';
    const reviewedOrigins = normalizeOrigins(options.reviewedOrigins);
    const currentOrigin = options.currentOrigin
        ?? globalThis.location?.origin
        ?? null;
    let originClass = 'blocked';

    if (url) {
        if (origin === currentOrigin) {
            originClass = 'same-origin';
        } else if (reviewedOrigins.has(origin)) {
            originClass = 'reviewed-default';
        } else {
            originClass = 'task-introduced';
        }
    }

    if (!reason && hasCredentials) {
        reason = 'credentials-not-allowed';
    }
    if (!reason && scheme === 'blob' && options.allowBlob === true) {
        // Browser-created object URLs are permitted only for workflows that opt in.
    } else if (!reason && scheme !== 'https') {
        const localHttp = scheme === 'http'
            && options.allowLocalhost === true
            && (addressClass === 'localhost' || addressClass === 'loopback');
        if (!localHttp) {
            reason = 'scheme-not-allowed';
        }
    }
    if (!reason && (addressClass === 'link-local' || addressClass === 'private-literal')) {
        if (consent !== 'private-explicitly-approved') {
            reason = 'private-address-approval-required';
        }
    }
    if (!reason && originClass === 'task-introduced'
        && options.requireTaskConsent === true
        && !['task-link-action', 'task-load-approved', 'private-explicitly-approved'].includes(consent)) {
        reason = 'task-origin-approval-required';
    }
    if (!reason && consent === 'denied') {
        reason = 'consent-denied';
    }

    const decision = {
        originalValue: String(originalValue ?? ''),
        resolvedUrl: url?.href ?? '',
        scheme,
        host,
        port,
        origin,
        hasCredentials,
        addressClass,
        originClass: reason ? 'blocked' : originClass,
        consent,
        proxyMode: options.proxyMode === 'deployment-proxy' ? 'deployment-proxy' : 'direct',
        redirectPolicy: options.redirectPolicy === 'validate-each-hop'
            ? 'validate-each-hop'
            : 'block-all',
        templateContext: template.context,
        status: reason ? 'blocked' : 'allowed',
        reason
    };

    if (!ADDRESS_CLASSES.has(decision.addressClass)) {
        throw new TypeError('Unsupported address classification.');
    }
    return Object.freeze(decision);
}

export function requireAllowedDestination(decision) {
    if (!decision || decision.status !== 'allowed' || !decision.resolvedUrl) {
        throw new TypeError(`Destination is blocked: ${decision?.reason ?? 'missing-decision'}`);
    }
    return decision;
}

export function validateExpandedDestination(preExpansionDecision, expandedValue, options = {}) {
    requireAllowedDestination(preExpansionDecision);
    const expanded = createDestinationDecision(expandedValue, {
        ...options,
        consent: preExpansionDecision.consent,
        proxyMode: preExpansionDecision.proxyMode,
        redirectPolicy: preExpansionDecision.redirectPolicy
    });
    if (expanded.status === 'allowed' && expanded.origin !== preExpansionDecision.origin) {
        return Object.freeze({
            ...expanded,
            originClass: 'blocked',
            status: 'blocked',
            reason: 'template-origin-changed'
        });
    }
    return expanded;
}

export function createWorkflowDestinationDecision(value, options = {}) {
    const workflow = options.workflow ?? 'page';
    const bases = {
        page: options.pageUrl,
        task: options.taskUrl ?? options.pageUrl,
        project: options.projectUrl ?? options.pageUrl,
        service: options.taskUrl ?? options.pageUrl
    };
    const baseUrl = bases[workflow];
    const text = String(value ?? '');
    if (!Object.hasOwn(bases, workflow) || !baseUrl) {
        return Object.freeze({
            ...createDestinationDecision('', options),
            originalValue: text,
            status: 'blocked',
            originClass: 'blocked',
            reason: 'missing-workflow-base'
        });
    }
    if (/^\s*\/\//.test(text) || text.includes('\\') || /[\r\n]/.test(text)) {
        return Object.freeze({
            ...createDestinationDecision('', { ...options, baseUrl }),
            originalValue: text,
            status: 'blocked',
            originClass: 'blocked',
            reason: 'ambiguous-relative-url'
        });
    }
    return createDestinationDecision(text, { ...options, baseUrl });
}
