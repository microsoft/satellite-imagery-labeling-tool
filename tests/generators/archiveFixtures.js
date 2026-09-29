export function archiveManifestFixture(overrides = {}) {
    return {
        entries: [
            { path: 'project_builder_settings.json', text: '{}' },
            { path: 'tasks/task-1.json', text: '{}' },
            { path: 'results/task-1.json', text: '{}' }
        ],
        ...overrides
    };
}

export function unsafeArchiveManifestFixtures() {
    return {
        traversal: archiveManifestFixture({ entries: [{ path: '../outside.json', text: '{}' }] }),
        absolute: archiveManifestFixture({ entries: [{ path: 'C:\\outside.json', text: '{}' }] }),
        duplicate: archiveManifestFixture({
            entries: [
                { path: 'project_builder_settings.json', text: '{}' },
                { path: './project_builder_settings.json', text: '{}' }
            ]
        }),
        ambiguousSettings: archiveManifestFixture({
            entries: [
                { path: 'one/project_builder_settings.json', text: '{}' },
                { path: 'two/project_builder_settings.json', text: '{}' }
            ]
        }),
        emptySegment: archiveManifestFixture({
            entries: [{ path: 'tasks//task-1.json', text: '{}' }]
        }),
        caseConflict: archiveManifestFixture({
            entries: [
                { path: 'project_builder_settings.json', text: '{}' },
                { path: 'PROJECT_BUILDER_SETTINGS.JSON', text: '{}' }
            ]
        })
    };
}
