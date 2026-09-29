import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createWorkflowDestinationDecision } from '../../src/modules/remoteDestination.js';

const common = {
    pageUrl: 'https://app.example/src/labeler.html',
    taskUrl: 'https://tasks.example/jobs/task-1.geojson',
    projectUrl: 'https://projects.example/project/settings.json',
    currentOrigin: 'https://app.example'
};

test('preserves workflow-specific relative URL bases', () => {
    assert.equal(
        createWorkflowDestinationDecision('./default.json', {
            ...common,
            workflow: 'page'
        }).resolvedUrl,
        'https://app.example/src/default.json'
    );
    assert.equal(
        createWorkflowDestinationDecision('../tiles/a.json', {
            ...common,
            workflow: 'task'
        }).resolvedUrl,
        'https://tasks.example/tiles/a.json'
    );
    assert.equal(
        createWorkflowDestinationDecision('./tasks/task-2.geojson', {
            ...common,
            workflow: 'project'
        }).resolvedUrl,
        'https://projects.example/project/tasks/task-2.geojson'
    );
    assert.equal(
        createWorkflowDestinationDecision('./custom?bbox={bbox}', {
            ...common,
            workflow: 'service',
            allowedPlaceholders: ['bbox']
        }).resolvedUrl,
        'https://tasks.example/jobs/custom?bbox=template-value'
    );
});

test('rejects ambiguous relative references and missing workflow bases', () => {
    assert.equal(
        createWorkflowDestinationDecision('//other.example/data', {
            ...common,
            workflow: 'task'
        }).reason,
        'ambiguous-relative-url'
    );
    assert.equal(
        createWorkflowDestinationDecision('..\\data.json', {
            ...common,
            workflow: 'task'
        }).reason,
        'ambiguous-relative-url'
    );
    assert.equal(
        createWorkflowDestinationDecision('task.json', {
            workflow: 'page',
            currentOrigin: 'https://app.example'
        }).reason,
        'missing-workflow-base'
    );
});
