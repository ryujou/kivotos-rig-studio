# Café furniture interaction packs

## 1. Extract a matched pair

Use the asset downloader to locate the café furniture prefab, its mesh, textures, Animator, and the corresponding student interaction AnimationClip from the same game release. In AssetStudio select the furniture hierarchy and its clips and export an animated FBX. Export the student armature with its interaction clip separately. Retain the original bone names and bind pose. [Blue Archive Asset Downloader](https://github.com/ZM-Kimu/Blue-Archive-Asset-Downloader) · [AssetStudio](https://github.com/Perfare/AssetStudio)

## 2. Export the two GLBs

In Blender, import the FBXs and check the interaction together at frame zero. Export each hierarchy as glTF Binary with animations and embedded textures. Use the same scale and axis settings for both. Name the furniture file `furniture.glb` and the student file `student.glb`. The student file can contain just the animated named hierarchy rooted at the original Bip001 skeleton. Check the exported clip names with the studio clip picker.

## 3. Pack the files

Put both GLBs alongside an optional UTF-8 `pack.json`. A furniture-only pack needs just its GLB. The standard filenames work without a manifest. Set `furniture` and `student` when using other filenames.

```json
{
  "name": "Drawing table",
  "furniture": "furniture.glb",
  "student": "student.glb",
  "furnitureClip": "Table_Idle",
  "studentClip": "Draw_Interaction",
  "offset": [0, 0, 0],
  "yaw": 0,
  "rootMode": "prop-locked"
}
```

Replace the example clip names with exact exported names, or omit them to select the first clip. For paired packs, the furniture starts at the active slot’s origin and heading. Offset gives the student’s local X/Y/Z displacement in meters and yaw gives its additional Y rotation in degrees. The default root mode is `prop-locked`. For a lone prop the offset and yaw place the prop itself. From the folder run `zip drawing-table.zip furniture.glb student.glb pack.json`.

## 4. Load and share

Select an Actor A. In **Props**, drop the ZIP or select all pack files together. Scrub the timeline to check both clips, then use the Props inspector to select a furniture clip, change visibility, or adjust placement. For a lone GLB choose a target bone in the import panel before dropping it.

For a community index, host the ZIP or manifest and GLBs on a CORS-enabled HTTP(S) host. Supply the index URL in **Props**. Relative links resolve against the index or manifest URL. A remote manifest names each downloadable GLB explicitly. For example:

```json
{"packs":[{"name":"Drawing table","url":"packs/drawing-table.zip"}]}
```
