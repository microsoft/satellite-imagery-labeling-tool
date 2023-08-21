export class Utils {
    ///////////////////////////////////////
    // Constants
    //////////////////////////////////////

    /** Display/layer name for the Azure Maps Setellite imagery layer. */
    static AZURE_MAPS_SATELLITE = 'Azure Maps Satellite';

    /**
     * A list of all layers in Azure Maps basemaps that contain the boarders we want to support displaying.
     */
    static #BorderLayers = [
        'microsoft.maps.base.transit.Country border outline',
        'microsoft.maps.base.transit.Country border',
        'microsoft.maps.base.transit.Treaty country border',
        'microsoft.maps.base.transit.Disputed country border',
        'microsoft.maps.base.transit.State border',
        'microsoft.bing.maps.roads.admin_division1_boundary_xlarge_sovereign_line-merged2',
        'microsoft.bing.maps.roads.admin_division1_boundary_russia_line',
        'microsoft.bing.maps.roads.admin_division1_boundary_uk_line-merged2',
        'microsoft.bing.maps.roads.admin_division1_boundary_europe_line',
        'microsoft.bing.maps.roads.sovereign_boundary_disputed_line',
        'microsoft.bing.maps.roads.admin_division1_boundary_disputed_line',
        'microsoft.bing.maps.roads.admin_division1_boundary_normal_line',
        'microsoft.bing.maps.roads.entity_override_sovereign_boundary_hong_kong_sar_line',
        'microsoft.bing.maps.roads.entity_override_sovereign_boundary_china_line',
        'microsoft.bing.maps.roads.admin_division1_line',
        'microsoft.bing.maps.roads.entity_override_sovereign_boundary_hong_kong_sar_line_1',
        'microsoft.bing.maps.roads.entity_override_sovereign_boundary_china_line_1',
        'microsoft.bing.maps.roads.admin_division1_line_1',
        'microsoft.bing.maps.roads.sovereign_boundary_normal_line',
        'microsoft.bing.maps.roads.country_region_line',
        'microsoft.bing.maps.roads.sovereign_boundary_normal_line_1',
        'microsoft.bing.maps.roads.country_region_line_1',
        'microsoft.bing.maps.roads.admin_division2_line',
        'microsoft.bing.maps.roads.equator_line'
    ];

    /**
     * A list of all POI layers in the Azure Maps basemaps to support displaying.
     */
    static #POILayers = [
        'microsoft.maps.base.labels_places.Airport label',
        'microsoft.maps.base.labels_places.Stadium label',
        'microsoft.maps.base.labels_places.Industrial area label',
        'microsoft.maps.base.labels_places.University/School label',
        'microsoft.maps.base.labels_places.Zoo label',
        //'microsoft.maps.base.labels_places.River label',
        'microsoft.maps.base.labels_places.Other label',
        'microsoft.maps.base.labels_places.Airport POI',
        'microsoft.maps.base.labels_places.POI',
        'microsoft.maps.base.labels_places.Amusement area label',
        'microsoft.maps.base.labels_places.Military Territory label',
        //'microsoft.maps.base.labels_places.Other water body label',
        //'microsoft.maps.base.labels_places.Intermittent water label',
        //'microsoft.maps.base.labels_places.Reservation label',
        //'microsoft.maps.base.labels_places.Ocean label',
        'microsoft.maps.base.labels_places.Museum label',
        'microsoft.maps.base.labels_places.Railway station',
        'microsoft.maps.base.labels_places.Point of Interest',
        'microsoft.maps.base.labels_places.Cemetery label',
        'microsoft.maps.base.labels_places.Golf Course label',
        //'microsoft.maps.base.labels_places.Woodland label',
        //'microsoft.maps.base.labels_places.Island label',
        'microsoft.maps.base.labels_places.Shopping centre label',
        //'microsoft.maps.base.labels_places.Sea label',
        //'microsoft.maps.base.labels_places.National park name',
        'microsoft.maps.base.labels_places.Park/Garden label',
        'microsoft.maps.base.labels_places.Hospital label',
        'microsoft.maps.base.labels_places.Prison label',
        //'microsoft.maps.base.labels_places.Lake label',
        'microsoft.maps.base.labels_places.Landmark label',
        //'microsoft.maps.base.labels_places.National park label',
        'microsoft.maps.base.labels_places.Ferry terminal',
        'microsoft.bing.maps.labels.generic_structure_footprint_label_hd',
        'microsoft.bing.maps.labels.generic_structure_footprint_label',
        'microsoft.bing.maps.labels.airport_runway_line_line_label',
        'microsoft.bing.maps.labels.trail_line_label',
        'microsoft.bing.maps.labels.promontory_fill_label',
        'microsoft.bing.maps.labels.waterfall_symbol',
        'microsoft.bing.maps.labels.geyser_symbol',
        'microsoft.bing.maps.labels.hot_spring_symbol',
        'microsoft.bing.maps.labels.spring_symbol',
        'microsoft.bing.maps.labels.delta_symbol_label',
        'microsoft.bing.maps.labels.wetland_fill_label',
        'microsoft.bing.maps.labels.wetland_symbol_label',
        'microsoft.bing.maps.labels.ruin_symbol_label',
        'microsoft.bing.maps.labels.rest_area_symbol_label',
        'microsoft.bing.maps.labels.ferry_terminal_gtfs_symbol',
        'microsoft.bing.maps.labels.ferry_terminal_point_symbol',
        'microsoft.bing.maps.labels.observation_point_symbol',
        'microsoft.bing.maps.labels.mine_symbol_label',
        'microsoft.bing.maps.labels.prison_symbol_label',
        'microsoft.bing.maps.labels.bridge_chn_symbol_label',
        'microsoft.bing.maps.labels.shipwreck_symbol',
        'microsoft.bing.maps.labels.fort_symbol',
        'microsoft.bing.maps.labels.battlefield_symbol',
        'microsoft.bing.maps.labels.autorail_line_label-merged3',
        'microsoft.bing.maps.labels.ferry_route_line_label-merged2',
        'microsoft.bing.maps.labels.beach_fill_label-merged2',
        'microsoft.bing.maps.labels.beach_symbol_label',
        'microsoft.bing.maps.labels.monument_symbol',
        'microsoft.bing.maps.labels.landmark_building_fill_label',
        'microsoft.bing.maps.labels.amusement_park_fill_label',
        'microsoft.bing.maps.labels.stadium_fill_label',
        'microsoft.bing.maps.labels.race_track_symbol_label',
        'microsoft.bing.maps.labels.playing_field_symbol_label-merged10',
        'microsoft.bing.maps.labels.playing_field_tennis_symbol',
        'microsoft.bing.maps.labels.golf_course_fill_label',
        'microsoft.bing.maps.labels.hospital_fill_label',
        'microsoft.bing.maps.labels.military_base_polygon_fill_label',
        'microsoft.bing.maps.labels.administrative_building_fill_label',
        'microsoft.bing.maps.labels.school_fill_label',
        'microsoft.bing.maps.labels.higher_education_facility_fill_label',
        'microsoft.bing.maps.labels.cemetery_fill_label',
        'microsoft.bing.maps.labels.shopping_center_fill_label',
        'microsoft.bing.maps.labels.ferry_terminal_polygon_fill_label',
        'microsoft.bing.maps.labels.bus_station_fill_label',
        'microsoft.bing.maps.labels.bus_station_symbol',
        'microsoft.bing.maps.labels.airport_fill_label-merged6',
        'microsoft.bing.maps.labels.zoo_fill_label',
        'microsoft.bing.maps.labels.information_center_symbol_label',
        'microsoft.bing.maps.labels.garden_sa_symbol',
        'microsoft.bing.maps.labels.tourist_structure_point_sa_symbol',
        'microsoft.bing.maps.labels.historical_site_symbol',
        'microsoft.bing.maps.labels.fish_hatchery_fill_label',
        'microsoft.bing.maps.labels.park_fill_label-merged2',
        'microsoft.bing.maps.labels.park_city_fill_label',
        'microsoft.bing.maps.labels.parking_lot_fill_label',
        'microsoft.bing.maps.labels.parking_lot_symbol',
        'microsoft.bing.maps.labels.parking_structure_fill_label-merged2',
        'microsoft.bing.maps.labels.parking_structure_sa_symbol',
        'microsoft.bing.maps.labels.camp_sa_symbol',
        'microsoft.bing.maps.labels.generic_business_landmark_retired',
        'microsoft.bing.maps.labels.generic_business_landmark',
        'microsoft.bing.maps.labels.generic_transit_landmark',
        'microsoft.bing.maps.labels.metro_station_symbol-merged3',
        'microsoft.bing.maps.labels.railway_station_point_symbol',
        'microsoft.bing.maps.labels.subway_wuxi_symbol-merged22',
        'microsoft.bing.maps.labels.bus_station_point_symbol',
        'microsoft.bing.maps.labels.premium_landmark',
        'microsoft.bing.maps.labels.playground_symbol',
        'microsoft.bing.maps.labels.airport_terminal_symbol_label',
        'microsoft.bing.maps.labels.wall_symbol',
        'microsoft.bing.maps.labels.swimming_pool_sa_symbol',
        'microsoft.bing.maps.labels.recreational_structure_fill_label',
        'microsoft.bing.maps.labels.nautical_structure_fill_label',
        'microsoft.bing.maps.labels.industrial_structure_fill_label',
        'microsoft.bing.maps.labels.educational_structure_fill_label',
        'microsoft.bing.maps.labels.business_center_fill_label',
        'microsoft.bing.maps.labels.outdoor_gym_symbol_label',
        'microsoft.bing.maps.labels.airport_major_fill_label',
        'microsoft.bing.maps.labels.subway_under_construction_chn_line_label',
        'microsoft.bing.maps.labels.subway_chn_line_label',
        'microsoft.bing.maps.labels.exit_symbol'
    ];

    static _baseTranistLayer = null;

    ///////////////////////////////////////
    // General helper methods.
    //////////////////////////////////////

    /**
     * Filters an array of GeoJSON features based on a set of parameters.
     * @param {*} features The array of GeoJSON features to filter.
     * @param {*} drawType Theallowed drawing type.
     * @param {*} geometry Optional. A geometry to limit the features to (intersection test).
     * @param {*} newProps Optional. A set of new properties to assign to the feature.
     * @param {*} maxFeatures Optional. Max number of features to return.
     * @returns 
     */
    static filterFeatures(features, drawType, geometry, newProps, maxFeatures) {
        let count = 0;
        return features.filter(f => {
            let r = false;

            if (!maxFeatures || count < maxFeatures) {
                const isLine = (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString');
                const isPoly = (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon');

                if ((drawType === 'all' && (isLine || isPoly)) ||
                    (drawType === 'lines' && isLine) ||
                    (drawType === 'polygons' && isPoly) ||
                    (drawType === 'rectangles' && isPoly && f.properties.subType === 'Rectangle')
                ) {
                    if (newProps) {
                        Object.assign(f.properties, newProps);
                    }

                    if (geometry && geometry.type) {
                        r = turf.booleanIntersects(f.geometry, geometry);
                    } else {
                        r = true;
                    }

                    if (r) {
                        count++;
                    }
                }
            }

            return r;
        });
    }

    /**
     * Rounds the coordinates of a GeoJSON geometry to six decimal places.
     * @param {*} geom The GeoJSON geometry to modify the coordinates of.
     */
    static roundGeomCoordinates(geom) {
        switch (geom.type) {
            // case 'Point':
            // Utils.roundCoordinates([geom.coordinates])[0];
            //  break;
            case 'LineString':
            case 'MultiPoint':
                Utils.roundCoordinates(geom.coordinates);
                break;
            case 'Polygon':
            case 'MultiLineString':
                geom.coordinates.forEach(ring => {
                    Utils.roundCoordinates(ring);
                });
                break;
            case 'MultiPolygon':
                geom.coordinates.forEach(poly => {
                    poly.forEach(ring => {
                        Utils.roundCoordinates(ring);
                    })
                });
                break;
        }
    }

    /**
     * Rounds the coordinates of an array of coordinates to six decimal places.
     */
    static roundCoordinates(coords) {
        for (let i = 0; i < coords.length; i++) {
            coords[i][0] = Utils.roundToSixDecimals(coords[i][0]);
            coords[i][1] = Utils.roundToSixDecimals(coords[i][1]);
        }
    }

    /**
     * Rounds a number to six decimal places.
     * @param {*} num Number to round.
     * @returns The rounded number.
     */
    static roundToSixDecimals(num) {
        return Math.round(num * 1000000) / 1000000;
    }

    /**
     * Helper method for loading CSS file on demand.
     * @param {*} cssFilePath URL path to a CSS file.
     */
    static requireCSS(cssFilePath) {
        const css = document.createElement('link');
        css.setAttribute('rel', 'stylesheet');
        css.setAttribute('href', cssFilePath);
        document.body.appendChild(css);
    }

    /**
     * Helper method for saving a file locally. 
     * @param {*} fileName The name of the file to create.
     * @param {*} blobContent The blob content of the file. 
     */
    static saveFile(fileName, blobContent) {
        //Create a download link, with the URL containing the blob content, then trigger the click event on the link.
        const a = document.createElement("a");
        a.href = window.URL.createObjectURL(blobContent);
        a.download = fileName;
        a.click();
    }

    ///////////////////////////////////////
    // Azure Maps Utilities
    //////////////////////////////////////

    /**
     * Creates an Azure Maps control instance.
     * @param {*} divId The ID of the element to create the map in.
     * @param {*} authOptions Optional. The authentication options for Azure Maps.
     * @returns An Azure Maps control instance.
     */
    static createMap(divId, authOptions) {
        //Checks is auth options are valid.
        const hasAZMapAuth = Utils.isAzureMapsAuthValid(authOptions);

        //Create the map instance.
        const map = new atlas.Map(divId, {
            //If valid auth provided, make the base layer be Azure Maps satellite imagery with vector labels. Otherwise default to a blank background.
            style: (hasAZMapAuth) ? 'satellite_road_labels' : 'blank',

            //Hide the feedback link of the map and disable rotation and pitching of the map.
            showFeedbackLink: false,
            dragRotateInteraction: false,

            //If auth is invalid, disable accessibility features that rely on the Azure Maps reverse geocoder (screen reader).
            enableAccessibility: hasAZMapAuth,

            //This option must be set to true in order to generate an image from the map canvas for the screen shot feature.
            preserveDrawingBuffer: true,

            //Let the regional view of the map be auto detected by Azure Maps servers. This addresses regional geopolitical issues in maps such as disputed boarders and place names.
            view: 'Auto',

            //Add authentication details for connecting to Azure Maps. If not valid, add default values to trick system into loading a map without Azure Maps content.
            authOptions: (hasAZMapAuth && authOptions) ? authOptions : {
                authType: 'subscriptionKey',
                subscriptionKey: '[YOUR_AZURE_MAPS_KEY]'
            }
        });

        //Wait until the map resources are ready.
        map.events.add('ready', () => {
            //Remove fade duration for faster transitions between layers.
            map.map._fadeDuration = 0;

            //Hide unneeded layers in the base map.
            Utils.hideNonEssentialLayers(map);
        });

        return map;
    }

    /**
     * Checks to see if Azure Maps auth options are valid "enough".
     * @param {*} authOptions Options to validate.
     * @returns True or False.
     */
    static isAzureMapsAuthValid(authOptions) {
        if (authOptions && authOptions.authType) {
            if (authOptions.authType === 'subscriptionKey') {
                //Assume if the subscription key is longer thant 40 characters, that it is valid.
                return authOptions.subscriptionKey && authOptions.subscriptionKey.length > 40;
            } else if (authOptions.authType === 'anonymous') {
                //Assume valid if clientId is longer than 30 characters.
                return authOptions.clientId && authOptions.clientId.length > 30;
            }
        }

        return false;
    }

    /**
     * Makes a GET request for a URL, and signs the request with the maps authOptions. 
     * @param {*} map An Azure Maps control instance.
     * @param {*} url The URL to make a request to.
     * @param {*} proxy Optional. A URL to a proxy service.
     * @returns A Promise that responds with JSON content. We should simply be able to append the encoded request URL to the proxy URL.
     */
    static makeSignedRequest(map, url, proxy) {
        //This is a reusable function that sets the Azure Maps platform domain, sings the request, and makes use of any transformRequest set on the map.
        return new Promise((resolve, reject) => {
            //Replace the domain placeholder to ensure the same Azure Maps cloud is used throughout the app.
            let requestParams = {
                url: url.replace('{azMapsDomain}', atlas.getDomain())
            };

            //Get the authentication details from the map for use in the request.
            if (url.indexOf('{azMapsDomain}') > -1) {
                requestParams = map.authentication.signRequest(requestParams);
            }

            //Transform the request.
            const transform = map.getServiceOptions().tranformRequest;
            if (transform) {
                requestParams = transform(url);
            }

            if (proxy && proxy !== '' && requestParams.url.indexOf(proxy) === -1) {
                requestParams.url = proxy + encodeURIComponent(requestParams.url);
            }

            //Make a CORs fetch request to the URL.
            fetch(requestParams.url, {
                method: 'GET',
                mode: 'cors',
                headers: new Headers(requestParams.headers)
            })
                .then(result => {
                    //Here body is not ready yet, throw promise
                    if (result.ok) {
                        return result.json();
                    }

                    throw result;
                })
                .then(result => {
                    //Successful request processing
                    resolve(result);
                }).catch(error => {
                    //Here is still promise
                    reject(error);
                })
        });
    }

    /**
     * Inflates a layer from a config file and adds it to the map. 
     * @param {*} map Azure Maps control instance to add the layer to.
     * @param {*} name The name/ID of the layer.
     * @param {*} options The options for the layer. Must include a "type" property indicating the type of layer to create.
     * @returns The created layer instance or null. 
     */
    static inflateLayer(map, name, options) {
        var layer = null;

        if (map && name && options && options.type) {
            //Ensure layer doesn't already exist in the map.
            layer = map.layers.getLayerById(name);

            if(_baseTranistLayer === null) {
                app.map.layers.layerIndex.forEach((l) => {
                    if(_baseTranistLayer === null && (l.id === 'transit' || l.id === 'roads' || l.id.startsWith('microsoft.bing.maps.roadDetails.road'))) {
                        _baseTranistLayer = l.id ;
                    } 
                });
            }

            if (!layer) {
                switch (options.type) {
                    case 'TileLayer':
                        layer = new atlas.layer.TileLayer(options, name);
                        break;
                    case 'ImageLayer':
                        layer = new atlas.layer.ImageLayer(options, name);
                        break;
                    case 'OgcMapLayer':
                        layer = new atlas.layer.OgcMapLayer(options);

                        //OgcMapLayer doesn't take in an ID, override the auto generated ID.
                        layer.id = name;
                        break;
                }

                if (layer) {
                    layer.setOptions({
                        //Ensure fade duration is 0 for faster loading and transitions.
                        fadeDuration: 0,

                        //Hide the layer by default.
                        visible: false
                    });

                    //Add the layer below the transit layer so that road labels and shields appear above the layer when displayed.
                    map.layers.add(layer, _baseTranistLayer);
                }
            } else if (layer.setOptions && layer.constructor.name === options.type) {
                //If the layer already exists, has a setOptions function, and the class name and options type properties are the same, try updating the layers options.
                layer.setOptions(options);
            }

            layer.properties = options;
        }

        return layer;
    }

    /**
    * Sets the visibility of Admin border layers in the map.
    * @param {atlas.Map} map Map instance
    * @param {string} isVisible Indicates if it should be visible or not.
    */
    static setMapBorderVisibility(map, isVisible) {
        const visibility = isVisible ? 'visible' : 'none';

        //Get all the layers within the basemap style.
        const layers = map.map.getStyle().layers;

        //Loop through all layers within the basemap. 
        for (let i = 0; i < layers.length; i++) {
            let l = layers[i];

            //If the layer for lines, and has an ID in the list of border layer ID's, set the visibility of the layer.
            if (l.id && l.type === 'line' && Utils.#BorderLayers.indexOf(l.id) > -1) {
                map.map.setLayoutProperty(l.id, 'visibility', visibility);
            }
        }
    }

    /**
     * Hides non-essential layers in the basemap.
     * @param {*} map An Azure Maps control instance.
     */
    static hideNonEssentialLayers(map) {
        Utils.#setBaseLayerVisibility(map, false, (l) => {
            //If the layer ID starts with 'microsft.maps', and is a fill (polygon), a line layer other than a boarder layer, or a symbol layer containing POI content, hide the layer.
            return (l.id && l.id.toLowerCase().indexOf('microsoft.maps.') === 0 && (
                l.type === 'fill' ||
                (l.type === 'line' && Utils.#BorderLayers.indexOf(l.id) === -1) ||
                (l.type === 'symbol' && Utils.#POILayers.indexOf(l.id) > -1)));
        });
    }

    /**
     * Sets the visibility of POI layers in the map.
     * @param {atlas.Map} map Azure Map control instance
     * @param {string} isVisible Indicates if it should be visible or not.
     */
    static setPoiLayerVisibility(map, isVisible) {
        Utils.#setBaseLayerVisibility(map, isVisible, (l) => {
            //If the layer is a symbol layer with an ID that matches with a POI layer we support displaying, set the visibility.
            return (l.type === 'symbol' && Utils.#POILayers.indexOf(l.id) > -1);
        });
    }

    /**
     * Sets the visibility of map label layers in the map.
     * @param {atlas.Map} map Map instance
     * @param {string} isVisible Indicates if it should be visible or not.
     */
    static setMapLabelVisibility(map, isVisible) {
        Utils.#setBaseLayerVisibility(map, isVisible, (l) => {
            //If the laywer is a symbol layer, and not a POI layer.
            return (l.type === 'symbol' && Utils.#POILayers.indexOf(l.id) === -1);
        });
    }

    /**
     * Helper method for setting visibility of layers within the basemap. 
     * @param {*} map Azure Maps control instance.
     * @param {*} isVisible Boolean indicating if layer(s) should be visible or not.
     * @param {*} filter A filter function that takes in the layer details, and returns a true for the layers that should have their visibility updated.
     */
    static #setBaseLayerVisibility(map, isVisible, filter) {
        const visibility = isVisible ? 'visible' : 'none';

        //Get all the layers within the basemap style.
        const layers = map.map.getStyle().layers;

        //Loop through all layers within the basemap. 
        for (let i = 0; i < layers.length; i++) {
            //Apply filter logic.
            if (filter(layers[i])) {
                map.map.setLayoutProperty(layers[i].id, 'visibility', visibility);
            }
        }
    }

    /**
     * Calculates the Ground resolution at a specific degree of latitude in the meters per pixel.
     * @param lat Degree of latitude to calculate resolution at.
     * @param zoom Zoom level.
     * @param tileSize The size of the tiles in the tile pyramid.
     * @returns Ground resolution in meters per pixels.
     */
    static groundResolution(lat, zoom) {
        return Math.cos(lat * Math.PI / 180) * 2 * Math.PI * 6378137 / Math.ceil(512 * Math.pow(2, zoom));
    }

    /**
     * Attempts to make a polygon valid.
     * @param {*} polygon A polygon to validate
     */
    static makePolygonValid(polygon) {
        //Unkinking polygon incase there are issues.
        const fc = turf.unkinkPolygon(polygon);

        //If unkinking created more than one feature, union them together (will likely create a multi-polygon).
        if (fc.features.length > 1) {
            let union = fc.features[0];

            for (let i = 1; i < fc.features.length; i++) {
                union = turf.union(union, fc.features[i]);
            }

            return union.geometry;
        }

        const g = fc.features[0].geometry;
        polygon.type = g.type;
        polygon.coordinates = g.coordinates;
    }

    /**
     * Shifts the coordinates of all features in a feature collection.
     * @param {*} fc A collection of features.
     * @param {*} offset Offset in meters.
     * @param {*} heading The direction to shift the features.
     * @param {*} sourceFilter The name of the source property on features to limit the shifting too.
     */
    static shiftFeatureCollection(fc, offset, heading, sourceFilter) {
        if (fc && fc.features) {
            fc.features.forEach(f => {
                if(!sourceFilter || f.properties.source === sourceFilter) {
                    Utils.shiftGeometry(f.geometry, offset, heading);
                }
            });
        }
    }

    /**
     * Shifts the coordinates of a geometry.
     * @param {*} geom The geometry to shift.
     * @param {*} offset Offset in meters.
     * @param {*} heading The direction to shift the geometry.
     */
    static shiftGeometry(geom, offset, heading) {
        switch (geom.type) {
            case 'Point':
                Utils.shiftCoordinate(geom.coordinates, offset, heading);
                break;
            case 'LineString':
            case 'MultiPoint':
                Utils.shiftCoordinates(geom.coordinates, offset, heading);
                break;
            case 'Polygon':
            case 'MultiLineString':
                geom.coordinates.forEach(r => {
                    Utils.shiftCoordinates(r, offset, heading);
                });
                break;
            case 'MultiPolygon':
                geom.coordinates.forEach(p => {
                    p.forEach(r => {
                        Utils.shiftCoordinates(r, offset, heading);
                    });
                });
                break;
        }
    }

    /**
     * Shifts an array of coordinates.
     * @param {*} coords Array of coordinates to shift.
     * @param {*} offset Offset in meters.
     * @param {*} heading The direction to shift the coordinates.
     */
    static shiftCoordinates(coords, offset, heading) {
        for(let i=0,len = coords.length;i<len;i++) {
            const c = atlas.math.getDestination(coords[i], heading, offset);
            coords[i][0] = c[0];
            coords[i][1] = c[1];
        }
    }

    /**
     * Shifts a coordinate.
     * @param {*} coord The coordinate to shift.
     * @param {*} offset Offset in meters.
     * @param {*} heading The direction to shift the coordinate.
     */
    static shiftCoordinate(coord, offset, heading) {
        const c = atlas.math.getDestination(coord, heading, offset);
        coord[0] = c[0];
        coord[1] = c[1];
    }

    /////////////////////////////////////
    // HTML utilities
    ////////////////////////////////////

    /**
     * Create a radio or checkbox element with a label. 
     * @param {string} type The type of input element to create. Supports radio, and checkbox.
     * @param {string} displayName The display name to show with the input.
     * @param {boolean} checked Optional. If the input is checked or not. For radio and checkboxes.
     * @param {string} groupName Optional. The group name of the input option.
     * @returns A radio or checkbox element wrapped with a label.
     */
    static createCheckInput(type, displayName, checked, groupName) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.setAttribute('type', type);

        switch (type) {
            case 'checkbox':
            case 'radio':
                input.setAttribute('role', type);
                break;
            default:
                return null;
        }

        if (groupName) {
            input.setAttribute('name', groupName);
        }

        label.appendChild(input);

        input.checked = checked;
        input.value = displayName;

        const span = document.createElement('span');
        span.innerHTML = displayName;

        label.appendChild(span);
        label.setAttribute('rel', displayName);

        return label;
    }

    /**
     * Gets the selected value from a select element.
     * @param {*} selector The id or instanceof a select element to set the value on.    
     * @param {*} property The property name to get the value from. Default: 'value'
     * @returns The selected value from a select element.
     */
    static getSelectValue(selector, property) {
        property = property || 'value';
        const selectElm = typeof selector === 'string' ? document.getElementById(selector) : selector;
        return selectElm.options[selectElm.selectedIndex][property];
    }

    /**
     * Sets the value of a select element by matching a given value.
     * @param {*} selector The id or instanceof a select element to set the value on.
     * @param {*} value The value to set.
     * @param {*} property The property name to match the value with. Default: 'value'
     * @returns The select element.
     */
    static setSelectByValue(selector, value, property) {
        property = property || 'value';
        const selectElm = typeof selector === 'string' ? document.getElementById(selector) : selector;
        if (selectElm && selectElm.options) {
            for (let i = 0; i < selectElm.options.length; i++) {
                if (selectElm.options[i][property] === value) {
                    selectElm.selectedIndex = i;
                    break;
                }
            }
        }
        return selectElm;
    }

    /**
     * Takes an array of element ID's and returns an object where each ID is the key, and the value is the element object.
     * @param {*} elmIds An array of element id's.
     * @returns 
     */
    static getElementsByIds(elmIds) {
        const elms = {};
        elmIds.forEach(id => {
            elms[id] = document.getElementById(id);
        });

        return elms;
    }
}

/**
 * A simple base class for adding support for custom events.
 */
export class SimpleEventerClass {
    /**
     * A simple base class for adding support for custom events.
     */
    constructor() {
        this.listeners = new Map();
    }

    /**
     * Execute the callback everytime the event name is trigger.
     * @param {*} name The event name.
     * @param {*} callback The associated event callback to trigger.
     */
    on(name, callback) {
        const l = this.listeners;
        //Create an array for the named event if one doesn't exist.
        if (!l.has(name)) {
            l.set(name, []);
        }
        //Get the named event array and add the callback to the stack.
        l.get(name).push(callback);
    }

    /**
     * Remove the callback for an event name.
     * @param {*} name The event name.
     * @param {*} callback The associated event callback to trigger.
     */
    off(name, callback = true) {
        const l = this.listeners;
        if (callback === true) {
            //Remove all listeners for the named event.
            l.delete(name);
        } else {
            //Remove listeners only with matching named event and callbacks.
            const listeners = l.get(name);
            if (listeners) {
                l.set(name, listeners.filter((value) => !(value === callback)));
            }
        }
    }

    /**
     * Trigger the event with the event name. 
     * @param {*} name The event name.
     * @param  {...any} args Any arguments to pass through to the event handlers.
     * @returns A boolean indicating if there are any listeners attached to the event.
     */
    trigger(name, ...args) {
        let res = false;
        const l = this.listeners.get(name);
        if (l && l.length) {
            l.forEach((listener) => {
                listener(...args);
            });
            res = true;
        }
        return res;
    }
}