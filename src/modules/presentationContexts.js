import {
    renderInstruction,
    renderSafeMarkdown,
    setText
} from './safeRendering.js';

const plainText = (field, surfaces) => Object.freeze({
    field,
    context: 'plain-text',
    renderer: 'setText',
    allowedSchemes: Object.freeze([]),
    surfaces: Object.freeze(surfaces)
});

const restrictedFormatting = (field, surfaces) => Object.freeze({
    field,
    context: 'restricted-formatting',
    renderer: 'renderInstruction',
    allowedSchemes: Object.freeze(['https:', 'mailto:', 'tel:']),
    surfaces: Object.freeze(surfaces)
});

export const PRESENTATION_CONTEXTS = Object.freeze([
    plainText('project.project_name', ['labeler-project-title']),
    restrictedFormatting('project.instructions', ['builder-instructions-preview']),
    plainText('task.name', ['viewer-unlabeled-task', 'viewer-task-popup']),
    restrictedFormatting('task.instructions', ['labeler-task-instructions']),
    plainText('layer.name', ['labeler-layer-control']),
    plainText('class.display_name', [
        'labeler-primary-class-title',
        'labeler-secondary-class-title',
        'viewer-primary-legend-title',
        'viewer-secondary-legend-title'
    ]),
    plainText('class.name', [
        'builder-class-table',
        'labeler-class-option',
        'viewer-class-legend-item'
    ]),
    plainText('service.label', [
        'labeler-custom-service-button',
        'labeler-custom-service-filter'
    ]),
    plainText('result.properties', ['viewer-result-popup']),
    plainText('intake.source_name', [
        'builder-area-import-source',
        'labeler-geojsonl-source'
    ]),
    plainText('intake.diagnostic', [
        'builder-area-import-diagnostic',
        'labeler-geojsonl-diagnostic'
    ]),
    plainText('destination.origin', ['declined-destination-notice'])
]);

export const PRESENTATION_SURFACES = Object.freeze([
    ['project.project_name', 'labeler-project-title', 'src/modules/labeler.js'],
    ['project.instructions', 'builder-instructions-preview', 'src/modules/projectBuilder.js'],
    ['task.name', 'viewer-unlabeled-task', 'src/modules/projectViewer.js'],
    ['task.name', 'viewer-task-popup', 'src/modules/projectViewer.js'],
    ['task.instructions', 'labeler-task-instructions', 'src/modules/labeler.js'],
    ['layer.name', 'labeler-layer-control', 'src/modules/controls/customMapControls.js'],
    ['class.display_name', 'labeler-primary-class-title', 'src/modules/controls/customMapControls.js'],
    ['class.display_name', 'labeler-secondary-class-title', 'src/modules/controls/customMapControls.js'],
    ['class.display_name', 'viewer-primary-legend-title', 'src/modules/projectViewer.js'],
    ['class.display_name', 'viewer-secondary-legend-title', 'src/modules/projectViewer.js'],
    ['class.name', 'builder-class-table', 'src/modules/projectBuilder.js'],
    ['class.name', 'labeler-class-option', 'src/modules/controls/customMapControls.js'],
    ['class.name', 'viewer-class-legend-item', 'src/modules/projectViewer.js'],
    ['service.label', 'labeler-custom-service-button', 'src/modules/labeler.js'],
    ['service.label', 'labeler-custom-service-filter', 'src/modules/labeler.js'],
    ['result.properties', 'viewer-result-popup', 'src/modules/projectViewer.js'],
    ['intake.source_name', 'builder-area-import-source', 'src/modules/projectBuilder.js'],
    ['intake.source_name', 'labeler-geojsonl-source', 'src/modules/labeler.js'],
    ['intake.diagnostic', 'builder-area-import-diagnostic', 'src/modules/projectBuilder.js'],
    ['intake.diagnostic', 'labeler-geojsonl-diagnostic', 'src/modules/labeler.js'],
    ['destination.origin', 'declined-destination-notice', 'src/modules/operationNotice.js']
].map(([field, id, source]) => Object.freeze({ field, id, source })));

const contextsByField = new Map(PRESENTATION_CONTEXTS.map(item => [item.field, item]));

export function presentField(element, field, surface, value) {
    const context = contextsByField.get(field);
    if (!context || !context.surfaces.includes(surface)) {
        throw new TypeError(`Unregistered presentation surface: ${field}:${surface}`);
    }
    if (context.context === 'restricted-formatting') {
        renderInstruction(element, renderSafeMarkdown(value));
    } else {
        setText(element, value);
    }
    return element;
}

export function validatePresentationContextInventory(inventory = PRESENTATION_CONTEXTS) {
    if (!Array.isArray(inventory) || inventory.length === 0) {
        throw new TypeError('The presentation-context inventory must be a non-empty array.');
    }
    const fields = new Set();
    let plainTextCount = 0;
    let restrictedFormattingCount = 0;

    for (const item of inventory) {
        if (!item || typeof item.field !== 'string' || fields.has(item.field)) {
            throw new TypeError('Presentation fields must be named and unique.');
        }
        fields.add(item.field);
        if (!Array.isArray(item.surfaces) || item.surfaces.length === 0) {
            throw new TypeError(`${item.field} must identify at least one presentation surface.`);
        }
        if (item.context === 'plain-text'
            && item.renderer === 'setText'
            && item.allowedSchemes.length === 0) {
            plainTextCount += 1;
        } else if (item.context === 'restricted-formatting'
            && item.renderer === 'renderInstruction'
            && item.allowedSchemes.join(',') === 'https:,mailto:,tel:') {
            restrictedFormattingCount += 1;
        } else {
            throw new TypeError(`${item.field} has an invalid presentation context.`);
        }
    }

    return Object.freeze({
        fields: fields.size,
        plainText: plainTextCount,
        restrictedFormatting: restrictedFormattingCount
    });
}
