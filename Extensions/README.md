# Extensions/ — official extensions (ship with the engine)

Folders here (`Extensions/<id>/extension.json`) are part of the engine: they are loaded in development and copied into
the packaged app (`resources/Extensions`, electron-builder `extraResources`). The editor's Extensions tab marks them
"official". A project still has to switch one on (Extensions tab, or `ir_set_extension`); being here only makes it
available everywhere without registering a folder.

| id | what it does |
|---|---|
| [`vrm10`](vrm10/README.md) | Reads VRM 1.0 models on the device. Replaces the engine part `vrm-loader` with UniVRM 0.131.3's VRM 1.0 loader (carried as `Packages/VRM-0.131.3_011b.unitypackage`); VRM 0.x models are converted on load. While it is on, the build leaves the engine's UniVRM 0.x out. |

- Samples to read and copy are in [`../samples/extensions/`](../samples/extensions/) (`quest-room`, `quest-input`).
  They are not part of the engine; use them by registering the folder (used in place, not copied):
  `npm run ext:link -- samples/extensions` (editor: Extensions → "Register a folder").
- Your own extensions: `npm run ext:new -- <id> --dir <folder>`, then register that folder, or pack it with
  `npm run ext:pack` and import the `.arsist`. An extension with the same id in your own folder replaces the official
  one (the Extensions tab says so).
- Put an extension here only when it is general (useful to any app) and works on every device its `requires` allows.

See `doc/17-extensions.md`.
