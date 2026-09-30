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
        this.crossings = new Map();
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

        if (!this.comparisonsEnabled) {
            return this.exceeded;
        }

        const supported = this.boundaries[dimension];
        if (Number.isFinite(supported) && this.counters[dimension] > supported) {
            this.crossings.set(dimension, Object.freeze({
                dimension,
                observed: this.counters[dimension],
                supported
            }));
            this.exceeded = Object.freeze({
                exceeded: true,
                dimension: this.crossings.values().next().value.dimension,
                observed: this.crossings.values().next().value.observed,
                supported: this.crossings.values().next().value.supported,
                crossings: Object.freeze([...this.crossings.values()]),
                counters: this.snapshot()
            });
        } else if (this.crossings.size > 0) {
            this.exceeded = Object.freeze({
                ...this.exceeded,
                crossings: Object.freeze([...this.crossings.values()]),
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
