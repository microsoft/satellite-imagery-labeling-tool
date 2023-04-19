/**
 * Settings specifically used by the project builder app.
 */
 export let appSettings = {
	/**
	 * The subtitle to display for the viewer app.
	 */
	viewerTitle: 'Spatial imagery labeling project viewer',

	/**
	 * The subtitle to display for the builder app.
	 */
	builderTitle: 'Spatial imagery labeling project builder',

	/** Default colors to pick when creating a new class. A random color will be used when all values have been used. By having a default pallete we help to create consistency between missions. */
	colorPalette: ["#00B0F0","#FFC000","#E1008D","#fd8a5e","#FF0000","#4DE600","#01dddd","#757575","#30C4E0","#FFFF32","#D774C4","#C00000","#00B050","#0071FE"],

	/** Specifies if the search bar should be shown if valid Azure Maps credentials are provided. */
	showSearchBar: true,

	/**
	 * The number of grid cells to allow before prompting the user if they want to continue calculating the cells.
	 * It's possible that with a small grid cell size and a large area that millions of cells would be calculated which would take a lot of time and/or cause the page to run out of memory.
	 * In reality, someone using this tool is unlikely to want to have more than a couple hundred grid cells to manage.
	 */
	gridSizeLimit: 10000,

	/**
	 * An initial set of basemap layers to choose from.
	 */
	layers: {
		'ESRI World Imagery': {
			type: 'TileLayer',
			minSourceZoom: 1,
			maxSourceZoom: 19,
			tileSize: 256,
			tileUrl: 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
		},
		'USGS - US Imagery': {
			type: 'OgcMapLayer',
			url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/WMTS/1.0.0/WMTSCapabilities.xml'
		},
		'Open Street Maps': {
			type: 'TileLayer',
			minSourceZoom: 1,
			maxSourceZoom: 19,
			subdomains: ['a','b','c'],
			tileSize: 256,
			tileUrl: 'https://{subdomain}.tile.openstreetmap.org/{z}/{x}/{y}.png',
			enabled: false
		},
		'BasemapAT.orthofoto': {
			type: 'TileLayer',
			minSourceZoom: 1,
			maxSourceZoom: 20,
			bounds: [8.782379, 46.35877, 17.189532, 49.037872],
			tileSize: 256,
			tileUrl: 'https://maps{subdomain}.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg',
			subdomains: ['', '1', '2', '3', '4'],
			enabled: false
		},
		'Luxembourg - Latest Aerial': {
			type: 'OgcMapLayer',
			actoveLayer: 'ortho_latest',
			url: 'https://wmts1.geoportail.lu/opendata/service',
			enabled: false
		},
		'SwissFederalGeoportal.SWISSIMAGE': {
			type: 'TileLayer',
			minSourceZoom: 2,
			maxSourceZoom: 19,
			bounds: [5.140242, 45.398181, 11.47757, 48.230651],
			tileSize: 256,
			tileUrl: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
			enabled: false
		}
	},

	/**
	 * Help information on how to use the project builder. Markdown supported.
	 */
	helpBuilderContent: 'This tool helps you define a spatial annonation project by letting you do the following:\n\n- Provide project specific instructions for the users (guidance on what you want the end users to annotate).\n- Define an area of interest, break it up into smaller task areas (grid cells).\n- Load and select imagery layers to be used for labeling (annotation).\n- Tweak the settings used by the labeler tool.\n\n[See the full documentation](https://github.com/microsoft/satellite-imagery-labeling-tool/blob/main/docs/Project-builder.md)',

	/**  Help information on how to use the project viewer. Markdown supported. */
	helpViewerContent: 'This tool helps you manage a spatial annonation project by letting you do the following:\n\n- Load and view a project.\n- View the results for all task areas and easily see which ones are complete.\n- Calculate stats.\n- Merge the results from all task areas into a single output file.\n\n[See the full documentation](https://github.com/microsoft/satellite-imagery-labeling-tool/blob/main/docs/Project-viewer.md)'
 };