import { appSettings } from '../settings/project_admin_settings.js'
import { mapSettings } from '../settings/map_settings.js'

import { Utils } from './utils.js';
import { ProjectUtils } from './projectUtils.js';
import { SimpleLayerControl, SearchBarControl, SimpleContentControl } from './controls/customMapControls.js';
import { AddLayerDialog, ContentDialog } from './controls/dialogs.js';
import { SimpleBinding } from './simpleBinding.js'

/**
 * The main logic for the spatial annotation project builder app.
 */
export class ProjectBuilderApp {
    #hasAZMapAuth = false;
    #drawingManager = null;
    #changingMonitor;
    #baselayers = [];
    #layerControl;
    #layerDialog;
    #statsControl;
    #config = {
        id: '',
        type: 'Feature',
        geometry: null,
        properties: {
            project_name: '',
            name: '',
            instructions: '',
            instructions_on_load: true,
            drawing_type: "polygon",
            allow_wizard: true,
            customDataService: null,
            customDataServiceLabel: null,
            layers: {},
            primary_classes: {
                display_name: 'Primary class',
                property_name: 'class',
                names: [],
                colors: []
            },
            secondary_classes: {
                display_name: 'Secondary class',
                property_name: 'secondary_class',
                names: []
            }
        }
    };
    #binding = new SimpleBinding(this.#config.properties);
    #gridSource = null;
    #cellSize = 1;
    #gridUnits = 'kilometers';
    #cardIdx = 1;

    /**
     * The main logic for the spatial annotation project builder app.
     */
    constructor() {
        const self = this;

        const hasAZMapAuth = Utils.isAzureMapsAuthValid(mapSettings.azureMapsAuth);
        this.#hasAZMapAuth = hasAZMapAuth;

        document.querySelector('title').innerText = appSettings.builderTitle;

        //Initialize a map instance.
        self.map = Utils.createMap('myMap', mapSettings.azureMapsAuth);

        self.map.events.add('ready', self.#mapReady);

        //Initialized the card functionalities.
        self.#initStep1();
        self.#initStep3();
        self.#initStep4();
        self.#initStep5();

        //Add click events to back and next buttons.
        document.querySelectorAll('.backBtn').forEach(e => {
            e.onclick = () => {
                self.#flipCard(-1);
            };
        });

        document.querySelectorAll('.nextBtn').forEach(e => {
            e.onclick = () => {
                self.#flipCard(1);
            };
        });

        //File input for local project.
        const loadLocalProjectFile = document.getElementById('loadLocalProjectFile');
        loadLocalProjectFile.onchange = (e) => {
            if (e.target.files && e.target.files.length > 0) {
                self.#loadProject(e.target.files[0]);
            }
        };

        //Click event for a button to load local project file. 
        document.getElementById('loadProjectBtn').onclick = () => {
            loadLocalProjectFile.click();
        };

        //Help functionality.
        const helpDialog = new ContentDialog('Project builder help', marked.parse(appSettings.helpBuilderContent), 'helpContent');
        document.getElementById('helpBtn').onclick = () => {
            helpDialog.show();
        };
    }

    /** Post map load tasks to prepare the app. */
    #mapReady = () => {
        const self = this;
        const map = self.map;

        //Create drawing manager.
        const drawingManager = new atlas.drawing.DrawingManager(map, {
            toolbar: new atlas.control.DrawingToolbar({
                buttons: ['draw-polygon', 'draw-rectangle', 'draw-circle', 'edit-geometry'],
                style: 'light',
                containerId: 'drawingToolbarContainer'
            }),
            shapeRotationEnabled: false,
            shapeDraggingEnabled: false
        });
        self.#drawingManager = drawingManager;

        map.events.add('drawingmodechanged', drawingManager, (mode) => {
            if (mode !== 'idle') {
                self.#gridSource.clear();

                if (mode !== 'edit-geometry') {
                    drawingManager.getSource().clear();
                }
            }
        });

        //Monitor for when drawing has been completed.
        map.events.add('drawingcomplete', drawingManager, self.#drawingComplete);

        //Workaround. Sometimes the drawingcomplete event doesn't fire when editting shapes.
        map.events.add('drawingchanged', drawingManager, () => {
            if (drawingManager.getOptions().mode === 'edit-geometry') {
                if (self.#changingMonitor) {
                    clearTimeout(self.#changingMonitor);
                }

                self.#changingMonitor = setTimeout(() => {
                    self.#changingMonitor = null;

                    self.#drawingComplete();
                }, 100);
            }
        });

        //Customize the line rendering options in the drawing layer.. 
        const layers = drawingManager.getLayers();
        const lineOptions = {
            strokeWidth: 3,
            strokeColor: 'yellow',
            strokeDashArray: [2, 2]
        };
        layers.lineLayer.setOptions(lineOptions);
        layers.polygonOutlineLayer.setOptions(lineOptions);

        //Create a data source to load in calculated grid areas.
        const gridSource = new atlas.source.DataSource();
        map.sources.add(gridSource);
        self.#gridSource = gridSource;

        //Specify custom properties to be the id for feature state.
        map.map.getSource(gridSource.getId()).promoteId = '_azureMapsShapeId';

        //Create a layer to display the area of a grid cell.
        const gridLayer = new atlas.layer.PolygonLayer(gridSource, null, {
            //Color based on the availability of layers in each cell. 
            fill: [

            ]
        });

        //Create a layer to display the outline of a grid cell.
        const gridOutlineLayer = new atlas.layer.LineLayer(gridSource, null, {
            strokeColor: 'black',
            strokeWidth: 3
        });

        //Add the layers to the map.
        map.layers.add([gridLayer, gridOutlineLayer], 'labels');

        //Add zoom control to map.
        map.controls.add(new atlas.control.ZoomControl(), {
            position: 'bottom-right'
        });

        //Add the search bar if valid Azure Maps credentials provided, and app settings have this feature enabled.
        if (self.#hasAZMapAuth && appSettings.showSearchBar) {
            const searchBar = new SearchBarControl();
            map.controls.add(searchBar, {
                position: 'top-left'
            });
        }

        //Add a simple control for displaying custom content messages.
        self.#statsControl = new SimpleContentControl({
            visible: false
        });
        map.controls.add(self.#statsControl, {
            position: 'bottom-left'
        });

        //Initialize step 2 which needs the map to be ready.        
        self.#initStep2();
    };

    /**
     * Event handler for when drawing has completed.
     */
    #drawingComplete = () => {
        const self = this;

        //Check to see if monitoring a change to a drawing when editting. If so, process that change. This is done to support a bug workaround.
        if (self.#changingMonitor) {
            clearTimeout(self.#changingMonitor);
            self.#changingMonitor = null;
        }

        //Put the drawing manager into an idle state, if not editting.
        if (self.#drawingManager.getOptions().mode !== 'edit-geometry') {
            self.#drawingManager.setOptions({ mode: "idle" });
        }

        //Recalute grid cells.
        self.#recalculateGrid();
    };

    /**
     * Initialize step 1.
     */
    #initStep1() {
        const self = this;       

        const binding = self.#binding;
        const props = self.#config.properties;

        const cardElm = document.getElementById('step-1');
        const binders = cardElm.querySelectorAll('[data-binding]');

        const preview = document.getElementById('instructionsPreview');
        const instructions = document.getElementById('instructions');
        instructions.addEventListener('keyup', () => {
            preview.innerHTML = marked.parse(instructions.value);
        });

        
        const customDataSwitch = document.getElementById('customDataSwitch');
        const customDataServiceButtonLabel = document.getElementById('customDataServiceButtonLabel');
        const customDataServiceLabel = document.getElementById('customDataServiceLabel');
        
        customDataSwitch.addEventListener('click', () => {
            if(customDataSwitch.checked){
                customDataServiceLabel.style.display = '';
                customDataServiceButtonLabel.style.display = '';
            } else {
                customDataServiceLabel.style.display = 'none';                
                customDataServiceButtonLabel.style.display = 'none';
                props.customDataServiceLabel = null;
                props.customDataService = null;
            }
        });

        binders.forEach(e => {
            binding.bind(e, e.getAttribute('data-binding'), null, (names, val) => {
                self.#validateStep1();

                if (names[0] === 'project_name') {
                    val = val.trim();
                    props.project_name = val;
                    self.#config.id = val;
                }
            });
        });
    }

    /** Validates the fields of step 1 and determines if user can proceed to step 2. */
    #validateStep1() {
        const props = this.#config.properties;

        //Must include a project name.
        document.querySelector('#step-1 .nextBtn').disabled = (!props.project_name || props.project_name.trim() === '');
    }

    /**
     * Initialize step 2.
     */
    #initStep2() {
        const self = this;
        const map = self.map;

        //Create layer control.
        const layerControl = new SimpleLayerControl(self.#baselayers, true);
        map.controls.add(layerControl, {
            position: 'top-left'
        });
        self.#layerControl = layerControl;

        //Create add layer dialog.
        self.#layerDialog = new AddLayerDialog(self.map);

        self.#layerDialog.on('close', (layers) => {
            if (layers) {
                self.#addLayers(layers);

                //Reload the layer list states.
                self.#updateLayerStates();
            }
        });

        //Add layer(s) button click
        document.querySelector('#step-2 button').onclick = () => {
            self.#layerDialog.show();
        };

        //Load default layers.
        self.#addLayers(appSettings.layers);
        self.#updateLayerStates();
    }

    /** Adds layers to layer panel and layer control. */
    #addLayers(layerConfig) {
        const self = this;
        const lc = self.#layerControl;

        Object.keys(layerConfig).forEach(key => {
            var l = Utils.inflateLayer(self.map, key, Object.assign({}, layerConfig[key]));

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

        lc.loadLayers(self.#baselayers);
    }

    /** Updates the state of selected layers in the layer panel and layer control. */
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
                self.#validateStep2();
            };
        });

        self.#validateStep2();
    }

    /** Validates the fields in step 2 and determines if the user can proceed to step 3. */
    #validateStep2() {
        //Needs either an Azure Maps auth or one or more layers selected.
        document.querySelector('#step-2 .nextBtn').disabled = !(this.#hasAZMapAuth || document.querySelector('#layerCardLayerList input[type="checkbox"]:checked'));
    }

    /**
     * Initialize step 3.
     */
    #initStep3() {
        const self = this;
        const gridUnitsElm = document.getElementById('gridUnits');
        const gridSizeElm = document.getElementById('gridSize');

        self.#gridUnits = Utils.getSelectValue(gridUnitsElm);
        let oldUnits = self.#gridUnits;

        self.#cellSize = parseFloat(gridSizeElm.value);

        gridUnitsElm.onfocus = (e) => {
            oldUnits = Utils.getSelectValue(gridUnitsElm);
        };

        //When the grid units change, convert the grid size. No need to recalculate.
        gridUnitsElm.onchange = (e) => {
            self.#drawingManager.setOptions({ mode: "idle" });
            self.#gridUnits = Utils.getSelectValue(gridUnitsElm);
            const d = atlas.math.convertDistance(self.#cellSize, oldUnits, self.#gridUnits);
            gridSizeElm.value = d;
            self.#cellSize = d;
        };

        //When the grid size value changes, recalculate the grid.
        gridSizeElm.onchange = () => {
            if (gridSizeElm.value <= 0) {
                alert('Grid size must be greater than zero.');
                gridSizeElm.value = self.#cellSize;
                return;
            }
            self.#drawingManager.setOptions({ mode: "idle" });
            self.#cellSize = parseFloat(gridSizeElm.value);
            self.#recalculateGrid();
        };

        //Load data from local file. 
        const importAreaFile = document.getElementById('importAreaFile');
        importAreaFile.onchange = (e) => {
            const source = self.#drawingManager.getSource();
            source.clear();
            self.#gridSource.clear();
            self.#drawingManager.setOptions({ mode: "idle" });

            if (e.target.files && e.target.files.length > 0) {
                const file = e.target.files[0];

                if (file.name.toLowerCase().indexOf('.geojsonl') > -1) {
                    //Parse as GeoJSONL
                    e.target.files[0].text().then(data => {
                        try {
                            var features = [];
                            var lines = data.split('\n');
                            for (let i = 0, len = lines.length; i < len; i++) {
                                try {
                                    features.push(JSON.parse(lines[i]));
                                } catch { }
                            }

                            self.#importFirstPolygon(features);
                        } catch (e) {
                            alert('Unable to load data file.');
                            self.#validateStep3();
                        }
                    });
                } else {
                    e.target.files[0].arrayBuffer().then(data => {
                        try {
                            //Use Spatial IO module to parse.
                            atlas.io.read(data).then(
                                //Success
                                (r) => {
                                    self.#importFirstPolygon(r.features);
                                },

                                //Error
                                (msg) => {
                                    alert(msg);
                                    self.#validateStep3();
                                }
                            );
                        } catch (e) {
                            alert('Unable to load data file.');
                            self.#validateStep3();
                        }
                    });
                }
            }
        };

        document.getElementById('importAreaBtn').onclick = () => {
            importAreaFile.click();
        };
    }

    /**
     * Imports an area of interest from an array of features. Will grab the first polygon in the array. 
     * @param {*} features Array of features.
     */
    #importFirstPolygon(features) {
        const self = this;
        if (features) {            
            const filtered = Utils.filterFeatures(features, 'polygons', null, null, 1);

            if (filtered.length === 0) {
                alert('No polygon data to import.');
                self.#validateStep3();
            } else {
                self.#drawingManager.getSource().setShapes(filtered[0]);
                self.map.setCamera({
                    bounds: atlas.data.BoundingBox.fromData(filtered[0]),
                    padding: 40
                });
                self.#recalculateGrid();
            }
        } else {
            alert('No polygon data to import.');
            self.#validateStep3();
        }
    }

    /**
     * Validation for step 3 and determines if the user can proceed to step 4.
     */
    #validateStep3() {
        const nextBtn = document.querySelector('#step-3 .nextBtn');

        const s = this.#drawingManager.getSource().getShapes();
        const g = this.#gridSource.getShapes();
        nextBtn.disabled = !(s.length > 0 && g.length > 0);
    }

    /**
     * Initialize step 4.
     */
    #initStep4() {
        const self = this;
        const elms = Utils.getElementsByIds(['classTable1', 'newClass1', 'addClassBtn1', 'classTable2', 'newClass2', 'addClassBtn2', 'captureSecondaryClass', 'secondaryClassInput']);

        const binders = document.getElementById('step-4').querySelectorAll('[data-binding]');

        const binding = self.#binding;

        binders.forEach(e => {
            binding.bind(e, e.getAttribute('data-binding'), null, (names, val) => {
                self.#validateStep4();
            });
        });

        //Add primary class row when button clicked.
        elms.addClassBtn1.onclick = () => {
            self.#addClassRow(elms.classTable1, self.#config.properties.primary_classes, elms.newClass1.value.trim());
            elms.newClass1.value = '';
        };

        //Add row if enter is pressed.
        elms.newClass1.addEventListener('keyup', (e) => {
            if (e.keyCode == 13) {
                elms.addClassBtn1.click();
            }
        });

        //Add secondary class row when button clicked.
        elms.addClassBtn2.onclick = () => {
            self.#addClassRow(elms.classTable2, self.#config.properties.secondary_classes, elms.newClass2.value.trim());
            elms.newClass2.value = '';
        };

        //Add row if enter is pressed.
        elms.newClass2.addEventListener('keyup', (e) => {
            if (e.keyCode == 13) {
                elms.addClassBtn2.click();
            }
        });

        elms.captureSecondaryClass.addEventListener('change', () => {
            const display = elms.captureSecondaryClass.checked ? '' : 'none';
            elms.secondaryClassInput.style.display = display;
        });
    }

    /**
     * Adds a class (primary or secondary) to table listing all classes.
     * @param {*} table The table instance showing a list of classes to add a row to.
     * @param {*} bindingObj The JSON object to bind this row to.
     * @param {*} name The name of the class to add.
     */
    #addClassRow(table, bindingObj, name, classColor) {
        if (name !== '' && bindingObj.names.indexOf(name) === -1) {
            bindingObj.names.push(name);

            const row = document.createElement('tr');
            let cell = document.createElement('td');
            const delBtn = document.createElement('button');
            delBtn.setAttribute('type', 'button');
            delBtn.setAttribute('title', 'Delete item');
            delBtn.className = 'icon-btn delete-btn';
            delBtn.innerHTML = '<i class="material-symbols-outlined">close</i>';
            delBtn.onclick = () => {
                this.#removeRow(table, row, bindingObj, name);
            };
            cell.appendChild(delBtn);
            row.appendChild(cell);

            cell = document.createElement('td');
            cell.innerText = name;
            row.appendChild(cell);

            if (bindingObj.colors) {
                const colorInput = document.createElement('input');
                colorInput.setAttribute('type', 'color');

                //Select an unused color.
                let color = classColor;

                if (!color) {
                    appSettings.colorPalette.forEach(c => {
                        if (bindingObj.colors.indexOf(c) === -1) {
                            color = c;
                        }
                    });

                    //If all pallete colors used, fallback to a random color.
                    if (!color) {
                        color = "#000000".replace(/0/g, function () { return (~~(Math.random() * 16)).toString(16); });
                    }
                }

                colorInput.value = color;
                bindingObj.colors.push(color);

                colorInput.oninput = () => {
                    bindingObj.colors[bindingObj.names.indexOf(name)] = colorInput.value;
                };

                cell = document.createElement('td');
                cell.appendChild(colorInput);
                row.appendChild(cell);
            }

            table.appendChild(row);
        }

        this.#validateStep4();
    }

    /**
     * Removes a class row from a table.
     * @param {*} table The table instance showing a list of classes to add a row to.
     * @param {*} rowElm The row instance to remove.
     * @param {*} bindingObj The JSON object to bind this row to.
     * @param {*} name The name of the class to add.
     */
    #removeRow(table, rowElm, bindingObj, name) {
        table.removeChild(rowElm);
        const idx = bindingObj.names.indexOf(name);
        if (idx > -1) {
            bindingObj.names.splice(idx, 1);

            if (bindingObj.colors) {
                bindingObj.colors.splice(idx, 1);
            }
        }

        this.#validateStep4();
    }

    /**
     * Recreates a class table.
     * @param {*} table The table to element to fill.
     * @param {*} classSettings The class settings.
     * @param {*} bindingObj The object to binding the class settings to.
     */
    #inflateTable(table, classSettings, bindingObj) {
        //Clear the table.
        table.innerHTML = '';

        classSettings.names.forEach((n, i) => {
            this.#addClassRow(table, bindingObj, n, (classSettings.colors) ? classSettings.colors[i] : null);
        });
    }

    /**
    * Validation for step 4.
    */
    #validateStep4() {
        const pc = this.#config.properties.primary_classes;
        const sc = this.#config.properties.secondary_classes;

        const nextBtn = document.querySelector('#step-4 .nextBtn');

        //Needs a valid property name and a min of 1 class to proceed (user just wants to capture a single type of thing).
        nextBtn.disabled = !(pc.names.length >= 1 && pc.names.length === pc.colors.length && pc.display_name && pc.display_name.trim() !== '' && pc.property_name && pc.property_name.trim() !== '' &&
            (sc.names.length === 0 || (sc.names.length > 0 && sc.display_name && sc.display_name.trim() !== '' && sc.property_name && sc.property_name.trim() !== '')));
    }

    /**
     * Initialize step 5.
     */
    #initStep5() {
        const self = this;
        const elms = Utils.getElementsByIds(['includeTaskFileLinks', 'baseUrlContainer', 'baseUrlInput']);

        elms.includeTaskFileLinks.addEventListener('change', () => {
            const display = elms.includeTaskFileLinks.checked ? '' : 'none';
            elms.baseUrlContainer.style.display = display;
        });

        const downloadBtn = document.querySelector('#step-5 .downloadBtn');

        downloadBtn.onclick = () => {
            const config = Object.assign({}, self.#config.properties);

            if (config.secondary_classes.names.length === 0) {
                delete config.secondary_classes;
            }

            const aoi = self.#drawingManager.getSource().toJson();
            const gridCells = self.#gridSource.toJson();

            const summary = ['Task ID,West,South,East,North'];

            let captureUrls = false;
            let baseUrl = elms.baseUrlInput.value;

            if (elms.includeTaskFileLinks && baseUrl.value !== '') {
                summary[0] += ',Task File URL,Labeler URL';
                captureUrls = true;

                if (!baseUrl.endsWith('/')) {
                    baseUrl += '/';
                }
            }

            //Create a zip file to put all the files into.            
            const zip = new JSZip();

            //Add an empty results folder.
            zip.folder("results");

            const fileFolder = zip.folder("tasks");
            let fileName = '';

            //Loop through each grid cell and create a config file. 
            gridCells.features.forEach((gc, i) => {
                //Assign a name/ID to the grid cell.
                gc.properties.name = `${config.project_name.replaceAll(' ', '_')}_${i}`;
                gc.id = gc.properties.name;

                fileName = gc.properties.name + '.json';

                //Calculate the bounding box.
                gc.bbox = atlas.data.BoundingBox.fromData(gc);

                //Add the grid info to the summary.
                if (captureUrls) {
                    summary.push(`${gc.id},${gc.bbox.join(',')},${baseUrl + fileName},${window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1)}labeler.html?taskUrl=${encodeURIComponent(baseUrl + fileName)}`);
                } else {
                    summary.push(`${gc.id},${gc.bbox.join(',')}`);
                }

                //Combine the config settings with the grid cell properties, but only include the calculated layers for the grid cell.
                gc.properties = Object.assign({}, config, gc.properties);

                delete gc.properties._azureMapsShapeId;

                fileFolder.file(fileName, JSON.stringify({
                    type: 'FeatureCollection',
                    features: [gc]
                }));
            });

            //Create config file for the overall project.
            const f = aoi.features[0];

            //Convert circles.
            if (f.geometry.type === 'Point' && f.properties.radius) {
                f.geometry.type = 'Polygon';
                f.geometry.coordinates = [atlas.math.getRegularPolygonPath(f.geometry.coordinates, f.properties.radius, 36)];
            }

            delete f.properties._azureMapsShapeId;
            delete f.properties.subType;
            delete f.properties.radius;

            const gridUnitsElm = document.getElementById('gridUnits');

            Object.assign(f.properties, config, {
                gridUnits: Utils.getSelectValue(gridUnitsElm),
                gridSize: parseFloat(document.getElementById('gridSize').value)
            });

            //Get the layer settings for the project.
            f.properties.layers = {};
            self.#baselayers.forEach(l => {
                f.properties.layers[l.id] = Object.assign({ enabled: l.enabled }, l.properties);
            });

            zip.file('project_builder_settings.json', JSON.stringify(aoi, null, 2));

            //Create a summary of the tasks.
            zip.file('summary.csv', summary.join('\n'));

            zip.generateAsync({ type: 'blob' }).then(function (content) {
                Utils.saveFile(config.project_name.replaceAll(' ', '_') + '.zip', content);
            });
        };
    }

    /**
     * Flips to the next or previous card in the sequence.
     * @param {*} direction The number of card steps to advance. Negative for going backwards.
     */
    #flipCard(direction) {
        const self = this;
        const cardIdx = self.#cardIdx + direction;

        if (cardIdx >= 1 && cardIdx <= 5) {
            document.querySelectorAll('.stepCard').forEach(e => {
                e.style.display = (e.id === `step-${cardIdx}`) ? '' : 'none';
            });

            self.#cardIdx = cardIdx;
        }

        if (self.#drawingManager) {
            self.#drawingManager.setOptions({ mode: 'idle' });
        }
    }

    /**
     * Calculates the grid for the area of interest.
     */
    #recalculateGrid = () => {
        const self = this;
        const shapes = self.#drawingManager.getSource().getShapes();

        let geometry;
        let cellSize = self.#cellSize;
        let units = self.#gridUnits;

        //Remove any previously calculated grids.
        self.#gridSource.clear();
        self.#validateStep3();

        //Normalize on kilometers for calculations for simplicity.
        if (units !== 'kilometers') {
            cellSize = atlas.math.convertDistance(cellSize, units, 'kilometers');
        }

        //Get the area of interest geometry.
        if (shapes.length > 0) {
            const props = shapes[0].getProperties();

            if (props.subType === 'Circle') {
                geometry = new atlas.data.Polygon(shapes[0].getCircleCoordinates());
            } else {
                geometry = shapes[0].toJson().geometry;
            }
        } else {
            //If not area of interest geometry, don't proceed.
            return;
        }

        //Try and make polygon valid, incase it isn't already valid.
        try {
            Utils.makePolygonValid(geometry);
        } catch (e) {
            alert(e.message);
            return;
        }

        //Estimate the number of grid cells that would be by comparing the area of the geometry to the area of a single cell.
        const estNumCells = Math.ceil(atlas.math.getArea(geometry, 'squareKilometers') / (cellSize * cellSize));

        //If estimate exceeds limit setting, ask the user if they want to continue.
        if (estNumCells > appSettings.gridSizeLimit && !confirm(`Estimating upwards of ${estNumCells} grid cells being generated. Do you want to continue calculating the grid?`)) {
            return;
        }

        //Calculate the grid cells that intersect the area of interest geometry, and capture the available layers for each cell.
        const cells = self.#calculateSquareGrid(geometry, cellSize);

        //Add the calculated grids to the map.
        this.#gridSource.setShapes(cells);

        //Validate the step.
        this.#validateStep3();

        self.#statsControl.setOptions({
            content: `${cells.length} grid cells`,
            visible: true
        });
    }

    /**
     * Calculates a square grid over a bounding box, then filters it to only the locations that intersect an area of interest. 
     * For those cells that are kept, a list of all layer ID's that intersect the cell are captured.
     * For performance and nice UX, square grid is calculated based on mercator pixels. 
     * The area of a single cell will be relative to the ground resolution in the center of the bounding box of the area of interest. 
     * As such, the size of a cell will vary slightly depending on how far it is north.south from the center of the bounding box.
     * @param {*} aoi Area of interest.
     * @param {*} cellSize The approximate size of a single size (width and height) in kilometers.
     * @returns An array of square polygon grid cells that intersect the area of interest.
     */
    #calculateSquareGrid(aoi, cellSize) {
        //Calculate the bounding box of the aoi geometry.
        const bbox = atlas.data.BoundingBox.fromData(aoi);

        //Ground resolution in km/pixel.
        const gr = Utils.groundResolution(atlas.data.BoundingBox.getCenter(bbox)[1], 22) / 1000;

        //The top left and bottom right corner coordinates in pixels at zoom level 22.
        const corners = atlas.math.mercatorPositionsToPixels([
            [bbox[0], bbox[3]], //Top left
            [bbox[2], bbox[1]]  //Bottom right
        ], 22);

        //Calculate the width/height of the bbox in pixels.
        let minX = Math.min(corners[1][0], corners[0][0]);
        let maxY = Math.max(corners[1][1], corners[0][1]);

        //Calculate the width and height of the bounding box in pixels.
        const w = Math.abs(corners[1][0] - corners[0][0]);
        const h = Math.abs(corners[1][1] - corners[0][1]);

        //Pixel cell size.
        const cellSizePx = cellSize / gr;

        //Calculate the number of rows and columns in the grid.
        const numX = Math.ceil(w / cellSizePx);
        const numY = Math.ceil(h / cellSizePx);

        //Get the details on available layers.
        const layerInfo = this.#getLayerAvailability();

        const intersections = [];

        //Loop through the rows and columns.
        for (let x = 0; x < numX; x++) {
            for (let y = 0; y < numY; y++) {
                let dx = minX + x * cellSizePx;
                let dy = maxY - y * cellSizePx;

                //Create a polygon for the cell.
                const cell = turf.polygon([atlas.math.mercatorPixelsToPositions([
                    [dx, dy],
                    [dx + cellSizePx, dy],
                    [dx + cellSizePx, dy - cellSizePx],
                    [dx, dy - cellSizePx],
                    [dx, dy]
                ], 22)]);

                //Check to see if it intersects the area of interest.
                if (turf.booleanIntersects(cell, aoi)) {
                    //Capture the globally available layers.
                    cell.properties.layers = Object.assign({}, layerInfo.global);

                    //Find all layers that intersect the grid cell.
                    Object.keys(layerInfo.bounded).forEach(k => {
                        const l = layerInfo.bounded[k];
                        if (turf.booleanIntersects(l.bbox, cell)) {
                            //cell.properties.layers.push(l.name);
                            cell.properties.layers[k] = l.properties;
                        }
                    });

                    intersections.push(cell);
                }
            }
        }

        return intersections;
    }

    /**
     * Gets the availability of all layers. Global layers, and layers that are available within a bounding box.
     * @returns An object containing the IDs of global layers, and the ID and a bounding box for limited layers.
     */
    #getLayerAvailability() {
        //Loop through all layers and extract the global layers, and those that need to be tested using a bounding polygon .
        const globalLayers = [];
        const boundedLayers = [];

        const layers = this.#baselayers;

        Object.keys(layers).forEach(k => {
            const l = layers[k];
            if (l.enabled) {
                const opt = l.getOptions();

                let bbox = opt.bounds;

                //Image layers don't have a bounds property, so we have to calculate the bounding box based on the corners of the image.
                if (!bbox && opt.coordinates) {
                    bbox = atlas.data.BoundingBox.fromPositions(opt.coordinates);
                }

                //If the layer has a bounds option, assume it requires testing.
                if (bbox && !(bbox[0] <= -179 && bbox[2] >= 179 && bbox[1] <= -85.05 && bbox[3] >= 85.05)) {
                    //boundedLayers.push({ name: layers[k].id, bounds: turf.bboxPolygon(bbox) });
                    boundedLayers[l.id] = {
                        bbox: turf.bboxPolygon(bbox),
                        properties: l.properties
                    };
                } else {
                    globalLayers[l.id] = l.properties;
                }
            }
        });

        return {
            global: globalLayers,
            bounded: boundedLayers
        };
    }

    #loadProject(fileBlob) {
        const self = this;
        //const settingsFileName = 'project_builder_settings.json';

        ProjectUtils.readProjectFile(fileBlob).then(project => {
            //Load the area of interest into the drawing manager.
            self.#drawingManager.getSource().setShapes(project.aoi);

            self.map.setCamera({
                bounds: project.bbox,
                padding: 10
            });

            const props = project.aoi.properties;
            Object.assign(self.#config.properties, props);

            const elms = Utils.getElementsByIds(['instructions', 'gridUnits', 'gridSize', 'classTable1', 'classDisplayName1', 'classPropName1', 'classTable2', 'classDisplayName2', 'classPropName2', 'loadLocalProjectFile', 'captureSecondaryClass']);

            //Step 1
            const card1Elm = document.getElementById('step-1');
            let binders = card1Elm.querySelectorAll('[data-binding]');

            binders.forEach(b => {
                const val = props[b.getAttribute('data-binding')];

                if (typeof (val) !== 'undefined') {
                    if (b.type === 'checkbox') {
                        b.checked = val;
                    } else {
                        b.value = val;
                    }
                }
            });

            const customDataSwitch = document.getElementById('customDataSwitch');
            customDataSwitch.checked = (props.customDataService && props.customDataService !== '');
            customDataSwitch.onclick();

            //Trigger instructions preview to update.
            elms.instructions.dispatchEvent(new Event('keyup'));

            //Validate step 1.
            self.#validateStep1();

            //Step 2
            self.#baselayers = [];
            self.#addLayers(props.layers);
            self.#updateLayerStates();
            self.#validateStep2();

            //Step 3
            elms.gridUnits.value = props.gridUnits;
            elms.gridSize.value = props.gridSize;

            //Load the tasks grid cells.
            self.#gridSource.setShapes(project.tasks);
            self.#statsControl.setOptions({
                content: `${project.tasks.length} grid cells`,
                visible: true
            });

            self.#validateStep3();

            //Step 4
            let c = props.primary_classes;

            self.#config.properties.primary_classes = {
                display_name: c.display_name,
                property_name: c.property_name,
                names: [],
                colors: []
            };

            self.#inflateTable(elms.classTable1, c, self.#config.properties.primary_classes);

            elms.classDisplayName1.value = c.display_name;
            elms.classPropName1.value = c.property_name;

            elms.classTable2.innerHTML = '';

            const sc = {
                display_name: 'Secondary class',
                property_name: 'secondary_class',
                names: []
            };

            self.#config.properties.secondary_classes = sc;

            c = props.secondary_classes;
            if (c && c.names.length > 0) {
                elms.captureSecondaryClass.checked = true;

                sc.display_name = c.display_name;
                sc.property_name = c.property_name;
                self.#inflateTable(elms.classTable2, c, self.#config.properties.secondary_classes);
            }

            elms.captureSecondaryClass.dispatchEvent(new Event('change'));

            elms.classDisplayName2.value = sc.display_name;
            elms.classPropName2.value = sc.property_name;

            self.#validateStep4();

            //Show the first step card.
            self.#cardIdx = 0;
            self.#flipCard(1);

            //Clear the file input so that the same file can be reloaded if desired.
            elms.loadLocalProjectFile.value = null;
        });
    }
}