import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    PRESENTATION_CONTEXTS,
    PRESENTATION_SURFACES,
    validatePresentationContextInventory
} from '../../src/modules/presentationContexts.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const requiredFields = [
    'project.project_name',
    'project.instructions',
    'task.name',
    'task.instructions',
    'layer.name',
    'class.display_name',
    'class.name',
    'service.label',
    'result.properties',
    'intake.source_name',
    'intake.diagnostic',
    'destination.origin'
];

test('presentation inventory is complete, unique, and uses supported contexts', () => {
    const result = validatePresentationContextInventory(PRESENTATION_CONTEXTS);
    assert.deepEqual(result, {
        fields: PRESENTATION_CONTEXTS.length,
        plainText: 10,
        restrictedFormatting: 2
    });
    assert.deepEqual(
        [...PRESENTATION_CONTEXTS.map(item => item.field)].sort(),
        [...requiredFields].sort()
    );
});

test('only restricted instruction contexts permit user-activated mail and telephone links', () => {
    for (const item of PRESENTATION_CONTEXTS) {
        if (item.context === 'restricted-formatting') {
            assert.deepEqual(item.allowedSchemes, ['https:', 'mailto:', 'tel:']);
            assert.equal(item.renderer, 'renderInstruction');
        } else {
            assert.deepEqual(item.allowedSchemes, []);
            assert.equal(item.renderer, 'setText');
        }
    }
});

test('every inventoried presentation surface is bound to a real application rendering call', () => {
    const expected = PRESENTATION_CONTEXTS.flatMap(context =>
        context.surfaces.map(surface => `${context.field}:${surface}`)
    ).sort();
    const actual = PRESENTATION_SURFACES.map(surface =>
        `${surface.field}:${surface.id}`
    ).sort();
    assert.deepEqual(actual, expected);

    for (const surface of PRESENTATION_SURFACES) {
        const source = fs.readFileSync(
            path.join(repositoryRoot, surface.source),
            'utf8'
        );
        assert.match(source, new RegExp(
            `presentField\\([\\s\\S]{0,240}['"]${surface.field.replaceAll('.', '\\.')}['"]`
            + `[\\s\\S]{0,120}['"]${surface.id}['"]`
        ), `${surface.field}:${surface.id}`);
    }
});

test('application presentation modules do not bypass rendering APIs with dynamic text sinks', () => {
    for (const sourceFile of [
        'src/modules/labeler.js',
        'src/modules/projectBuilder.js',
        'src/modules/projectViewer.js',
        'src/modules/controls/customMapControls.js',
        'src/modules/operationNotice.js'
    ]) {
        const source = fs.readFileSync(path.join(repositoryRoot, sourceFile), 'utf8');
        for (const match of source.matchAll(
            /\.(?:innerText|textContent)\s*=\s*([^;\r\n]+)/g
        )) {
            assert.match(match[1].trim(), /^['"`]/, `${sourceFile}: ${match[0]}`);
        }
    }
});
