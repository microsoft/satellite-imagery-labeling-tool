import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    ArchiveCancelledError,
    ArchiveCapacityError,
    ArchiveIntakeError,
    processArchiveEntries,
    validateArchiveManifest
} from '../../src/modules/archiveIntake.js';
import { unsafeArchiveManifestFixtures } from '../generators/archiveFixtures.js';

function taskDocument(name = 'task-1') {
    return {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: {
                project_name: 'Example project',
                name,
                instructions: 'Draw the visible area.',
                drawing_type: 'polygon',
                layers: {},
                primary_classes: {
                    display_name: 'Class',
                    property_name: 'class',
                    names: ['building'],
                    colors: ['#ff0000']
                }
            },
            geometry: {
                type: 'Polygon',
                coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]]
            }
        }]
    };
}

function resultDocument(taskName = 'task-1') {
    return {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: { task_name: taskName, class: 'building' },
            geometry: {
                type: 'Polygon',
                coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]]
            }
        }]
    };
}

function entry(name, document, overrides = {}) {
    const bytes = new TextEncoder().encode(JSON.stringify(document));
    return {
        name,
        declaredExpandedBytes: bytes.byteLength,
        compressedSize: Math.max(1, Math.floor(bytes.byteLength / 2)),
        bytes,
        ...overrides
    };
}

function validEntries() {
    const settings = taskDocument('project');
    delete settings.features[0].properties.name;
    return [
        entry('project/tasks/z-task.json', taskDocument('z-task')),
        entry('project/project_builder_settings.json', settings),
        entry('project/results/z-task.json', resultDocument('z-task')),
        entry('project/tasks/a-task.json', taskDocument('a-task')),
        entry('project/results/a-task.json', resultDocument('a-task'))
    ];
}

async function process(entries = validEntries(), options = {}) {
    const visited = [];
    const outcome = await processArchiveEntries(entries, {
        sourceId: 'archive-1',
        readResults: true,
        compressedBytes: 50,
        ...options,
        extractEntry: async (archiveEntry, onChunk) => {
            visited.push(archiveEntry.path);
            const midpoint = Math.max(1, Math.floor(archiveEntry.bytes.length / 2));
            onChunk(archiveEntry.bytes.slice(0, midpoint));
            onChunk(archiveEntry.bytes.slice(midpoint));
        }
    });
    return { outcome, visited };
}

test('validates and canonicalizes the complete manifest before extraction', () => {
    const manifest = validateArchiveManifest(validEntries());
    assert.equal(manifest.root, 'project/');
    assert.deepEqual(manifest.tasks.map(item => item.path), [
        'project/tasks/a-task.json',
        'project/tasks/z-task.json'
    ]);
});

test('rejects unsafe, duplicate, encrypted, and ambiguous manifest entries', () => {
    const fixtures = unsafeArchiveManifestFixtures();
    for (const entries of Object.values(fixtures).map(fixture => fixture.entries)) {
        assert.throws(() => validateArchiveManifest(entries), ArchiveIntakeError);
    }
    assert.throws(() => validateArchiveManifest([
        ...validEntries(),
        { name: 'project/secret.json', encrypted: true }
    ]), error => error.reasonCode === 'encrypted-entry' && error.retryEligible === false);
    assert.throws(() => validateArchiveManifest([
        ...validEntries(),
        { name: 'project/tasks//empty.json' }
    ]), error => error.reasonCode === 'empty-path-segment');
});

test('processes settings, tasks, and results deterministically and prepares one atomic project', async () => {
    const { outcome, visited } = await process();
    assert.deepEqual(visited, [
        'project/project_builder_settings.json',
        'project/tasks/a-task.json',
        'project/tasks/z-task.json',
        'project/results/a-task.json',
        'project/results/z-task.json'
    ]);
    assert.deepEqual(outcome.project.tasks.map(task => task.properties.name), ['a-task', 'z-task']);
    assert.equal(outcome.project.results.length, 2);
    assert.deepEqual(outcome.project.bbox, [0, 0, 1, 1]);
    assert.equal(outcome.counters.actualExpandedBytes, outcome.counters.decodedBytes);
    assert.ok(outcome.counters.validationWork > 0);
    assert.ok(outcome.counters.stagedRenderItems > 0);
});

test('rejects invalid schema and project relationships without a partial outcome', async () => {
    const entries = validEntries();
    entries.find(item => item.name.endsWith('a-task.json') && item.name.includes('results')).bytes =
        new TextEncoder().encode(JSON.stringify(resultDocument('missing-task')));

    await assert.rejects(
        process(entries),
        error => error instanceof ArchiveIntakeError
            && error.reasonCode === 'unknown-task-reference'
            && error.retryEligible === false
    );
});

test('stops before retaining a chunk that crosses the authoritative actual-expanded boundary', async () => {
    let acceptedChunks = 0;
    const entries = validEntries();
    await assert.rejects(
        processArchiveEntries(entries, {
            sourceId: 'archive-1',
            readResults: true,
            boundaries: { actualExpandedBytes: 10 },
            extractEntry: async (archiveEntry, onChunk) => {
                onChunk(archiveEntry.bytes.slice(0, 8));
                acceptedChunks++;
                onChunk(archiveEntry.bytes.slice(8, 16));
                acceptedChunks++;
            }
        }),
        error => error instanceof ArchiveCapacityError
            && error.dimension === 'actualExpandedBytes'
            && error.retryEligible === true
    );
    assert.equal(acceptedChunks, 1);
});

test('only capacity failures are retry eligible', async () => {
    await assert.rejects(
        process(validEntries(), { boundaries: { declaredExpandedBytes: 1 } }),
        error => error instanceof ArchiveCapacityError && error.retryEligible === true
    );
    await assert.rejects(
        process([entry('project/project_builder_settings.json', taskDocument('project'))]),
        error => error instanceof ArchiveIntakeError && error.retryEligible === false
    );
});

test('reports all manifest capacity dimensions crossed while equality passes', async () => {
    const entries = validEntries();
    const declaredExpandedBytes = entries.reduce(
        (total, archiveEntry) => total + archiveEntry.declaredExpandedBytes,
        0
    );

    await assert.rejects(
        process(entries, {
            boundaries: {
                entryCount: entries.length - 1,
                declaredExpandedBytes: declaredExpandedBytes - 1
            }
        }),
        error => error instanceof ArchiveCapacityError
            && error.crossings.map(crossing => crossing.dimension).join(',')
                === 'entryCount,declaredExpandedBytes'
    );

    await process(entries, {
        boundaries: {
            entryCount: entries.length,
            declaredExpandedBytes
        }
    });
});

test('observes cancellation between extraction chunks and releases the staged outcome', async () => {
    let cancelled = false;
    await assert.rejects(
        processArchiveEntries(validEntries(), {
            sourceId: 'archive-1',
            readResults: true,
            isCancelled: () => cancelled,
            extractEntry: async (archiveEntry, onChunk) => {
                onChunk(archiveEntry.bytes.slice(0, 1));
                cancelled = true;
                onChunk(archiveEntry.bytes.slice(1));
            }
        }),
        ArchiveCancelledError
    );
});
