export function createJsonFile(contents, name = 'fixture.json') {
    return new File([JSON.stringify(contents)], name, { type: 'application/json' });
}
