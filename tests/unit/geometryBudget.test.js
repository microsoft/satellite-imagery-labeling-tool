import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GeometryAccounting } from '../../src/modules/geometryBudget.js';

const dimensions = [
    'recordBytes',
    'jsonTokens',
    'positions',
    'rings',
    'nestingDepth',
    'typedArrayBytes',
    'renderVertices'
];

for (const dimension of dimensions) {
    test(`${dimension} allows below and at an injected boundary, then stops above it`, () => {
        const accounting = new GeometryAccounting({ boundaries: { [dimension]: 2 } });

        assert.equal(accounting.add(dimension, 1), null);
        assert.equal(accounting.add(dimension, 1), null);
        const result = accounting.add(dimension, 1);

        assert.equal(result.dimension, dimension);
        assert.equal(result.observed, 3);
        assert.equal(result.supported, 2);
        assert.equal(result.exceeded, true);
    });
}

test('tracks maximum nesting depth separately from current depth', () => {
    const accounting = new GeometryAccounting();
    accounting.enterNesting();
    accounting.enterNesting();
    accounting.leaveNesting();

    assert.equal(accounting.counters.nestingDepth, 1);
    assert.equal(accounting.counters.maxObservedDepth, 2);
});

test('override disables comparisons but retains counters', () => {
    const accounting = new GeometryAccounting({
        boundaries: { positions: 1 },
        comparisonsEnabled: false
    });

    assert.equal(accounting.add('positions', 3), null);
    assert.equal(accounting.counters.positions, 3);
});

test('records validation and pre-record diagnostics', () => {
    const accounting = new GeometryAccounting();
    accounting.add('validationOperations', 4);
    accounting.add('bytesScannedBeforeRecord', 100);
    accounting.add('invalidRecordsBeforeCandidate', 2);

    assert.deepEqual(accounting.snapshot(), {
        recordBytes: 0,
        jsonTokens: 0,
        positions: 0,
        rings: 0,
        nestingDepth: 0,
        maxObservedDepth: 0,
        renderVertices: 0,
        typedArrayBytes: 0,
        validationOperations: 4,
        bytesScannedBeforeRecord: 100,
        invalidRecordsBeforeCandidate: 2
    });
});

test('reports every crossed configured dimension while equality still passes', () => {
    const accounting = new GeometryAccounting({
        boundaries: {
            positions: 2,
            rings: 1,
            renderVertices: 3
        }
    });

    accounting.add('positions', 2);
    accounting.add('rings', 1);
    accounting.add('renderVertices', 3);
    assert.equal(accounting.exceeded, null);

    accounting.add('positions', 1);
    accounting.add('rings', 1);
    const result = accounting.add('renderVertices', 1);

    assert.deepEqual(
        result.crossings.map(crossing => crossing.dimension),
        ['positions', 'rings', 'renderVertices']
    );
});
