import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    loadValidatedTaskFromUrl,
    validateLabelerAutosave,
    validateLabelerTask
} from '../../src/modules/labelerTaskIntake.js';
import { SchemaValidationError } from '../../src/modules/schemaValidation.js';

function taskFeature() {
    return {
        type: 'Feature',
        id: 'task-1',
        properties: {
            project_name: 'Project',
            name: 'task-1',
            instructions: 'Label the image.',
            drawing_type: 'polygons',
            layers: {},
            primary_classes: {
                display_name: 'Class',
                property_name: 'class',
                names: ['building'],
                colors: ['#ff0000']
            },
            secondary_classes: {
                display_name: 'Secondary class',
                property_name: 'secondary_class',
                names: []
            }
        },
        geometry: {}
    };
}

function taskDocument() {
    return {
        type: 'FeatureCollection',
        features: [taskFeature()]
    };
}

function loadOptions(overrides = {}) {
    return {
        sourceId: 'task-url:test',
        defaultTask: taskFeature(),
        pageUrl: 'https://app.example/tools/labeler.html?mode=test',
        currentOrigin: 'https://app.example',
        reviewedOrigins: [],
        allowLocalhost: false,
        discloseTaskOrigin: async () => true,
        confirmPrivateDestination: async () => true,
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            json: async () => taskDocument()
        }),
        ...overrides
    };
}

test('resolves relative task URLs against the labeler page and blocks redirects', async () => {
    const requests = [];
    const result = await loadValidatedTaskFromUrl('../tasks/task.json', loadOptions({
        fetchImpl: async (url, init) => {
            requests.push({ url, init });
            return {
                ok: true,
                status: 200,
                json: async () => taskDocument()
            };
        }
    }));

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://app.example/tasks/task.json');
    assert.deepEqual(requests[0].init, { redirect: 'error' });
    assert.equal(result.validated.task.properties.name, 'task-1');
});

test('rejects invalid task destinations before issuing a request', async () => {
    let requestCount = 0;
    await assert.rejects(
        loadValidatedTaskFromUrl('http://remote.example/task.json', loadOptions({
            fetchImpl: async () => {
                requestCount += 1;
            }
        }))
    );
    assert.equal(requestCount, 0);
});

test('discloses a task-introduced origin once before fetching', async () => {
    let disclosureCount = 0;
    let requestCount = 0;
    await loadValidatedTaskFromUrl('https://tasks.example/task.json', loadOptions({
        discloseTaskOrigin: async decision => {
            disclosureCount += 1;
            assert.equal(decision.origin, 'https://tasks.example');
            return true;
        },
        fetchImpl: async () => {
            requestCount += 1;
            return {
                ok: true,
                status: 200,
                json: async () => taskDocument()
            };
        }
    }));

    assert.equal(disclosureCount, 1);
    assert.equal(requestCount, 1);
});

test('uses the stronger private-destination approval path before fetching', async () => {
    let ordinaryDisclosureCount = 0;
    let privateApprovalCount = 0;
    let requestCount = 0;

    const outcome = await loadValidatedTaskFromUrl(
        'https://10.0.0.7/task.json',
        loadOptions({
            discloseTaskOrigin: async () => {
                ordinaryDisclosureCount += 1;
                return true;
            },
            confirmPrivateDestination: async decision => {
                privateApprovalCount += 1;
                assert.equal(decision.addressClass, 'private-literal');
                return false;
            },
            fetchImpl: async () => {
                requestCount += 1;
            }
        })
    );

    assert.equal(ordinaryDisclosureCount, 0);
    assert.equal(privateApprovalCount, 1);
    assert.equal(requestCount, 0);
    assert.equal(outcome.status, 'declined');
    assert.equal(outcome.decision.reason, 'private-address-approval-required');
    assert.equal(outcome.decision.origin, 'https://10.0.0.7');
});

test('returns a distinct declined task outcome without issuing or remembering a request', async () => {
    let requestCount = 0;
    const outcome = await loadValidatedTaskFromUrl(
        'https://tasks.example/task.json',
        loadOptions({
            discloseTaskOrigin: async () => false,
            fetchImpl: async () => {
                requestCount += 1;
            }
        })
    );

    assert.equal(requestCount, 0);
    assert.equal(outcome.status, 'declined');
    assert.equal(outcome.decision.origin, 'https://tasks.example');
    assert.equal(outcome.decision.status, 'blocked');
});

test('validates task data before returning a staged replacement', () => {
    const current = taskFeature();
    const invalid = taskDocument();
    delete invalid.features[0].properties.name;

    assert.throws(() => validateLabelerTask(invalid, {
        sourceId: 'local-task:invalid.json',
        defaultTask: taskFeature()
    }), SchemaValidationError);
    assert.equal(current.properties.name, 'task-1');
});

test('merges compatibility defaults into a cloned validated task', () => {
    const document = taskDocument();
    delete document.features[0].properties.secondary_classes;
    const validated = validateLabelerTask(document, {
        sourceId: 'local-task:v2.json',
        defaultTask: taskFeature()
    });

    assert.deepEqual(validated.task.properties.secondary_classes.names, []);
    assert.equal(document.features[0].properties.secondary_classes, undefined);
});

test('validates autosave task relationships before returning cloned data', () => {
    const envelope = {
        timestamp: '2026-01-01T00:00:00.000Z',
        data: {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties: {
                    task_name: 'task-1',
                    class: 'building'
                },
                geometry: {
                    type: 'Polygon',
                    coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]]
                }
            }]
        }
    };
    const validated = validateLabelerAutosave(envelope, taskFeature(), {
        sourceId: 'autosave:task-1'
    });

    assert.equal(validated.data.features.length, 1);
    assert.equal(validated.date, Date.parse(envelope.timestamp));
    assert.notEqual(validated.data.features[0], envelope.data.features[0]);
});

test('rejects autosave results for another task or unknown class', () => {
    const envelope = {
        date: Date.now(),
        data: {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties: {
                    task_name: 'other-task',
                    class: 'unknown'
                },
                geometry: {
                    type: 'Point',
                    coordinates: [0, 0]
                }
            }]
        }
    };

    assert.throws(() => validateLabelerAutosave(envelope, taskFeature(), {
        sourceId: 'autosave:task-1'
    }), error =>
        error instanceof SchemaValidationError
        && error.reasonCode === 'unknown-task-reference'
    );
});
