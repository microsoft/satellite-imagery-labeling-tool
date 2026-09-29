import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateProjectForUse } from '../../src/modules/projectUtils.js';
import { SchemaValidationError } from '../../src/modules/schemaValidation.js';

function projectWithLayer(layer, service = null) {
    const properties = {
        project_name: 'Example project',
        instructions: '',
        drawing_type: 'polygon',
        layers: { imagery: layer },
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
        },
        customDataService: service,
        customDataServiceLabel: service ? 'Add data' : null
    };
    const taskProperties = {
        ...structuredClone(properties),
        name: 'task-1'
    };
    return {
        sourceId: 'archive-1',
        settings: {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties,
                geometry: {
                    type: 'Polygon',
                    coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]]
                }
            }]
        },
        tasks: [{
            type: 'Feature',
            id: 'task-1',
            properties: taskProperties,
            geometry: {
                type: 'Polygon',
                coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]]
            }
        }],
        results: []
    };
}

const destinationOptions = {
    pageUrl: 'https://app.example/src/projectViewer.html',
    currentOrigin: 'https://app.example',
    reviewedOrigins: ['https://tiles.example', 'https://data.example']
};

test('validates layer and service destinations before returning project state', () => {
    const project = validateProjectForUse(projectWithLayer({
        type: 'TileLayer',
        tileUrl: 'https://tiles.example/{z}/{x}/{y}.png'
    }, 'https://data.example/features?bbox={bbox}'), destinationOptions);

    assert.equal(project.destinationDecisions.length, 2);
    assert.equal(project.destinationDecisions.every(item => item.status === 'allowed'), true);
    assert.equal(project.tasks[0].properties.name, 'task-1');
});

test('preserves relative and embedded version 2 image destinations', () => {
    const relative = validateProjectForUse(projectWithLayer({
        type: 'ImageLayer',
        url: './images/example.png',
        coordinates: [[0, 1], [1, 1], [1, 0], [0, 0]]
    }), destinationOptions);
    assert.equal(
        relative.destinationDecisions[0].resolvedUrl,
        'https://app.example/src/images/example.png'
    );

    const embedded = validateProjectForUse(projectWithLayer({
        type: 'ImageLayer',
        url: 'data:image/png;base64,AA==',
        coordinates: [[0, 1], [1, 1], [1, 0], [0, 0]]
    }), destinationOptions);
    assert.equal(embedded.destinationDecisions[0].embedded, true);
});

test('rejects unreviewed project origins until explicitly approved', () => {
    assert.throws(() => validateProjectForUse(projectWithLayer({
        type: 'TileLayer',
        tileUrl: 'https://unreviewed.example/{z}/{x}/{y}.png'
    }), destinationOptions), error =>
        error instanceof SchemaValidationError
            && error.reasonCode === 'task-origin-approval-required'
            && error.destinationDecision.origin === 'https://unreviewed.example'
    );

    const approved = validateProjectForUse(projectWithLayer({
        type: 'TileLayer',
        tileUrl: 'https://unreviewed.example/{z}/{x}/{y}.png'
    }), {
        ...destinationOptions,
        approvedOrigins: ['https://unreviewed.example']
    });
    assert.equal(approved.destinationDecisions[0].status, 'allowed');
});

test('rejects blocked layer or custom-service destinations before state is returned', () => {
    assert.throws(() => validateProjectForUse(projectWithLayer({
        type: 'TileLayer',
        tileUrl: 'http://tiles.example/{z}/{x}/{y}.png'
    }), destinationOptions), error =>
        error instanceof SchemaValidationError && error.reasonCode === 'scheme-not-allowed'
    );

    assert.throws(() => validateProjectForUse(projectWithLayer({
        type: 'TileLayer',
        tileUrl: 'https://tiles.example/{z}/{x}/{y}.png'
    }, 'https://192.168.1.10/features?bbox={bbox}'), destinationOptions), error =>
        error instanceof SchemaValidationError
            && error.reasonCode === 'private-address-approval-required'
    );
});
