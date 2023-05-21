/**
 * Settings specifically used by the labeler app.
 */
export let appSettings = {
	/** The subtitle to display for the app. */
	appSubtitle: 'Spatial imagery labeler tool',

	/** Specifies if the search bar should be shown if valid Azure Maps credentials are provided. */
	showSearchBar: true,
	
	/** Setting for automatically saving data in browser storage to help prevent data loss when browser refresh/closed by accident. */
	autoSave: {	
		enabled: true,	//Specifies if auto save is enabled.
		ttl: 30,		//Specifies the "time to live" for the data in days. After data has been stored longer than this without update, it will be erased.
		name: 'annotation-session-db',	//The storage id used by the app.
	},

	/**
	 * When saving data, this specifies if the extended Azure Maps GeoJSON specification should be used to maintain circles and rectangles.
	 * Note that circles are Point objects that include a subType property set to 'circle' and a radius property in meters.
	 * More details at: https://docs.microsoft.com/azure/azure-maps/extend-geojson
	 */
	saveExtendedGeoJSON: false,

	/** Default configuration to load when a task file hasn't been loaded into the tool. */
	defaultConfig: {
		"type": "FeatureCollection",
		"features": [
			{
				"type": "Feature",
				"id": "Default_annotation_task",
				"properties": {
					"project_name": "Default annotation task",
					"name": "Default_annotation_task",
					"instructions": "Welcome to the Spatial imagery labeling tool.\n\nTo get started, either load a project task file, or simply zoom into an area of interest and start drawing!",
					"instructions_on_load": true,
					"drawing_type": "polygons",
					"allow_wizard": true,					
					"customDataService": null,
					"customDataServiceLabel": null,
					"layers": {
						"ESRI World Imagery": {
							type: "TileLayer",
							minSourceZoom: 1,
							maxSourceZoom: 19,
							tileSize: 256,
							tileUrl: "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
						}, 
						'USGS - US Imagery': {
							type: 'OgcMapLayer',
							url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/WMTS/1.0.0/WMTSCapabilities.xml'
						}
					},
					"primary_classes": {
						"display_name": "Primary class",
						"property_name": "class",
						"names": [],
						"colors": []
					},
					"secondary_classes": {
						"display_name": "Secondary class",
						"property_name": "secondary_class",
						"names": []
					}
				},
				"geometry": {}
			}
		]
	},

	/** The opacity to make polygon fill areas when displayed. */
	fillOpacity: 0.8,

	/** Display name: file name in overpassScripts folder. */
	overpassScripts: {
		'Buildings': 'buildings.overpassql',
		'Sidewalks':  'sidewalks.overpassql',
		'Railways': 'railways.overpassql'
	},

	/** List of overpass turbo API endpoints. */
	overpassServers: [
		"https://overpass-api.de/api/",
		"https://overpass.kumi.systems/api/",
		"https://overpass.openstreetmap.fr/api/",
		"https://overpass.openstreetmap.ru/cgi/"
	],

	azureConfig: {
		'accountName': 'redcross8280',
		'containerName': 'redcross8280',
		'sasToken':'sp=racwdl&st=2023-05-20T19:06:58Z&se=2023-06-21T03:06:58Z&spr=https&sv=2022-11-02&sr=c&sig=28Mvl4x4YDr7%2FPIxAbkPiGYq4MOWMN5iiQ08s6sVARs%3D'
	} 
};