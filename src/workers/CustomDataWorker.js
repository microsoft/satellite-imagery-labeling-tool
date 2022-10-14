importScripts('../libs/turf.min.js');

/**
 * A worker that makes a query to custom data service, and processes the results.
 * 
 * Inputs of "e.data"
 *  - aoi - The area of interest to limit the features to.
 *  - server - Formatted URL to the custom data service.
 *  - bbox - The bounding box of the aoi or map (map bbox used when no aoi). Fills in '{bbox}' placeholder in query.
 *  - existingGeoms - Existing geometries. If new data intersects existing data, do not import it.
 *  - allowLines - If LineString geometries can be returned.
 *  - allowPolygons - If Polygon geometries can be returned.
 */
onmessage = function (e) {

    fetch(e.data.server.replace('{bbox}', e.data.bbox.join(',')), {
        mode: 'cors',
        cache: 'no-cache',
    }).then(x => x.json()).then(fc => {
        //Filter the resulting data.
        const data = filterNewData(fc, e.data);
        postMessage(data);
    }, e => {
        postMessage({ error: 'Unable to retrieve data from custom data service.' });
    });
};

/**
 * Filters data from custom data service.
 * @param {*} data Data from custom data service.
 * @param {*} opt Options passed into the worker.
 * @returns Filters GeoJSON features.
 */
function filterNewData(data, opt) {
    const filteredData = [];

    //Loop through each feature.
    data.features.forEach(f => {
        //Ensure data doesn't overlap existing shape.
        let overlaps = false;

        //Limit to line and/or polygon data. Point data not supported in this app at this time.
        if ((f.geometry.type.indexOf('LineString') > -1 && opt.allowLines) ||
            (f.geometry.type.indexOf('Polygon') > -1 && opt.allowPolygons)) {

            //Check to see if data intersects with the area of interest (if provided).
            if ((opt.aoi && opt.aoi.type && turf.booleanIntersects(opt.aoi, f.geometry)) || !opt.aoi || !opt.aoi.type) {

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
        }
    });

    return filteredData;
}