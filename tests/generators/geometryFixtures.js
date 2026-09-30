export function polygonFixture(size = 1) {
    return {
        type: 'Feature',
        properties: {},
        geometry: {
            type: 'Polygon',
            coordinates: [[[0, 0], [size, 0], [size, size], [0, 0]]]
        }
    };
}

export function multiPolygonFixture(size = 1) {
    return {
        ...polygonFixture(size),
        geometry: {
            type: 'MultiPolygon',
            coordinates: [[[[0, 0], [size, 0], [size, size], [0, 0]]]]
        }
    };
}

export function nestedValueFixture(depth) {
    let value = 0;
    for (let index = 0; index < depth; index++) {
        value = [value];
    }
    return value;
}

export function mixedRecordFixture() {
    return [
        JSON.stringify({ type: 'Feature', properties: {}, geometry: null }),
        '{ malformed',
        JSON.stringify(polygonFixture())
    ].join('\n');
}
