import { expect, test } from '@playwright/test';

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

function projectSettings() {
    const settings = taskDocument('project');
    delete settings.features[0].properties.name;
    return settings;
}

test.beforeEach(async ({ page }) => {
    await page.goto('http://127.0.0.1:4173/tests/fixtures/archiveWorker.html');
});

test('archive worker returns one validated renderer-ready project', async ({ page }) => {
    const outcome = await page.evaluate(async documents => {
        const zip = new JSZip();
        for (const [path, document] of Object.entries(documents)) {
            zip.file(path, JSON.stringify(document));
        }
        const source = await zip.generateAsync({ type: 'blob' });
        const worker = new Worker('/src/workers/ArchiveIntakeWorker.js');
        return new Promise((resolve, reject) => {
            worker.onerror = event => reject(new Error(event.message));
            worker.onmessage = event => {
                if (['ready', 'failed', 'capacityExceeded'].includes(event.data.type)) {
                    worker.terminate();
                    resolve(event.data);
                }
            };
            worker.postMessage({
                type: 'start',
                requestId: 'browser-archive-1',
                sourceId: 'browser-source-1',
                source,
                readResults: true,
                boundaries: {},
                colorPalette: ['#123456'],
                commitToken: 'browser-commit-1'
            });
        });
    }, {
        'project/project_builder_settings.json': projectSettings(),
        'project/tasks/task-1.json': taskDocument('task-1'),
        'project/results/task-1.json': {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties: { task_name: 'task-1', class: 'building' },
                geometry: taskDocument().features[0].geometry
            }]
        }
    });

    expect(outcome.type).toBe('ready');
    expect(outcome.requestId).toBe('browser-archive-1');
    expect(outcome.commitToken).toBe('browser-commit-1');
    expect(outcome.stagedProject.tasks).toHaveLength(1);
    expect(outcome.stagedProject.results).toHaveLength(1);
    expect(outcome.accounting.actualExpandedBytes).toBeGreaterThan(0);
    expect(outcome.accounting.actualExpandedBytes).toBe(outcome.accounting.decodedBytes);
});

test('archive worker exposes only capacity stops as retry eligible outcomes', async ({ page }) => {
    const outcomes = await page.evaluate(async document => {
        async function run(requestId, path, boundaries) {
            const zip = new JSZip();
            zip.file('project/project_builder_settings.json', JSON.stringify(document));
            zip.file(path, JSON.stringify(document));
            const source = await zip.generateAsync({ type: 'blob' });
            const worker = new Worker('/src/workers/ArchiveIntakeWorker.js');
            return new Promise((resolve, reject) => {
                worker.onerror = event => reject(new Error(event.message));
                worker.onmessage = event => {
                    if (['ready', 'failed', 'capacityExceeded'].includes(event.data.type)) {
                        worker.terminate();
                        resolve(event.data);
                    }
                };
                worker.postMessage({
                    type: 'start',
                    requestId,
                    sourceId: 'browser-source-2',
                    source,
                    readResults: false,
                    boundaries,
                    commitToken: `${requestId}-commit`
                });
            });
        }

        return {
            capacity: await run('capacity', 'project/tasks/task-1.json', { actualExpandedBytes: 1 }),
            validation: await run('validation', 'project/tasks/../task-1.json', {})
        };
    }, projectSettings());

    expect(outcomes.capacity.type).toBe('capacityExceeded');
    expect(outcomes.capacity.dimension).toBe('actualExpandedBytes');
    expect(outcomes.validation.type).toBe('failed');
    expect(outcomes.validation.reasonCode).not.toBe('capacity-exceeded');
});

test('project utilities commit only ready projects and allow one acknowledged capacity retry', async ({ page }) => {
    const outcome = await page.evaluate(async documents => {
        const { ProjectUtils } = await import('/src/modules/projectUtils.js');
        const zip = new JSZip();
        for (const [path, document] of Object.entries(documents)) {
            zip.file(path, JSON.stringify(document));
        }
        const source = await zip.generateAsync({ type: 'blob' });
        let confirmations = 0;
        const project = await ProjectUtils.readProjectFile(source, {
            readResults: true,
            boundaries: { actualExpandedBytes: 1 },
            confirmCapacityOverride: ({ attempt, acknowledge }) => {
                confirmations++;
                if (attempt.used) {
                    throw new Error('Capacity attempt was used before approval.');
                }
                acknowledge();
                return true;
            }
        });
        return {
            confirmations,
            taskNames: project.tasks.map(task => task.properties.name),
            resultCount: project.results.length
        };
    }, {
        'project_builder_settings.json': projectSettings(),
        'tasks/task-1.json': taskDocument('task-1'),
        'results/task-1.json': {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties: { task_name: 'task-1', class: 'building' },
                geometry: taskDocument().features[0].geometry
            }]
        }
    });

    expect(outcome.confirmations).toBe(1);
    expect(outcome.taskNames).toEqual(['task-1']);
    expect(outcome.resultCount).toBe(1);
});

test('project utilities disclose unreviewed archive origins before returning state', async ({ page }) => {
    const outcome = await page.evaluate(async documents => {
        const { ProjectUtils } = await import('/src/modules/projectUtils.js');
        const makeSource = async () => {
            const zip = new JSZip();
            for (const [path, document] of Object.entries(documents)) {
                zip.file(path, JSON.stringify(document));
            }
            return zip.generateAsync({ type: 'blob' });
        };
        let blockedReason;
        try {
            await ProjectUtils.readProjectFile(await makeSource(), false);
        } catch (error) {
            blockedReason = error.reasonCode;
        }
        const disclosed = [];
        const project = await ProjectUtils.readProjectFile(await makeSource(), false, {
            confirmDestinationOrigin: decision => {
                disclosed.push(decision.origin);
                return true;
            }
        });
        return {
            blockedReason,
            disclosed,
            decision: project.destinationDecisions[0]
        };
    }, (() => {
        const settings = projectSettings();
        settings.features[0].properties.layers.imagery = {
            type: 'TileLayer',
            tileUrl: 'https://unreviewed.example/{z}/{x}/{y}.png'
        };
        const task = taskDocument('task-1');
        task.features[0].properties.layers = structuredClone(settings.features[0].properties.layers);
        return {
            'project_builder_settings.json': settings,
            'tasks/task-1.json': task
        };
    })());

    expect(outcome.blockedReason).toBe('task-origin-approval-required');
    expect(outcome.disclosed).toEqual(['https://unreviewed.example']);
    expect(outcome.decision.status).toBe('allowed');
});

test('project utilities return a distinct declined archive outcome without committing state', async ({ page }) => {
    const outcome = await page.evaluate(async documents => {
        const { ProjectUtils } = await import('/src/modules/projectUtils.js');
        const zip = new JSZip();
        for (const [path, document] of Object.entries(documents)) {
            zip.file(path, JSON.stringify(document));
        }
        const source = await zip.generateAsync({ type: 'blob' });
        const currentState = { id: 'unchanged-project' };
        const result = await ProjectUtils.readProjectFile(source, false, {
            confirmDestinationOrigin: () => false
        });
        return {
            currentState,
            result
        };
    }, (() => {
        const settings = projectSettings();
        settings.features[0].properties.layers.imagery = {
            type: 'TileLayer',
            tileUrl: 'https://declined.example/{z}/{x}/{y}.png'
        };
        const task = taskDocument('task-1');
        task.features[0].properties.layers = structuredClone(
            settings.features[0].properties.layers
        );
        return {
            'project_builder_settings.json': settings,
            'tasks/task-1.json': task
        };
    })());

    expect(outcome.currentState.id).toBe('unchanged-project');
    expect(outcome.result.status).toBe('declined');
    expect(outcome.result.decision.origin).toBe('https://declined.example');
});

test('project utilities reject invalid relationships and destinations before returning state', async ({ page }) => {
    const outcome = await page.evaluate(async documents => {
        const { ProjectUtils } = await import('/src/modules/projectUtils.js');
        const zip = new JSZip();
        for (const [path, document] of Object.entries(documents)) {
            zip.file(path, JSON.stringify(document));
        }
        const source = await zip.generateAsync({ type: 'blob' });
        const previousState = { id: 'unchanged-project' };
        let assignedState = previousState;
        let confirmations = 0;

        try {
            assignedState = await ProjectUtils.readProjectFile(source, {
                readResults: false,
                confirmCapacityOverride: () => {
                    confirmations++;
                    return true;
                }
            });
            return { returned: true };
        } catch (error) {
            return {
                returned: false,
                reasonCode: error.reasonCode,
                stateId: assignedState.id,
                confirmations
            };
        }
    }, (() => {
        const settings = projectSettings();
        settings.features[0].properties.layers.imagery = {
            type: 'TileLayer',
            tileUrl: 'http://tiles.example/{z}/{x}/{y}.png'
        };
        const task = taskDocument('task-1');
        task.features[0].properties.layers = structuredClone(
            settings.features[0].properties.layers
        );
        return {
            'project_builder_settings.json': settings,
            'tasks/task-1.json': task
        };
    })());

    expect(outcome.returned).toBe(false);
    expect(outcome.reasonCode).toBe('scheme-not-allowed');
    expect(outcome.stateId).toBe('unchanged-project');
    expect(outcome.confirmations).toBe(0);
});

test('archive worker acknowledges pause and cancellation within one second', async ({ page }) => {
    const outcome = await page.evaluate(async document => {
        const zip = new JSZip();
        zip.file('project_builder_settings.json', JSON.stringify(document));
        for (let index = 0; index < 100; index++) {
            zip.file(`tasks/task-${index}.json`, JSON.stringify({
                ...document,
                features: [{
                    ...document.features[0],
                    properties: {
                        ...document.features[0].properties,
                        name: `task-${index}`
                    }
                }]
            }));
        }
        const source = await zip.generateAsync({ type: 'blob' });
        const worker = new Worker('/src/workers/ArchiveIntakeWorker.js');
        return new Promise((resolve, reject) => {
            let controlStarted = 0;
            let controlTimeout;
            const startupTimeout = setTimeout(() => {
                worker.terminate();
                reject(new Error('Archive worker did not start.'));
            }, 5000);
            const seen = [];
            worker.onmessage = event => {
                if (event.data.type === 'started') {
                    clearTimeout(startupTimeout);
                    controlStarted = performance.now();
                    controlTimeout = setTimeout(() => {
                        worker.terminate();
                        reject(new Error('Archive worker did not respond to controls.'));
                    }, 1000);
                    worker.postMessage({ type: 'pause', requestId: 'archive-controls' });
                } else if (event.data.type === 'pauseUnsupported') {
                    seen.push(event.data.type);
                    worker.postMessage({ type: 'cancel', requestId: 'archive-controls' });
                } else if (event.data.type === 'cancelled') {
                    seen.push(event.data.type);
                    clearTimeout(controlTimeout);
                    worker.terminate();
                    resolve({ seen, elapsed: performance.now() - controlStarted });
                }
            };
            worker.postMessage({
                type: 'start',
                requestId: 'archive-controls',
                sourceId: 'archive-source',
                source,
                readResults: false,
                boundaries: {},
                commitToken: 'archive-commit'
            });
        });
    }, projectSettings());

    expect(outcome.seen).toEqual(['pauseUnsupported', 'cancelled']);
    expect(outcome.elapsed).toBeLessThanOrEqual(1000);
});
