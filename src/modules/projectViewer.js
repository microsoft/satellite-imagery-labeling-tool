import { appSettings } from '../settings/project_admin_settings.js';
import { mapSettings } from '../settings/map_settings.js';

import { Utils } from './utils.js';
import { ProjectUtils } from './projectUtils.js';
import { SimpleLayerControl, SearchBarControl, SimpleContentControl } from './controls/customMapControls.js';
import { ContentDialog, SaveResultsDialog, confirmCapacityOverride, confirmPrivateDestination } from './controls/dialogs.js';
import { renderSafeMarkdown, setText } from './safeRendering.js';

export class ProjectViewerApp {

    #hasAZMapAuth = false;
    #popup;
    #baselayers = [];
    #layerControl;
    #legendControl;
    #saveResultsDialog;
    #config = {
        id: '',
        type: 'Feature',
        geometry: null,
        properties: {
            project_name: '',
            name: '',
            instructions: '',
            drawing_type: "polygon",
            allow_wizard: true,
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
    #aoiSource;
    #taskSource;
    #resultSource;
    #taskOutline;
    #taskFillLayer;
    #resultOutlineLayer;
    #resultFillLayer;
    #resultHoverLayer;
    #currentProject;
    #focus = 'tasks';

    #areaOutlineStyle = {
        strokeWidth: 3,
        strokeColor: 'yellow',
        strokeDashArray: [2, 2]
    };

    #gridStatsStyle = {
        strokeColor: [
            'case',
            ['has', 'stats'],
            [
                'interpolate',
                ['linear'],
                ['get', 'numEntities', ['get', 'stats']],
                0, '#ffffcc', 
                25, '#a1dab4',
                50, '#41b6c4',
                75, '#2c7fb8',
                100, '#253494'
            ],
            '#d7191c'
        ],
        strokeWidth: 3
    };

    #neutralGridStyle = {
        strokeColor: 'black',
        strokeWidth: 3,
        strokeDashArray: [2, 2]
    };

    #legends = {
        tasks: null,
        primary: '',
        secondary: '',
    }

    constructor() {
        const self = this;

        const hasAZMapAuth = Utils.isAzureMapsAuthValid(mapSettings.azureMapsAuth);
        this.#hasAZMapAuth = hasAZMapAuth;

        document.querySelector('title').innerText = appSettings.builderTitle;

        //Initialize a map instance.
        self.map = Utils.createMap('myMap', mapSettings.azureMapsAuth);

        self.map.events.add('ready', self.#mapReady);

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
        const helpRendered = renderSafeMarkdown(appSettings.helpViewerContent);
        const helpDialog = new ContentDialog('Project viewer help', helpRendered, 'helpContent');
        document.getElementById('helpBtn').onclick = () => {
            helpDialog.show();
        };

        const fs = document.getElementById('focusSelector');
        fs.onchange = () => {
            const focus = Utils.getSelectValue(fs);
            self.#setFocus(focus);
        };

        self.#saveResultsDialog = new SaveResultsDialog('Merage and export results') ;     
        
        document.getElementById('exportBtn').onclick = () => {
            const cp = self.#currentProject;

            if(cp){                
                const sc = cp.aoi.properties.secondary_classes;
                self.#saveResultsDialog.show(cp.aoi.properties.project_name, self.#resultSource, cp.aoi.properties.primary_classes.property_name, (sc)? sc.property_name : null);
            } else {
                alert('No project loaded.');
            }
        };
    }

    /** Post map load tasks to prepare the app. */
    #mapReady = () => {
        const self = this;
        const map = self.map;

        //Create a reusable popup.
		self.#popup = new atlas.Popup();

        //Create datasource and layers for the area of interest.
        const aoiSource = new atlas.source.DataSource();
        map.sources.add(aoiSource);

        self.#aoiSource = aoiSource;

        const aoiLayer = new atlas.layer.LineLayer(aoiSource, null, self.#areaOutlineStyle);

        //Create datasource and layer for task areas grid cells.
        const taskSource = new atlas.source.DataSource();
        map.sources.add(taskSource);

        self.#taskSource = taskSource;

        //Specify custom properties to be the id for feature state.
        map.map.getSource(taskSource.getId()).promoteId = '_azureMapsShapeId';

        const taskOutline = new atlas.layer.LineLayer(taskSource, null, self.#gridStatsStyle);

        self.#taskOutline = taskOutline;

        const taskFillLayer = new atlas.layer.PolygonLayer(taskSource, null, {
            fillColor: [
                'case',
                ['has', 'stats'],
                [
                    'interpolate',
                    ['linear'],
                    ['get', 'numEntities', ['get', 'stats']],
                    0, '#ffffcc', 
                    25, '#a1dab4',
                    50, '#41b6c4',
                    75, '#2c7fb8',
                    100, '#253494'
                ],

                ['literal', '#d7191c']
            ]
        });

        self.#taskFillLayer = taskFillLayer;

        //Create a layer for highlighting shapes when hovered.
		const taskHoverLayer = new atlas.layer.LineLayer(taskSource, null, {
			strokeColor: 'white',
			strokeWidth: 11,
			blur: 7,
			strokeOpacity: [
				'case',
				['boolean', ['feature-state', 'hovered'], false],
				1, 0
			]
		});

        //Create datasource and layers for task area results.
        const resultSource = new atlas.source.DataSource();
        map.sources.add(resultSource);

         //Specify custom properties to be the id for feature state.
         map.map.getSource(resultSource.getId()).promoteId = '_azureMapsShapeId';

        self.#resultSource = resultSource;

        self.#resultOutlineLayer = new atlas.layer.LineLayer(resultSource, null, {
            strokeWidth: 3
        });

        self.#resultFillLayer = new atlas.layer.PolygonLayer(resultSource);

        //Create a layer for highlighting shapes when hovered.
        const resultHoverLayer = new atlas.layer.LineLayer(resultSource, null, {
            strokeColor: 'white',
            strokeWidth: 11,
            blur: 7,
            strokeOpacity: [
                'case',
                ['boolean', ['feature-state', 'hovered'], false],
                1, 0
            ]
        });

        self.#resultHoverLayer = resultHoverLayer;

        //Add layers to the map.
        map.layers.add([
            taskFillLayer,
            taskOutline,
            self.#resultFillLayer,
            self.#resultOutlineLayer,
            aoiLayer
        ], 'labels');

        map.layers.add([
            taskHoverLayer,
            resultHoverLayer
        ]);

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

        //Add a simple control for displaying a legend.
        self.#legendControl = new SimpleContentControl();

        map.controls.add(self.#legendControl, {
            position: 'top-right'
        });

        //Create layer control.
        const layerControl = new SimpleLayerControl(self.#baselayers, true);
        map.controls.add(layerControl, {
            position: 'top-left'
        });
        self.#layerControl = layerControl;
        self.#addLayers(appSettings.layers);

        //Add hover effect on mouse move.
		map.events.add('mousemove', (e) => {
			//Remove previous hover state.
			map.map.removeFeatureState({ source: taskSource.getId() });            
			map.map.removeFeatureState({ source: resultSource.getId() });
            map.getCanvas().style.cursor = 'grab';

            for(let i=0;i< e.shapes.length;i++) {
                if (e.shapes[i] instanceof atlas.Shape) {
                    const id = e.shapes[i].getProperties()._azureMapsShapeId;
    
                    if(taskSource.getShapeById(id) !== null) {
                        map.map.setFeatureState({ source: taskSource.getId(), id: id }, { hovered: true });
                        map.getCanvas().style.cursor = 'pointer';
                    } else  if(resultSource.getShapeById(id) !== null) {
                        map.map.setFeatureState({ source: resultSource.getId(), id: id }, { hovered: true });
                        map.getCanvas().style.cursor = 'pointer';
                    }

                    break;
                }
            }           
		});
        
        //Add a click event to layers.
		map.events.add('click', [taskFillLayer, taskOutline], self.#showTaskPopup);
        map.events.add('click', [self.#resultFillLayer, self.#resultOutlineLayer], self.#showEntityPopup);
    }

    /** Adds layers to layer control. */
    #addLayers(layerConfig) {
        const self = this;
        const lc = self.#layerControl;

        if (layerConfig) {
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
        }

        lc.loadLayers(self.#baselayers);
    }

    #loadProject(fileBlob) {
        const self = this;
        self.#popup.close();

        ProjectUtils.readProjectFile(fileBlob, true, {
            confirmCapacityOverride,
            confirmDestinationOrigin: decision => Promise.resolve(confirm(
                `This project references data from ${decision.origin}. Continue?`
            )),
            confirmPrivateDestination: decision => confirmPrivateDestination({
                title: 'Load project data from a private address?',
                description: `This project references ${decision.origin}. Only continue if you trust this private network destination.`,
                acknowledgment: 'I understand this project will contact a private network address.',
                action: 'Load project data',
                cancel: 'Cancel project load'
            })
        }).then(project => {
            self.#currentProject = project;

            //Load and zoom into the area of interest.
            self.#aoiSource.setShapes(project.aoi);
            self.map.setCamera({
                bounds: project.bbox,
                padding: 10
            });

            const props = project.aoi.properties;
            Object.assign(self.#config.properties, props);

            //Load layers.
            self.#baselayers = [];
            self.#addLayers(props.layers);

            //Load the task area grid cells.
            self.#taskSource.setShapes(project.tasks);

            //Load result data.
            self.#resultSource.setShapes(project.results);

            //Create legends.
            const pc = props.primary_classes;
            const primaryLegend = document.createElement('div');
            const primaryTitle = document.createElement('h2');
            setText(primaryTitle, pc.display_name);
            const primaryItems = document.createElement('div');
            primaryItems.className = 'legend';
            primaryLegend.append(primaryTitle, primaryItems);

            pc.names.forEach(n => {
                primaryItems.appendChild(self.#getLegendItem(
                    n,
                    project.colors.primary[project.colors.primary.indexOf(n) + 1]
                ));
            });

            self.#legends.primary = primaryLegend;

            const sc = props.secondary_classes;
            if(sc && sc.names && sc.names.length > 0){
                const secondaryLegend = document.createElement('div');
                const secondaryTitle = document.createElement('h2');
                setText(secondaryTitle, sc.display_name);
                const secondaryItems = document.createElement('div');
                secondaryItems.className = 'legend';
                secondaryLegend.append(secondaryTitle, secondaryItems);

                sc.names.forEach(n => {
                    secondaryItems.appendChild(self.#getLegendItem(
                        n,
                        project.colors.secondary[project.colors.secondary.indexOf(n) + 1]
                    ));
                });

                self.#legends.secondary = secondaryLegend;
            } else {
                self.#legends.secondary = document.createElement('div');
                if(self.#focus === 'secondary') {
                    self.#focus = 'primary';
                }
            }

            const statsPanel = document.getElementById('statsPanel');
            statsPanel.replaceChildren();
            const addStatsLine = (text, tagName = 'div') => {
                const line = document.createElement(tagName);
                setText(line, text);
                statsPanel.appendChild(line);
            };
            addStatsLine(`Task areas: ${project.tasks.length}`);
            addStatsLine(`Labeled features: ${project.results.length}`);

            if(project.stats.primary && Object.keys(project.stats.primary).length > 0){
                addStatsLine(`${pc.display_name}:`);

                Object.keys(project.stats.primary).forEach(n => {
                    addStatsLine(` - ${n}: ${project.stats.primary[n] || 0}`);
                });
            }
            
            const fs = document.getElementById('focusSelector');
            setText(fs.options[1], pc.display_name);

            if(sc && sc.names && sc.names.length > 0 && project.stats.secondary && Object.keys(project.stats.secondary).length > 0){
                addStatsLine(`${sc.display_name}:`);

                Object.keys(project.stats.secondary).forEach(n => {
                    addStatsLine(` - ${n}: ${project.stats.secondary[n] || 0}`);
                });

                setText(fs.options[2], sc.display_name);
                fs.options[2].disabled = false;
            } else {
                fs.options[2].disabled = true;
            }

            if(project.stats.resultsNoTasks > 0){
                addStatsLine(`Results missing a task: ${project.stats.resultsNoTasks}`);
            }

            if(project.stats.tasksNoResults > 0){
                statsPanel.appendChild(document.createElement('hr'));
                addStatsLine(`Tasks with no labeled features: ${project.stats.tasksNoResults}`);

                project.tasks.forEach(t => {
                    if(!t.properties.stats) {
                        const button = document.createElement('button');
                        button.type = 'button';
                        button.className = 'viewTaskLink';
                        setText(button, t.properties.name);
                        button.onclick = () => {
                            const shape = self.#taskSource.getShapeById(t.properties.name);
                            if (shape) {
                                self.map.setCamera({
                                    bounds: atlas.data.BoundingBox.fromData(shape),
                                    padding: 20
                                });
                            }
                        };
                        statsPanel.appendChild(button);
                    }
                });
            }

            //Clear the file input so that the same file can be reloaded if desired.
            document.getElementById('loadLocalProjectFile').value = null;

            self.#setFocus();
        }).catch(error => {
            document.getElementById('loadLocalProjectFile').value = null;
            alert(error.message || 'Unable to load project archive.');
        });
    }

    #getLegendItem(label, color) {
        const item = document.createElement('div');
        item.className = 'legend-item';
        const swatch = document.createElement('span');
        swatch.className = 'legend-box';
        swatch.style.backgroundColor = typeof color === 'string' && CSS.supports('color', color)
            ? color
            : 'transparent';
        const text = document.createElement('span');
        setText(text, label);
        item.append(swatch, text);
        return item;
    }

    #getTaskLegend(largestLabeledTask) {
        const legend = document.createElement('div');
        const title = document.createElement('h2');
        setText(title, 'Task area stats');
        const label = document.createElement('strong');
        setText(label, '# of labeled features');
        const scale = document.createElement('div');
        scale.className = 'legend task-count-legend';
        scale.style.background = 'linear-gradient(90deg, #d7191c, #ffffcc 1%, #a1dab4 25%, #41b6c4 50%, #2c7fb8 75%, #253494)';
        scale.setAttribute('aria-label', `Range from 0 to ${largestLabeledTask}`);
        const range = document.createElement('div');
        setText(range, `0 - ${largestLabeledTask}`);
        legend.append(title, label, scale, range);
        return legend;
    }

    #setFocus(focus) {
        const self = this;
        self.#popup.close();
        const p = self.#currentProject;

        focus = focus || self.#focus;
        self.#focus = focus;

        if(p){
            const tol = self.#taskOutline;
            const tfl = self.#taskFillLayer;
            const rol = self.#resultOutlineLayer;
            const rfl = self.#resultFillLayer;
            const rhl = self.#resultHoverLayer;
            
            const ngs = self.#neutralGridStyle;

            switch (focus) {
                case 'tasks':
                    tfl.setOptions({ visible: true });
                    tol.setOptions(self.#gridStatsStyle);
                    rol.setOptions({ visible: false });
                    rfl.setOptions({ visible: false });
                    rhl.setOptions({ visible: false });
                    break;
                case 'primary':
                    tfl.setOptions({ visible: false });
                    tol.setOptions(ngs);
                    rol.setOptions({ visible: true, strokeColor: p.colors.primary });
                    rfl.setOptions({ visible: true, fillColor: p.colors.primary });
                    rhl.setOptions({ visible: true });
                    break;
                case 'secondary':
                    tfl.setOptions({ visible: false });
                    tol.setOptions(ngs);
                    rol.setOptions({ visible: true, strokeColor: p.colors.secondary });
                    rfl.setOptions({ visible: true, fillColor: p.colors.secondary });
                    rhl.setOptions({ visible: true });
                    break;
            }

            if (focus === 'tasks') {
                self.#legendControl.setOptions({
                    content: self.#getTaskLegend(p.stats.largestLabeledTask || 1)
                });
            } else {
                self.#legendControl.setOptions({
                    content: self.#legends[focus].cloneNode(true)
                });
            }
        }
    }

    #showTaskPopup = (e) => {
        const self = this;

        const p = e.shapes[0].getProperties();

        const content = document.createElement('div');
        content.className = 'popup-content';
        const addLine = (text, strong = false) => {
            const line = document.createElement(strong ? 'strong' : 'div');
            setText(line, text);
            content.appendChild(line);
        };
        addLine('Task ID:');
        addLine(p.name);

        if(p.stats) {
            addLine(`${p.stats.numEntities} labeled features.`, true);
            addLine(`${p.primary_classes.display_name}:`);

            Object.keys(p.stats.primary).forEach(n => {
                addLine(` - ${n}: ${p.stats.primary[n] || 0}`);
            });

            const sc = p.secondary_classes;

            if(sc && sc.names && sc.names.length > 0){
                addLine(`${sc.display_name}:`);

                Object.keys(p.stats.secondary).forEach(n => {
                    addLine(` - ${n}: ${p.stats.secondary[n] || 0}`);
                });
            }

        } else {
            addLine('Has no labeled features.', true);
        }

        self.#popup.setOptions({
            content,
            position: e.position
        });
        self.#popup.open(self.map);
    }

    #showEntityPopup = (e) => {
        const content = document.createElement('pre');
        setText(content, JSON.stringify(e.shapes[0].getProperties(), null, 2));
        this.#popup.setOptions({
            content,
            position: e.position
        });
        this.#popup.open(this.map);
    }
}