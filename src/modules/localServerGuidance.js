(function () {
    const storageKey = 'satellite-imagery-labeling-tool:file-guidance-seen';

    function wasShown() {
        try {
            return sessionStorage.getItem(storageKey) === 'true';
        } catch {
            return globalThis.__localServerGuidanceSeen === true;
        }
    }

    function remember() {
        globalThis.__localServerGuidanceSeen = true;
        try {
            sessionStorage.setItem(storageKey, 'true');
        } catch {
            // Some file:// contexts do not expose storage; the in-page marker still prevents duplicates.
        }
    }

    function showLocalServerGuidance() {
        if (location.protocol !== 'file:' || wasShown()
            || document.querySelector('[data-local-server-guidance="true"]')) {
            return;
        }
        remember();

        const notice = document.createElement('aside');
        notice.className = 'local-server-guidance';
        notice.dataset.localServerGuidance = 'true';
        notice.setAttribute('role', 'status');
        notice.setAttribute('aria-label', 'Local server recommended');

        const message = document.createElement('span');
        message.textContent = 'Direct filesystem use reduces protections that require served '
            + 'response headers and cross-origin isolation. Run the application from a local HTTP '
            + 'server for the intended browser protections and worker behavior.';

        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.className = 'text-btn-round';
        dismiss.setAttribute('aria-label', 'Dismiss local-server guidance');
        dismiss.textContent = 'Dismiss';
        dismiss.addEventListener('click', () => notice.remove());

        notice.append(message, dismiss);
        document.body.prepend(notice);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', showLocalServerGuidance, { once: true });
    } else {
        showLocalServerGuidance();
    }
}());
