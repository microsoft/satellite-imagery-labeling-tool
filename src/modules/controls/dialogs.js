import { Utils, SimpleEventerClass } from "../utils.js";
import { mapSettings } from '../../settings/map_settings.js'

/**
 * Template for a dialog panel.
 */
const dialogTemplate = `
    <div class="dialog-background"></div>
    <div class="dialog-card">
        <div class="dialog-title">
            {{title}}
            <button type="button" aria-label="Close dialog" class="icon-btn flyout-header-close-btn"><i class="material-symbols-outlined">close</i></a>
        </div>

        <div class="dialog-content">
        </div>
    </div>
`;

/**
 * Template for a layer dialog control.
 */
const addLayerDialogTemplate = `
    <table class="add-layer-dialog">
        <tr>
            <td><label for='layer-type'>Layer type</label></td>
            <td><select id='layer-type' name='layer-type'></select></td>
        </tr>
        <tr class='layer-name'>
            <td>Layer name</td>
            <td><input type='text' aria-label='layer name'/></td>
        </tr>
        <tr class='service-url'>
            <td>Service URL</td>
            <td><input type='text' aria-label='service url'/> <img name='service-loader' src='assets/small-loader.gif' style='visibility:hidden' aria-label='Service loading icon'/><button class="text-btn-round">Test</button></td>
        </tr>
        <tr class='url-local-file'>
            <td>URL or local file</td>
            <td>
                <input type='text' aria-label='url or local file'/>
                <input type="file" aria-label='input file'/>
                <button class='icon-btn-round' type='button'>Local file</button>
            </td>
        </tr>
        <tr class='bounds'>
            <td>Bounds</td>
            <td>
                <input name='bbox' type="text" aria-label="bounding box. min longitude, min latitude, max longitude, max latitude" placeholder="minLon, minLat, maxLon, maxLat"/><br/>
            </td>
        </tr>
        <tr class='rotation'>
            <td>Rotation</td>
            <td>
                <form oninput='RotationValue.value=rotationValue.value'>
                    <input type='range' id='rotationValue' name='rotationValue' min='0' max='360' value='0' aria-label='image rotation'/>
                    <output name='RotationValue' for='rotationValue'>0</output>
                </form>
            </td>
        </tr>
        <tr class='tile-size'>
            <td>Tile size</td>
            <td>
                <label><input type='radio' name='tile-size-radio' value='256' checked='checked' aria-label='tile size of 256 pixels'/> 256</label>
                <label><input type='radio' name='tile-size-radio' value='512' aria-label='tile size of 512 pixels'/> 512</label>
            </td>
        </tr>
        <tr class='tile-subdomains'>
            <td>Subdomains</td>
            <td><input type='text' aria-label='subdomains'/></td>
        </tr>
        <tr class='corners'>
            <td>Corner coordinates</td>
            <td>
                <table>
                    <tr>
                        <td>Top left</td>
                        <td><input name='topLeft' type='text' aria-label='Top left coordinate' placeholder='lon, lat'/></td>
                    </tr>
                    <tr>
                        <td>Top right</td>
                        <td><input name='topRight' type='text' aria-label='Top right coordinate' placeholder='lon, lat'/></td>
                    </tr>
                    <tr>
                        <td>Bottom left</td>
                        <td><input name='bottomLeft' type='text' aria-label='Bottom left coordinate' placeholder='lon, lat'/></td>
                    </tr>
                    <tr>
                        <td>Bottom right</td>
                        <td><input name='bottomRight' type='text' aria-label='Bottom right coordinate' placeholder='lon, lat'/></td>
                    </tr>
                </table>
            </td>
        </tr>
        <tr class='active-ogc-layer'>
            <td><label for='active-ogc-layer-selector'>Active layer</label></td>
            <td><select id='active-ogc-layer-selector' name='active-ogc-layer-selector'></select></td>
        </tr>
        <tr class='tilejson-urls'>
            <td colspan="2">
                TileJSON URLs (one per line)<br/><br/>
                <textarea name='active-ogc-layer-selector'></textarea>
            </td>
        </tr>
    </table>
`;

/**
 * A modal dialog panel that allows map layers to be created.
 * Exposes a 'close' event that will have an array of layers or null as an argument.
 */
export class AddLayerDialog extends SimpleEventerClass {
    #map;
    #container;
    #serviceLoaderIcon;
    #layerTypeSelector;

    //Settings for each type of layer.
    #layerTypes = {
        'ImageLayerBounds': {
            title: 'Image layer - bounds/rotation',
            inputs: ['layer-name', 'url-local-file', 'bounds', 'rotation'],
            defaults: {
                bbox: '',
                rotationValue: 0,
                accepts: '.jpg,.png'
            }
        },
        'ImageLayer': {
            title: 'Image layer - corners',
            inputs: ['layer-name', 'url-local-file', 'corners'],
            defaults: {
                topLeft: '',
                topRight: '',
                bottomRight:'',
                bottomLeft: '',
                accepts: '.jpg,.png'
            }
        },
        'KmlGroundOverlay': {
            title: 'KML / KMZ Ground Overlay',
            inputs: ['layer-name', 'url-local-file'],
            defaults: {
                accepts: '.kml,.kmz,.zip'
            }
        },
        'BulkTileJSON': {
            title: 'TileJSON (Bulk load)',
            inputs: ['tilejson-urls']
        },
        'TileLayer': {
            title: 'Tile Layer',
            inputs: ['layer-name', 'service-url', 'bounds', 'tile-size', 'tile-subdomains'],
            defaults: {
                bbox: ''
            }
        },
        'OgcMapLayer': {
            title: 'WMS / WMTS service',
            inputs: ['layer-name', 'service-url', 'active-ogc-layer']
        }
    };

    /**
     * A modal dialog panel that allows map layers to be created.
     * @param {*} map The map instance.
     */
    constructor(map) {
        super();

        const self = this;

        self.#map = map;

        //Load in the CSS styles for the dialog.
        Utils.requireCSS('css/dialogs.css');

        //Create the container. 
        const c = document.createElement('div');
        c.className = 'dialog-container';
        c.style.display = 'none';

        //Set the title of the dialog.
        c.innerHTML = dialogTemplate.replace('{{title}}', 'Add layer');

        //Wire up the close button to cancel the creation of a layer.
        c.querySelector('.dialog-title button').onclick = () => {
            this.close();
        };

        document.body.appendChild(c);
        self.#container = c;

        //Create UI elements.
        const content = c.querySelector('.dialog-content');
        content.innerHTML = addLayerDialogTemplate;

        const addBtn = document.createElement('button');
        addBtn.className = 'text-btn-round addLayerBtn';
        addBtn.innerHTML = 'Add';
        addBtn.setAttribute('type', 'button');
        addBtn.onclick = self.#addBtnClicked;
        content.appendChild(addBtn);

        const lt = c.querySelector('select[name="layer-type"]');

        //Create the dropdown list of layer types to choose from.
        const options = [];
        Object.keys(self.#layerTypes).forEach(key => {
            var l = self.#layerTypes[key];
            options.push(`<option value='${key}' ${(key === 'TileLayer') ? 'checked="checked"' : ''}>${l.title}</option>`);
        });

        lt.innerHTML = options.join('');
        lt.onchange = () => {
            self.#setLayerType(lt.options[lt.selectedIndex].value);
        };

        self.#layerTypeSelector = lt;

        //Create a loading icon to show when testing TileJSON and OGC service URLs.
        const sericeLoaderIcon = c.querySelector('img[name="service-loader"]')
        self.#serviceLoaderIcon = sericeLoaderIcon;

        c.querySelector('.service-url button').onclick = async () => {
            const l = lt.options[lt.selectedIndex].value;
            const serviceUrl = c.querySelector('.service-url input').value;

            sericeLoaderIcon.style.visibility = 'visible';

            if (l === 'TileLayer') {
                try {
                    const tilejson = await self.#getTileJson(serviceUrl);

                    if (tilejson !== null) {
                        const ln = c.querySelector('.layer-name input');

                        if (ln.value === '') {
                            ln.value = tilejson.name;
                        }
                    }
                } catch (e) {
                    confirm('Unable to access tile service.');
                }
            } else if (l === 'OgcMapLayer') {
                //Test service endpoint.
                self.#testOgcServiceUrl(serviceUrl);
            }

            sericeLoaderIcon.style.visibility = 'hidden';
        };

        //If the service URL changes, reset the active layer.
        c.querySelector('.service-url input[type="text"]').onkeyup = () => {
            c.querySelector('select[name="active-ogc-layer-selector"]').innerHTML = '';
        };

        //Wire up support for loading a local file for some layers.
        const fileInput = c.querySelector('.url-local-file input[type="file"]');
        fileInput.oninput = async (e) => {
            if (e.target.files && e.target.files.length > 0) {
                var file = e.target.files[0];
                const l = lt.options[lt.selectedIndex].value;

                const reader = new FileReader();

                reader.onload = async () => {
                    const textInput = c.querySelector('.url-local-file input[type="text"]');
                    textInput.value = reader.result;

                    if (l === 'KmlGroundOverlay') {
                        try {
                            const go = await self.#testKmlGroundOverlay(reader.result);
                            if (!go) {
                                confirm('No ground overlay found in KML / KMZ file.');
                            }
                        } catch (e) {
                            confirm('Error reading KML / KMZ file.');
                        }
                    }
                };
                reader.onerror = (error) => {
                    confirm('Error loading file.');
                };

                reader.readAsDataURL(file);
            }
        };

        const loadLocalFileBtn = c.querySelector('.url-local-file button');
        loadLocalFileBtn.onclick = () => {
            fileInput.click();
        };
    }

    /**
     * Shows the dialog.
     */
    show() {
        const self = this;

        //Reset UI.
        self.#setLayerType('TileLayer');

        //Display dialog.
        self.#container.style.display = '';

        //Set focus on the close button.
        self.#container.querySelector('.dialog-title button').blur();
    }

    /**
     * Close the dialog without making any changes.
     */
    close(layers) {
        this.#container.style.display = 'none';

        //Trigger the close event.
        this.trigger('close', layers);
    }

    /**
     * Event handler for when the layer Add button is clicked. 
     */
    #addBtnClicked = async () => {
        const self = this;
        const layers = {};

        const c = self.#container;

        const lt = c.querySelector('select[name="layer-type"]');
        const layerType = lt.options[lt.selectedIndex].value;

        const ln = c.querySelector('.layer-name input').value;
        const serviceUrl = c.querySelector('.service-url input').value;
        const urlLocalUrl = c.querySelector('.url-local-file input').value;
        const bounds = self.#getBounds();

        switch (layerType) {
            //Gather inputs for a tile layer.
            case 'TileLayer':
                try {
                    //Try and load service URL as TileJSON.
                    var tilejson = await self.#getTileJson(serviceUrl);

                    //Service URL must be a formatted tile service URL.
                    if (tilejson === null) {
                        var subdomains;
                        const sd = c.querySelector('.tile-subdomains input').value;

                        if (sd && sd !== '') {
                            subdomains = sd.split(/[\s,]+/);
                        }

                        //URL is a formated tile URL. Grab bounds and tile size settings.
                        layers[ln] = {
                            type: 'TileLayer',
                            tileUrl: serviceUrl,
                            bounds: bounds,
                            tileSize: (c.querySelector('input[name="tile-size-radio"]').checked) ? 256 : 512,
                            subdomains: subdomains,
                            enabled: true
                        };
                    } else {
                        //If no layer name provided by user, set the layer name to the name in the TileJSON file. 
                        if (ln === '' && tilejson.name && tilejson.name !== '') {
                            ln = tilejson.name;
                        }

                        //URL is for tile json, let that define the settings.
                        layers[ln] = {
                            type: 'TileLayer',
                            tileUrl: serviceUrl,
                            enabled: true
                        };
                    }
                } catch (e) {
                    confirm('Unable to access tile service.');
                    return;
                }
                break;
            //Gather inputs for an image layer using 4 corner coordinates.
            case 'ImageLayer':
                layers[ln] = {
                    type: 'ImageLayer',
                    url: urlLocalUrl,
                    coordinates: self.#getCornerCoordinates(),
                    enabled: true
                };
                break;
            //Gather inputs for an image layer using bounding box and a rotation.
            case 'ImageLayerBounds':
                layers[ln] = {
                    type: 'ImageLayer',
                    url: urlLocalUrl,

                    //Calculate the corner coordinates using the bounding box and rotation.
                    coordinates: atlas.layer.ImageLayer.getCoordinatesFromEdges(
                        bounds[3], bounds[1], bounds[2], bounds[0],

                        parseFloat(c.querySelector('input[name="rotationValue"]').value)
                    ),
                    enabled: true
                };
                break;
            //Gather inputs for an OGC map layer for a WMS or WMTS service.
            case 'OgcMapLayer':
                const activeLayerSelector = this.#container.querySelector('select[name="active-ogc-layer-selector"]');

                let activeLayers = null;
                if (activeLayerSelector.options && activeLayerSelector.options.length > 0) {
                    activeLayers = activeLayerSelector.options[activeLayerSelector.selectedIndex].value;
                }

                layers[ln] = {
                    type: 'OgcMapLayer',
                    url: serviceUrl,
                    activeLayers: [activeLayers],
                    enabled: true
                };
                break;
            //Gather inputs for a KML ground overlay.
            case 'KmlGroundOverlay':
                layers[ln] = await self.#testKmlGroundOverlay(urlLocalUrl);
                break;
            //Gather inputs for a list of TileJSON URLs for bulk importing of tile layers. One URL per line.
            case 'BulkTileJSON':
                const data = c.querySelector('.tilejson-urls textarea').value;
                const lines = data.split('\n');
                const issues = [];

                //Loop through each line of text and attempt to process it as a TileJSON URL. 
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[0].trim();
                    if (line !== '') {
                        //Each line can have two space delimited values. Value 1 = URL, value 2 = Name.
                        const parts = line.split(' ');

                        const tilejson = await self.#getTileJson(parts[0]);

                        if (tilejson !== null) {
                            //Default to using the URL as the name. Worst case.
                            var name = parts[0];

                            //Check to see if the user specified a name for the layer.
                            if (parts.length >= 1 && parts[1] !== '') {
                                //Assume first index of array is URL, all other values in array make up the name with support for spaces. Remove any double quote characters.
                                name = parts.slice(0).join(' ').replace(/"/g, '');
                            } else if (tilejson.name) {
                                //If there is a name in the TileJSON file, fallback to that.
                                name = tilejson.name;
                            }

                            layers[name] = {
                                type: 'TileLayer',
                                tileUrl: parts[0]
                            };
                        } else {
                            issues.push(line);
                        }
                    }
                }

                if (Object.keys(layers).length === 0) {
                    confirm(`No valid TileJson URLs provided. ${(issues.length !== 0) ? issues.join('\n') : ''}`);
                    return;
                }

                if (issues.length !== 0) {
                    console.log('Unale to load the following lines as TileJSON URLs.\n' + issues.join('\n'));
                }

                break;
        }

        //If no layer name value specified, and not bulk importing TileJSON, alert user as name is required.
        if (ln === '' && layerType !== 'BulkTileJSON') {
            confirm('No layer name specified.');
            return;
        }

        //Close the dialog panel.
        self.close(layers);
    }

    /**
     * Sets the input layer type and updates the displayed layer input panel.
     * @param {*} name The name of the type of layer to set.
     */
    #setLayerType(name) {
        const self = this;

        //Set the selected value.
        self.#layerTypeSelector.value = name;

        const lt = self.#layerTypes[name];
        const c = self.#container;

        const rows = c.querySelectorAll('.dialog-content tr');

        //Reset layer defaults.
        rows.forEach(r => {
            if (r.className) {
                if (lt.inputs.indexOf(r.className) > -1) {
                    var inputs = r.querySelectorAll('input');
                    inputs.forEach(i => {
                        if (i.name && lt.defaults && typeof lt.defaults[i.name] !== undefined) {
                            i.value = lt.defaults[i.name];
                        } else if (i.type === 'text') {
                            i.value = '';
                        } else if (i.type === 'number') {
                            i.value = 100;
                        }
                    });

                    r.style.display = '';
                } else {
                    r.style.display = 'none';
                }
            }
        });

        c.querySelector('select[name="active-ogc-layer-selector"]').innerHTML = '';
        c.querySelector('.tilejson-urls textarea').value = '';

        //If on the KML or image layer panel, set the file accept option for the open file dialog.
        if (name === 'KmlGroundOverlay' || name.indexOf('ImageLayer') === 0) {
            const fileInput = c.querySelector('.url-local-file input[type="file"]');
            fileInput.setAttribute('accept', lt.defaults.accepts);
        }
    }

    /**
     * Takes a Tile layer URL and tries to see if it is a formatted URL, or a TileJSON URL. If it is a TileJSON url, it will try loading it.
     * @param {*} url URL for a tile layer.
     * @returns TileJSON tile layer options, or null.
     */
    async #getTileJson(url) {
        //Check to see if this is a TileJSON or formatted URL. 
        if (url.indexOf('{x}') !== -1 || url.indexOf('{quadkey}') !== -1 || url.indexOf('{bbox-epsg-3857}') !== -1) {
            //Formatted tile URL. Not a TileJSON URL.

            return null;
        }

        //Try and get Tile json.
        var r = await Utils.makeSignedRequest(this.#map, url, mapSettings.proxyService);
        if (r.tilejson) {
            return r;
        }
    }

    /**
     * Tests a connection to an OGC service. CORs issues most likely to be the most common blocker.
     * @param {*} url The URL to an OGC service. 
     */
    #testOgcServiceUrl(url) {
        const self = this;

        const activeLayerSelector = self.#container.querySelector('select[name="active-ogc-layer-selector"]');
        activeLayerSelector.innerHTML = '';

        //Create the OGC layer instance that will connect to the service. 
        const layer = new atlas.layer.OgcMapLayer({
            url: url,

            //If a proxy service is specified in the app settings, it will help address any CORs related issues.
            proxyService: mapSettings.proxyService
        });

        try {
            layer.onActiveLayersChanged = () => {
                //Get the capabilities if the active layers change.
                layer.getCapabilities().then(async cap => {
                    //If capabilities are null. Something went wrong.
                    if (!cap) {
                        confirm('Unable to load service capabilities.');
                        return;
                    }

                    //Check to see if there are any sublayers available in the service. 
                    if (cap.sublayers.length === 0) {
                        confirm('WMS / WMTS service has no layers.');
                        return;
                    }

                    //Create a list of sublayers to choose from. We will only allow a single sublayer to be selected in this app.
                    var html = [];

                    for (var i = 0; i < cap.sublayers.length; i++) {
                        html.push('<option value="', cap.sublayers[i].id, '"');

                        if (i === 0) {
                            html.push(' selected="selected"');
                        }
                        html.push('>', cap.sublayers[i].title, '</option>');
                    }

                    activeLayerSelector.innerHTML = html.join('');

                    //If no layer name has been specified by the user yet, use the services title value as the name.
                    if (cap.title && cap.title !== '') {
                        const ln = self.#container.querySelector('.layer-name input');

                        if (ln.value === '') {
                            ln.value = cap.title;
                        }
                    }

                    return cap;
                });
            };

            //Temporarily add the layer to the map so that its capabilities get loaded.
            self.#map.layers.add(layer);
        } catch (e) {
            confirm('Unable to access WMS / WMTS service.');
        }

        //Remove the layer from the map.
        self.#map.layers.remove(layer);
    }

    /**
     * Attempts to extract a KML ground overlay from a KML or KMZ file that is either hosted via a URL or embedded in a local file. 
     * @param {*} urlLocalUrl A URL to a KML/KMZ file or a blob of a local file. 
     * @returns Image layer options needed to render the KML ground overlay, or null. 
     */
    async #testKmlGroundOverlay(urlLocalUrl) {
        const kml = await atlas.io.read(urlLocalUrl, {
            parseStyles: false,
            ignoreVisibility: true,
            maxNetworkLinks: 2,
            maxNetworkLinkDepth: 1,
            proxyService: mapSettings.proxyService
        });

        if (kml.groundOverlays && kml.groundOverlays.length > 0) {
            const go = kml.groundOverlays[0];

            const ln = this.#container.querySelector('.layer-name input');
            if (go.properties && go.properties.title && ln.value === '') {
                ln.value = go.properties.title;
            }

            const opt = go.getOptions();

            if (go instanceof atlas.layer.OgcMapLayer) {
                opt.type = 'OgcMapLayer';
            } else if (go instanceof atlas.layer.ImageLayer) {
                opt.type = 'ImageLayer';
            }

            opt.enabled = true;

            return opt;
        } else {
            confirm('No ground overlay found in KML / KMZ');
        }

        return null;
    }

    /**
     * Retrieves the bounding box coordinates from the input controls. 
     * @returns A GeoJSON bounding box object [west, south, east, north]
     */
    #getBounds() {
        const boundsText = this.#container.querySelector('.bounds input').value;
        const bounds = [-180, -85.5, 180, 85.5];

        const parts = boundsText.split(',');
        if(parts.length >= 4){
            parts.forEach((x, i)=> {
                const num = parseFloat(x.trim())
                if(!isNaN(num) && i <= 4) {
                    //Even index values are longitudes.
                    if(i%2 === 0){                        
                        bounds[i] = atlas.math.normalizeLongitude(num);
                    } else {
                        bounds[i] = atlas.math.normalizeLatitude(num);
                    }
                }
            });
        }
        return bounds;
    }

    /**
     * Retrieves the four coordinates for the corners of an image overlay; top left, top right, bottom right, bottom left.
     * @returns An array of four corner coordinates of an image overlay.
     */
    #getCornerCoordinates() {
        const inputs = this.#container.querySelectorAll('.corners input');
        const extents = [
            [-180, 85.5],   //topLeft
            [180, 85.5],    //topRight
            [180, -85.5],   //bottomRight
            [-180, -85.5]   //bottomLeft
        ];

        const nameIdx = ['topLeft','topRight', 'bottomRight','bottomLeft'];

        inputs.forEach(x => {
            const pair = x.value.split(',');
            if(pair.length >= 2){
                const lon = parseFloat(pair[0].trim());
                const lat = parseFloat(pair[1].trim());
                const idx = nameIdx[x.name];

                if(idx > -1 && !isNaN(lon) && !isNaN(lat) && typeof extents[x.name] !== 'undefined'){
                    extents[idx] = [
                        atlas.math.normalizeLongitude(lon), 
                        atlas.math.normalizeLatitude(lat)
                    ];
                }
            }
        });

        return extents;
    }
}

/**
 * A simple dialog that displays custom content.
 */
export class ContentDialog {
    #container;

    /**
     * A simple dialog that displays custom content.
     * @param {*} title Title of the dialog.
     * @param {*} content HTML content for the dialog.
     * @param {*} contentCss Optional CSS class name to add to content container.
     */
    constructor(title, content, contentCss) {
        //Create the container. 
        const c = document.createElement('div');
        c.className = 'dialog-container';
        c.style.display = 'none';

        //Set the title of the dialog.
        c.innerHTML = dialogTemplate.replace('{{title}}', title);

        //Wire up the close button to cancel the creation of a layer.
        c.querySelector('.dialog-title button').onclick = () => {
            this.close();
        };

        document.body.appendChild(c);
        this.#container = c;

        //Add content.
        const contentElm = c.querySelector('.dialog-content');

        if (contentCss) {
            contentElm.classList.add(contentCss);
        }

        contentElm.innerHTML = content;
    }

    /**
     * Show the dialog.
     */
    show() {
        //Display dialog.
        this.#container.style.display = '';

        //Set focus on the close button.
        this.#container.querySelector('.dialog-title button').focus();
    }

    /**
     * Hide the dialog.
     */
    close() {
        //Hide dialog.
        this.#container.style.display = 'none';
    }
}

/** A dialog window for saving results as a file. */
export class SaveResultsDialog {
    #container;
    #fileFormatSelector;
    #datasource;
    #nameLabel;
    #primaryPropName;
    #secondaryPropName;

    /**
     * A dialog window for saving results as a file.
     * @param {*} title Title of the dialog.
     * @param {*} content HTML content for the dialog.
     */
    constructor(title) {
        const self = this;

        //Create the container. 
        const c = document.createElement('div');
        c.className = 'dialog-container';
        c.style.display = 'none';

        //Set the title of the dialog.
        c.innerHTML = dialogTemplate.replace('{{title}}', title);

        //Wire up the close button to cancel the creation of a layer.
        c.querySelector('.dialog-title button').onclick = () => {
            this.close();
        };

        document.body.appendChild(c);
        this.#container = c;

        //Add content.
        const contentElm = c.querySelector('.dialog-content');
        contentElm.classList.add('save-results-dialog');

        const nameLabel = document.createElement('label');
        nameLabel.innerHTML = 'File name: <input type="text"/>';
        contentElm.appendChild(nameLabel);
        self.#nameLabel = nameLabel;

        const fileFormatLabel = document.createElement('label');
        fileFormatLabel.innerHTML = 'File format: ';
        contentElm.appendChild(fileFormatLabel);

        const fileFormat = document.createElement('select');
        fileFormat.innerHTML = `
            <option>CSV</option>
            <option selected="selected">GeoJSON</option>
            <option>GeoJSONL</option>
            <option>GeoRSS</option>
            <option>GML</option>
            <option>GPX</option>
            <option>KML</option>
            <option>KMZ</option>							
            <option>Pipe delimited</option>
            <option>Tab delimited</option>`;

        fileFormatLabel.appendChild(fileFormat);

        self.#fileFormatSelector = fileFormat;

        const minPropsLabel = document.createElement('label');
        minPropsLabel.innerHTML = '<input type="checkbox" checked="checked"/> Minimize exported properties';
        contentElm.appendChild(minPropsLabel);

        const saveBtn = document.createElement('button');
        saveBtn.className = 'text-btn-round';
        saveBtn.setAttribute('type', 'button');
        saveBtn.innerHTML = 'Save';
        contentElm.appendChild(saveBtn);

        saveBtn.onclick = async () => {
            let fileName = self.#nameLabel.querySelector('input').value;

            if (fileName.trim === '') {
                alert('Invalid file name');
                return;
            }

            const ff = Utils.getSelectValue(fileFormat);
            const mp = minPropsLabel.querySelector('input').checked;

            const allowedProps = ['source', 'task_name'];
            allowedProps.push(self.#primaryPropName);

            if(self.#secondaryPropName){
                allowedProps.push(self.#secondaryPropName);
            }

            const data = self.#datasource.toJson();

            for (let i = 0; i < data.features.length; i++) {
                const f = data.features[i];
                if (mp) {
                    //Remove all but the property names
                    Object.keys(f.properties).forEach(key => {
                        if (allowedProps.indexOf(key) === -1) {
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

                delete f.id;
            }

            let outputBlob = null;
            let fileExt = ff.toLowerCase();

            switch (ff) {
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
                    const outputPipeString = await atlas.io.write(data, { format: ff, delimiter: '|' });
                    outputBlob = new Blob([outputPipeString], { type: "text/plain" });
                    fileExt = 'txt';
                    break;
                case 'Tab delimited':
                    const outputTabString = await atlas.io.write(data, { format: ff, delimiter: '\t' });
                    outputBlob = new Blob([outputTabString], { type: "text/plain" });
                    fileExt = 'txt';
                    break;
                default: //KML, GML, GPX, GeoRSS, CSV
                    const outputString = await atlas.io.write(data, { format: ff });
                    outputBlob = new Blob([outputString], { type: "text/plain" });
                    break;
            }

            if (!fileName.endsWith('.' + fileExt)) {
                fileName = `${fileName}.${fileExt}`;
            }

            if (outputBlob !== null) {
                Utils.saveFile(fileName, outputBlob);
            }

            self.close();
        };
    }

    /**
     * Show the dialog.
     */
    show(fileName, datasource, primaryPropName, secondaryPropName) {
        const self = this;
        self.#datasource = datasource;
        self.#primaryPropName = primaryPropName;
        self.#secondaryPropName = secondaryPropName;

        self.#nameLabel.querySelector('input').value = fileName.replace(/\s/g, '_');

        //Display dialog.
        self.#container.style.display = '';

        //Set focus on the close button.
        self.#container.querySelector('.dialog-title button').focus();
    }

    /**
     * Hide the dialog.
     */
    close() {
        //Hide dialog.
        this.#container.style.display = 'none';
    }
}