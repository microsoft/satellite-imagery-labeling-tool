import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    isAllowedInstructionUrl,
    renderSafeMarkdown
} from '../../src/modules/safeRendering.js';

function dependencies({ sanitized = '<p>safe</p>', removed = [] } = {}) {
    return {
        marked: { parse: value => `<p>${value}</p>` },
        DOMPurify: {
            removed,
            sanitize: () => sanitized
        }
    };
}

test('preserves supported instruction formatting', () => {
    const result = renderSafeMarkdown('**safe**', dependencies({
        sanitized: '<p><strong>safe</strong></p>'
    }));
    assert.equal(result.safeHtml, '<p><strong>safe</strong></p>');
    assert.equal(result.status, 'unchanged');
});

test('allows relative, same-document, HTTPS, mail, and telephone links', () => {
    const base = 'https://example.test/path/page.html';
    for (const value of ['#section', './help', 'https://example.test/help', 'mailto:a@example.test', 'tel:+15555550100']) {
        assert.equal(isAllowedInstructionUrl(value, base), true);
    }
    assert.equal(isAllowedInstructionUrl('javascript:alert(1)', base), false);
    assert.equal(isAllowedInstructionUrl('http://example.test', base), false);
});

test('reports removed content without exposing raw HTML', () => {
    const result = renderSafeMarkdown('<script>bad()</script>', dependencies({
        sanitized: '<p>bad()</p>',
        removed: [{ element: { nodeName: 'SCRIPT' } }]
    }));
    assert.equal(result.status, 'sanitized');
    assert.equal(result.noticeRequired, true);
    assert.deepEqual(result.removedKinds, ['element']);
});

test('falls back to the original string as inert text when sanitizing fails', () => {
    const result = renderSafeMarkdown('<b>original</b>', {
        marked: { parse: value => value },
        DOMPurify: { sanitize: () => { throw new Error('failed'); } }
    });
    assert.equal(result.status, 'plain-text-fallback');
    assert.equal(result.safeHtml, '');
    assert.equal(result.plainTextFallback, '<b>original</b>');
});
