# Changelog

## 10/19/2022

- Changed initial layer displayed When loading a config. If the config contains a layer other than Azure Maps, default to the first layer initially as that's most likely the image an admin would want the user to trace. This is to address [Issue #8](https://github.com/microsoft/satellite-imagery-labeling-tool/issues/8)
- Changed default for "fill polygons" as preference from users seems to be not to have them filled.
- Fix bug [Issue #5](https://github.com/microsoft/satellite-imagery-labeling-tool/issues/5) related to zip files created on Mac OS.

## 10/14/2022

- Changed OSM script file extentions from ".txt" to ".overpassql" as per [Issue #3](https://github.com/microsoft/satellite-imagery-labeling-tool/issues/3)

## 9/21/2022

- Major upgrade, project completely rewritten to make it easier to use, faster, and also help in managing annotation projects at scale.