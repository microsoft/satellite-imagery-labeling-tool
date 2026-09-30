import assert from 'node:assert/strict';
import { test } from 'node:test';
import clarinet from 'clarinet';

await import('../../src/modules/geoJsonlParser.js');

const {
    CapacityError,
    DANGEROUS_KEY_POLICY,
    IncrementalGeoJsonlParser,
    compactGeometryToGeoJson
} = globalThis.GeoJsonlParser;

function feature(geometry, properties = {}) {
    return { type: 'Feature', properties, geometry };
}

function polygon(size = 1) {
    return {
        type: 'Polygon',
        coordinates: [[[0, 0], [size, 0], [size, size], [0, 0]]]
    };
}

function parseInChunks(text, options = {}, chunkSize = 7) {
    const parser = new IncrementalGeoJsonlParser({ clarinet, ...options });
    for (let index = 0; index < text.length && !parser.stopped; index += chunkSize) {
        parser.write(text.slice(index, index + chunkSize));
    }
    return parser.finish();
}

test('uses the fail-closed dangerous-key policy', () => {
    assert.deepEqual(DANGEROUS_KEY_POLICY, {
        action: 'reject-record',
        reasonCode: 'dangerous-key'
    });
});

test('frames adjacent top-level records across arbitrary decoder chunks', () => {
    const input = [
        JSON.stringify(feature({ type: 'Point', coordinates: [1, 2] }, { text: 'a}\\n{b' })),
        JSON.stringify(feature(polygon(2)))
    ].join('\r\n');

    const result = parseInChunks(input, { mode: 'labeler' }, 3);

    assert.equal(result.recordsSeen, 2);
    assert.equal(result.validCount, 2);
    assert.equal(result.invalidCount, 0);
    assert.equal(result.features[0].properties.text, 'a}\\n{b');
});

test('builder selects and compacts the first valid Polygon or MultiPolygon Feature', () => {
    const input = [
        JSON.stringify(feature({ type: 'Point', coordinates: [1, 2] })),
        JSON.stringify(feature(polygon(3), { ignored: 'value' })),
        JSON.stringify(feature(polygon(4)))
    ].join('\n');

    const result = parseInChunks(input, { mode: 'builder' }, 5);
    const geometry = compactGeometryToGeoJson(result.candidate);

    assert.equal(result.recordsSeen, 2);
    assert.equal(result.candidate.geometryType, 'Polygon');
    assert.equal(result.candidate.positionCount, 4);
    assert.equal(result.candidate.ringCount, 1);
    assert.equal(result.candidate.renderVertexCount, 4);
    assert.deepEqual(Array.from(result.candidate.bbox), [0, 0, 3, 3]);
    assert.deepEqual(geometry, polygon(3));
    assert.equal(
        result.counters.typedArrayBytes,
        result.candidate.coordinates.byteLength
            + result.candidate.ringOffsets.byteLength
            + result.candidate.polygonOffsets.byteLength
            + result.candidate.bbox.byteLength
            + result.candidate.signedAreas.byteLength
    );
});

test('rejects bare geometry and nested FeatureCollection records', () => {
    const input = [
        JSON.stringify(polygon()),
        JSON.stringify({ type: 'FeatureCollection', features: [feature(polygon())] }),
        JSON.stringify(feature(polygon()))
    ].join('\n');

    const result = parseInChunks(input, { mode: 'labeler' });

    assert.equal(result.validCount, 1);
    assert.equal(result.invalidCount, 2);
    assert.deepEqual(
        result.invalidSamples.map(sample => sample.reasonCode),
        ['bare-geometry', 'nested-feature-collection']
    );
});

test('validates declared nesting, finite positions, ring minimum, and closure', () => {
    const records = [
        feature({ type: 'Polygon', coordinates: [[0, 0], [1, 1]] }),
        feature({ type: 'Point', coordinates: [1, 1e400] }),
        feature({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] }),
        feature({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [2, 2]]] })
    ].map(JSON.stringify).join('\n');

    const result = parseInChunks(records, { mode: 'labeler' }, 11);

    assert.equal(result.validCount, 0);
    assert.equal(result.invalidCount, 4);
    assert.deepEqual(
        result.invalidSamples.map(sample => sample.reasonCode),
        ['invalid-ring-nesting', 'non-finite-position', 'short-line', 'open-ring']
    );
});

test('rejects each dangerous-key collision as an invalid record and continues intake', () => {
    const collidingRecords = ['__proto__', 'prototype', 'constructor'].map(key =>
        `{"type":"Feature","properties":{"${key}":{"value":"inert"}},"geometry":{"type":"Point","coordinates":[0,0]}}`
    );
    const input = [
        ...collidingRecords,
        JSON.stringify(feature({ type: 'Point', coordinates: [1, 2] }, { safe: true }))
    ].join('\n');
    const result = parseInChunks(input, { mode: 'labeler' }, 4);

    assert.equal(result.validCount, 1);
    assert.equal(result.invalidCount, 3);
    assert.deepEqual(
        result.invalidSamples.map(sample => sample.reasonCode),
        ['dangerous-key', 'dangerous-key', 'dangerous-key']
    );
    assert.equal(result.features[0].properties.safe, true);
});

test('injected boundaries stop above but not at the exact value', () => {
    const record = JSON.stringify(feature(polygon()));
    const atBoundary = parseInChunks(record, {
        mode: 'builder',
        boundaries: { positions: 4 }
    });
    assert.equal(atBoundary.candidate.positionCount, 4);

    assert.throws(() => parseInChunks(record, {
        mode: 'builder',
        boundaries: { positions: 3 }
    }), error => error instanceof CapacityError
        && error.dimension === 'positions'
        && error.observed === 4
        && error.supported === 3);
});

test('capacity override disables only comparisons and retains exact counters', () => {
    const result = parseInChunks(JSON.stringify(feature(polygon())), {
        mode: 'builder',
        boundaries: { positions: 1 },
        overrideCapacity: true
    });

    assert.equal(result.candidate.positionCount, 4);
    assert.equal(result.counters.positions, 4);
});
