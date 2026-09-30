import { setText } from './safeRendering.js';
import { presentField } from './presentationContexts.js';

export function showOperationNotice(message, options = {}) {
    const notice = document.createElement('div');
    notice.className = 'operation-notice';
    notice.dataset.operationNotice = options.kind ?? 'status';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    if (options.label) {
        notice.setAttribute('aria-label', options.label);
    }
    setText(notice, message);
    document.body.prepend(notice);
    return notice;
}

export function showDestinationDeclinedNotice(operation, decision) {
    const origin = decision?.origin || 'the requested destination';
    const notice = showOperationNotice(
        `${operation} was declined. No request was sent to ${origin}, and existing work was not modified.`,
        {
            kind: 'declined',
            label: 'Destination declined'
        }
    );
    presentField(
        notice,
        'destination.origin',
        'declined-destination-notice',
        `${operation} was declined. No request was sent to ${origin}, and existing work was not modified.`
    );
    return notice;
}
