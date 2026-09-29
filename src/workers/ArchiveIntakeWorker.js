importScripts('../libs/jszip.min.js');

let activeRequest = null;
let archiveModulePromise = null;

self.onmessage = event => {
    const message = event.data ?? {};
    if (message.type === 'cancel') {
        if (activeRequest?.id === message.requestId) {
            activeRequest.cancelled = true;
            activeRequest.stream?.pause();
        }
        return;
    }
    if (message.type === 'pause') {
        postMessage({ type: 'pauseUnsupported', requestId: message.requestId });
        return;
    }
    if (message.type !== 'start') {
        return;
    }

    if (activeRequest) {
        activeRequest.cancelled = true;
        activeRequest.stream?.pause();
    }
    const request = {
        id: message.requestId,
        cancelled: false,
        stream: null,
        working: null
    };
    activeRequest = request;
    runArchiveRequest(request, message);
};

function isActive(request) {
    return activeRequest === request && !request.cancelled;
}

function ensureActive(request) {
    if (!isActive(request)) {
        const error = new Error('Archive processing was cancelled.');
        error.name = 'ArchiveCancelledError';
        throw error;
    }
}

function getArchiveModule() {
    archiveModulePromise ??= import('../modules/archiveIntake.js');
    return archiveModulePromise;
}

function extractSizes(entry) {
    return {
        compressedSize: Number(entry?._data?.compressedSize) || 0,
        declaredExpandedBytes: Number(entry?._data?.uncompressedSize) || 0
    };
}

function streamEntry(request, entry, onChunk) {
    let stream;
    return new Promise((resolve, reject) => {
        try {
            stream = entry.internalStream('uint8array');
            request.stream = stream;
            stream.on('data', data => {
                try {
                    ensureActive(request);
                    onChunk(data);
                } catch (error) {
                    stream.pause();
                    reject(error);
                }
            });
            stream.on('error', reject);
            stream.on('end', resolve);
            stream.resume();
        } catch (error) {
            reject(error);
        }
    }).finally(() => {
        if (request.stream === stream) {
            request.stream = null;
        }
    });
}

async function runArchiveRequest(request, message) {
    try {
        const archiveModule = await getArchiveModule();
        ensureActive(request);
        const compressedBytes = Number(message.source?.size) || 0;
        const supportedCompressed = message.boundaries?.compressedBytes;
        if (message.overrideCapacity !== true
            && Number.isFinite(supportedCompressed)
            && compressedBytes > supportedCompressed) {
            throw new archiveModule.ArchiveCapacityError(
                'compressedBytes',
                compressedBytes,
                supportedCompressed,
                archiveModule.createArchiveCounters({ compressedBytes })
            );
        }

        postMessage({
            type: 'started',
            requestId: request.id,
            effectiveBoundaries: message.overrideCapacity === true ? {} : (message.boundaries ?? {})
        });

        let zip;
        try {
            zip = await JSZip.loadAsync(message.source, {
                createFolders: true,
                checkCRC32: true
            });
        } catch (error) {
            const reasonCode = /encrypt/i.test(error?.message ?? '')
                ? 'encrypted-entry'
                : 'invalid-archive';
            throw new archiveModule.ArchiveIntakeError(
                'Unable to read the project archive.',
                reasonCode,
                null,
                error
            );
        }
        ensureActive(request);
        request.working = zip;

        const entries = Object.values(zip.files).map(entry => ({
            ...extractSizes(entry),
            name: entry.name,
            unsafeOriginalName: entry.unsafeOriginalName,
            dir: entry.dir,
            zipEntry: entry
        }));
        const outcome = await archiveModule.processArchiveEntries(entries, {
            sourceId: message.sourceId,
            compressedBytes,
            boundaries: message.boundaries,
            comparisonsEnabled: message.overrideCapacity !== true,
            readResults: message.readResults,
            colorPalette: message.colorPalette,
            isCancelled: () => !isActive(request),
            extractEntry: (entry, onChunk) =>
                streamEntry(request, entry.zipEntry, onChunk),
            onProgress: progress => {
                if (isActive(request)) {
                    postMessage({
                        type: 'progress',
                        requestId: request.id,
                        ...progress
                    });
                }
            }
        });
        ensureActive(request);
        postMessage({
            type: 'ready',
            requestId: request.id,
            stagedProject: outcome.project,
            renderPayload: outcome.renderPayload,
            manifest: outcome.manifest,
            accounting: outcome.counters,
            commitToken: message.commitToken
        });
    } catch (error) {
        if (error.name === 'ArchiveCancelledError' || !isActive(request)) {
            postMessage({ type: 'cancelled', requestId: request.id });
        } else if (error.retryEligible === true && error.category === 'capacity') {
            postMessage({
                type: 'capacityExceeded',
                requestId: request.id,
                dimension: error.dimension,
                observed: error.observed,
                supported: error.supported,
                accounting: error.counters
            });
        } else {
            postMessage({
                type: 'failed',
                requestId: request.id,
                category: error.category ?? 'archive-integrity',
                reasonCode: error.reasonCode ?? 'archive-processing-failed',
                entryPath: error.entryPath ?? null,
                error: error.message || 'Unable to process the project archive.'
            });
        }
    } finally {
        request.stream?.pause();
        request.stream = null;
        request.working = null;
        if (activeRequest === request) {
            activeRequest = null;
        }
    }
}
