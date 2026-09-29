const ALLOWED_TAGS = [
    'a', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'hr', 'li', 'ol', 'p', 'pre', 'strong', 'ul'
];
const ALLOWED_ATTR = ['href', 'rel', 'target', 'title'];
const REMOVAL_LIMIT = 10;

export function setText(element, value) {
    element.textContent = value == null ? '' : String(value);
    return element;
}

export function isAllowedInstructionUrl(value, baseUrl = globalThis.location?.href) {
    if (typeof value !== 'string' || value.trim() === '') {
        return false;
    }
    if (value.startsWith('#')) {
        return true;
    }

    try {
        const url = new URL(value, baseUrl ?? 'https://example.invalid/');
        return ['https:', 'mailto:', 'tel:'].includes(url.protocol)
            || (baseUrl && url.origin === new URL(baseUrl).origin);
    } catch {
        return false;
    }
}

function normalizeLinks(html, removedKinds) {
    if (typeof document === 'undefined') {
        return html;
    }

    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelectorAll('a').forEach(link => {
        const href = link.getAttribute('href');
        if (!isAllowedInstructionUrl(href)) {
            link.removeAttribute('href');
            link.removeAttribute('target');
            link.removeAttribute('rel');
            removedKinds.add('unsafe-link');
            return;
        }

        const url = new URL(href, globalThis.location?.href ?? 'https://example.invalid/');
        if (url.origin !== globalThis.location?.origin && ['http:', 'https:'].includes(url.protocol)) {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        } else {
            link.removeAttribute('target');
            link.removeAttribute('rel');
        }
    });

    return template.innerHTML;
}

export function renderSafeMarkdown(value, dependencies = {}) {
    const sourceText = value == null ? '' : String(value);
    const markdown = dependencies.marked ?? globalThis.marked;
    const purifier = dependencies.DOMPurify ?? globalThis.DOMPurify;

    try {
        if (!markdown || typeof markdown.parse !== 'function'
            || !purifier || typeof purifier.sanitize !== 'function') {
            throw new Error('Instruction rendering dependencies are unavailable.');
        }

        const rendered = markdown.parse(sourceText);
        const safe = purifier.sanitize(rendered, {
            ALLOWED_TAGS,
            ALLOWED_ATTR,
            ALLOW_DATA_ATTR: false,
            ALLOW_ARIA_ATTR: false
        });
        const removedKinds = new Set();

        for (const removal of purifier.removed ?? []) {
            removedKinds.add(removal.attribute ? 'attribute' : 'element');
        }

        const safeHtml = normalizeLinks(String(safe), removedKinds);
        const boundedKinds = [...removedKinds].slice(0, REMOVAL_LIMIT);
        const changed = boundedKinds.length > 0;

        return Object.freeze({
            safeHtml,
            plainTextFallback: sourceText,
            removedKinds: Object.freeze(boundedKinds),
            changed,
            noticeRequired: changed,
            status: changed ? 'sanitized' : 'unchanged'
        });
    } catch {
        return Object.freeze({
            safeHtml: '',
            plainTextFallback: sourceText,
            removedKinds: Object.freeze(['render-failure']),
            changed: true,
            noticeRequired: true,
            status: 'plain-text-fallback'
        });
    }
}

export function renderInstruction(container, renderedResult) {
    container.replaceChildren();
    if (renderedResult.status === 'plain-text-fallback') {
        setText(container, renderedResult.plainTextFallback);
    } else {
        container.innerHTML = renderedResult.safeHtml;
    }
    renderSanitizationNotice(renderedResult, container);
}

export function renderSanitizationNotice(renderedResult, container) {
    if (!container || !renderedResult?.noticeRequired
        || container.querySelector('[data-safe-render-notice="true"]')) {
        return;
    }

    const notice = document.createElement('div');
    notice.className = 'safe-render-notice';
    notice.dataset.safeRenderNotice = 'true';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.tabIndex = -1;
    setText(
        notice,
        renderedResult.status === 'plain-text-fallback'
            ? 'Instructions could not be formatted and are shown as plain text.'
            : 'Some formatting was removed because it was not safe to render.'
    );
    container.appendChild(notice);
}
