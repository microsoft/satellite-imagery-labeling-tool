import { Utils, SimpleEventerClass } from '../utils.js';

////////////////////////////////
// Custom map controls
// A collection of custom controls that can be added to the map using "map.controls.add".
// Follows the Azure Maps Control interface: https://docs.microsoft.com/javascript/api/azure-maps-control/atlas.control
///////////////////////////////

/**
 * A simple search bar control.
 */
export class SearchBarControl {
	/**
	 * A simple search bar control.
	 */
	constructor() {
		const self = this;

		//Create the controls UI elements.
		const elm = document.createElement('div');
		elm.className = 'azure-maps-control-container light simple-search-control';
		elm.setAttribute('aria-label', 'Search control');
		elm.setAttribute('role', 'search');

		const input = document.createElement('input');
		input.setAttribute('type', 'search');
		input.setAttribute('role', 'searchbox');
		input.setAttribute('aria-label', 'Search');
		elm.appendChild(input);

		//<button class="icon-btn search-btn"><i class="material-symbols-outlined">search</i></button>
		const searchBtn = document.createElement('button');
		searchBtn.setAttribute('type', 'button');
		searchBtn.className = 'icon-btn search-btn';

		const icon = document.createElement('i');
		icon.className = 'material-symbols-outlined';
		icon.innerHTML = 'search';

		searchBtn.appendChild(icon);
		elm.appendChild(searchBtn);

		searchBtn.onclick = () => {
			self.search(input.value);
		};

		self.elm = elm;
	}

	/**
	 * Event fired when the control is added to the map.
	 * @param {*} map The map instance.
	 * @param {*} controlOptions Options used when load the control into the map.
	 * @returns The control DOM element.
	 */
	onAdd(map, controlOptions) {
		this.map = map;
		return this.elm;
	}

	/**
	 * Event fired when control is removed from the map.
	 */
	onRemove() {
		if (this.map) {
			this.map = null;
		}
	}

	/**
	 * Function to perform a search query.
	 * @param {*} query The query to search for.
	 */
	search(query) {
		const self = this;
		if (self.map && query && query !== '') {
			//Calling Azure Maps geocode API directly so as not having to load the Azure Maps Services module.
			const url = `https://{azMapsDomain}/geocode?api-version=2022-02-01-preview&top=1&query=${encodeURIComponent(query)}`;
			Utils.makeSignedRequest(self.map, url).then(r => {
				if (r && r.features && r.features.length > 0) {
					//Update the map view for the resulting search result.
					self.map.setCamera({
						bounds: r.features[0].bbox,
						padding: 100
					});
				}
			});
		}
	}
}

/**
 * A simple control for toggling between custom map layers. 
 */
export class SimpleLayerControl {
	#radioGroupName = 'simple-layer-control-' + Math.round(Math.random() * 1000000);
	#layers = [];
	#container = null;
	#currentLayer = null;
	#azureMapsLayer = null;

	/**
	 * A simple control for toggling between custom map layers. 
	 * @param {*} layers Optional. An array of layers to load into the control. 
	 * @param {*} labelToggles Optional. Specifies if the option to toggle map labels, POIs, and borders, is displayed.
	 */
	constructor(layers, labelToggles) {
		const self = this;

		self.#layers = layers || [];
		self.labelToggles = labelToggles;

		//Create the UI controls.
		const elm = document.createElement('div');
		elm.className = 'azure-maps-control-container light simple-layer-control';
		elm.setAttribute('aria-label', 'Layer control');

		const title = document.createElement('div');
		title.className = 'simple-layer-control-title';
		title.innerText = 'Layers';
		elm.appendChild(title);

		const container = document.createElement('div');
		container.className = 'simple-layer-control-container';
		elm.appendChild(container);
		self.#container = container;

		//If valid Azure Maps auth, add label/POI options.
		const optionContainer = document.createElement('div');
		optionContainer.style.display = labelToggles ? '' : 'none';

		optionContainer.appendChild(document.createElement('hr'));

		const label = Utils.createCheckInput('checkbox', 'Show labels', true);
		label.onclick = () => {
			if (self.map) {
				const labelChbx = label.querySelector('input');
				Utils.setMapLabelVisibility(self.map, labelChbx.checked);
			}
		};

		optionContainer.appendChild(label);

		const border = Utils.createCheckInput('checkbox', 'Show borders', true);
		border.onclick = () => {
			if (self.map) {
				const borderChbx = border.querySelector('input');
				Utils.setMapBorderVisibility(self.map, borderChbx.checked);
			}
		};

		optionContainer.appendChild(border);

		const poi = Utils.createCheckInput('checkbox', 'Show POIs', false);
		poi.onclick = () => {
			if (self.map) {
				const poiChbx = poi.querySelector('input');
				Utils.setPoiLayerVisibility(self.map, poiChbx.checked);
			}
		};

		optionContainer.appendChild(poi);
		self.optionContainer = optionContainer;

		elm.appendChild(optionContainer);

		self.elm = elm;
	}

	/**
	 * Event fired when the control is added to the map.
	 * @param {*} map The map instance.
	 * @param {*} controlOptions Options used when load the control into the map.
	 * @returns The control DOM element.
	 */
	onAdd(map, controlOptions) {
		const self = this;
		self.map = map;

		//Check to see if valid Azure Maps auth has been provided.
		const hasAZMapAuth = Utils.isAzureMapsAuthValid(map.getServiceOptions().authOptions);

		//If invalid auth provided, hide toggles for map labels, POIs, and borders.
		self.optionContainer.style.display = (self.labelToggles && hasAZMapAuth) ? '' : 'none';

		//If valid Azure Maps auth provided, add Azure Maps satellite imagery as an option.
		if (hasAZMapAuth && map.getStyle().style.indexOf('satellite') === 0) {
			app.map.layers.getLayerById('base').layers.forEach(l => {
				if (l.id === 'microsoft.maps.base.base.satelliteLayer') {
					self.#azureMapsLayer = l;
				}
			});
		}

		//Load all other layers.
		self.loadLayers();

		return self.elm;
	}

	/**
	 * Event fired when control is removed from the map.
	 */
	onRemove() {
		if (this.map) {
			this.map = null;
		}
	}

	/**
	 * Clears all loaded layers from the list.
	 */
	clear() {
		this.#layers = [];

		if (this.#container) {
			this.loadLayers([]);
		}
	}

	/**
	 * Sets the current visible layer to display on the map.
	 * @param {*} layerId he layer id of the desired layer to make visible.
	 */
	setVisibleLayer(layerId) {
		const labels = this.#container.querySelectorAll('label');

		for(let i=0;i<labels.length;i++) {
			let id = labels[i].getAttribute('rel');
			if(id === layerId) {
				labels[i].click();
				break;
			}
		}
	}

	/**
	 * Sets the enabled state of a layer.
	 * @param {*} layerId The ID of the layer to update the enabled state on.
	 * @param {*} enabled The enabled state to set.
	 */
	setLayerEnabledState(layerId, enabled) {
		const self = this;
		const labels = self.#container.querySelectorAll('label');

		//Loop through all the layers and find the layer by ID. 
		self.#layers.forEach(l => {
			const id = l.getId();

			if (id === layerId) {
				//Set the enabled state.
				l.enabled = enabled;

				//Set visibility of the layer label.
				labels.forEach(lb => {
					if (lb.getAttribute('rel') === layerId) {
						lb.style.display = (enabled) ? '' : 'none';
					}
				});
			}
		});

		//If the layer state is not enabled, and it is the current layer, reset the current layer flag.
		if (!enabled && self.#currentLayer === layerId) {
			self.#currentLayer = null;
		}

		//If no current layer set. Find the first available layer, and enable it.
		if (self.#currentLayer === null) {
			for (let i = 0; i < labels.length; i++) {
				if (labels[i].style.display !== 'none') {
					labels[i].click();
				}
			}
		}
	}

	/**
	 * Gets the current state of all layers in the control. 
	 * @returns An key-value pair of layer ID's to enabled states.
	 */
	getLayerStates() {
		const states = {};

		this.#layers.forEach(l => {
			states[l.getId()] = l.enabled;
		});

		return states;
	}

	/**
	 * Gets the current layer.
	 * @returns The current layer.
	 */
	getCurrentLayer() {
		return this.#currentLayer;
	}

	/**
	 * Loads a list of layers into the control.
	 * @param {*} layers 
	 */
	loadLayers(layers) {
		const self = this;
		self.#layers = layers || [];

		//Clear the content of the layer list.
		self.#container.innerHTML = '';

		//Checks to see if Azure Maps has valid credentials. If it does, includes Azure Maps satellite imagery as an option in the layer list.
		if (Utils.isAzureMapsAuthValid(self.map.getServiceOptions().authOptions)) {
			if (self.#currentLayer === null) {
				self.#currentLayer = Utils.AZURE_MAPS_SATELLITE;
			}

			self.#createRadioBtn(Utils.AZURE_MAPS_SATELLITE);
		}

		if (layers) {
			//Create a radio button list from the layers. 
			layers.forEach(l => {
				const id = l.getId();

				const label = self.#createRadioBtn(id);
				label.style.display = (l.enabled) ? '' : 'none';

				if (l.enabled && self.#currentLayer === null) {
					self.#currentLayer = id;
					label.checked = true;
					self.#setVisibleLayer(id);
				}
			});
		}
	}

	/**
	 * Sets the layer options; fade duration, saturation, hue rotation, and contrast.
	 * @param {*} options 
	 */
	setLayerOptions(options) {
		const self = this;

		//Apply the options to all layers in the control. 
		self.#layers.forEach(l => {
			l.setOptions(options);
		});

		//Apply the options to the underlying Azure Maps satellite imagery, if available.
		if (self.#azureMapsLayer) {
			const id = self.#azureMapsLayer.id;
			const mlMap = self.map.map;

			mlMap.setPaintProperty(id, 'raster-fade-duration', options['fadeDuration']);
			mlMap.setPaintProperty(id, 'raster-saturation', options['saturation']);
			mlMap.setPaintProperty(id, 'raster-hue-rotate', options['hueRotation']);
			mlMap.setPaintProperty(id, 'raster-contrast', options['contrast']);
			mlMap.setPaintProperty(id, 'raster-brightness-max', options['maxBrightness']);
		}
	}

	/**
	 * Create a radio button for a layer.
	 * @param {*} layerId The layer id associated with the button.
	 * @returns The label element that wraps the radio button.
	 */
	#createRadioBtn(layerId) {
		const self = this;
		const label = Utils.createCheckInput('radio', layerId, self.#currentLayer === layerId, self.#radioGroupName);
		label.onclick = (e) => {
			let id = label.getAttribute('rel');
			self.#setVisibleLayer(id);
		};

		self.#container.appendChild(label);

		return label;
	}

	/**
	 * Sets the current visible layer to display on the map.
	 * @param {*} layerId he layer id of the desired layer to make visible.
	 */
	#setVisibleLayer(layerId) {
		this.#layers.forEach(l => {
			l.setOptions({
				visible: (l.getId() === layerId)
			});
		});

		this.#currentLayer = layerId;
	}
}

/**
 * A control that lists the primary and secondary classes available, and lets the user set the current one's that should be used when drawing.
 */
export class AnnotationClassControl extends SimpleEventerClass {
	#elm = null;
	#primary = {};
	#secondary = {};
	#primaryContainer = null;
	#secondaryContainer = null;
	#currentPrimary = null;
	#currentSecondary = null;
	#primaryGroupName = 'simple-layer-control-' + Math.round(Math.random() * 1000000);
	#secondaryGroupName = 'simple-layer-control-' + Math.round(Math.random() * 1000000);
	#bulkEditMode;

	/**
	 * A control that lists the primary and secondary classes available, and lets the user set the current one's that should be used when drawing.
	 */
	constructor() {
		super();

		const self = this;

		//Create the control UI elements.
		const elm = document.createElement('div');
		elm.className = 'azure-maps-control-container light annotation-class-control';
		elm.setAttribute('aria-label', 'Annotation class control');
		self.#elm = elm;

		const primaryElm = document.createElement('div');
		primaryElm.className = 'annotation-class-control-btn-group';
		primaryElm.id = 'primary-class-container';
		elm.appendChild(primaryElm);
		self.#primaryContainer = primaryElm;

		const secondaryElm = document.createElement('div');
		secondaryElm.className = 'annotation-class-control-btn-group';
		elm.appendChild(secondaryElm);
		self.#secondaryContainer = secondaryElm;
	}

	/**
	 * Event fired when the control is added to the map.
	 * @param {*} map The map instance.
	 * @param {*} controlOptions Options used when load the control into the map.
	 * @returns The control DOM element.
	 */
	onAdd(map, controlOptions) {
		this.map = map;

		return this.#elm;
	}

	/**
	 * Event fired when control is removed from the map.
	 */
	onRemove() {
		const self = this;
		if (self.map) {
			self.completeBulkEdit();
			self.map = null;
		}
	}

	/**
	 * Get the selected primary class name.
	 * @returns The selected primary class name.
	 */
	getPrimaryClass() {
		return this.#currentPrimary;
	}

	/**
	 * Get the selected secondary class name.
	 * @returns The selected secondary class name.
	 */
	getSecondaryClass() {
		return this.#currentSecondary;
	}

	/**
	 * Sets the list of available primary and secondary classes.
	 * @param {*} primary A list of primary class configuration.
	 * @param {*} secondary A list of secondary class configuration.
	 */
	setClasses(primary, secondary) {
		const self = this;
		self.completeBulkEdit();
		self.#primary = primary || {};
		self.#secondary = secondary || {};

		self.#primaryContainer.innerHTML = '';

		//Create the primary class radio button list.
		if (primary && primary.names && primary.names.length > 0) {
			const title = document.createElement('div');
			title.className = 'annotation-class-control-title';
			title.innerText = primary.display_name || 'Primary class';			
			self.#primaryContainer.appendChild(title);

			if (!self.#currentPrimary || primary.names.indexOf(self.#currentPrimary) === -1) {
				self.#currentPrimary = primary.names[0];
			}

			let hasMatch = false;

			//Create a radio button for each class.
			for (let i = 0; i < primary.names.length; i++) {
				const c = (primary.colors && i < primary.colors.length) ? primary.colors[i] : null;
				const test = (self.#currentPrimary === primary.names[i]);
				hasMatch |= test;
				const l = self.#createClassElm(primary.names[i], c, self.#primaryContainer, test, self.#primaryGroupName);
				l.onclick = () => {
					self.#currentPrimary = l.querySelector('span').innerText;
					const opt = self.#bulkEditMode;
					if(opt){
						opt.classType = 'primary';
						opt.value[primary.property_name] = self.#currentPrimary;
					}
				};
			}

			//Ensure an inital class is selected.
			if (!hasMatch) {
				self.#currentPrimary = primary.names[0];
				self.#primaryContainer.querySelector('input').checked = true;
			}

			self.#addBulkEditBtns(self.#primaryContainer, 'primary');
		}

		//Create the secondary class radio button list.
		self.#secondaryContainer.innerHTML = '';

		if (secondary && secondary.names && secondary.names.length > 0) {
			const title = document.createElement('div');
			title.className = 'annotation-class-control-title';
			title.innerText = secondary.display_name || 'Secondary class';
			self.#secondaryContainer.appendChild(title);

			if (!self.#currentSecondary || secondary.names.indexOf(self.#currentSecondary) === -1) {
				self.#currentSecondary = secondary.names[0];
			}

			let hasMatch = false;
			
			//Create a radio button for each class.
			for (let i = 0; i < secondary.names.length; i++) {
				const test = (self.#currentSecondary === secondary.names[i]);
				hasMatch |= test;
				const l = self.#createClassElm(secondary.names[i], null, self.#secondaryContainer, test, self.#secondaryGroupName);
				l.onclick = () => {
					self.#currentSecondary = l.querySelector('span').innerText;
					const opt = self.#bulkEditMode;
					if(opt){
						opt.classType = 'secondary';
						opt.value[secondary.property_name] = self.#currentSecondary;
					}
				}
			}

			//Ensure an inital class is selected.
			if (!hasMatch) {
				self.#currentSecondary = primary.names[0];
				self.#secondaryContainer.querySelector('input').checked = true;
			}

			self.#addBulkEditBtns(self.#secondaryContainer, 'secondary');
			self.#secondaryContainer.style.display = '';
		} else {
			self.#secondaryContainer.style.display = 'none';
		}
	}

	/** Completes a bulk edit process. */
	completeBulkEdit(){
		const self = this;
		self.#bulkEditMode = null;
		
		//Set the button states to inactive.
		self.#elm.querySelectorAll('button').forEach(b => {
			b.classList.remove('active');
		});
		
		self.trigger('bulkedit', null);
	}
	
	/**
	 * Creates a radio button for a class list item.
	 * @param {*} name The class name.
	 * @param {*} color The color the text should be if it's a primary class.
	 * @param {*} parent The parent element the radio button should be added to.
	 * @param {*} checked If the initial state should be checked or not.
	 * @param {*} groupName The class radio group name. 
	 * @returns 
	 */
	#createClassElm(name, color, parent, checked, groupName) {
		const label = Utils.createCheckInput('radio', name, checked, groupName);

		if (color) {
			label.style.color = color;
		}

		parent.appendChild(label);

		return label;
	}

	/** primary, secondary */
	#addBulkEditBtns(elm, classType){

		const self = this;
		const btnContainer = document.createElement('div');
		btnContainer.className = 'annotation-class-control-btnContainer';
		elm.appendChild(btnContainer);

		//Create point edit button.
		let alt = `Click to bulk update ${classType} class`;

		const pBtn = document.createElement('button');
		pBtn.classList.add('azure-maps-control-button');	
		pBtn.classList.add('annotation-class-control-pointBtn');	
		pBtn.setAttribute('type', 'button');
		pBtn.setAttribute('alt', alt);
		pBtn.setAttribute('title', alt);
		pBtn.onclick = () => {
			self.#bulkEditBtnClicked('point', classType, pBtn);
		};
		btnContainer.appendChild(pBtn);

		//Create rectangle edit button.
		alt = `Rectangle select to bulk update ${classType} class`;

		const rBtn = document.createElement('button');
		rBtn.classList.add('azure-maps-control-button');	
		rBtn.classList.add('annotation-class-control-rectangleBtn');	
		rBtn.setAttribute('type', 'button');		
		rBtn.setAttribute('alt', alt);
		rBtn.setAttribute('title', alt);
		rBtn.onclick = () => {
			self.#bulkEditBtnClicked('rectangle', classType, rBtn);
		};
		btnContainer.appendChild(rBtn);
	}

	/** Event handler for when one of the bulk edit buttons have been clicked. */
	#bulkEditBtnClicked = (mode, classType, elm) => {		
		const self = this;
		const bem = self.#bulkEditMode;

		if(!bem || !(bem.mode === mode && bem.classType === classType)) {
			//Set the button states to inactive.
			self.#elm.querySelectorAll('button').forEach(b => {
				b.classList.remove('active');
			});

			const opt = {
				mode: mode,
				classType: classType,
				value: {}
			};

			if(classType === 'primary'){
				opt.value[self.#primary.property_name] = self.#currentPrimary;
			} else {
				opt.value[self.#secondary.property_name] = self.#currentSecondary;
			}

			elm.classList.add('active');			

			self.#bulkEditMode = opt;
			self.trigger('bulkedit', opt);
		} else {
			elm.classList.remove('active');	
			elm.blur();
			self.#bulkEditMode = null;
			self.trigger('bulkedit', null);
		}
	}
}

/**
 * A simple control for displaying Text or HTML content on the map. 
 */
export class SimpleContentControl {
	#container;
	#options = {
		content: '',
		visible: true
	};

	/**
	 * A simple control for displaying Text or HTML content on the map. 
	 * @param {*} options Options to set on the control.
	 */
	constructor(options) {
		const self = this;
		const container = document.createElement('div');
		container.className = 'azure-maps-control-container light simpleContentControl';

		self.#container = container;
		self.setOptions(options);		
	}

	/**
	 * Event fired when the control is added to the map.
	 * @param {*} map The map instance.
	 * @param {*} controlOptions Options used when load the control into the map.
	 * @returns The control DOM element.
	 */
	onAdd(map, controlOptions){
		this.map = map;
		return this.#container;
	}

	/**
	 * Event fired when control is removed from the map.
	 */
	onRemove() {
		if (this.map) {
			this.map = null;
		}
	}

	/**
	 * Gets the options of the control.
	 * @returns The control options.
	 */
	getOptions() {
		return Object.assign({}, this.#options);
	}

	/**
	 * Sets the options on the control.
	 * @param {*} options Options to set on the control.
	 */
	setOptions(options) {
		if(options){
			const o = this.#options;

			if(options.content){
				o.content = options.content;
				this.#container.innerHTML = options.content;
			}

			if(typeof options.visible === 'boolean'){
				o.visible = options.visible;
				this.#container.style.display = (o.visible)? '': 'none';
			}
		}
	}
}