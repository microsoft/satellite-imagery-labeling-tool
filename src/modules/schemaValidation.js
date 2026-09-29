const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const LAYER_TYPES = new Set(['TileLayer', 'ImageLayer', 'OgcMapLayer']);

export class SchemaValidationError extends Error {
    constructor(message, reasonCode = 'invalid-schema', path = '$') {
        super(message);
        this.name = 'SchemaValidationError';
        this.reasonCode = reasonCode;
        this.path = path;
    }
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value, path) {
    if (!isRecord(value)) {
        throw new SchemaValidationError(`${path} must be an object.`, 'invalid-type', path);
    }
}

function requireString(value, path, allowEmpty = false) {
    if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
        throw new SchemaValidationError(`${path} must be a non-empty string.`, 'invalid-field', path);
    }
}

function requireBoolean(value, path) {
    if (typeof value !== 'boolean') {
        throw new SchemaValidationError(`${path} must be a boolean.`, 'invalid-field', path);
    }
}

function requireFiniteNumber(value, path) {
    if (!Number.isFinite(value)) {
        throw new SchemaValidationError(`${path} must be a finite number.`, 'invalid-field', path);
    }
}

function cloneValue(value) {
    return typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
}

export function assertNoDangerousKeys(value, path = '$', seen = new Set()) {
    if (value === null || typeof value !== 'object') {
        return;
    }

    if (seen.has(value)) {
        throw new SchemaValidationError('Cyclic input is not supported.', 'cyclic-input', path);
    }
    seen.add(value);

    for (const key of Object.keys(value)) {
        const childPath = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`;
        if (DANGEROUS_KEYS.has(key)) {
            throw new SchemaValidationError(
                `The field ${childPath} is not allowed.`,
                'dangerous-key',
                childPath
            );
        }
        assertNoDangerousKeys(value[key], childPath, seen);
    }

    seen.delete(value);
}

function validateBounds(value, path) {
    if (!Array.isArray(value) || value.length !== 4) {
        throw new SchemaValidationError(`${path} must contain four values.`, 'invalid-layer-bounds', path);
    }
    value.forEach((coordinate, index) => requireFiniteNumber(coordinate, `${path}[${index}]`));
}

function validateCoordinates(value, path) {
    if (!Array.isArray(value) || value.length !== 4) {
        throw new SchemaValidationError(
            `${path} must contain four corner positions.`,
            'invalid-layer-coordinates',
            path
        );
    }
    value.forEach((position, index) => {
        if (!Array.isArray(position) || position.length < 2) {
            throw new SchemaValidationError(
                `${path}[${index}] must be a position.`,
                'invalid-layer-coordinates',
                `${path}[${index}]`
            );
        }
        requireFiniteNumber(position[0], `${path}[${index}][0]`);
        requireFiniteNumber(position[1], `${path}[${index}][1]`);
    });
}

function validateLayer(layer, path) {
    requireRecord(layer, path);
    requireString(layer.type, `${path}.type`);
    if (!LAYER_TYPES.has(layer.type)) {
        throw new SchemaValidationError(
            `${path}.type is not a supported layer type.`,
            'unsupported-layer-type',
            `${path}.type`
        );
    }
    if (layer.enabled !== undefined) {
        requireBoolean(layer.enabled, `${path}.enabled`);
    }
    if (layer.bounds !== undefined) {
        validateBounds(layer.bounds, `${path}.bounds`);
    }

    if (layer.type === 'TileLayer') {
        requireString(layer.tileUrl, `${path}.tileUrl`);
        if (layer.tileSize !== undefined && ![256, 512].includes(layer.tileSize)) {
            throw new SchemaValidationError(
                `${path}.tileSize must be 256 or 512.`,
                'invalid-layer-tile-size',
                `${path}.tileSize`
            );
        }
        if (layer.subdomains !== undefined
            && (!Array.isArray(layer.subdomains)
                || layer.subdomains.some(value => typeof value !== 'string'))) {
            throw new SchemaValidationError(
                `${path}.subdomains must be an array of strings.`,
                'invalid-layer-subdomains',
                `${path}.subdomains`
            );
        }
    } else {
        requireString(layer.url, `${path}.url`);
        if (layer.type === 'ImageLayer') {
            validateCoordinates(layer.coordinates, `${path}.coordinates`);
        }
    }
}

function validateLayers(layers, path) {
    requireRecord(layers, path);
    for (const [name, layer] of Object.entries(layers)) {
        requireString(name, `${path} layer name`);
        validateLayer(layer, `${path}.${name}`);
    }
}

function validateService(properties, path) {
    const service = properties.customDataService;
    const label = properties.customDataServiceLabel;
    if (service === undefined || service === null || service === '') {
        if (label !== undefined && label !== null && label !== '') {
            throw new SchemaValidationError(
                `${path}.customDataServiceLabel requires a service.`,
                'orphan-service-label',
                `${path}.customDataServiceLabel`
            );
        }
        return;
    }
    requireString(service, `${path}.customDataService`);
    requireString(label, `${path}.customDataServiceLabel`);
}

function equivalentValue(left, right) {
    if (left === right) {
        return true;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left)
            && Array.isArray(right)
            && left.length === right.length
            && left.every((value, index) => equivalentValue(value, right[index]));
    }
    if (isRecord(left) || isRecord(right)) {
        if (!isRecord(left) || !isRecord(right)) {
            return false;
        }
        const leftKeys = Object.keys(left).sort();
        const rightKeys = Object.keys(right).sort();
        return equivalentValue(leftKeys, rightKeys)
            && leftKeys.every(key => equivalentValue(left[key], right[key]));
    }
    return false;
}

function validateTaskRelationships(task, projectProperties, projectLayers, path) {
    const properties = task.properties;
    if (task.id !== undefined && String(task.id) !== properties.name) {
        throw new SchemaValidationError(
            'A task feature id must match its task name.',
            'task-id-mismatch',
            `${path}.id`
        );
    }
    if (properties.drawing_type !== projectProperties.drawing_type) {
        throw new SchemaValidationError(
            'A task drawing type must match the project settings.',
            'task-settings-mismatch',
            `${path}.properties.drawing_type`
        );
    }
    for (const field of ['primary_classes', 'secondary_classes']) {
        if (!equivalentValue(properties[field], projectProperties[field])) {
            throw new SchemaValidationError(
                `A task ${field} definition must match the project settings.`,
                'task-settings-mismatch',
                `${path}.properties.${field}`
            );
        }
    }

    validateService(properties, `${path}.properties`);
    const projectService = projectProperties.customDataService ?? null;
    const taskService = properties.customDataService ?? null;
    if (taskService !== projectService
        || (properties.customDataServiceLabel ?? null)
            !== (projectProperties.customDataServiceLabel ?? null)) {
        throw new SchemaValidationError(
            'A task custom data service must match the project settings.',
            'task-service-mismatch',
            `${path}.properties.customDataService`
        );
    }

    for (const [name, taskLayer] of Object.entries(properties.layers)) {
        const projectLayer = projectLayers[name];
        if (!projectLayer) {
            throw new SchemaValidationError(
                'A task references a layer not defined by the project.',
                'unknown-project-layer',
                `${path}.properties.layers.${name}`
            );
        }
        if (!equivalentValue(taskLayer, projectLayer)) {
            throw new SchemaValidationError(
                'A task layer must match its project layer definition.',
                'task-layer-mismatch',
                `${path}.properties.layers.${name}`
            );
        }
    }
}

function validateResultRelationships(result, task, path) {
    const primary = task.properties.primary_classes;
    const primaryValue = result.properties[primary.property_name];
    if (primaryValue !== undefined && !primary.names.includes(primaryValue)) {
        throw new SchemaValidationError(
            'A result uses an unknown primary class.',
            'unknown-primary-class',
            `${path}.properties.${primary.property_name}`
        );
    }
    const secondary = task.properties.secondary_classes;
    if (secondary?.property_name && Array.isArray(secondary.names)) {
        const secondaryValue = result.properties[secondary.property_name];
        if (secondaryValue !== undefined && !secondary.names.includes(secondaryValue)) {
            throw new SchemaValidationError(
                'A result uses an unknown secondary class.',
                'unknown-secondary-class',
                `${path}.properties.${secondary.property_name}`
            );
        }
    }
}

function validatePosition(position, path) {
    if (!Array.isArray(position) || position.length < 2) {
        throw new SchemaValidationError(`${path} must be a position.`, 'invalid-geometry', path);
    }
    position.forEach((value, index) => requireFiniteNumber(value, `${path}[${index}]`));
}

function positionsEqual(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateLine(coordinates, path, minimum = 2) {
    if (!Array.isArray(coordinates) || coordinates.length < minimum) {
        throw new SchemaValidationError(
            `${path} must contain at least ${minimum} positions.`,
            'invalid-geometry',
            path
        );
    }
    coordinates.forEach((position, index) => validatePosition(position, `${path}[${index}]`));
}

function validateRing(coordinates, path) {
    validateLine(coordinates, path, 4);
    if (!positionsEqual(coordinates[0], coordinates[coordinates.length - 1])) {
        throw new SchemaValidationError(`${path} must be closed.`, 'invalid-geometry', path);
    }
}

function validatePolygon(coordinates, path) {
    if (!Array.isArray(coordinates) || coordinates.length === 0) {
        throw new SchemaValidationError(`${path} must contain at least one ring.`, 'invalid-geometry', path);
    }
    coordinates.forEach((ring, index) => validateRing(ring, `${path}[${index}]`));
}

function validateGeometry(geometry, path) {
    requireRecord(geometry, path);
    requireString(geometry.type, `${path}.type`);
    const coordinatesPath = `${path}.coordinates`;
    switch (geometry.type) {
        case 'Point':
            validatePosition(geometry.coordinates, coordinatesPath);
            break;
        case 'MultiPoint':
            validateLine(geometry.coordinates, coordinatesPath, 1);
            break;
        case 'LineString':
            validateLine(geometry.coordinates, coordinatesPath);
            break;
        case 'MultiLineString':
            if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
                throw new SchemaValidationError(`${coordinatesPath} must contain a line.`, 'invalid-geometry', coordinatesPath);
            }
            geometry.coordinates.forEach((line, index) => validateLine(line, `${coordinatesPath}[${index}]`));
            break;
        case 'Polygon':
            validatePolygon(geometry.coordinates, coordinatesPath);
            break;
        case 'MultiPolygon':
            if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
                throw new SchemaValidationError(`${coordinatesPath} must contain a polygon.`, 'invalid-geometry', coordinatesPath);
            }
            geometry.coordinates.forEach((polygon, index) => validatePolygon(polygon, `${coordinatesPath}[${index}]`));
            break;
        case 'GeometryCollection': {
            const geometriesPath = `${path}.geometries`;
            if (!Array.isArray(geometry.geometries)) {
                throw new SchemaValidationError(`${geometriesPath} must be an array.`, 'invalid-geometry', geometriesPath);
            }
            geometry.geometries.forEach((child, index) => validateGeometry(child, `${geometriesPath}[${index}]`));
            break;
        }
        default:
            throw new SchemaValidationError(
                `${path}.type is not a supported geometry type.`,
                'unsupported-geometry-type',
                `${path}.type`
            );
    }
}

function validateFeature(feature, path, requireProperties = true, allowEmptyGeometry = false) {
    requireRecord(feature, path);
    if (feature.type !== 'Feature') {
        throw new SchemaValidationError(`${path}.type must be Feature.`, 'invalid-feature', `${path}.type`);
    }
    if (requireProperties) {
        requireRecord(feature.properties, `${path}.properties`);
    }
    requireRecord(feature.geometry, `${path}.geometry`);
    if (!allowEmptyGeometry || Object.keys(feature.geometry).length > 0) {
        validateGeometry(feature.geometry, `${path}.geometry`);
    }
}

function validateTaskProperties(properties, path, requireTaskName = true) {
    requireString(properties.project_name, `${path}.project_name`);
    if (requireTaskName) {
        requireString(properties.name, `${path}.name`);
    } else if (properties.name !== undefined) {
        requireString(properties.name, `${path}.name`, true);
    }
    requireString(properties.instructions, `${path}.instructions`, true);
    requireString(properties.drawing_type, `${path}.drawing_type`);
    validateLayers(properties.layers, `${path}.layers`);
    requireRecord(properties.primary_classes, `${path}.primary_classes`);
    requireString(properties.primary_classes.display_name, `${path}.primary_classes.display_name`);
    requireString(properties.primary_classes.property_name, `${path}.primary_classes.property_name`);
    if (!Array.isArray(properties.primary_classes.names)) {
        throw new SchemaValidationError(
            `${path}.primary_classes.names must be an array.`,
            'invalid-field',
            `${path}.primary_classes.names`
        );
    }
    if (properties.primary_classes.colors !== undefined
        && (!Array.isArray(properties.primary_classes.colors)
            || properties.primary_classes.colors.some(value => typeof value !== 'string'))) {
        throw new SchemaValidationError(
            `${path}.primary_classes.colors must be an array of strings.`,
            'invalid-field',
            `${path}.primary_classes.colors`
        );
    }
    if (properties.secondary_classes !== undefined && properties.secondary_classes !== null) {
        requireRecord(properties.secondary_classes, `${path}.secondary_classes`);
        requireString(
            properties.secondary_classes.display_name,
            `${path}.secondary_classes.display_name`
        );
        requireString(
            properties.secondary_classes.property_name,
            `${path}.secondary_classes.property_name`
        );
        if (!Array.isArray(properties.secondary_classes.names)
            || properties.secondary_classes.names.some(value => typeof value !== 'string')) {
            throw new SchemaValidationError(
                `${path}.secondary_classes.names must be an array of strings.`,
                'invalid-field',
                `${path}.secondary_classes.names`
            );
        }
    }
    validateService(properties, path);
}

export function validateTask(document, options = {}) {
    assertNoDangerousKeys(document);
    requireRecord(document, '$');
    if (document.type !== 'FeatureCollection' || !Array.isArray(document.features) || document.features.length === 0) {
        throw new SchemaValidationError(
            'A task must be a non-empty FeatureCollection.',
            'invalid-task-document',
            '$'
        );
    }

    const taskFeature = document.features[0];
    validateFeature(
        taskFeature,
        '$.features[0]',
        true,
        options.allowEmptyGeometry === true
    );
    validateTaskProperties(taskFeature.properties, '$.features[0].properties');
    if (taskFeature.id !== undefined
        && String(taskFeature.id) !== taskFeature.properties.name) {
        throw new SchemaValidationError(
            'A task feature id must match its task name.',
            'task-id-mismatch',
            '$.features[0].id'
        );
    }
    requireString(options.sourceId, 'sourceId');

    const clonedDocument = cloneValue(document);
    const instructions = taskFeature.properties.instructions;

    return Object.freeze({
        document: clonedDocument,
        task: clonedDocument.features[0],
        instructions: Object.freeze({
            original: instructions,
            rendered: options.renderedInstruction ?? null
        }),
        destinations: Object.freeze([...(options.destinationDecisions ?? [])]),
        warnings: Object.freeze([...(options.warnings ?? [])].slice(0, 20)),
        sourceId: options.sourceId
    });
}

export function validateProjectSettings(document, options = {}) {
    assertNoDangerousKeys(document);
    requireRecord(document, '$');
    if (document.type !== 'FeatureCollection'
        || !Array.isArray(document.features)
        || document.features.length === 0) {
        throw new SchemaValidationError(
            'Project settings must be a non-empty FeatureCollection.',
            'invalid-project-settings',
            '$'
        );
    }

    const areaFeature = document.features[0];
    validateFeature(areaFeature, '$.features[0]');
    validateTaskProperties(areaFeature.properties, '$.features[0].properties', false);
    requireString(options.sourceId, 'sourceId');

    return Object.freeze({
        document: cloneValue(document),
        area: cloneValue(areaFeature),
        sourceId: options.sourceId
    });
}

export function validateTaskResults(task, results, options = {}) {
    assertNoDangerousKeys({ task, results });
    requireString(options.sourceId, 'sourceId');
    validateTask({
        type: 'FeatureCollection',
        features: [task]
    }, {
        sourceId: options.sourceId,
        allowEmptyGeometry: options.allowEmptyTaskGeometry === true
    });
    if (!Array.isArray(results)) {
        throw new SchemaValidationError('Task results must be an array.', 'invalid-results', '$.results');
    }

    results.forEach((result, index) => {
        const path = `$.results[${index}]`;
        validateFeature(result, path);
        requireString(result.properties.task_name, `${path}.properties.task_name`);
        if (result.properties.task_name !== task.properties.name) {
            throw new SchemaValidationError(
                'A result references a different task.',
                'unknown-task-reference',
                `${path}.properties.task_name`
            );
        }
        validateResultRelationships(result, task, path);
    });

    return Object.freeze(results.map(cloneValue));
}

export function validateProject(project, options = {}) {
    assertNoDangerousKeys(project);
    requireRecord(project, '$');
    requireString(options.sourceId, 'sourceId');

    validateProjectSettings(project.settings, { sourceId: options.sourceId });
    if (!Array.isArray(project.tasks) || project.tasks.length === 0) {
        throw new SchemaValidationError('Project tasks must be a non-empty array.', 'missing-tasks', '$.tasks');
    }
    if (project.results !== undefined && !Array.isArray(project.results)) {
        throw new SchemaValidationError('Project results must be an array.', 'invalid-results', '$.results');
    }

    const taskNames = new Set();
    const tasksByName = new Map();
    const projectName = project.settings.features[0].properties.project_name;
    const projectProperties = project.settings.features[0].properties;
    const projectLayers = projectProperties.layers;
    project.tasks.forEach((task, index) => {
        validateTask({
            type: 'FeatureCollection',
            features: [task]
        }, { sourceId: options.sourceId });
        if (taskNames.has(task.properties.name)) {
            throw new SchemaValidationError(
                'Project task names must be unique.',
                'duplicate-task',
                `$.tasks[${index}].properties.name`
            );
        }
        if (task.properties.project_name !== projectName) {
            throw new SchemaValidationError(
                'A project task references a different project.',
                'project-name-mismatch',
                `$.tasks[${index}].properties.project_name`
            );
        }
        validateTaskRelationships(task, projectProperties, projectLayers, `$.tasks[${index}]`);
        taskNames.add(task.properties.name);
        tasksByName.set(task.properties.name, task);
    });

    (project.results ?? []).forEach((result, index) => {
        validateFeature(result, `$.results[${index}]`);
        requireString(result.properties.task_name, `$.results[${index}].properties.task_name`);
        if (!taskNames.has(result.properties.task_name)) {
            throw new SchemaValidationError(
                'A project result references an unknown task.',
                'unknown-task-reference',
                `$.results[${index}].properties.task_name`
            );
        }
        validateResultRelationships(
            result,
            tasksByName.get(result.properties.task_name),
            `$.results[${index}]`
        );
    });

    const cloned = cloneValue(project);
    return Object.freeze({
        ...cloned,
        sourceId: options.sourceId,
        warnings: Object.freeze([...(options.warnings ?? [])].slice(0, 20)),
        diagnostics: Object.freeze([...(options.diagnostics ?? [])])
    });
}
