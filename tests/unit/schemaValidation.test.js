import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    SchemaValidationError,
    assertNoDangerousKeys,
    validateProject,
    validateProjectSettings,
    validateTask,
    validateTaskResults
} from '../../src/modules/schemaValidation.js';

function validTask() {
    return {
        type: 'FeatureCollection',
        inertExtension: { retained: true },
        features: [{
            type: 'Feature',
            id: 'task-1',
            properties: {
                project_name: 'Example project',
                name: 'task-1',
                instructions: 'Draw the visible area.',
                drawing_type: 'polygons',
                layers: {},
                primary_classes: {
                    display_name: 'Class',
                    property_name: 'class',
                    names: [],
                    colors: []
                }
            },
            geometry: {
                type: 'Polygon',
                coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]]
            }
        }]
    };
}

test('validates required task fields and retains inert unknown fields', () => {
    const result = validateTask(validTask(), {
        sourceId: 'source-1',
        renderedInstruction: { safeHtml: '<p>safe</p>', status: 'unchanged' }
    });

    assert.equal(result.sourceId, 'source-1');
    assert.equal(result.document.inertExtension.retained, true);
    assert.equal(result.instructions.original, 'Draw the visible area.');
});

test('rejects missing required task fields', () => {
    const task = validTask();
    delete task.features[0].properties.name;

    assert.throws(() => validateTask(task, { sourceId: 'source-1' }), SchemaValidationError);
});

test('rejects a task whose feature id does not match its name', () => {
    const task = validTask();
    task.features[0].id = 'different-task';

    assert.throws(() => validateTask(task, {
        sourceId: 'source-1'
    }), error =>
        error instanceof SchemaValidationError
        && error.reasonCode === 'task-id-mismatch'
    );
});

test('accepts the labeler default task empty geometry', () => {
    const task = validTask();
    task.features[0].geometry = {};
    assert.doesNotThrow(() => validateTask(task, {
        sourceId: 'default-task',
        allowEmptyGeometry: true
    }));
    assert.throws(() => validateTask(task, { sourceId: 'archive-task' }));
});

test('rejects malformed and non-finite GeoJSON geometry before staging', () => {
    const missingCoordinates = validTask();
    missingCoordinates.features[0].geometry = { type: 'Point' };
    assert.throws(() => validateTask(missingCoordinates, {
        sourceId: 'invalid-point'
    }), error => error instanceof SchemaValidationError && error.reasonCode === 'invalid-geometry');

    const openRing = validTask();
    openRing.features[0].geometry.coordinates[0][3] = [2, 2];
    assert.throws(() => validateTask(openRing, {
        sourceId: 'open-ring'
    }), error => error instanceof SchemaValidationError && error.reasonCode === 'invalid-geometry');

    const nonFinite = validTask();
    nonFinite.features[0].geometry.coordinates[0][1][0] = Infinity;
    assert.throws(() => validateTask(nonFinite, {
        sourceId: 'non-finite'
    }), error => error instanceof SchemaValidationError && error.reasonCode === 'invalid-field');
});

test('validates nested GeoJSON geometry collections', () => {
    const task = validTask();
    task.features[0].geometry = {
        type: 'GeometryCollection',
        geometries: [{
            type: 'Point',
            coordinates: [0, 0]
        }, {
            type: 'GeometryCollection',
            geometries: [{
                type: 'LineString',
                coordinates: [[0, 0], [1, 1]]
            }]
        }]
    };
    assert.doesNotThrow(() => validateTask(task, { sourceId: 'geometry-collection' }));

    task.features[0].geometry.geometries[1].geometries[0] = { type: 'Point' };
    assert.throws(() => validateTask(task, {
        sourceId: 'invalid-geometry-collection'
    }), error => error instanceof SchemaValidationError && error.reasonCode === 'invalid-geometry');
});

for (const key of ['__proto__', 'prototype', 'constructor']) {
    test(`rejects recursive ${key} keys`, () => {
        const value = JSON.parse(`{"safe":{"nested":{"${key}":{"polluted":true}}}}`);
        assert.throws(() => assertNoDangerousKeys(value), error =>
            error instanceof SchemaValidationError && error.reasonCode === 'dangerous-key'
        );
    });
}

test('validates complete project relationships atomically', () => {
    const task = validTask().features[0];
    const project = validateProject({
        settings: validTask(),
        tasks: [task],
        results: [{
            type: 'Feature',
            properties: { task_name: 'task-1' },
            geometry: task.geometry
        }]
    }, { sourceId: 'archive-1' });

    assert.equal(project.tasks.length, 1);
    assert.equal(project.results.length, 1);
});

test('preserves version 2 project settings that omit the task name', () => {
    const settings = validTask();
    delete settings.features[0].properties.name;
    const validated = validateProjectSettings(settings, { sourceId: 'archive-1' });
    assert.equal(validated.area.properties.project_name, 'Example project');
});

test('rejects tasks that reference a different project', () => {
    const settings = validTask();
    delete settings.features[0].properties.name;
    const task = validTask().features[0];
    task.properties.project_name = 'Different project';

    assert.throws(() => validateProject({
        settings,
        tasks: [task],
        results: []
    }, { sourceId: 'archive-1' }), error =>
        error instanceof SchemaValidationError && error.reasonCode === 'project-name-mismatch'
    );
});

test('rejects a result whose task relationship is missing', () => {
    const task = validTask().features[0];
    assert.throws(() => validateProject({
        settings: validTask(),
        tasks: [task],
        results: [{
            type: 'Feature',
            properties: { task_name: 'unknown-task' },
            geometry: task.geometry
        }]
    }, { sourceId: 'archive-1' }), SchemaValidationError);
});

test('validates results against a single task without project settings geometry', () => {
    const task = validTask().features[0];
    task.geometry = {};
    const results = [{
        type: 'Feature',
        properties: { task_name: 'task-1' },
        geometry: {
            type: 'Point',
            coordinates: [0, 0]
        }
    }];

    assert.equal(validateTaskResults(task, results, {
        sourceId: 'autosave-1',
        allowEmptyTaskGeometry: true
    }).length, 1);
});

test('validates task layer and service relationships against project settings', () => {
    const settings = validTask();
    delete settings.features[0].properties.name;
    settings.features[0].properties.layers.imagery = {
        type: 'TileLayer',
        tileUrl: 'https://tiles.example/{z}/{x}/{y}.png'
    };
    settings.features[0].properties.customDataService = 'https://data.example/?bbox={bbox}';
    settings.features[0].properties.customDataServiceLabel = 'Add data';
    const task = validTask().features[0];
    task.properties.layers = structuredClone(settings.features[0].properties.layers);
    task.properties.customDataService = settings.features[0].properties.customDataService;
    task.properties.customDataServiceLabel = settings.features[0].properties.customDataServiceLabel;

    assert.doesNotThrow(() => validateProject({
        settings,
        tasks: [task],
        results: []
    }, { sourceId: 'archive-1' }));

    task.properties.layers.other = {
        type: 'TileLayer',
        tileUrl: 'https://other.example/{z}/{x}/{y}.png'
    };
    assert.throws(() => validateProject({
        settings,
        tasks: [task],
        results: []
    }, { sourceId: 'archive-1' }), error =>
        error instanceof SchemaValidationError && error.reasonCode === 'unknown-project-layer'
    );
});

test('rejects task layer rendering differences even when destinations match', () => {
    const settings = validTask();
    delete settings.features[0].properties.name;
    settings.features[0].properties.layers.imagery = {
        type: 'ImageLayer',
        url: 'https://images.example/a.png',
        coordinates: [[0, 1], [1, 1], [1, 0], [0, 0]],
        enabled: true
    };
    const task = validTask().features[0];
    task.properties.layers = structuredClone(settings.features[0].properties.layers);
    task.properties.layers.imagery.coordinates[0] = [40, 40];

    assert.throws(() => validateProject({ settings, tasks: [task], results: [] }, {
        sourceId: 'archive-1'
    }), error => error instanceof SchemaValidationError && error.reasonCode === 'task-layer-mismatch');
});

test('rejects mismatched task services and result class relationships', () => {
    const settings = validTask();
    delete settings.features[0].properties.name;
    settings.features[0].properties.primary_classes.names = ['building'];
    settings.features[0].properties.primary_classes.colors = ['#ff0000'];
    settings.features[0].properties.customDataService = 'https://data.example/?bbox={bbox}';
    settings.features[0].properties.customDataServiceLabel = 'Add data';
    const task = structuredClone(validTask().features[0]);
    task.properties.primary_classes = structuredClone(
        settings.features[0].properties.primary_classes
    );
    task.properties.customDataService = 'https://different.example/?bbox={bbox}';
    task.properties.customDataServiceLabel = 'Add data';

    assert.throws(() => validateProject({
        settings,
        tasks: [task],
        results: []
    }, { sourceId: 'archive-1' }), error =>
        error instanceof SchemaValidationError && error.reasonCode === 'task-service-mismatch'
    );

    task.properties.customDataService = settings.features[0].properties.customDataService;
    assert.throws(() => validateProject({
        settings,
        tasks: [task],
        results: [{
            type: 'Feature',
            properties: { task_name: 'task-1', class: 'unknown' },
            geometry: task.geometry
        }]
    }, { sourceId: 'archive-1' }), error =>
        error instanceof SchemaValidationError && error.reasonCode === 'unknown-primary-class'
    );
});
