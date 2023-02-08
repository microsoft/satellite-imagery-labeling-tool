# Using GeoTIFFs as layers

GeoTIFF files are a common way of sharing georeferenced aerial and satellite imagery. These files tend to be hundreds of megabytes, if not gigabytes in size. As such, directly loading them into a web based map app will rarely be an option. Instead, this imagery will need to be hosted on a server and exposed in an easily consumable way, such as a tile layer.

If you have satellite/aerial imagery stored in a cloud optimized GeoTIFF format on the web (e.g. in a Azure blob storage container or S3 bucket) you can use [TiTiler](https://developmentseed.org/titiler/) to render it on-the-fly and use it seamlessly with this tool.

## Install and run TiTiler

TiTiler can be installed in a python environment using `pip`. See more options on the [TiTiler documentation page](https://developmentseed.org/titiler/).

```
pip install -U pip
pip install uvicorn
pip install titiler.{package}
```

TiTiler can then be run as a server process that listens on some port (**note**, the machine that you run TiTiler on should have CORs enabled so it is accessible from elsewhere on the web).

```
uvicorn --host 0.0.0.0 --port <PORT> titiler.application.main:app
```

See other ways of deploying TiTiler on [Azure](https://developmentseed.org/titiler/deployment/azure/) or [AWS](https://developmentseed.org/titiler/deployment/aws/intro/).

## Create a task file that uses a TiTiler instance as a basemap

We assume that we have:

- A server, "example.com", that is running a web server on port 80 (the default) that includes the files in this repo in the root directory (i.e. that http://example.com/index.html serves the file from this repo).
- A server, "example.com", that is running TiTiler on port 8888. Note, that this server does not necessarily have to be running on the same machine as the web server.
- A COG file either hosted on _some_ web server (can be on the local server, in the cloud, etc.). For example can use a NAIP aerial imagery COG hosted by Microsoft's [Planetary Computer](https://planetarycomputer.microsoft.com/) -- https://naipeuwest.blob.core.windows.net/naip/v002/fl/2019/fl_60cm_2019/28080/m_2808060_sw_17_060_20191215.tif.

In the project builder, or labeler tool, go to the `Add a layer+` option and create a `Tile Layer` with the following settings:

- `Layer name` - Anything you want. For example "USDA NAIP Imagery".
- `Service URL` - The formatted URL to the tile service or a TileJSON URL. For example: "http://example.com:8888/cog/tiles/{z}/{x}/{y}.jpg?url=https://naipeuwest.blob.core.windows.net/naip/v002/fl/2019/fl_60cm_2019/28080/m_2808060_sw_17_060_20191215.tif"

If a TileJSON URL is provided as the `Service URL`, the following settings can be skipped as they will automatically be set by the TileJSON settings.

- `Bounds` - The bounding box of where the GeoTIff imagery is available. For example; north = 28.064522, south = 27.997976, east = -80.560208, west = -80.627296
- `Tile size` - 256 is the most likely value unless you specifically changed the size when creating the tiles.

Alternatively, manually add this to the `layers` section of a task file or the labeler tool settings (`labeler_settings.js`). For example:

```js
"layers": {
    "USDA NAIP Imagery": {
        type: "TileLayer",
        minSourceZoom: 1,
        maxSourceZoom: 19,
        bounds: [-80.627296, 27.997976, -80.560208, 28.064522],
        tileSize: 256,
        tileUrl: "http://example.com:8888/cog/tiles/{z}/{x}/{y}.jpg?url=https://naipeuwest.blob.core.windows.net/naip/v002/fl/2019/fl_60cm_2019/28080/m_2808060_sw_17_060_20191215.tif"
    }
}
```

Finally, you should be able to navigate to labeler tool with this layer defined in the task file, and create labels over the NAIP imagery!


## See also

- [Layers documentation](Layers.md)
