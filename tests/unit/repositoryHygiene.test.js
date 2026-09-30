import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const prohibitedPatterns = [
    new RegExp(`\\b${['C', 'H', 'K'].join('')}\\d+\\b`, 'i'),
    new RegExp(['pkgs', 'dev', 'azure', 'com'].join('\\.'), 'i'),
    new RegExp(['_auth', 'Token'].join(''), 'i')
];

test('committable files do not disclose private planning data or package feeds', () => {
    const files = execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
        { cwd: repositoryRoot, encoding: 'utf8' }
    ).split('\0').filter(Boolean);

    const disclosed = [];
    for (const file of files) {
        if (prohibitedPatterns.some(pattern => pattern.test(file))) {
            disclosed.push(file);
            continue;
        }

        const contents = fs.readFileSync(path.join(repositoryRoot, file));
        if (contents.includes(0)) {
            continue;
        }

        if (prohibitedPatterns.some(pattern => pattern.test(contents.toString('utf8')))) {
            disclosed.push(file);
        }
    }

    assert.deepEqual(disclosed, []);
});

test('externally hosted runtime assets are integrity pinned with anonymous CORS', () => {
    const pages = ['labeler.html', 'projectBuilder.html', 'projectViewer.html'];
    for (const page of pages) {
        const markup = fs.readFileSync(path.join(repositoryRoot, 'src', page), 'utf8');
        const externalAssets = [...markup.matchAll(
            /<(?:script|link)\b[^>]*(?:src|href)="https:\/\/atlas\.microsoft\.com\/[^"]+"[^>]*>/g
        )].map(match => match[0]);
        assert.equal(externalAssets.length, 5, page);
        for (const asset of externalAssets) {
            assert.match(asset, /\bintegrity="sha384-[A-Za-z0-9+/=]+"/, page);
            assert.match(asset, /\bcrossorigin="anonymous"/, page);
        }
    }
});

test('third-party notices record pinned versions and minimum browser support', () => {
    const notices = fs.readFileSync(
        path.join(repositoryRoot, 'src', 'libs', 'THIRD-PARTY-NOTICES.md'),
        'utf8'
    );
    for (const dependency of [
        'Material Symbols 0.47.5',
        'DOMPurify 3.4.15',
        'Clarinet 0.12.6',
        'Azure Maps Web SDK Map Control 3',
        'Azure Maps Drawing Tools 1',
        'Azure Maps Spatial IO 0'
    ]) {
        assert.match(notices, new RegExp(dependency.replaceAll('.', '\\.')));
    }
    assert.match(notices, /Chromium 105, Firefox 102, and WebKit 16\.0/);
    assert.match(notices, /Microsoft Learn.*locally.*host/i);
    assert.match(notices, /ETag/i);
});
