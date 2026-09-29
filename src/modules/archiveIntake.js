import {
    SchemaValidationError,
    assertNoDangerousKeys,
    validateProject,
    validateProjectSettings,
    validateTask
} from './schemaValidation.js';

const SETTINGS_FILE = 'project_builder_settings.json';
const SUPPORTED_JSON_EXTENSION = /\.(?:geo)?json$/i;
const DRIVE_PATH = /^[a-z]:[\\/]/i;
const DEFAULT_COLOR_PALETTE = [
    '#00B0F0', '#FFC000', '#E1008D', '#fd8a5e', '#FF0000', '#4DE600',
    '#01dddd', '#757575', '#30C4E0', '#FFFF32', '#D774C4', '#C00000',
    '#00B050', '#0071FE'
];

export class ArchiveIntakeError extends Error {
    constructor(message, reasonCode, entryPath = null, cause = null) {
        super(message, cause ? { cause } : undefined);
        this.name = 'ArchiveIntakeError';
        this.category = 'archive-integrity';
        this.reasonCode = reasonCode;
        this.entryPath = entryPath;
        this.retryEligible = false;
    }
}

export class ArchiveCapacityError extends ArchiveIntakeError {
    constructor(dimension, observed, supported, counters) {
        super(
            `Archive processing exceeded the injected ${dimension} boundary.`,
            'capacity-exceeded'
        );
        this.name = 'ArchiveCapacityError';
        this.category = 'capacity';
        this.dimension = dimension;
        this.observed = observed;
        this.supported = supported;
        this.counters = Object.freeze({ ...counters });
        this.retryEligible = true;
    }
}

export class ArchiveCancelledError extends ArchiveIntakeError {
    constructor() {
        super('Archive processing was cancelled.', 'cancelled');
        this.name = 'ArchiveCancelledError';
        this.category = 'cancelled';
    }
}

export function createArchiveCounters(initial = {}) {
    return {
        compressedBytes: 0,
        entryCount: 0,
        declaredExpandedBytes: 0,
        actualExpandedBytes: 0,
        decodedBytes: 0,
        validationWork: 0,
        stagedRenderItems: 0,
        taskCount: 0,
        resultCount: 0,
        featureCount: 0,
        coordinateCount: 0,
        ...initial
    };
}

export function normalizeArchivePath(value, directory = false) {
    if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
        throw new ArchiveIntakeError('Archive entries require non-empty paths.', 'empty-path');
    }
    if (value.startsWith('/') || value.startsWith('\\') || DRIVE_PATH.test(value)) {
        throw new ArchiveIntakeError('Absolute archive paths are not supported.', 'absolute-path', value);
    }

    const slashPath = value.replaceAll('\\', '/').normalize('NFC');
    const hadTrailingSlash = slashPath.endsWith('/');
    const segments = slashPath.split('/');
    if (hadTrailingSlash) {
        segments.pop();
    }
    if (segments.length === 0 || segments.some(segment => segment === '')) {
        throw new ArchiveIntakeError('Archive paths cannot contain empty segments.', 'empty-path-segment', value);
    }
    if (segments.some(segment => segment === '..')) {
        throw new ArchiveIntakeError('Archive paths cannot traverse parent directories.', 'parent-traversal', value);
    }

    const canonicalSegments = segments.filter(segment => segment !== '.');
    if (canonicalSegments.length === 0) {
        throw new ArchiveIntakeError('Archive paths cannot canonicalize to empty.', 'empty-path', value);
    }

    return canonicalSegments.join('/') + ((directory || hadTrailingSlash) ? '/' : '');
}

function declaredSize(entry) {
    const value = entry.declaredExpandedBytes ?? entry.uncompressedSize ?? 0;
    return Number.isFinite(value) && value >= 0 ? value : 0;
}

function compressedSize(entry) {
    const value = entry.compressedSize ?? 0;
    return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function validateArchiveManifest(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
        throw new ArchiveIntakeError('The archive has no entries.', 'empty-archive');
    }

    const logicalPaths = new Map();
    const manifestEntries = entries.map((entry, index) => {
        const originalPath = entry.unsafeOriginalName
            ?? entry.originalPath
            ?? entry.name
            ?? entry.path;
        const path = normalizeArchivePath(originalPath, entry.dir === true);
        const logicalKey = path.toLocaleLowerCase('en-US');

        if (entry.encrypted === true) {
            throw new ArchiveIntakeError('Encrypted archive entries are not supported.', 'encrypted-entry', path);
        }
        if (logicalPaths.has(logicalKey)) {
            throw new ArchiveIntakeError(
                'Archive entries must have unique logical paths.',
                'duplicate-logical-path',
                path
            );
        }
        logicalPaths.set(logicalKey, path);

        return Object.freeze({
            ...entry,
            index,
            originalPath,
            path,
            dir: entry.dir === true || path.endsWith('/'),
            compressedSize: compressedSize(entry),
            declaredExpandedBytes: declaredSize(entry)
        });
    });

    const settingsCandidates = manifestEntries.filter(entry =>
        !entry.dir && entry.path.split('/').at(-1).toLocaleLowerCase('en-US') === SETTINGS_FILE
    );
    if (settingsCandidates.length !== 1) {
        throw new ArchiveIntakeError(
            'The archive must contain exactly one project settings file.',
            settingsCandidates.length === 0 ? 'missing-settings' : 'ambiguous-settings'
        );
    }

    const settings = settingsCandidates[0];
    const settingsSegments = settings.path.split('/');
    if (settingsSegments.length > 2) {
        throw new ArchiveIntakeError(
            'The project settings file may only use one common root directory.',
            'unsupported-settings-path',
            settings.path
        );
    }
    const root = settingsSegments.length === 2 ? `${settingsSegments[0]}/` : '';
    const taskPrefix = `${root}tasks/`;
    const resultPrefix = `${root}results/`;
    const tasks = manifestEntries
        .filter(entry => !entry.dir
            && entry.path.startsWith(taskPrefix)
            && SUPPORTED_JSON_EXTENSION.test(entry.path))
        .sort((left, right) => left.path.localeCompare(right.path, 'en-US'));
    const results = manifestEntries
        .filter(entry => !entry.dir
            && entry.path.startsWith(resultPrefix)
            && SUPPORTED_JSON_EXTENSION.test(entry.path))
        .sort((left, right) => left.path.localeCompare(right.path, 'en-US'));

    if (tasks.length === 0) {
        throw new ArchiveIntakeError('The archive must contain at least one task.', 'missing-tasks');
    }

    return Object.freeze({
        root,
        settings,
        tasks: Object.freeze(tasks),
        results: Object.freeze(results),
        entries: Object.freeze(
            manifestEntries.sort((left, right) => left.path.localeCompare(right.path, 'en-US'))
        )
    });
}

export function addArchiveCounter(context, dimension, amount) {
    if (!Number.isFinite(amount) || amount < 0 || !(dimension in context.counters)) {
        throw new TypeError(`Invalid archive counter update for ${dimension}.`);
    }
    const observed = context.counters[dimension] + amount;
    const supported = context.boundaries?.[dimension];
    context.counters[dimension] = observed;
    if (context.comparisonsEnabled !== false
        && Number.isFinite(supported)
        && observed > supported) {
        throw new ArchiveCapacityError(dimension, observed, supported, context.counters);
    }
    return observed;
}

function ensureActive(context) {
    if (context.isCancelled?.()) {
        throw new ArchiveCancelledError();
    }
}

async function extractText(entry, context) {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const textChunks = [];

    try {
        await context.extractEntry(entry, chunk => {
            ensureActive(context);
            const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
            addArchiveCounter(context, 'actualExpandedBytes', bytes.byteLength);
            addArchiveCounter(context, 'decodedBytes', bytes.byteLength);
            textChunks.push(decoder.decode(bytes, { stream: true }));
        });
        textChunks.push(decoder.decode());
        return textChunks.join('');
    } catch (error) {
        if (error instanceof ArchiveIntakeError) {
            throw error;
        }
        throw new ArchiveIntakeError(
            `Unable to extract ${entry.path}.`,
            'entry-extraction-failed',
            entry.path,
            error
        );
    }
}

function countValidationWork(value, context, depth = 0) {
    ensureActive(context);
    addArchiveCounter(context, 'validationWork', 1);
    if (depth > 1000) {
        throw new ArchiveIntakeError('Archive JSON nesting is unsupported.', 'excessive-json-nesting');
    }
    if (value === null || typeof value !== 'object') {
        if (typeof value === 'number') {
            addArchiveCounter(context, 'coordinateCount', 1);
        }
        return;
    }
    for (const key of Object.keys(value)) {
        countValidationWork(value[key], context, depth + 1);
    }
}

async function readJsonEntry(entry, context) {
    const text = await extractText(entry, context);
    ensureActive(context);
    let value;
    try {
        value = JSON.parse(text);
    } catch (error) {
        throw new ArchiveIntakeError(
            `Archive entry ${entry.path} is not valid JSON.`,
            'invalid-json',
            entry.path,
            error
        );
    }
    countValidationWork(value, context);
    assertNoDangerousKeys(value);
    return value;
}

function calculateBoundingBox(feature) {
    if (Array.isArray(feature.bbox) && feature.bbox.length >= 4) {
        return feature.bbox.slice(0, 4);
    }
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    const visit = value => {
        if (!Array.isArray(value)) {
            return;
        }
        if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
            bounds[0] = Math.min(bounds[0], value[0]);
            bounds[1] = Math.min(bounds[1], value[1]);
            bounds[2] = Math.max(bounds[2], value[0]);
            bounds[3] = Math.max(bounds[3], value[1]);
            return;
        }
        value.forEach(visit);
    };
    visit(feature.geometry?.coordinates);
    if (!bounds.every(Number.isFinite)) {
        throw new ArchiveIntakeError('The project area has no finite bounds.', 'invalid-project-bounds');
    }
    return bounds;
}

function deterministicColor(value) {
    let hash = 0;
    for (const character of value) {
        hash = ((hash << 5) - hash + character.codePointAt(0)) | 0;
    }
    return `#${(hash >>> 0).toString(16).padStart(8, '0').slice(0, 6)}`;
}

function prepareProject(project, colorPalette, context) {
    const taskIndex = new Map(project.tasks.map((task, index) => [task.properties.name, index]));
    const stats = {
        resultsNoTasks: 0,
        tasksNoResults: 0,
        largestLabeledTask: 0,
        primary: {},
        secondary: {}
    };

    for (const result of project.results) {
        ensureActive(context);
        const index = taskIndex.get(result.properties.task_name);
        if (index === undefined) {
            stats.resultsNoTasks++;
            continue;
        }
        const taskProperties = project.tasks[index].properties;
        taskProperties.stats ??= { numEntities: 0, primary: {}, secondary: {} };
        const taskStats = taskProperties.stats;
        taskStats.numEntities++;
        stats.largestLabeledTask = Math.max(stats.largestLabeledTask, taskStats.numEntities);
        for (const value of Object.values(result.properties)) {
            if (taskProperties.primary_classes.names.includes(value)) {
                taskStats.primary[value] = (taskStats.primary[value] ?? 0) + 1;
            } else if (taskProperties.secondary_classes?.names?.includes(value)) {
                taskStats.secondary[value] = (taskStats.secondary[value] ?? 0) + 1;
            }
        }
    }

    for (const task of project.tasks) {
        const taskStats = task.properties.stats;
        if (!taskStats?.numEntities) {
            stats.tasksNoResults++;
            continue;
        }
        for (const [name, count] of Object.entries(taskStats.primary)) {
            stats.primary[name] = (stats.primary[name] ?? 0) + count;
        }
        for (const [name, count] of Object.entries(taskStats.secondary)) {
            stats.secondary[name] = (stats.secondary[name] ?? 0) + count;
        }
    }

    const properties = project.settings.features[0].properties;
    const colors = { primary: [], secondary: [] };
    const primary = properties.primary_classes;
    if (primary.colors.length > 0) {
        colors.primary = ['match', ['get', primary.property_name]];
        primary.names.forEach((name, index) => colors.primary.push(name, primary.colors[index]));
        colors.primary.push('yellow');
    }
    const secondary = properties.secondary_classes;
    if (secondary?.names?.length > 0) {
        colors.secondary = ['match', ['get', secondary.property_name]];
        secondary.names.forEach((name, index) => {
            colors.secondary.push(name, colorPalette[index] ?? deterministicColor(name));
        });
        colors.secondary.push('yellow');
    }

    addArchiveCounter(
        context,
        'stagedRenderItems',
        project.tasks.length + project.results.length + 1
    );
    return {
        ...project,
        aoi: project.settings.features[0],
        bbox: calculateBoundingBox(project.settings.features[0]),
        stats,
        colors
    };
}

function wrapSchemaError(error, entryPath) {
    if (error instanceof SchemaValidationError) {
        return new ArchiveIntakeError(
            `Archive entry ${entryPath} does not match the version 2 schema.`,
            error.reasonCode,
            entryPath,
            error
        );
    }
    return error;
}

export async function processArchiveEntries(entries, options) {
    const context = {
        counters: createArchiveCounters({
            compressedBytes: options.compressedBytes ?? 0
        }),
        boundaries: options.boundaries ?? {},
        comparisonsEnabled: options.comparisonsEnabled !== false,
        extractEntry: options.extractEntry,
        isCancelled: options.isCancelled
    };
    if (typeof context.extractEntry !== 'function') {
        throw new TypeError('Archive extraction requires an extractEntry function.');
    }

    addArchiveCounter(context, 'compressedBytes', 0);
    const manifest = validateArchiveManifest(entries);
    addArchiveCounter(context, 'entryCount', manifest.entries.length);
    for (const entry of manifest.entries) {
        addArchiveCounter(context, 'declaredExpandedBytes', entry.declaredExpandedBytes);
    }

    const sourceId = options.sourceId;
    const settingsDocument = await readJsonEntry(manifest.settings, context);
    try {
        validateProjectSettings(settingsDocument, { sourceId });
    } catch (error) {
        throw wrapSchemaError(error, manifest.settings.path);
    }

    const tasks = [];
    for (let index = 0; index < manifest.tasks.length; index++) {
        const entry = manifest.tasks[index];
        ensureActive(context);
        const document = await readJsonEntry(entry, context);
        try {
            validateTask(document, { sourceId });
        } catch (error) {
            throw wrapSchemaError(error, entry.path);
        }
        addArchiveCounter(context, 'taskCount', 1);
        addArchiveCounter(context, 'featureCount', document.features.length);
        addArchiveCounter(context, 'stagedRenderItems', 1);
        tasks.push(document.features[0]);
        options.onProgress?.({
            phase: 'validating-tasks',
            completedEntries: index + 1,
            totalEntries: manifest.tasks.length + manifest.results.length + 1,
            counters: { ...context.counters }
        });
    }

    const results = [];
    if (options.readResults !== false) {
        for (let index = 0; index < manifest.results.length; index++) {
            const entry = manifest.results[index];
            ensureActive(context);
            const document = await readJsonEntry(entry, context);
            if (document?.type !== 'FeatureCollection' || !Array.isArray(document.features)) {
                throw new ArchiveIntakeError(
                    `Archive entry ${entry.path} must be a FeatureCollection.`,
                    'invalid-results-document',
                    entry.path
                );
            }
            assertNoDangerousKeys(document);
            for (const feature of document.features) {
                addArchiveCounter(context, 'resultCount', 1);
                addArchiveCounter(context, 'featureCount', 1);
                addArchiveCounter(context, 'stagedRenderItems', 1);
                results.push(feature);
            }
            options.onProgress?.({
                phase: 'validating-results',
                completedEntries: manifest.tasks.length + index + 1,
                totalEntries: manifest.tasks.length + manifest.results.length + 1,
                counters: { ...context.counters }
            });
        }
    }

    ensureActive(context);
    let validatedProject;
    try {
        validatedProject = validateProject({
            settings: settingsDocument,
            tasks,
            results
        }, { sourceId });
    } catch (error) {
        throw wrapSchemaError(error, 'project');
    }

    const prepared = prepareProject(
        structuredClone(validatedProject),
        options.colorPalette ?? DEFAULT_COLOR_PALETTE,
        context
    );
    options.onProgress?.({
        phase: 'ready',
        completedEntries: manifest.tasks.length + manifest.results.length + 1,
        totalEntries: manifest.tasks.length + manifest.results.length + 1,
        counters: { ...context.counters }
    });

    return Object.freeze({
        project: prepared,
        renderPayload: prepared,
        manifest: Object.freeze({
            root: manifest.root,
            entries: Object.freeze(manifest.entries.map(entry => Object.freeze({
                path: entry.path,
                compressedSize: entry.compressedSize,
                declaredExpandedBytes: entry.declaredExpandedBytes,
                directory: entry.dir
            })))
        }),
        counters: Object.freeze({ ...context.counters })
    });
}
