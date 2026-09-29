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
