import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outputDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'fixtures',
    'generated'
);

function writeFixture(name, contents) {
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(path.join(outputDirectory, name), contents, 'utf8');
}

writeFixture('mixed-records.geojsonl', [
    JSON.stringify({ type: 'Feature', geometry: null, properties: { sequence: 1 } }),
    '{ malformed',
    JSON.stringify({
        type: 'Feature',
        properties: { sequence: 3 },
        geometry: {
            type: 'Polygon',
            coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]]
        }
    })
].join('\n'));

writeFixture('multiline-feature.geojsonl', JSON.stringify({
    type: 'Feature',
    properties: { note: 'deterministic' },
    geometry: {
        type: 'MultiPolygon',
        coordinates: [[[[0, 0], [2, 0], [2, 2], [0, 0]]]]
    }
}, null, 2));
