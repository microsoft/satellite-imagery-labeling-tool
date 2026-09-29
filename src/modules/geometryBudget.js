const COUNTER_NAMES = Object.freeze([
    'recordBytes',
    'jsonTokens',
    'positions',
    'rings',
    'nestingDepth',
    'maxObservedDepth',
    'renderVertices',
    'typedArrayBytes',
    'validationOperations',
    'bytesScannedBeforeRecord',
    'invalidRecordsBeforeCandidate'
]);

function createCounters() {
    return Object.fromEntries(COUNTER_NAMES.map(name => [name, 0]));
}

function validateAmount(amount) {
    if (!Number.isFinite(amount) || amount < 0) {
        throw new TypeError('Counter increments must be finite non-negative numbers.');
    }
}

export class GeometryAccounting {
    constructor(options = {}) {
        this.boundaries = Object.freeze({ ...(options.boundaries ?? {}) });
        this.comparisonsEnabled = options.comparisonsEnabled !== false;
        this.safeguard = options.safeguard ?? null;
        this.counters = createCounters();
        this.exceeded = null;
    }

    add(dimension, amount = 1) {
        if (!COUNTER_NAMES.includes(dimension)) {
            throw new TypeError(`Unknown geometry counter: ${dimension}`);
        }
        validateAmount(amount);

        this.counters[dimension] += amount;
        if (dimension === 'nestingDepth') {
            this.counters.maxObservedDepth = Math.max(
                this.counters.maxObservedDepth,
                this.counters.nestingDepth
            );
        }

        if (!this.comparisonsEnabled || this.exceeded) {
            return this.exceeded;
        }

        const supported = this.boundaries[dimension];
        if (Number.isFinite(supported) && this.counters[dimension] > supported) {
            this.exceeded = Object.freeze({
                exceeded: true,
                dimension,
                observed: this.counters[dimension],
                supported,
                counters: this.snapshot()
            });
        }

        return this.exceeded;
    }

    enterNesting() {
        return this.add('nestingDepth', 1);
    }

    leaveNesting() {
        this.counters.nestingDepth = Math.max(0, this.counters.nestingDepth - 1);
    }

    snapshot() {
        return { ...this.counters };
    }
}

export function createGeometryCounters() {
    return createCounters();
}
