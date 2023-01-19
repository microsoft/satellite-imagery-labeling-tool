import { appSettings } from '../settings/labeler_settings.js'
import { mapSettings } from '../settings/map_settings.js'

import { Navbar, Flyout } from './controls/layoutControls.js'
import { Utils } from './utils.js';
import { SimpleLayerControl, SearchBarControl, AnnotationClassControl, SimpleContentControl } from './controls/customMapControls.js';
import { AddLayerDialog } from './controls/dialogs.js';

/** The main logic for the spatial annotation labeler app. */
export class LabelerApp {
	///////////////////////////
	// Private properties
	//////////////////////////

	#storage;
	#hasAZMapAuth = false;
	#snapGrid;
	#drawingManager;
	#popup;
	#baselayers = [];
	#layerControl;
	#classControl;
	#statsControl;
	#layerDialog;
	#layerOptions = {
		fadeDuration: 0,
		contrast: 0,
		saturation: 0,
		hueRotation: 0,
		maxBrightness: 1
	};
	#osmWizardWorker;
	#cdWorker;
	#featureSource = new atlas.source.DataSource();
	#fillLayer;
	#outlineLayer;
	#aoiSource = new atlas.source.DataSource();
	#bulkEditMode;
	#shiftIntervalToken;

	#navItems = [
		{
			type: 'menuItem',
			name: 'Import data',
			icon: 'add_circle',
			flyoutCard: 'importDataCard'
		},
		{
			type: 'menuItem',
			name: 'Layers',
			icon: 'layers',
			flyoutCard: 'layersCard'
		},
		{
			type: 'menuItem',
			name: 'Save',
			icon: 'save_as',
			flyoutCard: 'saveCard'
		},
		{
			type: 'menuItem',
			name: 'Screenshot',
			icon: 'photo_camera',
			flyoutCard: 'screenshotCard'
		},
		{
			type: 'menuItem',
			name: 'Power tools',
			icon: 'bolt',
			flyoutCard: 'powerToolsCard'
		},
		{
			type: 'menuItem',
			name: 'Instructions',
			icon: 'info',
			position: 'bottom',
			flyoutCard: 'instructionsCard'
		},
		{
			type: 'menuItem',
			name: 'Settings',
			icon: 'settings',
			position: 'bottom',
			flyoutCard: 'settingsCard'
		},
		{
			type: 'menuItem',
			name: 'Expand',
			icon: 'keyboard_double_arrow_right',
			position: 'bottom'
		},
		{
			type: 'menuItem',
			name: 'Collapse',
			icon: 'keyboard_double_arrow_left',
			position: 'bottom'
		},
		{
			type: 'flyoutCard',
			name: 'OSM Overpass Wizard',
			flyoutCard: 'importWizard'
		}
	];

	#checkSettings = ['fill_polygons', 'continuousDrawing', 'continuousDelete', 'snapGridEnabled', 'shapeDragEnabled', 'shapeRotateEnabled'];

	#shapePasteMode = 'Map center';
	#lastEdittedShape;
	#copiedShape;
	#mousePosition;

	///////////////////////////
	// Constructor
	//////////////////////////

	/** The main logic for the spatial annotation labeler app. */
	constructor() {
		const self = this;

		//Setup local storage for caching session state.
		self.#storage = localforage.createInstance({
			name: appSettings.autoSave.name
		});

		self.#initSettingsPanel();

		const hasAZMapAuth = Utils.isAzureMapsAuthValid(mapSettings.azureMapsAuth);
		this.#hasAZMapAuth = hasAZMapAuth;

		document.querySelector('#appSubtitle').innerHTML = appSettings.appSubtitle;
		document.querySelector('title').innerText = appSettings.appSubtitle;

		//Setup navbar.
		self.navbar = new Navbar(document.querySelector('.navbar'), self.#navItems);

		//Setup flyout.
		self.flyout = new Flyout(document.querySelector('.flyout'), self.#navItems);

		self.navbar.on('item-selected', (item) => {
			//If the same item is selected, toggle it close.
			if (self.flyout.isCurrentItem(item)) {
				self.flyout.hide();
			} else {
				self.flyout.show(item);

				if (item.name === 'Layers') {
					self.#updateLayerStates();
				} else if (item.name === 'Save') {
					document.getElementById('save-file-name').value = self.config.id;
				} else if (item.name === 'Screenshot') {
					document.getElementById('screenshot-file-name').value = self.config.id;
					document.getElementById('screenshot-title').value = self.config.properties.project_name;
				}
			}
		});

		self.flyout.on('closed', (item) => {
			self.navbar.setSelectedItem('');
			self.navbar.focus();
		});

		//Initialize a map instance.
		self.map = Utils.createMap('myMap', mapSettings.azureMapsAuth);

		self.map.events.add('ready', self.#mapReady);

		//Make clone of the default config.
		self.config = Object.assign({}, appSettings.defaultConfig.features[0]);

		//Check to see if the URL contains a URL path.
		const queryString = window.location.search;
		const urlParams = new URLSearchParams(queryString);

		if (urlParams.has("taskUrl")) {
			let taskUrl = urlParams.get('taskUrl');

			if (taskUrl && taskUrl !== '') {
				if (taskUrl.indexOf('%2F') > -1) {
					//Assume URL is encoded, decode it.
					taskUrl = decodeURIComponent(taskUrl);
				}

				fetch(taskUrl).then(x => {
					return x.json();
				}).then(fc => {
					if (fc.features && fc.features.length > 0) {
						self.config = fc.features[0];
					}
					self.#loadConfig();
				});
			}
		} else {
			self.#loadConfig();
		}

		document.getElementById('app-theme').onchange = self.#themeColorChanged;

		//Initialized the flyout panels.
		self.#initLoadPanel();
		self.#initLayerPanel();
		self.#initSavePanel();
		self.#initScreenshotPanel();
		self.#initPowerTools();

		self.#updateOsmLinks();
	}

	///////////////////////////
	// Flyout panel functions
	//////////////////////////

	/** Initializes the data loading panel. */
	#initLoadPanel() {
		const self = this;

		//File input for local config.
		const loadLocalTaskFile = document.getElementById('loadLocalTaskFile');
		loadLocalTaskFile.onchange = (e) => {
			if (e.target.files && e.target.files.length > 0) {
				//Ensure it meets our config file schema.
				e.target.files[0].text().then(data => {
					try {
						let fc = JSON.parse(data);
						if (fc && fc.type === 'FeatureCollection' && fc.features && fc.features.length > 0) {

							const defaultProps = Object.assign({}, appSettings.defaultConfig.features[0].properties);
							fc.features[0].properties = Object.assign(defaultProps, fc.features[0].properties);
							self.config = fc.features[0];

							self.#loadConfig();
						}
					} catch (e) {
						alert('Unable to load task file.');
					}
				});

				//Clear the file input so that the same file can be reloaded if desired.
				loadLocalTaskFile.value = null;
			}
		};

		//Click event for a button to load local config file.
		document.getElementById('loadLocalTask').onclick = () => {
			self.#popup.close();
			//self.flyout.hide();
			loadLocalTaskFile.click();
		};

		//File input for local data.
		const loadLocalDataFile = document.getElementById('loadLocalDataFile');
		loadLocalDataFile.onchange = (e) => {
			if (e.target.files && e.target.files.length > 0) {
				const file = e.target.files[0];

				//Create initial properties to assign to the imported shapes.
				const source = { source: `LocalFile|${file.name}` };

				if (file.name.toLowerCase().indexOf('.geojsonl') > -1) {
					//Parse as GeoJSONL
					e.target.files[0].text().then(data => {
						try {
							const features = [];
							const lines = data.split('\n');
							for (let i = 0, len = lines.length; i < len; i++) {
								try {
									features.push(JSON.parse(lines[i]));
								} catch { }
							}

							self.#importFeatures(r.features, source, true, true);
						} catch (e) {
							alert('Unable to load data file.');
						}
					});
				} else {
					//Try parsing the file using the Sptial IO module (GeoJSON, GeoRSS, GML, GPX, KML, KMZ, spatial CSV/Tab/Pipe).
					e.target.files[0].arrayBuffer().then(data => {
						try {
							//Use Spatial IO module to parse.
							atlas.io.read(data).then(
								//Success
								(r) => {
									self.#importFeatures(r.features, source, true, true);
								},

								//Error
								(msg) => {
									alert(msg);
								}
							);
						} catch (e) {
							alert('Unable to load data file.');
						}
					});
				}

				//Clear the file input so that the same file can be reloaded if desired.
				loadLocalDataFile.value = null;
			}
		};

		//Click event for a button to load local data file.
		document.getElementById('loadLocalData').onclick = () => {
			self.#popup.close();
			loadLocalDataFile.click();
			self.flyout.hide();
		};

		//Click event for loading data using the OSM wizard.
		document.getElementById('loadOsmWizard').onclick = () => {
			self.#popup.close();
			self.flyout.show('importWizard');
		};

		//Wire up OSM wizard
		self.#initOsmWizard();

		//Add a click event to the cancel button for the data importer.
		const cancelImportBtn = document.querySelector('#customImportLoadingScreen button');
		cancelImportBtn.onclick = self.#cancelDataImport;

		const cds = self.config.properties.customDataService;
		const cdsl = self.config.properties.customDataServiceLabel;

		if (cds && cdsl && cds !== '' && cdsl !== '') {
			document.getElementById('customImportBtn').style.display = '';
			document.querySelector('#customImportBtn span').innerText = cdsl;
		} else {
			document.getElementById('customImportBtn').style.display = 'none';
		}

		//Handle custom data importer
		document.getElementById('customImportBtn').onclick = () => {
			const server = self.config.properties.customDataService;

			if (server && server !== '') {
				self.#idleDrawing();

				//Complete the bulk edit phase.
				self.#classControl.completeBulkEdit();

				//get query values -> show loading screen -> run query in worker -> if success, load data and close flyout. if error, prompt user, leave flyout open.

				let cdWorker = self.#cdWorker;
				if (!cdWorker) {
					cdWorker = new Worker('workers/CustomDataWorker.js');
					cdWorker.onmessage = self.#customImportResponded;
					self.#cdWorker = cdWorker;
				}

				const map = self.map;
				const cam = map.getCamera();
				let bbox = cam.bounds;

				const areaOfInterest = self.config.geometry;

				if (areaOfInterest && areaOfInterest.type) {
					bbox = atlas.data.BoundingBox.fromData(areaOfInterest);
				} else if (cam.zoom < 12) {
					alert('Zoom in more.');
					return;
				}

				document.getElementById('customImportLoadingScreen').style.display = '';

				const dt = self.config.properties.drawing_type;

				//Use worker to filter data more using geospatial analysis.
				cdWorker.postMessage({
					server: server,
					bbox: bbox,
					aoi: areaOfInterest,
					existingGeoms: self.#getSourceData(true).features,
					allowLines: dt === 'lines' || dt === 'all',
					allowPolygons: dt === 'polygons' || dt === 'all'
				});

				cancelImportBtn.focus();
			}
		};
	}

	/*
	 * Event handler for when the custom data importer responds. `e.data` may contain and error property if the import failed. Otherwise it will be a feature collection of results.
	 * @param {*} e Worker response object. `e.data` is either a feature collection, or an object with an error property.
	 */
	#customImportResponded = (e) => {
		document.getElementById('customImportLoadingScreen').style.display = 'none';

		//If there is an error, alert the user and do nothing else.
		if (e.data.error) {
			alert(e.data.error);
			return;
		}

		//Import the features. No need to filter as that was done in the worker.
		this.#importFeatures(e.data, {
			source: 'CustomDataImport'
		}, false, true);
	}

	/**
	 * Event handler that cancels the OSM wizard worker.
	 */
	#cancelDataImport = () => {
		const self = this;
		if (self.#cdWorker) {
			self.#cdWorker.terminate();
			self.#cdWorker = null;
			document.getElementById('customImportLoadingScreen').style.display = 'none';
		}
	}

	/** Initializes the layer panel. */
	#initLayerPanel() {
		const self = this;

		//Capture user input on sliders for layer contrast/saturation/hur rotation.
		const layerSettings = document.querySelectorAll('#layersCard input[type="range"]');
		layerSettings.forEach(input => {
			input.oninput = () => {
				//Capture the updated layer option (contrast/saturation/hur rotation).
				self.#layerOptions[input.id] = parseFloat(input.value);

				//Apply the options to the layer.
				self.#layerControl.setLayerOptions(self.#layerOptions);
			};
		});

		//Create add layer dialog.
		self.#layerDialog = new AddLayerDialog(self.map);

		self.#layerDialog.on('close', (layers) => {
			if (layers) {
				self.#addLayers(layers);

				//Reload the layer list states.
				self.#updateLayerStates();
			}
		});

		//Reset filters button
		document.querySelector('#layersCard input[type="button"]').onclick = () => {
			//Update input and output values.
			layerSettings.forEach(input => {
				const val = (input.id === 'maxBrightness') ? 1 : 0;
				input.value = val;
				input.nextElementSibling.value = val;
			});

			//Capture the updated layer option (contrast/saturation/hur rotation).
			const opt = self.#layerOptions;
			opt.contrast = 0;
			opt.saturation = 0;
			opt.hueRotation = 0;
			opt.maxBrightness = 1;

			//Apply the options to the layer.
			self.#layerControl.setLayerOptions(opt);
		};

		//Add layer(s) button click
		document.querySelector('#layersCard button').onclick = () => {
			self.#popup.close();
			self.#layerDialog.show();
		};
	}

	/** Initializes the save panel. */
	#initSavePanel() {
		const self = this;

		const saveCard = document.getElementById('saveCard');
		saveCard.querySelector('button').onclick = async () => {
			self.#popup.close();

			let fileName = document.getElementById('save-file-name').value;

			const fileFormatElm = document.getElementById('save-file-format');
			const fileFormat = fileFormatElm.options[fileFormatElm.selectedIndex].innerText;

			const classPropsOnly = saveCard.querySelector('input[type="checkbox"]').checked;

			const data = self.#getSourceData(classPropsOnly, appSettings.saveExtendedGeoJSON, false);

			let outputBlob = null;
			let fileExt = fileFormat.toLowerCase();

			switch (fileFormat) {
				case 'KMZ':
					outputBlob = await atlas.io.writeCompressed(data, 'Blob', { format: 'KML' });
					break;
				case 'GeoJSONL':
					const geojsonl = JSON.stringify(data.features).replaceAll(',{"type":"Feature"', '\n{"type":"Feature"').slice(1, -1);
					outputBlob = new Blob([geojsonl], { type: "text/plain" });
					break;
				case 'GeoJSON':
					outputBlob = new Blob([JSON.stringify(data).replaceAll('{"type":"Feature"', '\n{"type":"Feature"')], { type: "text/plain" });
					break;
				case 'Pipe delimited':
					const outputPipeString = await atlas.io.write(data, { format: fileFormat, delimiter: '|' });
					outputBlob = new Blob([outputPipeString], { type: "text/plain" });
					fileExt = 'txt';
					break;
				case 'Tab delimited':
					const outputTabString = await atlas.io.write(data, { format: fileFormat, delimiter: '\t' });
					outputBlob = new Blob([outputTabString], { type: "text/plain" });
					fileExt = 'txt';
					break;
				default: //KML, GML, GPX, GeoRSS, CSV
					const outputString = await atlas.io.write(data, { format: fileFormat });
					outputBlob = new Blob([outputString], { type: "text/plain" });
					break;
			}

			if (!fileName.endsWith('.' + fileExt)) {
				fileName = `${fileName}.${fileExt}`;
			}

			if (outputBlob !== null) {
				Utils.saveFile(fileName, outputBlob);
			}
		};
	}

	/** Initializes the screenshot panel. */
	#initScreenshotPanel() {
		const self = this;
		const ssc = document.getElementById('screenshotCard');
		ssc.querySelector('button').onclick = () => {
			const dm = self.#drawingManager;
			if (dm.getOptions().mode !== 'idle') {
				//Idle the drawing manager.
				self.#idleDrawing();

				//Wait a moment for the map to repaint, then generate the screenshot.
				setTimeout(() => { self.#generateScreenshot(); }, 100);
			} else {
				self.#generateScreenshot();
			}
		};
	}

	/**
	 * Logic that generates a screenshot of the map and adds an optional title and legend to the image.
	 */
	#generateScreenshot() {
		//Generate the screenshot of the map.
		atlas.MapImageExporter.getImage(this.map).then((mapImg) => {
			const ssc = document.getElementById('screenshotCard');
			let fileName = document.getElementById('screenshot-file-name').value;

			if (!fileName.toLowerCase().endsWith('.png')) {
				fileName += '.png';
			}

			let cw = mapImg.width;
			let ch = mapImg.height;
			let mapYOffset = 0;
			let legendYOffset = 0;

			//If title provided, add space for it.
			const title = document.getElementById('screenshot-title').value;
			if (title && title !== '') {
				ch += 30;
				mapYOffset = 30;
				legendYOffset = 30;
			}

			//If legend or requested, add space for it.
			const includeLegend = ssc.querySelector('input[value="legend"]').checked;
			if (includeLegend) {
				ch += 30;
				mapYOffset += 30;
			}

			//Create an offscreen canvas.
			const oCanvas = document.createElement('canvas');
			oCanvas.width = cw;
			oCanvas.height = ch;

			const ctx = oCanvas.getContext('2d');

			//Color the background.
			ctx.fillStyle = 'white';
			ctx.fillRect(0, 0, cw, ch);
			ctx.fillStyle = 'black';

			//Draw title if one was provided.
			if (title && title !== '') {
				ctx.font = 'bold 25px sans-serif';
				ctx.fillText(title, 10, 22);
			}

			ctx.font = 'bold 18px sans-serif';

			//Draw legend if one was requested.
			if (includeLegend) {
				ctx.lineWidth = 3;
				ctx.lineJoin = 'round';
				ctx.strokeStyle = 'black';

				const textYOffset = legendYOffset + 22;

				let xOffset = 0;

				const primary = this.config.properties.primary_classes;
				for (let i = 0; i < primary.names.length; i++) {
					ctx.fillStyle = primary.colors[i];
					ctx.fillRect(xOffset + 10, legendYOffset + 5, 20, 20);
					ctx.strokeRect(xOffset + 10, legendYOffset + 5, 20, 20);

					ctx.fillStyle = 'black';
					ctx.fillText(primary.names[i], xOffset + 35, textYOffset);

					xOffset += 35 + ctx.measureText(primary.names[i]).width;
				}

				//Add an entry for the area of interest outline.
				ctx.beginPath();
				ctx.lineWidth = 10;
				ctx.lineJoin = 'round';
				ctx.strokeStyle = 'black';

				ctx.moveTo(xOffset + 5, legendYOffset + 15);
				ctx.lineTo(xOffset + 50, legendYOffset + 15);
				ctx.stroke();

				if (ctx.setLineDash !== undefined) {
					ctx.setLineDash([15, 15]);
				}

				if (ctx.mozDash !== undefined) {
					ctx.mozDash = [15, 15];
				}

				ctx.lineWidth = 5;
				ctx.strokeStyle = 'yellow';
				ctx.stroke();
				ctx.closePath();

				ctx.fillStyle = 'black';
				ctx.fillText('Area of interest', xOffset + 55, textYOffset);
			}

			//Draw the map image.
			ctx.drawImage(mapImg, 0, mapYOffset);

			//Check to see if stats should be included.
			const includeStats = ssc.querySelector('input[value="stats"]').checked;

			if (includeStats) {
				const stats = this.#statsControl.getOptions().content;
				ctx.fillStyle = 'black';
				ctx.fillText(stats, oCanvas.width - ctx.measureText(stats).width - 10, 20);
			}

			//Get a blob of the canvas and save it as a file.
			oCanvas.toBlob((outputBlob) => {
				Utils.saveFile(fileName, outputBlob);
			});
		}, function (e) {
			alert(e.message);
		});
	}

	/** Initializes the settings panel. */
	#initSettingsPanel() {
		const self = this;

		const elms = Utils.getElementsByIds(['continuousDrawing', 'continuousDelete', 'fill_polygons', 'snapGridEnabled', 'shapeDragEnabled', 'shapeRotateEnabled', 'drawingModeSelector', 'clearCacheBtn', 'shapePasteMode']);

		elms.continuousDrawing.onchange = (e) => {
			self.config.properties.continuousDrawing = elms.continuousDrawing.checked;
			self.#saveSettings();
		};

		elms.continuousDelete.onchange = (e) => {
			self.config.properties.continuousDelete = elms.continuousDelete.checked;
			self.#saveSettings();
		};

		elms.fill_polygons.onchange = () => {
			self.config.properties.fill_polygons = elms.fill_polygons.checked;

			if (self.#drawingManager) {
				self.#updateShapeColors();
			}

			self.#saveSettings();
		};

		elms.snapGridEnabled.onchange = () => {
			const sg = self.#snapGrid;
			if (sg) {
				sg.setOptions({ enabled: elms.snapGridEnabled.checked });
			}

			self.#saveSettings();
		};

		elms.shapeDragEnabled.onchange = () => {
			const dm = self.#drawingManager;
			if (dm) {
				dm.setOptions({ shapeDraggingEnabled: elms.shapeDragEnabled.checked });
			}

			self.#saveSettings();
		};

		elms.shapeRotateEnabled.onchange = () => {
			const dm = self.#drawingManager;
			if (dm) {
				dm.setOptions({ shapeRotationEnabled: elms.shapeRotateEnabled.checked });
			}

			self.#saveSettings();
		};

		elms.drawingModeSelector.onchange = () => {
			const dm = self.#drawingManager;
			if (dm) {
				dm.setOptions({ interactionType: Utils.getSelectValue(elms.drawingModeSelector, 'innerText') });
			}

			self.#saveSettings();
		};

		elms.shapePasteMode.onchange = () => {
			self.#shapePasteMode = Utils.getSelectValue(elms.shapePasteMode, 'innerText');

			self.#saveSettings();
		};

		elms.clearCacheBtn.onclick = async () => {
			if (confirm('Do you want to delete all cached data for the labeler?')) {
				await self.#storage.clear();
			}
		};
	}

	/** Initialize power tools. */
	#initPowerTools() {
		const self = this;
		const shiftButtons = document.querySelectorAll('#shiftDataButtons button');
		const dataShiftFilter = document.getElementById('dataShiftFilter');

		shiftButtons.forEach(sb => {
			sb.onmousedown = () => {

				const shiftData = () => {
					const self = this;
					let filter = dataShiftFilter.options[dataShiftFilter.selectedIndex].value;

					if (filter === '') {
						filter = null;
					}

					const heading = parseFloat(sb.getAttribute('rel'));

					//Calculate the meters per pixels
					const cam = self.map.getCamera();
					const offset = Utils.groundResolution(cam.center[1], cam.zoom);

					const fc = self.#getSourceData(false, true, true);
					Utils.shiftFeatureCollection(fc, offset, heading, filter);

					self.#featureSource.setShapes(fc);
					self.#saveSession();
				};

				shiftData();

				self.#shiftIntervalToken = setInterval(shiftData, 100);
			};

			sb.onmouseup = () => {
				clearInterval(self.#shiftIntervalToken);
			};
		});

		document.getElementById('rectangleDeleteBtn').onclick = () => {
			self.#classControl.trigger('bulkedit', {
				mode: 'delete-rectangle'
			});
		};

		document.getElementById('polygonDeleteBtn').onclick = () => {
			self.#classControl.trigger('bulkedit', {
				mode: 'delete-polygon'
			});
		};
	}

	///////////////////////////
	// Map functions
	//////////////////////////

	/**
	 * Event handler for when the map is ready to be accessed.
	 */
	#mapReady = () => {
		const self = this;
		const map = self.map;

		//Create a reusable popup.
		self.#popup = new atlas.Popup({
			closeButton: false,
			fillColor: getComputedStyle(document.body).backgroundColor
		});

		//Set up a snap grid for better alignment of adjacent points when drawing.
		self.#snapGrid = new atlas.drawing.SnapGridManager(map, {
			showGrid: false,
			resolution: 5,
			enabled: document.getElementById('snapGridEnabled').checked
		});

		//Using drawing tools in combination with snap grid.
		const dm = new atlas.drawing.DrawingManager(map, {
			toolbar: new atlas.control.DrawingToolbar({
				buttons: self.#getDrawingButtons(),
				position: 'top-right',
				style: 'light'
			}),
			shapeRotationEnabled: false,
			shapeDraggingEnabled: false
		});
		self.#drawingManager = dm;

		//Monitor for when drawing has started.
		map.events.add('drawingstarted', dm, (shape) => {
			if(dm.getOptions().mode === 'edit-geometry') {
				//Store a copy of the last editted shape.
				const shapeCopy = shape.toJson();
								
				//Delete ids to prevent issues.
				delete shapeCopy.id;
				delete shapeCopy.properties._azureMapsShapeId;

				self.#lastEdittedShape = shapeCopy;
			}
		});

		//Monitor for when drawing has been completed.
		map.events.add('drawingcomplete', dm, (e) => {
			self.#drawingComplete(e);
		});

		//When drawing mode changed, close the popup.
		map.events.add('drawingmodechanged', dm, (mode) => {
			if (mode !== 'idle') {
				//Complete the bulk edit phase.
				self.#classControl.completeBulkEdit();
			}

			self.#popup.close();
		});

		//Add copy/paste handling
		map.getMapContainer().addEventListener('keyup', (e) => {
			//Check to see if the control button is held.
			if(e.ctrlKey) {
				//Check to see if user pressed C to copy.
				if(e.keyCode === 67) {
					//Ensure that the drawing manager is in edit mode and a shape has been selected.
					if(dm.getOptions().mode === 'edit-geometry' && self.#lastEdittedShape) {
						//Copy the selected shape.
						self.#copiedShape = self.#lastEdittedShape;							
					}
				} 
				
				//Check to see if user pressed V to paste and if their is a copied shape in memory.
				else if (e.keyCode === 86 && self.#copiedShape){
					self.#pasteShape();
				}
			}
		});

		//Get layers from the drawing manager and modify line styles.
		const layers = dm.getLayers();
		const dwgLineOptions = {
			strokeColor: 'yellow',
			strokeWidth: 3
		};

		layers.lineLayer.setOptions(dwgLineOptions);
		layers.polygonOutlineLayer.setOptions(dwgLineOptions);
		layers.polygonLayer.setOptions({ fill: 'transparent' });

		const previewLayers = dm.getPreviewLayers();
		previewLayers.lineLayer.setOptions(dwgLineOptions);
		previewLayers.polygonOutlineLayer.setOptions(dwgLineOptions);

		//Add the feature source. Shapes will be moved to this data source for visualization.
		//For performance, the drawing manager source will only be used when a shape is being editted or drawn.
		const featureSource = self.#featureSource;
		map.sources.add(featureSource);

		//Specify custom properties to be the id for feature state.
		map.map.getSource(featureSource.getId()).promoteId = '_azureMapsShapeId';

		//Create layers for displaying the featues.
		self.#fillLayer = new atlas.layer.PolygonLayer(featureSource);
		self.#outlineLayer = new atlas.layer.LineLayer(featureSource, null, {
			strokeWidth: 3
		});

		//Create a layer for highlighting shapes when hovered.
		const hoverLayer = new atlas.layer.LineLayer(featureSource, null, {
			strokeColor: 'white',
			strokeWidth: 11,
			blur: 7,
			strokeOpacity: [
				'case',
				['boolean', ['feature-state', 'hovered'], false],
				1, 0
			]
		});

		//Add the layers to the map.
		map.layers.add([self.#fillLayer, self.#outlineLayer, hoverLayer], 'labels');

		//Add a click event to the fill layer.
		map.events.add('click', self.#fillLayer, self.#fillClicked);

		//Add hover effect on mouse move.
		map.events.add('mousemove', (e) => {
			self.#mousePosition = e.position;

			//Remove previous hover state.
			map.map.removeFeatureState({ source: featureSource.getId() });

			//If not drawing a shape, or not in the process of editting one, set the map pointer and check to see if hovering over a shape.
			if (!self.#getDrawingMode().startsWith('draw') && !dm.editHelper.isMouseDown) {
				map.getCanvas().style.cursor = 'grab';

				for (let i = 0; i < e.shapes.length; i++) {
					//If drawing manager is idle, check to see if shape from drawing manager hovered.
					if (e.shapes[i] instanceof atlas.Shape && featureSource.getShapeById(e.shapes[i].getId()) !== null) {
						map.map.setFeatureState({ source: featureSource.getId(), id: e.shapes[i].getProperties()._azureMapsShapeId }, { hovered: true });
						map.getCanvas().style.cursor = 'pointer';
						break;
					}
				}
			}
		});

		map.events.add('mouseout', () => { self.#mousePosition = null });

		//Create a layer for visualizing the area of interest on the map.		
		map.sources.add(self.#aoiSource);
		map.layers.add(new atlas.layer.LineLayer(self.#aoiSource, null, {
			strokeWidth: 3,
			strokeColor: 'yellow',
			strokeDashArray: [2, 2]
		}), 'labels');

		//Add a brind data into view control and a zoom control to map.
		map.controls.add([
			new atlas.control.BringDataIntoViewControl({
				includeMarkers: false,
				includeImageLayers: false,
				sources: [self.#aoiSource, self.#featureSource]
			}),
			new atlas.control.ZoomControl()], {
			position: 'bottom-right'
		});

		//Add the search bar if valid Azure Maps credentials provided, and app settings have this feature enabled.
		if (self.#hasAZMapAuth && appSettings.showSearchBar) {
			map.controls.add(new SearchBarControl(), {
				position: 'top-left'
			});
		}

		document.getElementById('dataShiftFilter').options[1].style.display = (self.#hasAZMapAuth) ? '' : 'none';

		//Create a layer control and add it to the map.
		let layerControl = new SimpleLayerControl(self.#baselayers, true);
		map.controls.add(layerControl, {
			position: 'top-left'
		});
		self.#layerControl = layerControl;

		//Create a second drawing manager to power selection for bulk editting.
		const dm2 = new atlas.drawing.DrawingManager(map, {
		});

		//Monitor for when drawing has been completed.
		map.events.add('drawingcomplete', dm2, (shape) => {
			//Find all shapes the intersect the drawing shape.
			const g = shape.toJson().geometry;
			const fc = self.#getSourceData(null, null, true);
			const ids = [];

			//Do an intersection test and capture the intersecting feature ids (we are testing on the area where circles have been converted to polygons, thus why we are not updating these features directly.)
			fc.features.forEach(f => {
				if (turf.booleanIntersects(f.geometry, g)) {
					ids.push(f.id);
				}
			});

			//Loop through all shapes and update the properties if their id was captured in the intersection test.
			if (self.#bulkEditMode.mode.startsWith('delete')) {
				ids.forEach(id => {
					self.#featureSource.removeById(id);
				});

				self.#classControl.completeBulkEdit();
			} else {
				self.#featureSource.getShapes().forEach(s => {
					if (ids.indexOf(s.getId()) > -1) {
						s.setProperties(Object.assign(s.getProperties(), self.#bulkEditMode.value));
					}
				});
			}

			//Save the session.
			self.#saveSession();

			//Get ride of the drawn selection area.
			dm2.getSource().clear();
		});

		const dm2Layers = dm2.getLayers();
		dm2Layers.lineLayer.setOptions(dwgLineOptions);
		dm2Layers.polygonOutlineLayer.setOptions(dwgLineOptions);

		//Create an annotation class control, set the classes based on the config settings, and add it to the map.
		const classControl = new AnnotationClassControl();
		classControl.setClasses(self.config.properties.primary_classes, self.config.properties.secondary_classes);
		map.controls.add(classControl, {
			position: 'top-right'
		});
		self.#classControl = classControl;

		classControl.on('bulkedit', (opt) => {
			//Idle the drawing manager.
			dm.setOptions({ mode: 'idle' });

			let mode = 'idle';

			if (opt && opt.mode) {
				if (opt.mode.indexOf('rectangle') > -1) {
					mode = 'draw-rectangle';
				} else if (opt.mode.indexOf('polygon') > -1) {
					mode = 'draw-polygon';
				}
			}

			dm2.setOptions({
				mode: mode
			});

			//Set the bulk edit mode.
			self.#bulkEditMode = opt;
		});

		//Create a simple control to show stats.
		self.#statsControl = new SimpleContentControl({ visible: false });
		map.controls.add(self.#statsControl, {
			position: 'bottom-left'
		});
		self.#calcStats();

		//When the map is done moving, update the OSM links.
		self.map.events.add('moveend', self.#updateOsmLinks);

		//Update colors.
		self.#updateShapeColors();
		self.#themeColorChanged();

		//Load user settings from local storage.
		self.#loadSettings();
	}

	/**
	 * Event handler for when the main polygon layer is clicked.
	 * @param {*} e Layer click event argument.
	 */
	#fillClicked = (e) => {
		//Ensure a shape was clicked.
		if (e.shapes && e.shapes.length > 0 && e.shapes[0] instanceof atlas.Shape) {
			const shape = e.shapes[0];

			const self = this;
			const dm = self.#drawingManager;
			const mode = dm.getOptions().mode;

			if (mode === 'edit-geometry') {
				if(!dm.getSource().getShapeById(shape.getId())){
					//Idle drawing manager.
					self.#idleDrawing();

					//Remove the shape from the main source and add to drawing manager source, then enable editting on it.
					//self.#featureSource.removeById(shape.getId());
					const id = shape.getId();
					self.#forceRemoveShape(id);

					dm.edit(shape);
				}
			} else if (mode === 'erase-geometry') {
				//If continuous delete disabled, idle the drawing manager.
				if (!document.getElementById('continuousDelete').checked) {
					self.#idleDrawing();
				}

				//If in erase mode, delete the clicked feature from the source and idle drawing manager.
				const id = shape.getId();
				self.#forceRemoveShape(id);

				self.#saveSession();
			} else if (mode === 'idle') {
				if (self.#bulkEditMode && self.#bulkEditMode.mode === 'point') {
					shape.setProperties(Object.assign(shape.getProperties(), self.#bulkEditMode.value));
					self.#saveSession();
				} else {
					//If no drawing is going on, show the popup for the clicked shape.
					self.#showEditPopup(e);
				}
			}
		}
	};

	#showEditPopup = (e) => {
		const self = this;

		//Only show popup if drawing mode is idle, and a shape from the drawing manager was clicked.
		if (self.#getDrawingMode() === 'idle' && e.shapes.length > 0 && e.shapes[0] instanceof atlas.Shape && self.#featureSource.getShapeById(e.shapes[0].getId()) !== null) {
			self.#popup.shape = e.shapes[0];

			self.#createPopupContent(self.#popup);

			self.#popup.setOptions({
				position: e.position
			});
			self.#popup.open(self.map);
		}
	}

	/**
	 * Removes one or more shapes that have a specific ID but only triggers one refresh.
	 * @param {*} id The shape id.
	 */
	#forceRemoveShape(id) {
		const self = this;
		const shapes = self.#featureSource.toJson();
		for(let i=shapes.features.length - 1;i >= 0;i--){
			if(shapes.features[i].id === id){
				shapes.features.splice(i, 1);
			}
		}

		self.#featureSource.setShapes(shapes);
	}

	/**
	 * Replaces a shape in a data source and only triggers a single refresh.
	 * @param {*} shape The shape to replace.
	 */
	#replaceShape(shape) {
		const self = this;
		const id = shape.getId();
		const shapes = self.#featureSource.toJson();
		for(let i=shapes.features.length - 1;i >= 0;i--){
			if(shapes.features[i].id === id){
				shapes.features.splice(i, 1);
			}
		}

		shapes.features.push(shape.toJson());

		self.#featureSource.setShapes(shapes);
	}

	#createPopupContent(popup) {
		const self = this;
		const shape = popup.shape;
		const props = shape.getProperties();
		const cp = self.config.properties;

		const primary = cp.primary_classes;
		const secondary = cp.secondary_classes;
		const hasSecondary = secondary && secondary.names && secondary.names.length > 0;

		const popupContainer = document.createElement('div');
		popupContainer.className = 'popup-class';

		const titleElm = document.createElement('h3');
		titleElm.innerText = 'Edit class properties';
		popupContainer.appendChild(titleElm);

		const table = document.createElement('table');
		popupContainer.appendChild(table);

		const head = document.createElement('thead');
		head.innerHTML = `<tr><td>Primary class</td>${hasSecondary ? '<td>Secondary class</td>' : ''}</tr>`;

		table.appendChild(head);

		const row = document.createElement('tr');
		table.appendChild(row);

		//Add list of primary classes.
		const cell1 = document.createElement('td');
		row.appendChild(cell1);

		for (let i = 0; i < primary.names.length; i++) {
			const c = (primary.colors && i < primary.colors.length) ? primary.colors[i] : null;
			const isChecked = primary.names[i] === props[primary.property_name];

			const l = Utils.createCheckInput('radio', primary.names[i], isChecked, 'popup-primary-class-group');
			l.style.color = c;
			cell1.appendChild(l);
		}

		if (hasSecondary) {
			//Add list of secondary classes.
			const cell2 = document.createElement('td');
			row.appendChild(cell2);

			for (let i = 0; i < secondary.names.length; i++) {
				const isChecked = secondary.names[i] === props[secondary.property_name];
				const l = Utils.createCheckInput('radio', secondary.names[i], isChecked, 'popup-secondary-class-group');
				cell2.appendChild(l);
			}
		}

		const okBtn = document.createElement('button');
		okBtn.innerText = 'Save';
		okBtn.className = 'text-btn-round';
		okBtn.setAttribute('type', 'button');
		okBtn.onclick = () => {
			document.getElementsByName('popup-primary-class-group').forEach(e => {
				if (e.checked) {
					props[primary.property_name] = e.value;
				}
			});

			if (hasSecondary) {
				document.getElementsByName('popup-secondary-class-group').forEach(e => {
					if (e.checked) {
						props[secondary.property_name] = e.value;
					}
				});
			}

			shape.setProperties(props);
			popup.close();

			self.#saveSession();
		};

		popupContainer.appendChild(okBtn);

		const cancelBtn = document.createElement('button');
		cancelBtn.innerText = 'Cancel';
		cancelBtn.className = 'text-btn-round';
		cancelBtn.setAttribute('type', 'button');
		cancelBtn.onclick = () => {
			popup.close();
		};

		popupContainer.appendChild(cancelBtn);

		popup.setOptions({ content: popupContainer });
	};

	/**
	 * Updates the color settings of layers based on changes to config settings.
	 */
	#updateShapeColors() {
		const self = this;
		const cp = self.config.properties;
		const primaryClasses = cp.primary_classes;

		const polyOptions = { fillColor: cp.fill_polygons ? 'DodgerBlue' : 'transparent', fillOpacity: appSettings.fillOpacity };

		if (primaryClasses.colors.length > 0) {
			//Create a match expression based on the primary classes property name.
			const fillColorExp = ['match', ['get', primaryClasses.property_name]];

			//Map the names to the colors.
			for (let i = 0; i < primaryClasses.names.length; i++) {
				fillColorExp.push(primaryClasses.names[i], primaryClasses.colors[i]);
			}

			//Set default color to use when drawing.
			fillColorExp.push('yellow');

			if (cp.fill_polygons) {
				polyOptions.fillColor = fillColorExp
			}
			const lineOptions = { strokeColor: fillColorExp };

			//Set colors on main layers.
			self.#outlineLayer.setOptions(lineOptions);
		}

		self.#fillLayer.setOptions(polyOptions);
	}

	/**
	 * Focuses the map view on the area of interest.
	 */
	#focusOnAoi() {
		const self = this;
		const aoi = self.config.geometry;
		let bbox = self.config.bbox;

		//If no bounding box in vconfig, try calculating from the area of interest, or fallback to world view.
		if (!bbox) {
			if (aoi && (aoi.type === 'Polygon' || aoi.type === 'MultiPolygon')) {
				bbox = atlas.data.BoundingBox.fromData(config);
			} else {
				//Default to world view.
				bbox = [-180, -85, 180, 85];
			}
		}

		self.map.setCamera({
			bounds: bbox,
			padding: 100
		});
	}

	/**
	 * Imports an array of feature into the map.
	 * @param {*} features Array of features to import.
	 * @param {*} newProps Optional. A set of new properties to assign to the feature.
	 * @param {*} filter Specifies if the features should be filtered based on the configuration settings.
	 * @param {*} setClass Specifies if the class values should be set on the features, if not already specified in the feature.
	 */
	#importFeatures(features, newProps, filter, setClass) {
		const self = this;
		const cp = self.config.properties;

		if (features && features.length > 0) {
			if (filter) {
				features = Utils.filterFeatures(features, cp.drawing_type, self.config.geometry, newProps);
			} else if (newProps) {
				features.forEach(f => {
					Object.assign(f.properties, newProps);
				});
			}

			if (features.length > 0) {
				if (setClass) {
					const n1 = cp.primary_classes.property_name;
					const sc = cp.secondary_classes;
					const c1 = self.#classControl.getPrimaryClass();
					const c2 = (sc && sc.property_name && sc.names && sc.names.length > 0) ? self.#classControl.getSecondaryClass() : null;

					features.forEach(f => {
						if (!f.properties[n1]) {
							f.properties[n1] = c1;
						}

						if (c2 && !f.properties[sc.property_name2]) {
							f.properties[sc.property_name] = c2;
						}
					});
				}

				self.#featureSource.add(features);
				self.#saveSession();
			}
		}
	}

	///////////////////////////
	// Config & layer functions
	//////////////////////////

	/** Loads a configuration file and alters the settings of the labeler. */
	#loadConfig() {
		const self = this;

		//Clear the basemap layers list from the current session.
		if (self.layerControl) {
			self.layerControl.clear();
		}

		//Get the new and default config details.
		const config = self.config;
		const cp = config.properties;
		const dc = appSettings.defaultConfig;

		const dataShiftFilter = document.getElementById('dataShiftFilter');
		dataShiftFilter.selectedIndex = 0;

		//Add the area of interest and focus the map view on it.
		if (config.geometry && (config.geometry.type === 'Polygon' || config.geometry.type === 'MultiPolygon')) {
			self.#aoiSource.setShapes(config);
			self.#focusOnAoi();
		}

		//Idle the drawing manager.
		const dm = self.#drawingManager;
		if (dm) {
			self.#idleDrawing();

			//Save the current session.
			self.#saveSession();

			//Remove all data that's in the feature source.
			self.#featureSource.clear();
		}

		if (cp) {
			document.querySelector('#appTitle').innerHTML = cp.project_name || '';

			self.map.events.add('ready', () => {
				self.#drawingManager.getOptions().toolbar.setOptions({
					buttons: self.#getDrawingButtons()
				});

				self.#baselayers = [];
				self.#addLayers(cp.layers);
				self.#updateLayerStates();

				//If a non-Azure Maps layer is in the config, set initial layer to the first one.
				if (cp.layers) {
					const layerNames = Object.keys(cp.layers);
					if (layerNames.length > 0)
						self.#layerControl.setVisibleLayer(layerNames[0]);
				}

				self.#classControl.setClasses(cp.primary_classes, cp.secondary_classes);
			});

			const instructions = cp.instructions || dc.features[0].properties.instructions || '';

			document.getElementById('instructions').innerHTML = marked.parse(instructions);
			if (cp.instructions_on_load) {
				self.navbar.setSelectedItem('Instructions');
			}

			const wizardDisplay = (cp.allow_wizard && cp.drawing_type !== 'rectangle') ? '' : 'none';
			document.getElementById('loadOsmWizard').style.display = wizardDisplay;
			dataShiftFilter.options[2].style.display = wizardDisplay;

			if (dm) {
				self.#updateShapeColors();
			}

			//Set visibility of custom data service
			if (cp.customDataService && cp.customDataService !== '' && cp.customDataServiceLabel && cp.customDataServiceLabel !== '') {
				document.getElementById('customImportBtn').style.display = '';
				document.querySelector('#customImportBtn span').innerText = cp.customDataServiceLabel;
				dataShiftFilter.options[3].style.display = '';
				dataShiftFilter.options[3].innerText = cp.customDataServiceLabel.replace(/^Add /gi, '');
			} else {
				document.getElementById('customImportBtn').style.display = 'none';
				dataShiftFilter.options[3].style.display = 'none';
			}
		}

		self.#checkStorage();
	}

	/** Adds layers to the labeler and layer control. */
	#addLayers(layerConfig) {
		const self = this;
		const lc = self.#layerControl;

		Object.keys(layerConfig).forEach(key => {
			var l = Utils.inflateLayer(self.map, key, Object.assign({}, layerConfig[key], self.#layerOptions));

			if (l) {
				if (typeof layerConfig[key].enabled === 'undefined') {
					l.enabled = true;
					layerConfig[key].enabled = true;
				} else {
					l.enabled = layerConfig[key].enabled;
				}

				self.#baselayers.push(l);
			}
		});

		if (lc) {
			lc.loadLayers(self.#baselayers);
		}
	}

	/** Updates the state of selected layers in the layer control. */
	#updateLayerStates() {
		const self = this;
		const states = self.#layerControl.getLayerStates();
		const list = document.getElementById('layerCardLayerList');
		list.innerHTML = '';

		Object.keys(states).forEach(key => {
			let item = Utils.createCheckInput('checkbox', key, states[key]);
			item.setAttribute('rel', key);
			list.appendChild(item);
			item.onclick = () => {
				self.#layerControl.setLayerEnabledState(item.getAttribute('rel'), item.firstChild.checked);
			};
		});
	}

	///////////////////////////
	// Drawing functions
	//////////////////////////

	/** Gets the current drawing mode. */
	#getDrawingMode() {
		return this.#drawingManager.getOptions().mode;
	}

	/** Idles the drawing manager. */
	#idleDrawing() {
		this.#drawingManager.setOptions({ mode: 'idle' });
	}

	/**
	 * Get an array of the buttons to show in the drawing manager based on project settings.
	 * @returns An array of drawing buttons.
	 */
	#getDrawingButtons() {
		const btns = [];
		const dt = this.config.properties.drawing_type;

		if (dt === 'lines' || dt === 'all') {
			btns.push('draw-line');
		}

		if (dt === 'polygons' || dt === 'all') {
			btns.push('draw-polygon', 'draw-rectangle', 'draw-circle');
		}

		if (dt === 'rectangles') {
			btns.push('draw-rectangle');
		}

		btns.push('edit-geometry', 'erase-geometry');

		return btns;
	}

	/**
	 * Event handler for when a drawing has been drawn, editted, moved, or rotated.
	 */
	#drawingComplete(shape) {
		const self = this;
		const dm = self.#drawingManager;
		const props = shape.getProperties();
		const coords = shape.getCoordinates();

		//Sometimes its possible to create a polygon in the drawing manager without actually drawing it. Ignore those.
		if (shape.getType() === 'Polygon' && (coords.length === 0 || coords[0].length === 0)) {
			return;
		}

		//Update the shapes "source" property based on the currently select layer/basemap.
		shape.setProperties(Object.assign(props, { source: `Drawn|${self.#layerControl.getCurrentLayer()}` }));

		//Don't make updates when in edit mode.
		if (self.#getDrawingMode() !== 'edit-geometry') {

			//If continuous drawing disabled, idle the drawing manager.
			if (!document.getElementById('continuousDrawing').checked) {
				self.#idleDrawing();
			}

			const classControl = self.#classControl;
			const cp = self.config.properties;

			if (!props[cp.primary_classes.property_name]) {
				props[cp.primary_classes.property_name] = classControl.getPrimaryClass();
			}

			if (cp.secondary_classes && cp.secondary_classes.property_name && !props[cp.secondary_classes.property_name]) {
				props[cp.secondary_classes.property_name] = classControl.getSecondaryClass();
			}

			//Maintain circle properties so that they can easily be editted, and skip snapping.
			shape.setProperties(props);

			//Snap the shape coordinates if it is not a circle.
			if (!shape.isCircle()) {
				self.#snapGrid.snapShape(shape);
			}
		}

		//Move the shape to the feature source.
		dm.getSource().remove(shape);
		//self.#featureSource.add(shape);
		self.#replaceShape(shape);

		//Stop tracking the last editted shape.
		self.#lastEdittedShape = null;

		self.#saveSession();
	}

	///////////////////////////
	// OSM Wizard functions
	//////////////////////////

	/** Initializes the OSM Overpas wizard. */
	#initOsmWizard() {
		const self = this;

		const osmScriptsElm = document.getElementById('osmScripts');

		const defaultScriptOption = document.createElement('option');
		defaultScriptOption.setAttribute('selected', 'selected')
		osmScriptsElm.appendChild(defaultScriptOption);

		if (appSettings.overpassScripts) {
			Object.keys(appSettings.overpassScripts).forEach(key => {
				const option = document.createElement('option');
				option.innerText = key;
				osmScriptsElm.appendChild(option);
			});
		}

		osmScriptsElm.onchange = () => {
			const value = osmScriptsElm.options[osmScriptsElm.selectedIndex].innerText;
			const textarea = document.querySelector('#importWizard textarea');

			if (value === '') {
				textarea.value = '';
			} else {
				let scriptFile = appSettings.overpassScripts[value];

				fetch(`overpassScripts/${scriptFile}`).then(r => r.text()).then(script => {
					textarea.value = script;
				});
			}
		};

		const osmServerElm = document.getElementById('osmServers');
		if (appSettings.overpassServers) {
			appSettings.overpassServers.forEach(s => {
				const option = document.createElement('option');
				option.innerText = s;
				osmServerElm.appendChild(option);
			});
		}

		//Add a click event to the cancel button for the OSM wizard.
		const cancelWizardBtn = document.querySelector('#osmLoadingScreen button');
		cancelWizardBtn.onclick = self.#cancelWizard;

		const importBtn = document.querySelector('#importWizard button');
		importBtn.onclick = () => {
			self.#idleDrawing();

			//Complete the bulk edit phase.
			self.#classControl.completeBulkEdit();

			//get query values -> show loading screen -> run query in worker -> if success, load data and close flyout. if error, prompt user, leave flyout open.

			let osmWizardWorker = self.#osmWizardWorker;
			if (!osmWizardWorker) {
				osmWizardWorker = new Worker('workers/OsmSearchWorker.js');
				osmWizardWorker.onmessage = self.#wizardResponded;
				self.#osmWizardWorker = osmWizardWorker;
			}

			const map = self.map;
			const cam = map.getCamera();
			let bbox = cam.bounds;

			const areaOfInterest = self.config.geometry;

			if (areaOfInterest && areaOfInterest.type) {
				bbox = atlas.data.BoundingBox.fromData(areaOfInterest);
			} else if (cam.zoom < 12) {
				alert('Zoom in more.');
				return;
			}

			const server = Utils.getSelectValue(osmServerElm);
			const query = document.querySelector('#importWizard textarea').value;

			document.getElementById('osmLoadingScreen').style.display = '';

			const dt = self.config.properties.drawing_type;

			//Use worker to filter data more using geospatial analysis.
			osmWizardWorker.postMessage({
				server: server,
				query: query,
				center: Math.round(cam.center),
				bbox: bbox,
				aoi: areaOfInterest,
				existingGeoms: self.#getSourceData(true).features,
				allowLines: dt === 'lines' || dt === 'all',
				allowPolygons: dt === 'polygons' || dt === 'all'
			});

			cancelWizardBtn.focus();
		};
	}

	/**
	 * Event handler for when the OSM wizard responds. `e.data` may contain and error property if the wizard failed. Otherwise it will be a feature collection of results.
	 * @param {*} e Worker response object. `e.data` is either a feature collection, or an object with an error property.
	 */
	#wizardResponded = (e) => {
		document.getElementById('osmLoadingScreen').style.display = 'none';

		//If there is an error, alert the user and do nothing else.
		if (e.data.error) {
			alert(e.data.error);
			return;
		}

		//Import the features. No need to filter as that was done in the worker.
		this.#importFeatures(e.data, {
			source: 'OSMOverpass'
		}, false, true);
	}

	/**
	 * Event handler that cancels the OSM wizard worker.
	 */
	#cancelWizard = () => {
		const self = this;
		if (self.#osmWizardWorker) {
			self.#osmWizardWorker.terminate();
			self.#osmWizardWorker = null;
			document.getElementById('osmLoadingScreen').style.display = 'none';
		}
	}

	/**
	 * Updates the links to OSM and Overpass Turbo sites that appear in the OSM wizard with location information related to the current map view.
	 */
	#updateOsmLinks = () => {
		const cam = this.map.getCamera();

		document.getElementById('overpass-link').href = `https://overpass-turbo.eu/?lat=${cam.center[1]}&lon=${cam.center[0]}&zoom=${Math.ceil(cam.zoom)}`;
		document.getElementById('osm-link').href = `https://www.openstreetmap.org/#map=${Math.ceil(cam.zoom)}/${cam.center[1]}/${cam.center[0]}`;
	}

	///////////////////////////
	// Data & settings functions
	//////////////////////////

	/**
	 * Gets the drawn shape data as GeoJSON feature collection. Automatically rounds coordinates to 6 decimal places.
	 * @param {*} classSourceOnly Specifies if only the class properties and source property should be captured.
	 * @param {*} saveSubType Specifies if shape subType and radius properties should be maintained.
	 * @returns The drawn shape data as GeoJSON feature collection.
	 */
	#getSourceData(classSourceOnly, saveSubType, preserveId) {
		const self = this;
		const cp = self.config.properties;
		const propName1 = cp.primary_classes.property_name;
		const propName2 = (cp.secondary_classes) ? cp.secondary_classes.property_name : null;

		//Get geojson from drawing manager.
		const json = self.#featureSource.toJson();

		//If drawing is occuring, retrieve shapes in drawing manager.
		if (self.#getDrawingMode() !== 'idle') {
			json.features = json.features.concat(self.#drawingManager.getSource().toJson().features);
		}

		const allowedProps = ['source', 'task_name'];
		allowedProps.push(propName1);

		if (propName2) {
			allowedProps.push(propName2);
		}

		//Process geojson. Convert circles to polygons and remove any extra properties.
		json.features.forEach(f => {
			if (!saveSubType && f.geometry.type === 'Point' && f.properties.radius) {
				f.geometry.type = 'Polygon';
				f.geometry.coordinates = [atlas.math.getRegularPolygonPath(f.geometry.coordinates, f.properties.radius, 36)];
			}

			Utils.roundGeomCoordinates(f.geometry);

			if (classSourceOnly) {
				//Remove all but the property names
				Object.keys(f.properties).forEach(key => {
					if (allowedProps.indexOf(key) === -1 &&
						(!saveSubType || (saveSubType && (key !== 'subType' || key !== 'radius')))) {
						delete f.properties[key];
					}
				});
			} else {
				//Remove Azure Maps specific properties.
				delete f.properties._azureMapsShapeId;

				if (!saveSubType) {
					delete f.properties.subType;
					delete f.properties.radius;
				}
			}

			if (!preserveId) {
				//Remove ID as its possible it came from an external source or was auto generated from Azure Maps.
				delete f.id;
			}

			f.properties.task_name = cp.name;
		});

		return json;
	}

	/**
	 * Saves all drawn data in local storage for the project.
	 */
	#saveSession = async () => {
		//Get clean source data.
		const self = this;
		if (appSettings.autoSave.enabled) {
			const json = self.#getSourceData(false, true);

			//Store a copy of the data, date, and the name of the project.
			await self.#storage.setItem(self.config.properties.name, {
				data: json,
				date: Date.now()
			});
		}

		self.#calcStats();
	}

	/**
	 * Calculate stats on the drawn features.
	 */
	#calcStats = () => {
		if (this.#statsControl) {
			const statsInfo = [];

			const fc = this.#featureSource.toJson();

			statsInfo.push(`Number of shapes: ${fc.features.length}`)

			let c1 = 0;
			let c2 = 0;

			fc.features.forEach(f => {

			});

			this.#statsControl.setOptions({
				content: statsInfo.join(''),
				visible: true
			});
		}
	}

	/**
	 * Checks to see if any data for the project exists in local storage. If it does, asks if the user would like to recover it.
	 */
	async #checkStorage() {
		const self = this;

		//If auto save is disabled, don't try and load any data.
		if (appSettings.autoSave.enabled) {
			const today = new Date();

			//Calcuate the expiry date for old cached data.
			const expiryDate = new Date().setDate(today.getDate() - appSettings.autoSave.ttl);

			await self.#storage.iterate((value, key) => {
				//Check to see if there is cached data for the named project.
				if (key === self.config.properties.name) {
					//Check to see if the user wants to recover it.
					if (value && confirm('Found cached data for this project task. Continue from where you left off?')) {
						self.#featureSource.setShapes(value.data);
						self.#calcStats();
					} else {
						//If not, clear the cached data.
						self.#removeExpireData(key).then();
					}
				} else if (value.date < expiryDate) {
					//Check other cached data to see if it's older than the expiry date. If so, remove it.
					self.#removeExpireData(key).then();
				}
			});
		}
	}

	async #removeExpireData(key) {
		await this.#storage.removeItem(key);
	}

	/** Captures the user prefernce settings, and saves them for future sessions. */
	#saveSettings() {
		//Only keep track of settings that aren't driven by the config files.

		//Get the checkbox settings.
		this.#checkSettings.forEach(s => {
			localStorage.setItem(s, document.getElementById(s).checked);
		});

		localStorage.setItem('drawingMode', Utils.getSelectValue(document.getElementById('drawingModeSelector'), 'innerText'));
		localStorage.setItem('app-theme', Utils.getSelectValue(document.getElementById('app-theme'), 'innerText'));
		localStorage.setItem('shapePasteMode', Utils.getSelectValue(document.getElementById('shapePasteMode'), 'innerText'));
	}

	/** Loads user prefernce settings from previous session. */
	#loadSettings() {
		//Only keep track of settings that aren't driven by the config files.
		const elms = [];

		//Set the checkbox settings.
		this.#checkSettings.forEach(s => {
			const e = document.getElementById(s);
			e.checked = localStorage.getItem(s) !== 'false';
			elms.push(e);
		});

		//Set dropdown settings.
		elms.push(Utils.setSelectByValue('drawingModeSelector', localStorage.getItem('drawingMode'), 'innerText'));
		elms.push(Utils.setSelectByValue('app-theme', localStorage.getItem('app-theme'), 'innerText'));
		elms.push(Utils.setSelectByValue('shapePasteMode', localStorage.getItem('shapePasteMode'), 'innerText'));
		
		//Trigger the onchange events of each setting.
		elms.forEach(e => {
			e.onchange();
		});
	}

	/**
	 * Event handler for whent he theme color changes.
	 */
	#themeColorChanged = () => {
		const self = this;

		//Get the theme setting.
		const theme = Utils.getSelectValue(document.getElementById('app-theme'), 'innerText');

		//Create a style sheet link to load the theme style.
		const l = document.createElement('link');
		l.setAttribute('rel', 'stylesheet');
		l.setAttribute('href', `css/themes/${theme}.css`);
		l.onload = () => {
			const color = getComputedStyle(document.body).backgroundColor;

			let azMapStyle = 'light';
			switch (theme) {
				case 'Dark':
					azMapStyle = 'dark';
					break;
			}

			//Loop through the Azure Map controls and set their style.
			const map = self.map;
			map.controls.getControls().forEach(c => {
				if (c instanceof atlas.control.ZoomControl) {
					//Zoom control doesn't have a setOtpions method, so have to remove and re-add.
					map.controls.remove(c);
					map.controls.add(new atlas.control.ZoomControl({ style: azMapStyle }), {
						position: 'bottom-right'
					});
				} else if (c instanceof atlas.control.DrawingToolbar ||
					c instanceof atlas.control.BringDataIntoViewControl) {
					c.setOptions({ style: azMapStyle });
				}
			});

			//Save the setting.
			localStorage.setItem('app-theme', theme);

			//Set the fill color of the popup.
			if (self.#popup) {
				self.#popup.setOptions({ fillColor: color });
			}
		};
		document.body.appendChild(l);
	}

	#pasteShape() {
		const self = this;
			
		if(self.#copiedShape) {
			let dx = 0;
			let dy = 0;

			if(self.#shapePasteMode !== 'No offset') {
				//Calculate the center point of the copied shape based on bounding box for simplicity. 
				const copiedCenter = atlas.data.BoundingBox.getCenter(atlas.data.BoundingBox.fromData(self.#copiedShape));
			
				//Paste the shape to where the mouse is over the map, or the center of the map.
				let pasteCenter = self.map.getCamera().center;

				if(self.#shapePasteMode === 'Mouse pointer' && self.#mousePosition) {
					pasteCenter = self.#mousePosition;
				}

				//Calculate the offsets. Use pixels at zoom level 22 for visible accuracy.
				const p = atlas.math.mercatorPositionsToPixels([copiedCenter, pasteCenter], 22);
				dx = p[1][0] - p[0][0];
				dy = p[1][1] - p[0][1];
			}
			
			const shapeToPaste = self.#createShapeToPaste(dx, dy);
			
			const ds = self.#drawingManager.getSource();
			ds.add(shapeToPaste);
			
			//Get the last shape added to the data source and put it into edit mode.
			const shapes = ds.getShapes();
			const s = shapes[shapes.length - 1];
			self.#drawingManager.edit(s);

			//Save the session.
			self.#saveSession();
		}
	}
	
	#createShapeToPaste(dx, dy) {
		const self = this;
		const g = self.#copiedShape.geometry;
	
		const newGeometry = {
			type: g.type,
			coordinates: [] 
		};

		if(dx === 0 && dy === 0) {
			newGeometry.coordinates = JSON.parse(JSON.stringify(g.coordinates));
		} else {
			//Offset the positions of the geometry.
			switch(g.type) {
				case 'Point':
					newGeometry.coordinates = self.#getOffsetPositions([g.coordinates], dx, dy)[0];
					break;
				case 'LineString':
				case 'MultiPoint':					
					newGeometry.coordinates = self.#getOffsetPositions(g.coordinates, dx, dy);
					break;
				case 'Polygon':
				case 'MultiLineString':					
					newGeometry.coordinates = g.coordinates.map(r => {
						return self.#getOffsetPositions(r, dx, dy);
					});
					break;
				//MultiPolygon
			}
		}
		
		//Create a GeoJSON featuret from new geometry, copy the properties. 
		return new atlas.data.Feature(newGeometry, JSON.parse(JSON.stringify(self.#copiedShape.properties)));		
	}
	
	#getOffsetPositions(positions, dx, dy) {
		//Convert positions to pixel at zoom level 22.
		const pixels = atlas.math.mercatorPositionsToPixels(positions, 22);
		
		//Offset pixels.
		for(let i=0, len = pixels.length; i< len;i++) {
			pixels[i][0] += dx;
			pixels[i][1] += dy;
		}			
		
		//Convert back to positions.
		return atlas.math.mercatorPixelsToPositions(pixels, 22);
	}
}
