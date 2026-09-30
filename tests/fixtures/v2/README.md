# Version 2 compatibility fixtures

These fixtures capture the public version 2 formats documented in:

- `docs/Project-builder.md` — project settings and task FeatureCollection fields.
- `docs/Labeler.md` — result FeatureCollection fields and browser autosave behavior.
- `docs/Project-viewer.md` — task/result relationships consumed by the viewer.

`project-settings.json` is the archive settings FeatureCollection. `task.json` is a
single-task FeatureCollection. `result.json` contains a labeled feature related by
`task_name`. `autosave.json` represents the labeler cache envelope with its saved
FeatureCollection and timestamp. Compatibility tests may clone these fixtures but
must not weaken validation to accept malformed relationships.
