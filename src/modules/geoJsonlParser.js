(function initializeGeoJsonlParser(global) {
    'use strict';

    const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
    const SAMPLE_LIMIT = 5;
    const COUNTER_NAMES = [
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
    ];

    class GeoJsonlParseError extends Error {
        constructor(reasonCode, message, recordNumber) {
            super(message);
            this.name = 'GeoJsonlParseError';
            this.reasonCode = reasonCode;
            this.recordNumber = recordNumber;
        }
    }

    class CapacityError extends Error {
        constructor(result) {
            super(`The ${result.dimension} boundary was exceeded.`);
            this.name = 'CapacityError';
            Object.assign(this, result);
        }
    }

    function createCounters() {
        return Object.fromEntries(COUNTER_NAMES.map(name => [name, 0]));
    }

    function utf8ByteLength(value) {
        if (typeof TextEncoder === 'function') {
            return new TextEncoder().encode(value).byteLength;
        }

        return unescape(encodeURIComponent(value)).length;
    }

    function cloneJsonValue(value) {
        if (typeof structuredClone === 'function') {
            return structuredClone(value);
        }

        return JSON.parse(JSON.stringify(value));
    }

    function samePosition(first, last) {
        return first.length === last.length
            && first.every((value, index) => value === last[index]);
    }

    class Accounting {
        constructor(boundaries, comparisonsEnabled) {
            this.boundaries = { ...(boundaries || {}) };
            this.comparisonsEnabled = comparisonsEnabled !== false;
            this.counters = createCounters();
        }

        resetRecordBytes() {
            this.counters.recordBytes = 0;
        }

        add(dimension, amount = 1) {
            if (!COUNTER_NAMES.includes(dimension)
                || !Number.isFinite(amount)
                || amount < 0) {
                throw new TypeError(`Invalid geometry counter update: ${dimension}.`);
            }

            this.counters[dimension] += amount;
            if (dimension === 'nestingDepth') {
                this.counters.maxObservedDepth = Math.max(
                    this.counters.maxObservedDepth,
                    this.counters.nestingDepth
                );
            }

            const supported = this.boundaries[dimension];
            if (this.comparisonsEnabled
                && Number.isFinite(supported)
                && this.counters[dimension] > supported) {
                throw new CapacityError({
                    dimension,
                    observed: this.counters[dimension],
                    supported,
                    counters: this.snapshot()
                });
            }
        }

        leaveNesting() {
            this.counters.nestingDepth = Math.max(0, this.counters.nestingDepth - 1);
        }

        snapshot() {
            return { ...this.counters };
        }
    }

    function requireArray(value, reasonCode, message, recordNumber) {
        if (!Array.isArray(value)) {
            throw new GeoJsonlParseError(reasonCode, message, recordNumber);
        }
    }

    function validatePosition(position, accounting, recordNumber) {
        requireArray(
            position,
            'invalid-position',
            'Every position must be an array.',
            recordNumber
        );
        if (position.length < 2 || position.some(value => !Number.isFinite(value))) {
            throw new GeoJsonlParseError(
                'non-finite-position',
                'Every position must contain at least two finite numbers.',
                recordNumber
            );
        }
        accounting.add('validationOperations');
        accounting.add('positions');
    }

    function validateLine(line, accounting, recordNumber, minimum = 2) {
        requireArray(line, 'invalid-line', 'A line must be an array of positions.', recordNumber);
        if (line.length < minimum) {
            throw new GeoJsonlParseError(
                'short-line',
                `A line must contain at least ${minimum} positions.`,
                recordNumber
            );
        }
        line.forEach(position => validatePosition(position, accounting, recordNumber));
    }

    function validateRing(ring, accounting, recordNumber) {
        accounting.add('rings');
        if (!Array.isArray(ring) || ring.some(position => !Array.isArray(position))) {
            throw new GeoJsonlParseError(
                'invalid-ring-nesting',
                'Polygon coordinates must be nested as arrays of positions.',
                recordNumber
            );
        }
        validateLine(ring, accounting, recordNumber, 4);
        if (!samePosition(ring[0], ring[ring.length - 1])) {
            throw new GeoJsonlParseError(
                'open-ring',
                'Polygon rings must be structurally closed.',
                recordNumber
            );
        }
    }

    function validateGeometry(geometry, accounting, recordNumber) {
        if (!geometry || typeof geometry !== 'object' || Array.isArray(geometry)) {
            throw new GeoJsonlParseError(
                'invalid-geometry',
                'A Feature must contain a geometry object.',
                recordNumber
            );
        }

        const coordinates = geometry.coordinates;
        switch (geometry.type) {
            case 'Point':
                validatePosition(coordinates, accounting, recordNumber);
                break;
            case 'MultiPoint':
                requireArray(coordinates, 'invalid-multipoint', 'MultiPoint coordinates must be an array.', recordNumber);
                coordinates.forEach(position => validatePosition(position, accounting, recordNumber));
                break;
            case 'LineString':
                validateLine(coordinates, accounting, recordNumber);
                break;
            case 'MultiLineString':
                requireArray(coordinates, 'invalid-multiline', 'MultiLineString coordinates must be an array.', recordNumber);
                coordinates.forEach(line => validateLine(line, accounting, recordNumber));
                break;
            case 'Polygon':
                requireArray(coordinates, 'invalid-polygon', 'Polygon coordinates must be an array of rings.', recordNumber);
                if (coordinates.length === 0) {
                    throw new GeoJsonlParseError('empty-polygon', 'A Polygon must contain a ring.', recordNumber);
                }
                coordinates.forEach(ring => validateRing(ring, accounting, recordNumber));
                break;
            case 'MultiPolygon':
                requireArray(coordinates, 'invalid-multipolygon', 'MultiPolygon coordinates must be an array of polygons.', recordNumber);
                if (coordinates.length === 0) {
                    throw new GeoJsonlParseError('empty-multipolygon', 'A MultiPolygon must contain a polygon.', recordNumber);
                }
                coordinates.forEach(polygon => {
                    requireArray(polygon, 'invalid-polygon', 'A MultiPolygon member must be an array of rings.', recordNumber);
                    if (polygon.length === 0) {
                        throw new GeoJsonlParseError('empty-polygon', 'A MultiPolygon member must contain a ring.', recordNumber);
                    }
                    polygon.forEach(ring => validateRing(ring, accounting, recordNumber));
                });
                break;
            default:
                throw new GeoJsonlParseError(
                    'unsupported-geometry',
                    `Unsupported Feature geometry type: ${String(geometry.type)}.`,
                    recordNumber
                );
        }
    }

    function compactPolygonGeometry(geometry, accounting, recordNumber) {
        const polygons = geometry.type === 'Polygon'
            ? [geometry.coordinates]
            : geometry.coordinates;
        const flatCoordinates = [];
        const ringOffsets = [0];
        const polygonOffsets = [0];
        const signedAreas = [];
        const bbox = [Infinity, Infinity, -Infinity, -Infinity];
        let ringCount = 0;
        let positionCount = 0;

        polygons.forEach(polygon => {
            polygon.forEach(ring => {
                let twiceArea = 0;
                for (let index = 0; index < ring.length; index++) {
                    const position = ring[index];
                    const x = position[0];
                    const y = position[1];
                    flatCoordinates.push(x, y);
                    bbox[0] = Math.min(bbox[0], x);
                    bbox[1] = Math.min(bbox[1], y);
                    bbox[2] = Math.max(bbox[2], x);
                    bbox[3] = Math.max(bbox[3], y);
                    if (index > 0) {
                        const previous = ring[index - 1];
                        twiceArea += (previous[0] * y) - (x * previous[1]);
                    }
                }
                positionCount += ring.length;
                ringCount += 1;
                ringOffsets.push(positionCount);
                signedAreas.push(twiceArea / 2);
            });
            polygonOffsets.push(ringCount);
        });

        const typedArrayBytes = (flatCoordinates.length * Float64Array.BYTES_PER_ELEMENT)
            + (ringOffsets.length * Uint32Array.BYTES_PER_ELEMENT)
            + (polygonOffsets.length * Uint32Array.BYTES_PER_ELEMENT)
            + (bbox.length * Float64Array.BYTES_PER_ELEMENT)
            + (signedAreas.length * Float64Array.BYTES_PER_ELEMENT);
        accounting.add('typedArrayBytes', typedArrayBytes);
        accounting.add('renderVertices', positionCount);
        accounting.add('validationOperations', positionCount + ringCount + polygons.length);

        const compact = {
            geometryType: geometry.type,
            coordinates: new Float64Array(flatCoordinates),
            ringOffsets: new Uint32Array(ringOffsets),
            polygonOffsets: new Uint32Array(polygonOffsets),
            bbox: new Float64Array(bbox),
            signedAreas: new Float64Array(signedAreas),
            positionCount,
            ringCount,
            renderVertexCount: positionCount
        };

        compact.rendererPayload = {
            geometryType: compact.geometryType,
            coordinates: compact.coordinates,
            ringOffsets: compact.ringOffsets,
            polygonOffsets: compact.polygonOffsets,
            bbox: compact.bbox,
            positionCount: compact.positionCount,
            ringCount: compact.ringCount,
            renderVertexCount: compact.renderVertexCount
        };
        return compact;
    }

    function validateFeatureRecord(record, accounting, recordNumber, compactPolygons) {
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
            throw new GeoJsonlParseError(
                'record-not-object',
                'Each GeoJSONL record must be an object.',
                recordNumber
            );
        }
        if (record.type === 'FeatureCollection') {
            throw new GeoJsonlParseError(
                'nested-feature-collection',
                'FeatureCollection records are not accepted in GeoJSONL intake.',
                recordNumber
            );
        }
        if (record.type !== 'Feature') {
            throw new GeoJsonlParseError(
                'bare-geometry',
                'Each GeoJSONL record must be a Feature.',
                recordNumber
            );
        }

        if (record.properties === undefined || record.properties === null) {
            record.properties = {};
        } else if (typeof record.properties !== 'object' || Array.isArray(record.properties)) {
            throw new GeoJsonlParseError(
                'invalid-properties',
                'Feature properties must be an object or null.',
                recordNumber
            );
        }

        validateGeometry(record.geometry, accounting, recordNumber);
        const compactGeometry = compactPolygons
            && (record.geometry.type === 'Polygon' || record.geometry.type === 'MultiPolygon')
            ? compactPolygonGeometry(record.geometry, accounting, recordNumber)
            : null;

        return {
            feature: record,
            compactGeometry
        };
    }

    class ClarinetRecordBuilder {
        constructor(clarinetApi, accounting, recordNumber) {
            if (!clarinetApi || typeof clarinetApi.parser !== 'function') {
                throw new TypeError('A Clarinet parser implementation is required.');
            }
            this.accounting = accounting;
            this.recordNumber = recordNumber;
            this.stack = [];
            this.root = undefined;
            this.error = null;
            this.parser = clarinetApi.parser();
            this.configure();
        }

        configure() {
            const token = () => this.accounting.add('jsonTokens');
            const rejectKey = key => {
                if (DANGEROUS_KEYS.has(key)) {
                    throw new GeoJsonlParseError(
                        'dangerous-key',
                        `The key ${key} is not allowed.`,
                        this.recordNumber
                    );
                }
            };
            const append = value => {
                if (this.stack.length === 0) {
                    this.root = value;
                    return;
                }
                const parent = this.stack[this.stack.length - 1];
                if (parent.type === 'array') {
                    parent.value.push(value);
                } else {
                    const key = parent.key;
                    if (key === null) {
                        throw new GeoJsonlParseError(
                            'invalid-object-state',
                            'An object value was missing its key.',
                            this.recordNumber
                        );
                    }
                    rejectKey(key);
                    Object.defineProperty(parent.value, key, {
                        configurable: true,
                        enumerable: true,
                        writable: true,
                        value
                    });
                    parent.key = null;
                }
            };

            this.parser.onopenobject = firstKey => {
                token();
                this.accounting.add('nestingDepth');
                const value = {};
                append(value);
                if (firstKey !== undefined) {
                    rejectKey(firstKey);
                }
                this.stack.push({
                    type: 'object',
                    value,
                    key: firstKey === undefined ? null : firstKey
                });
            };
            this.parser.onkey = key => {
                token();
                rejectKey(key);
                this.stack[this.stack.length - 1].key = key;
            };
            this.parser.oncloseobject = () => {
                token();
                this.stack.pop();
                this.accounting.leaveNesting();
            };
            this.parser.onopenarray = () => {
                token();
                this.accounting.add('nestingDepth');
                const value = [];
                append(value);
                this.stack.push({ type: 'array', value, key: null });
            };
            this.parser.onclosearray = () => {
                token();
                this.stack.pop();
                this.accounting.leaveNesting();
            };
            this.parser.onvalue = value => {
                token();
                append(value);
            };
            this.parser.onerror = error => {
                this.error = new GeoJsonlParseError(
                    'invalid-json',
                    error.message,
                    this.recordNumber
                );
            };
        }

        write(value) {
            if (!this.error) {
                try {
                    this.parser.write(value);
                } catch (error) {
                    this.error = error instanceof CapacityError || error instanceof GeoJsonlParseError
                        ? error
                        : new GeoJsonlParseError('invalid-json', error.message, this.recordNumber);
                }
            }
        }

        finish() {
            if (!this.error) {
                try {
                    this.parser.close();
                } catch (error) {
                    this.error = error instanceof CapacityError || error instanceof GeoJsonlParseError
                        ? error
                        : new GeoJsonlParseError('invalid-json', error.message, this.recordNumber);
                }
            }
            if (this.error) {
                throw this.error;
            }
            return this.root;
        }
    }

    class IncrementalGeoJsonlParser {
        constructor(options = {}) {
            this.options = options;
            this.clarinet = options.clarinet;
            this.mode = options.mode === 'builder' ? 'builder' : 'labeler';
            this.materializeProperties = this.mode !== 'builder';
            this.accounting = new Accounting(
                options.boundaries,
                options.overrideCapacity !== true
            );
            this.recordBuilder = null;
            this.recordNumber = 0;
            this.recordsSeen = 0;
            this.validFeatures = [];
            this.candidate = null;
            this.invalidCount = 0;
            this.invalidSamples = [];
            this.bytesRead = 0;
            this.started = false;
            this.scalar = false;
            this.depth = 0;
            this.inString = false;
            this.escape = false;
            this.stopped = false;
        }

        startRecord(firstCharacter) {
            this.recordNumber += 1;
            this.accounting.resetRecordBytes();
            this.recordBuilder = new ClarinetRecordBuilder(
                this.clarinet,
                this.accounting,
                this.recordNumber
            );
            this.started = true;
            this.scalar = firstCharacter !== '{' && firstCharacter !== '[';
            this.depth = this.scalar ? 0 : 1;
            this.inString = firstCharacter === '"';
            this.escape = false;
        }

        writeRecordSegment(segment) {
            const byteLength = utf8ByteLength(segment);
            this.bytesRead += byteLength;
            this.accounting.add('recordBytes', byteLength);
            this.recordBuilder.write(segment);
        }

        addInvalid(error) {
            this.invalidCount += 1;
            if (this.invalidSamples.length < SAMPLE_LIMIT) {
                this.invalidSamples.push({
                    recordNumber: this.recordNumber,
                    reasonCode: error.reasonCode || 'invalid-record',
                    message: error.message
                });
            }
            if (!this.candidate) {
                this.accounting.add('invalidRecordsBeforeCandidate');
            }
        }

        finishRecord() {
            this.recordsSeen += 1;
            try {
                const record = this.recordBuilder.finish();
                if (!this.materializeProperties && record && record.type === 'Feature') {
                    record.properties = {};
                }
                const validated = validateFeatureRecord(
                    record,
                    this.accounting,
                    this.recordNumber,
                    this.mode === 'builder'
                );
                if (this.mode === 'builder') {
                    if (validated.compactGeometry) {
                        this.candidate = validated.compactGeometry;
                        this.stopped = true;
                    }
                } else {
                    this.validFeatures.push(cloneJsonValue(validated.feature));
                }
            } catch (error) {
                if (error instanceof CapacityError) {
                    throw error;
                }
                this.addInvalid(error);
            } finally {
                this.recordBuilder = null;
                this.started = false;
                this.scalar = false;
                this.depth = 0;
                this.inString = false;
                this.escape = false;
                this.accounting.counters.nestingDepth = 0;
            }
        }

        write(text) {
            if (this.stopped || typeof text !== 'string' || text.length === 0) {
                return;
            }

            let segmentStart = 0;
            for (let index = 0; index < text.length && !this.stopped; index++) {
                const character = text[index];
                let startedNow = false;
                if (!this.started) {
                    if (/\s/.test(character)) {
                        const byteLength = utf8ByteLength(character);
                        this.bytesRead += byteLength;
                        this.accounting.add('bytesScannedBeforeRecord', byteLength);
                        segmentStart = index + 1;
                        continue;
                    }
                    this.startRecord(character);
                    segmentStart = index;
                    startedNow = true;
                }

                if (this.scalar) {
                    if (startedNow && character === '"') {
                        continue;
                    }
                    if (!this.inString && /\s/.test(character)) {
                        if (index > segmentStart) {
                            this.writeRecordSegment(text.slice(segmentStart, index));
                        }
                        this.finishRecord();
                        segmentStart = index + 1;
                    } else if (this.inString) {
                        if (this.escape) {
                            this.escape = false;
                        } else if (character === '\\') {
                            this.escape = true;
                        } else if (character === '"') {
                            this.inString = false;
                        }
                    }
                    continue;
                }

                if (this.inString) {
                    if (this.escape) {
                        this.escape = false;
                    } else if (character === '\\') {
                        this.escape = true;
                    } else if (character === '"') {
                        this.inString = false;
                    }
                    continue;
                }

                if ((character === '\n' || character === '\r') && !this.scalar) {
                    this.writeRecordSegment(text.slice(segmentStart, index + 1));
                    segmentStart = index + 1;
                    if (this.recordBuilder.error) {
                        this.finishRecord();
                    }
                    continue;
                }

                if (character === '"') {
                    this.inString = true;
                } else if (character === '{' || character === '[') {
                    if (!startedNow) {
                        this.depth += 1;
                    }
                } else if (character === '}' || character === ']') {
                    this.depth -= 1;
                    if (this.depth === 0) {
                        this.writeRecordSegment(text.slice(segmentStart, index + 1));
                        this.finishRecord();
                        segmentStart = index + 1;
                    }
                }
            }

            if (this.started && segmentStart < text.length && !this.stopped) {
                this.writeRecordSegment(text.slice(segmentStart));
            }
        }

        finish() {
            if (this.started && !this.stopped) {
                this.finishRecord();
            }

            return {
                mode: this.mode,
                recordsSeen: this.recordsSeen,
                validCount: this.mode === 'builder'
                    ? (this.candidate ? 1 : 0)
                    : this.validFeatures.length,
                invalidCount: this.invalidCount,
                invalidSamples: this.invalidSamples.slice(),
                features: this.validFeatures,
                candidate: this.candidate,
                counters: this.accounting.snapshot(),
                bytesRead: this.bytesRead
            };
        }
    }

    function compactGeometryToGeoJson(compact) {
        if (!compact
            || !(compact.coordinates instanceof Float64Array)
            || !(compact.ringOffsets instanceof Uint32Array)
            || !(compact.polygonOffsets instanceof Uint32Array)) {
            throw new TypeError('A valid CompactGeometry is required.');
        }

        const rings = [];
        for (let ringIndex = 0; ringIndex < compact.ringOffsets.length - 1; ringIndex++) {
            const ring = [];
            const start = compact.ringOffsets[ringIndex];
            const end = compact.ringOffsets[ringIndex + 1];
            for (let positionIndex = start; positionIndex < end; positionIndex++) {
                ring.push([
                    compact.coordinates[positionIndex * 2],
                    compact.coordinates[(positionIndex * 2) + 1]
                ]);
            }
            rings.push(ring);
        }

        if (compact.geometryType === 'Polygon') {
            return { type: 'Polygon', coordinates: rings };
        }
        if (compact.geometryType !== 'MultiPolygon') {
            throw new TypeError('Unsupported compact geometry type.');
        }

        const polygons = [];
        for (let polygonIndex = 0; polygonIndex < compact.polygonOffsets.length - 1; polygonIndex++) {
            polygons.push(rings.slice(
                compact.polygonOffsets[polygonIndex],
                compact.polygonOffsets[polygonIndex + 1]
            ));
        }
        return { type: 'MultiPolygon', coordinates: polygons };
    }

    global.GeoJsonlParser = Object.freeze({
        CapacityError,
        GeoJsonlParseError,
        IncrementalGeoJsonlParser,
        compactGeometryToGeoJson
    });
})(globalThis);
