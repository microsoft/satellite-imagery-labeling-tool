importScripts('../libs/turf.min.js');
importScripts('../libs/osmtogeojson.js');

/**
 * A worker that makes a query to an OSM Overpass Turbo API, and processes the results.
 * 
 * Inputs of "e.data"
 *  - aoi - The area of interest to limit the features to.
 *  - server - The Overpass turbo API endpoint server to connect to.
 *  - query - The Overpass turbo query.
 *  - center - The center point of the map. Fills in '{{center}}' placeholder in query.
 *  - bbox - The bounding box of the aoi or map (map bbox used when no aoi). Fills in '{{bbox}}' placeholder in query.
 *  - existingGeoms - Existing geometries. If new data intersects existing data, do not import it.
 *  - allowLines - If LineString geometries can be returned.
 *  - allowPolygons - If Polygon geometries can be returned.
 */
onmessage = function (e) {
    //Make a CORs request to the overpass turbo API.
    fetch(e.data.server + 'interpreter', {
        method: 'POST',
        mode: 'cors',
        cache: 'no-cache',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
        },

        //Append the query to the POST body.
        body: 'data=' + cleanQuery(e.data.query, e.data.center, e.data.bbox)
    }).then(x => x.json()).then(osm_data => {
        //Filter the resulting OSM data.
        const data = filterNewData(osm_data, e.data);
        postMessage(data);
    }, e => {
        postMessage({ error: 'Unable to retrieve data from overpass.' });
    });
};

/**
 * Cleans the Overpass turbo query to help ensure it doesn't fail on the server side. Also inserts values into the {{center}} and {{bbox}} placeholders.
 * @param {*} query The raw text query.
 * @param {*} center The center of the query.
 * @param {*} bbox The bounding box of interest.
 * @returns A cleans Overpass turbo query.
 */
function cleanQuery(query, center, bbox) {
    //Replace the {{center}} placeholder.
    if (query.indexOf("{{center}}") > -1) {
        query = query.replace(/\{\{center\}\}/gi, `${center[1]},${center[0]}`);
    }

    //Replace the {{bbox}} placeholder.
    if (query.indexOf("{{bbox}}") > -1) {
        query = query.replace(/\{\{bbox\}\}/gi, `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}`);
    }

    //Remove comments /* */ and //
    query = query.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '');

    //Remove new lines characters and surrounding whitespace.
    query = query.replace(/[\s\t]*\n[\s\t]*/gi, '');

    //Encode the query.
    return encodeURIComponent(query);
}

/**
 * Filters raw OSM data into GeoJSON features.
 * @param {*} osm_data Raw OSM data returned by Overpass turbo.
 * @param {*} opt Options passed into the worker.
 * @returns Filters GeoJSON features.
 */
function filterNewData(osm_data, opt) {
    const filteredData = [];

    //Convert OSM data to geojson data.
    const data = osmtogeojson(osm_data);

    //Loop through each feature.
    data.features.forEach(f => {
        //Ensure data doesn't overlap existing shape.
        let overlaps = false;

        //Limit to line and/or polygon data. Point data not supported in this app at this time.
        if ((f.geometry.type.indexOf('LineString') > -1 && opt.allowLines) ||
            (f.geometry.type.indexOf('Polygon') > -1 && opt.allowPolygons)) {

            //Check to see if data intersects with the area of interest (if provided).
            if (opt.aoi && opt.aoi.type) {
                if(turf.booleanIntersects(opt.aoi, f.geometry)) {

                    //Loop through all existing shapes and check to see if the new data intersects. Only import data that doesn't intersect with existing data.
                    for (let i = 0; i < opt.existingGeoms.length; i++) {
                        if (turf.booleanIntersects(opt.existingGeoms[i].geometry, f.geometry)) {
                            overlaps = true;
                            break;
                        }
                    }
                    
                    //Import non-overlapping feature.
                    if (!overlaps) {
                        filteredData.push(f);
                    }
                }
            } else {
                filteredData.push(f);
            }
        }
    });

    return filteredData;
}