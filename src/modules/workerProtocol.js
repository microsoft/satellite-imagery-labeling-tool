(function initializeWorkerProtocol(global) {
    'use strict';

    const EVENT_TYPES = new Set([
        'started',
        'progress',
        'checkpoint',
        'paused',
        'resumed',
        'pauseUnsupported',
        'ready',
        'capacityExceeded',
        'cancelled',
        'failed',
        'unresponsive'
    ]);
    const COMMAND_TYPES = new Set(['start', 'pause', 'resume', 'cancel']);

    function requireRecord(value, name) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new TypeError(`${name} must be an object.`);
        }
        return value;
    }

    function requireString(value, name) {
        if (typeof value !== 'string' || value.trim() === '') {
            throw new TypeError(`${name} must be a non-empty string.`);
        }
        return value;
    }

    function requireCounter(value, name) {
        if (!Number.isFinite(value) || value < 0) {
            throw new TypeError(`${name} must be a finite non-negative number.`);
        }
        return value;
    }

    function requireArray(value, name) {
        if (!Array.isArray(value)) {
            throw new TypeError(`${name} must be an array.`);
        }
        return value;
    }

    function requireNonEmptyRecord(value, name) {
        const record = requireRecord(value, name);
        if (Object.keys(record).length === 0) {
            throw new TypeError(`${name} must not be empty.`);
        }
        return record;
    }

    function requireCounterRecord(value, name) {
        const record = requireNonEmptyRecord(value, name);
        for (const [counterName, counterValue] of Object.entries(record)) {
            requireString(counterName, `${name} counter name`);
            requireCounter(counterValue, `${name}.${counterName}`);
        }
        return record;
    }

    function requireStructuredPayload(value, name) {
        if (value === null || value === undefined) {
            throw new TypeError(`${name} is required.`);
        }
        if (Array.isArray(value)) {
            return value;
        }
        return requireNonEmptyRecord(value, name);
    }

    function copyCounters(counters = {}) {
        requireRecord(counters, 'progress.counters');
        const copy = {};
        for (const [name, value] of Object.entries(counters)) {
            copy[requireString(name, 'counter name')] = requireCounter(
                value,
                `progress.counters.${name}`
            );
        }
        return copy;
    }

    function validateProgress(message) {
        const completed = requireCounter(message.completed, 'progress.completed');
        const total = requireCounter(message.total, 'progress.total');
        if (completed > total) {
            throw new TypeError('progress.completed cannot exceed progress.total.');
        }
        return {
            ...message,
            type: 'progress',
            requestId: requireString(message.requestId, 'message.requestId'),
            operation: requireString(message.operation, 'progress.operation'),
            phase: requireString(message.phase, 'progress.phase'),
            unit: requireString(message.unit, 'progress.unit'),
            completed,
            total,
            counters: copyCounters(message.counters)
        };
    }

    function validateWorkerCommand(input) {
        const message = requireRecord(input, 'worker command');
        if (!COMMAND_TYPES.has(message.type)) {
            throw new TypeError(`Unsupported worker command: ${String(message.type)}.`);
        }
        requireString(message.requestId, 'message.requestId');
        return message;
    }

    function validateCheckpoint(message) {
        const checkpoint = requireRecord(message.checkpoint, `${message.type}.checkpoint`);
        requireCounter(checkpoint.byteOffset, `${message.type}.checkpoint.byteOffset`);
        requireCounter(checkpoint.recordsSeen, `${message.type}.checkpoint.recordsSeen`);
    }

    function validateDiagnostic(diagnostic) {
        const value = requireRecord(diagnostic, 'failed.diagnostic');
        requireString(value.category, 'failed.diagnostic.category');
        requireString(value.reasonCode, 'failed.diagnostic.reasonCode');
        requireCounter(value.totalCount, 'failed.diagnostic.totalCount');
        requireCounter(value.bytesScanned, 'failed.diagnostic.bytesScanned');
        for (const identifier of requireArray(
            value.sampleIdentifiers,
            'failed.diagnostic.sampleIdentifiers'
        )) {
            if (typeof identifier !== 'string') {
                throw new TypeError(
                    'failed.diagnostic.sampleIdentifiers must contain only strings.'
                );
            }
        }
        if (value.messageArguments !== undefined) {
            requireRecord(value.messageArguments, 'failed.diagnostic.messageArguments');
        }
    }

    function validateStagedResult(message) {
        const stagedResult = requireRecord(message.stagedResult, 'ready.stagedResult');
        requireString(stagedResult.kind, 'ready.stagedResult.kind');
        requireString(stagedResult.sourceId, 'ready.stagedResult.sourceId');
        requireString(stagedResult.commitToken, 'ready.stagedResult.commitToken');
        requireStructuredPayload(stagedResult.payload, 'ready.stagedResult.payload');
        requireNonEmptyRecord(stagedResult.renderPayload, 'ready.stagedResult.renderPayload');
        for (const warning of requireArray(
            stagedResult.warnings,
            'ready.stagedResult.warnings'
        )) {
            requireString(warning, 'ready.stagedResult warning');
        }
        for (const diagnostic of requireArray(
            stagedResult.diagnostics,
            'ready.stagedResult.diagnostics'
        )) {
            requireRecord(diagnostic, 'ready.stagedResult diagnostic');
        }

        const summary = requireRecord(message.summary, 'ready.summary');
        requireCounter(summary.recordsSeen, 'ready.summary.recordsSeen');
        requireCounter(summary.validCount, 'ready.summary.validCount');
        requireCounter(summary.invalidCount, 'ready.summary.invalidCount');
        requireArray(summary.invalidSamples, 'ready.summary.invalidSamples');
        requireCounterRecord(summary.counters, 'ready.summary.counters');
        requireCounter(summary.bytesRead, 'ready.summary.bytesRead');
    }

    function validateReady(message) {
        const variants = [
            message.stagedResult !== undefined,
            message.stagedProject !== undefined,
            message.data !== undefined
        ].filter(Boolean).length;
        if (variants !== 1) {
            throw new TypeError('Ready worker events require exactly one staged payload.');
        }

        if (message.stagedResult !== undefined) {
            validateStagedResult(message);
            return;
        }
        if (message.stagedProject !== undefined) {
            requireNonEmptyRecord(message.stagedProject, 'ready.stagedProject');
            requireNonEmptyRecord(message.renderPayload, 'ready.renderPayload');
            requireNonEmptyRecord(message.manifest, 'ready.manifest');
            requireCounterRecord(message.accounting, 'ready.accounting');
            requireString(message.commitToken, 'ready.commitToken');
            return;
        }

        requireArray(message.data, 'ready.data');
        requireCounterRecord(message.accounting, 'ready.accounting');
        if (message.conditionalIdentity !== undefined
            && message.conditionalIdentity !== null) {
            const identity = requireRecord(
                message.conditionalIdentity,
                'ready.conditionalIdentity'
            );
            requireString(identity.type, 'ready.conditionalIdentity.type');
            requireString(identity.value, 'ready.conditionalIdentity.value');
        }
    }

    function validateCapacityExceeded(message) {
        requireString(message.dimension, 'capacityExceeded.dimension');
        requireCounter(message.observed, 'capacityExceeded.observed');
        requireCounter(message.supported, 'capacityExceeded.supported');
        if (!Array.isArray(message.crossings) || message.crossings.length === 0) {
            throw new TypeError('capacityExceeded.crossings must be a non-empty array.');
        }
        for (const crossing of message.crossings) {
            requireRecord(crossing, 'capacity crossing');
            requireString(crossing.dimension, 'capacity crossing dimension');
            requireCounter(crossing.observed, 'capacity crossing observed');
            requireCounter(crossing.supported, 'capacity crossing supported');
        }
    }

    function validateFailure(message) {
        if (message.diagnostic !== undefined) {
            validateDiagnostic(message.diagnostic);
            return;
        }
        requireString(message.error, 'failed.error');
        if (message.category !== undefined) {
            requireString(message.category, 'failed.category');
        }
        if (message.reasonCode !== undefined) {
            requireString(message.reasonCode, 'failed.reasonCode');
        }
    }

    function validateWorkerEvent(input) {
        const message = requireRecord(input, 'worker event');
        if (!EVENT_TYPES.has(message.type)) {
            throw new TypeError(`Unsupported worker event: ${String(message.type)}.`);
        }
        requireString(message.requestId, 'message.requestId');
        switch (message.type) {
            case 'progress':
                return validateProgress(message);
            case 'started':
                requireRecord(message.effectiveBoundaries, 'started.effectiveBoundaries');
                if (message.overrideCapacity !== undefined
                    && typeof message.overrideCapacity !== 'boolean') {
                    throw new TypeError('started.overrideCapacity must be a boolean.');
                }
                break;
            case 'checkpoint':
            case 'paused':
            case 'resumed':
                validateCheckpoint(message);
                break;
            case 'ready':
                validateReady(message);
                break;
            case 'capacityExceeded':
                validateCapacityExceeded(message);
                break;
            case 'failed':
                validateFailure(message);
                break;
            default:
                break;
        }
        return message;
    }

    function createProgressReporter(options) {
        requireRecord(options, 'progress reporter options');
        const requestId = requireString(options.requestId, 'progress requestId');
        const operation = requireString(options.operation, 'progress operation');
        const unit = requireString(options.unit, 'progress unit');
        const minIntervalMs = options.minIntervalMs ?? 100;
        const maxIntervalMs = options.maxIntervalMs ?? 750;
        if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0
            || !Number.isFinite(maxIntervalMs) || maxIntervalMs < minIntervalMs
            || maxIntervalMs > 1000) {
            throw new TypeError('Progress cadence must be between 0 and 1000 milliseconds.');
        }
        if (typeof options.post !== 'function') {
            throw new TypeError('A progress post function is required.');
        }

        const now = options.now ?? (() => performance.now());
        let lastSentAt = Number.NEGATIVE_INFINITY;
        let lastCompleted = 0;
        let lastCounters = {};
        let latestMessage = null;
        let heartbeatTimer = null;
        let stopped = false;

        const scheduleHeartbeat = () => {
            clearTimeout(heartbeatTimer);
            if (!stopped && latestMessage) {
                heartbeatTimer = setTimeout(() => {
                    options.post(latestMessage);
                    lastSentAt = now();
                    scheduleHeartbeat();
                }, maxIntervalMs);
            }
        };

        return Object.freeze({
            report(detail, force = false) {
                requireRecord(detail, 'progress detail');
                const currentTime = now();
                const elapsed = currentTime - lastSentAt;
                const message = validateProgress({
                    type: 'progress',
                    requestId,
                    operation,
                    unit,
                    ...detail
                });
                latestMessage = message;
                if (message.completed < lastCompleted) {
                    throw new TypeError('Progress completion must be monotonic.');
                }
                for (const [name, value] of Object.entries(message.counters)) {
                    if (value < (lastCounters[name] ?? 0)) {
                        throw new TypeError(`Progress counter ${name} must be monotonic.`);
                    }
                }
                if (!force && elapsed < minIntervalMs && elapsed < maxIntervalMs) {
                    lastCompleted = message.completed;
                    lastCounters = { ...lastCounters, ...message.counters };
                    scheduleHeartbeat();
                    return false;
                }
                options.post(message);
                lastSentAt = currentTime;
                lastCompleted = message.completed;
                lastCounters = { ...lastCounters, ...message.counters };
                scheduleHeartbeat();
                return true;
            },
            stop() {
                stopped = true;
                clearTimeout(heartbeatTimer);
                heartbeatTimer = null;
            }
        });
    }

    function createWorkerSilenceWatchdog(options) {
        requireRecord(options, 'watchdog options');
        const timeoutMs = options.timeoutMs ?? 1000;
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 1000) {
            throw new TypeError('Worker silence timeout must be at most one second.');
        }
        if (typeof options.onSilence !== 'function') {
            throw new TypeError('A worker silence callback is required.');
        }

        let timer = null;
        let stopped = false;
        const arm = () => {
            clearTimeout(timer);
            if (!stopped) {
                timer = setTimeout(() => {
                    timer = null;
                    options.onSilence();
                }, timeoutMs);
            }
        };
        arm();
        return Object.freeze({
            touch() {
                stopped = false;
                arm();
            },
            stop() {
                stopped = true;
                clearTimeout(timer);
                timer = null;
            }
        });
    }

    global.WorkerProtocol = Object.freeze({
        createProgressReporter,
        createWorkerSilenceWatchdog,
        validateWorkerCommand,
        validateWorkerEvent
    });
})(globalThis);
