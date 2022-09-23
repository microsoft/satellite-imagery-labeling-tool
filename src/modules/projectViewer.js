import { appSettings } from '../settings/project_admin_settings.js';
import { mapSettings } from '../settings/map_settings.js';

import { Utils } from './utils.js';
import { ProjectUtils } from './projectUtils.js';
import { SimpleLayerControl, SearchBarControl, SimpleContentControl } from './controls/customMapControls.js';
import { ContentDialog, SaveResultsDialog } from './controls/dialogs.js';

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
        tasks: `
        <h2>Task area stats</h2>
        <b># of labeled features</b>
        <div class='legend'>
            <svg width="225" height="46" viewBox="0 0 200 46.96" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
                <defs>      
                    <linearGradient id="task-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stop-color="#d7191c"></stop>
                        <stop offset="1%" stop-color="#ffffcc"></stop>
                        <stop offset="25%" stop-color="#a1dab4"></stop>
                        <stop offset="50%" stop-color="#41b6c4"></stop>
                        <stop offset="75%" stop-color="#2c7fb8"></stop>
                        <stop offset="100%" stop-color="#253494"></stop>
                    </linearGradient>
                </defs>

                <rect x="0" y="0" width="200" height="20" fill="url('#task-gradient')"></rect>

                <g style="stroke:#011c2c;stroke-width:2;"><line x1="0" y1="23" x2="200" y2="23"></line><line x1="1" y1="23" x2="1" y2="28"></line><line x1="199" y1="23" x2="199" y2="28"></line></g>

                <g style="fill:#011c2c;font-size:12px;font-family:'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif;text-align:center;text-anchor:middle;dominant-baseline:hanging;"><text x="1" y="31">0</text><text x="199" y="31">{{largestLabeledTask}}</text></g>
            </svg>
        </div>`,
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
        const helpDialog = new ContentDialog('Project viewer help', marked.parse(appSettings.helpViewerContent), 'helpContent');
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

        ProjectUtils.readProjectFile(fileBlob, true).then(project => {
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
            
            const pc = project.aoi.properties.primary_classes;
            let html = ['<h2>', pc.display_name,'</h2><div class="legend">'];

            pc.names.forEach(n => {
                html.push(self.#getLegendItem(n, project.colors.primary[project.colors.primary.indexOf(n) + 1]));
            });

            html.push('</div>');

            self.#legends.primary = html.join('');

            const sc = project.aoi.properties.secondary_classes;
            if(sc && sc.names && sc.names.length > 0){
                let html = ['<h2>', sc.display_name,'</h2><div class="legend">'];

                sc.names.forEach(n => {
                    html.push(self.#getLegendItem(n, project.colors.secondary[project.colors.secondary.indexOf(n) + 1]));
                });
                html.push('</div>');

                self.#legends.secondary = html.join('');
            } else {
                self.#legends.secondary = '';
                if(self.#focus === 'secondary') {
                    self.#focus = 'primary';
                }
            }

            html = [
                `Task areas: ${project.tasks.length}`, 
                `Labeled features: ${project.results.length}`
            ];

            if(project.stats.primary && Object.keys(project.stats.primary).length > 0){
                html.push(`<br/>${pc.display_name}:<br/>`);

                Object.keys(project.stats.primary).forEach(n => {
                    html.push(` - ${n}: ${project.stats.primary[n] || 0}`);
                });
            }
            
            const fs = document.getElementById('focusSelector');
            fs.options[1].innerHTML = pc.display_name;

            if(sc && sc.names && sc.names.length > 0 && project.stats.secondary && Object.keys(project.stats.secondary).length > 0){
                html.push(`<br/>${sc.display_name}:<br/>`);

                Object.keys(project.stats.secondary).forEach(n => {
                    html.push(` - ${n}: ${project.stats.secondary[n] || 0}`);
                });

                fs.options[2].innerHTML = sc.display_name;
                fs.options[2].disabled = false;
            } else {
                fs.options[2].disabled = true;
            }

            if(project.stats.resultsNoTasks > 0){
                html.push(`<br/>Results missing a task: ${project.stats.resultsNoTasks}`);    
            }

            if(project.stats.tasksNoResults > 0){
                html.push(`<br/><hr/>Tasks with no labeled features: ${project.stats.tasksNoResults}<br/>`);

                project.tasks.forEach(t => {
                    if(!t.properties.stats) {
                        html.push(`<a href="javascript:void(0)" class="viewTaskLink">${t.properties.name}</a>`);
                    }
                });
            }

            document.getElementById('statsPanel').innerHTML = html.join('<br/>');

            document.querySelectorAll('.viewTaskLink').forEach(e => {
                e.onclick = () => {
                    var s = self.#taskSource.getShapeById(e.innerText);
                    if(s) {
                        self.map.setCamera({
                            bounds: atlas.data.BoundingBox.fromData(s),
                            padding: 20
                        })
                    }
                };
            });

            //Clear the file input so that the same file can be reloaded if desired.
            document.getElementById('loadLocalProjectFile').value = null;

            self.#setFocus();
        });
    }

    #getLegendItem(label, color) {
        return `<div class="legend-item">
            <svg class="legend-box" style="width:20px;" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                <rect x="1" y="1" height="18" width="18" fill="${color}" stroke-width="1"></rect>
            </svg>
            <span aria-label="${label}">${label}</span>
        </div>`;
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

            self.#legendControl.setOptions({
                content: self.#legends[focus].replace('{{largestLabeledTask}}', p.stats.largestLabeledTask || 1)
            });
        }
    }

    #showTaskPopup = (e) => {
        const self = this;

        const p = e.shapes[0].getProperties();

        const html = [`<div class="popup-content">Task ID: <br/>${p.name}<br/><br/>`];

        if(p.stats) {
            html.push(`<b>${p.stats.numEntities} labeled features.</b><br/><br/>`);

            html.push(`${p.primary_classes.display_name}:<br/>`);

            Object.keys(p.stats.primary).forEach(n => {
                html.push(` - ${n}: ${p.stats.primary[n] || 0}<br/>`);
            });

            const sc = p.secondary_classes;

            if(sc && sc.names && sc.names.length > 0){
                html.push(`<br/>${sc.display_name}:<br/>`);

                Object.keys(p.stats.secondary).forEach(n => {
                    html.push(` - ${n}: ${p.stats.secondary[n] || 0}<br/>`);
                });
            }

        } else {
            html.push('<b>Has no labeled features.</b>');
        }

        html.push('</div>');

        self.#popup.setOptions({
            content: html.join(''),
            position: e.position
        });
        self.#popup.open(self.map);
    }

    #showEntityPopup = (e) => {
        this.#popup.setOptions({
            content: atlas.PopupTemplate.applyTemplate(e.shapes[0].getProperties()),
            position: e.position
        });
        this.#popup.open(this.map);
    }
}