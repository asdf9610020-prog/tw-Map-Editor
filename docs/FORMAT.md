# Authored map format

Schema: `twremake.authored-map.v1`. This is a portable authoring format, not a native `.d2m` file.

`grid` contains width / height in cells, `cellMeters` (normally 0.25), `coordinateUnitsPerCell=4`, `blockedMask=2`, and `blockGroupSize=13`. Width and height must be 8–1024.

`collision.flags` contains one byte value per cell. `collision.heights` contains one finite height per cell in metres, limited to ±1000. Both arrays are row-major with index `y * width + x`. `flags & 2` means blocked. Painting changes only this bit. Resizing copies cells by coordinates to the new row stride; new cells receive flag 2 and height 0.

Tiles identify a catalog asset, position in cells, height in metres, yaw in degrees, and scale (0.25–4). Entity markers include spawn, portal, NPC and monster. A portal has authored target world, terrain and region values. Markers do not implement game actor behaviour.

Local browser drafts use `twremake.editor-draft.v2`: run-length encoded flags and sparse nonzero heights. Old full JSON drafts remain readable. Portable saved / exported projects always contain the full arrays. If a dense authored map exceeds browser storage, save it through the server or export it.

ZIP exports include `map.twmap.json`, `collision.bin`, `heights.f32le`, `868-native-regions.json`, a catalog subset, models and a README. The height buffer uses little-endian float32; JSON preserves the original JavaScript numeric precision. Region groups are 13×13 except truncated right / bottom edges.

Acceptance is reset on import / export: `editorOnly=true`, `runtimeIntegrated=false`, `desktopGameplayAccepted=false`, `browserGameplayAccepted=false`. Editor path checks do not establish native pathfinding, gameplay parity or server authority.
