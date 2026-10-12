# Extensions/ — extensions that ship with the engine

Folders here (`Extensions/<id>/extension.json`) are part of the engine: they are loaded in development and copied into
the packaged app (`resources/Extensions`, electron-builder `extraResources`). It is empty on purpose — nothing is
bundled by default.

- Samples to read and copy are in [`../samples/extensions/`](../samples/extensions/) (`quest-room`, `quest-input`).
  They are not part of the engine; use them by registering the folder (used in place, not copied):
  `npm run ext:link -- samples/extensions` (editor: Extensions → "Register a folder").
- Your own extensions: `npm run ext:new -- <id> --dir <folder>`, then register that folder, or pack it with
  `npm run ext:pack` and import the `.arsist`.

See `doc/17-extensions.md`.
