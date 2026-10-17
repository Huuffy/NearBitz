const fetch = require('node-fetch');
const config = require('../config');

const OSRM_URL = config.osrm.url;

async function getRoute(from, to, mode = 'driving') {
    const profile = mode === 'cycling' ? 'bike' : mode === 'walking' ? 'foot' : 'car';
    // from/to are [lat, lon]
    const coords = `${from[1]},${from[0]};${to[1]},${to[0]}`;
    const url = `${OSRM_URL}/route/v1/${profile}/${coords}?steps=true&geometries=geojson&overview=full`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.routes || !data.routes.length) throw new Error('No route found');
    return data.routes[0];
}

async function getTripOrder(waypoints) {
    // waypoints: [{lat, lon, ...}]
    const coords = waypoints.map(w => `${w.lon},${w.lat}`).join(';');
    const url = `${OSRM_URL}/trip/v1/car/${coords}?steps=false&geometries=geojson&overview=full&roundtrip=false&source=first`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.waypoints) throw new Error('Trip optimization failed');
    return data.waypoints.map(w => ({
        ...waypoints[w.waypoint_index],
        trip_order: w.trips_index
    }));
}

module.exports = { getRoute, getTripOrder };
