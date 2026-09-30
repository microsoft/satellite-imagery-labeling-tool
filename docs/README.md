# Spatial labeling toolkit documentation

Welcome to the Spatial labeling tool documentation. The following will help guide you on your imagery labeling journey.

- [Project builder documentation](Project-builder.md) - Details on how to use the project builder tool. 
- [Labeler documentation](Labeler.md) - Details on how to use the labeler tool.
- [Project viewer documentation](Project-viewer.md) - Details on how to use the project view tool.
- [Working with GeoTiffs](GeoTiffs.md) - Details on how to use custom GeoTiffs as reference layers in the project builder and labeler tools. 
- [Imagery layers](Layers.md) - Details on how to import different types of imagery layers into this tool.

## Deployment security

Serve the tools over HTTPS. Application-controlled requests reject redirects, so configure task, data, and service URLs to their final HTTPS destinations. A deployment proxy must validate every redirect hop, apply the same destination rules after template expansion, and reject credentials, unsafe schemes, loopback, link-local, and private addresses unless the deployment explicitly supports and discloses them.

The entry pages include a restrictive meta Content Security Policy. Production deployments should also send the same policy as an HTTP response header, because headers provide stronger enforcement and reporting. Keep `script-src` free of `unsafe-inline` and `unsafe-eval`; Azure Maps requires its documented script/style origin and may create SDK-managed workers or blobs that require `worker-src 'self' blob:`. The current Azure Maps CDN bundle may attempt dynamic evaluation that this policy intentionally blocks, so deployments should test SDK features they enable and track CSP-compatible SDK releases rather than weakening the policy. A browser cannot reliably expose DNS resolution or safely inspect a redirect target before following it, so server-side proxies remain responsible for DNS rebinding defenses and redirect-hop validation.

Version 2 task, project, result, and autosave data remain supported after validation. Direct HTTPS services remain supported; plaintext remote HTTP and redirecting endpoints intentionally do not. Opening the application with `file://` remains best effort because browser module, worker, and local-file policies vary.
