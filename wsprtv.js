// WSPR Telemetry Viewer
// https://github.com/wsprtv/wsprtv.github.io
//
// This file is part of the WSPR TV project.
// Copyright (C) 2025 WSPR TV authors.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

let map;  // Leaflet map object
let params;  // form / URL params
let debug = 0;  // controls console logging

// Band info. For each band, the value is
// [starting_minute_base (for ch 0), wspr_live_band]
const kBandInfo = {
  '2200m' : [0, -1],
  '630m' : [4, 0],
  '160m' : [8, 1],
  '80m' : [2, 3],
  '60m' : [6, 5],
  '40m' : [0, 7],
  '30m' : [4, 10],
  '20m' : [8, 14],
  '17m' : [2, 18],
  '15m' : [6, 21],
  '12m' : [0, 24],
  '10m' : [4, 28],
  '6m' : [8, 50],
  '4m' : [2, 70],
  '2m' : [6, 144]
}

// Extract a parameter value from URL
function getUrlParameter(name) {
  name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
  const regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
  const results = regex.exec(location.search);
  return results === null ?
      '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
}

// Parses a string such as '2025-07-13' into a Date object or
// returns null if the string couldn't be parsed
function parseDateParam(param) {
  const date_regex = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
  const match = param.match(date_regex);
  if (!match) return null;
  const year = parseInt(match[1]);
  const month = parseInt(match[2]) - 1;  // 0-indexed
  const day = parseInt(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month ||
      date.getUTCDate() !== day) return null;
  return date;
}

// Parses and validates input params, returning them as a dictionary.
// Alerts the user and returns null if validation failed.
function parseParams() {
  const cs = document.getElementById('cs').value.trim().toUpperCase();
  const ch = Number(document.getElementById('ch').value.trim());
  const band = document.getElementById('band').value.trim();
  const start_date = parseDateParam(
      document.getElementById('start_date').value);
  const end_date = end_date_param ?
      parseDateParam(end_date_param) : new Date();
  const units = units_param || localStorage.getItem('units') || "metric";

  const cs_regex = /^[a-zA-Z0-9]{4,6}$/;
  if (!cs_regex.test(cs)) {
    alert('Please enter a valid callsign');
    return null;
  }

  if (isNaN(ch) || !Number.isInteger(ch) || ch < 0 || ch >= 600) {
    alert('Channel should be an integer between 0 and 599');
    return null;
  }

  if (!start_date) {
    alert('Start date should be in the YYYY-mm-dd format');
    return null;
  }

  if (!end_date) {
    alert('End date should be in the YYYY-mm-dd format');
    return null;
  }

  if (start_date > end_date) {
    alert('Start date should be before end date');
  }

  if (end_date - start_date > 366 * 86400 * 1000) {
    alert('Start date cannot be more than a year before the end date. ' +
          'For past flights, end date can be specified with the ' +
          '&end_date=YYYY-mm-dd URL param');
    return null;
  }

  // Successful validation
  return {'cs' : cs, 'ch' : ch, 'band' : band,
          'start_date' : start_date, 'end_date' : end_date,
          'units' : units};
}

// Date() object corresponding to last track update
let last_update_ts;

// Create a wspr.live SQL clause corresponding to desired date range
function createQueryDateRange(incremental_update = false) {
  if (incremental_update) {
    // Fetch up to 6 hours prior to last update timestamp
    let cutoff_ts = last_update_ts;
    cutoff_ts.setHours(cutoff_ts.getHours() - 6);
    const cutoff_ts_str =
        cutoff_ts.toISOString().slice(0, 16).replace('T', ' ');
    return `time > '${cutoff_ts_str}:00'`;
  } else {
    const start_date = params.start_date.toISOString().slice(0, 10);
    const end_date = params.end_date.toISOString().slice(0, 10);
    return `time >= '${start_date}' AND time <= '${end_date} 23:59:00'`
  }
}

// Creates wspr.live query for fetching regular callsign reports
function createRegularCallsignQuery(incremental_update = false) {
  const [starting_minute_base, wspr_band] = kBandInfo[params.band];
  const tx_minute = (starting_minute_base + (params.ch % 5) * 2) % 10;
  const date_range = createQueryDateRange(incremental_update);
  return `
    SELECT
      time, tx_loc, power,
      groupArray(tuple(rx_sign, rx_loc, frequency, snr))
    FROM wspr.rx
    WHERE
      tx_sign = '${params.cs}' AND
      band = ${wspr_band} AND
      ${date_range} AND
      toMinute(time) % 10 = ${tx_minute}
    GROUP BY time, tx_loc, power
    FORMAT JSONCompact`;
}

// Creates wspr.live query for fetching basic telemetry reports
function createBasicTelemetryQuery(incremental_update = false) {
  const cs1 = ['0', '1', 'Q'][Math.floor(params.ch / 200)];
  const cs3 = Math.floor(params.ch / 20) % 10;
  const [starting_minute_base, wspr_band] = kBandInfo[params.band];
  const tx_minute = (starting_minute_base + (params.ch % 5) * 2 + 2) % 10;
  const date_range = createQueryDateRange(incremental_update);
  return `
    SELECT
      time, tx_sign, tx_loc, power,
      groupArray(tuple(rx_sign, frequency))
    FROM wspr.rx
    WHERE
      substr(tx_sign, 1, 1) = '${cs1}' AND
      substr(tx_sign, 3, 1) = '${cs3}' AND
      band = ${wspr_band} AND
      ${date_range} AND
      toMinute(time) % 10 = ${tx_minute}
    GROUP BY time, tx_sign, tx_loc, power
    FORMAT JSONCompact`;
}

// Displays progress by number of dots inside the button
function displayProgress(button, stage) {
  button.textContent = '.'.repeat(stage);
}

// Executes a wspr.live query and returns the results as a json object
async function runQuery(query) {
  if (debug > 0) console.log(query);
  const encoded_query = encodeURIComponent(query);

  const url = `https://db1.wspr.live/?query=${encoded_query}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('HTTP error ' + response.status);
  return (await response.json()).data;
}

// Imports data from wspr.live for further processing:
// 1) Names the data members
// 2) Sorts rx reports by callsign
// 3) Sorts rows by ts
function importRegularCallsignData(data) {
  for (let i = 0; i < data.length; i++) {
    let row = data[i];
    data[i] = {'ts' : new Date(Date.parse(row[0].replace(' ', 'T') + 'Z')),
               'grid' : row[1], 'power' : row[2],
               'rx' : row[3].map(rx => ({'cs' : rx[0], 'grid' : rx[1],
                                         'freq' : rx[2], 'snr' : rx[3]}))
                   .sort((r1, r2) => (r1.cs > r2.cs) - (r1.cs < r2.cs))};
  }
  // Sort rows by time
  return data.sort((row1, row2) => (row1.ts - row2.ts));
}

function importBasicTelemetryData(data) {
  for (let i = 0; i < data.length; i++) {
    let row = data[i];
    data[i] = {'ts' : new Date(Date.parse(row[0].replace(' ', 'T') + 'Z')),
               'cs' : row[1], 'grid' : row[2], 'power' : row[3],
               'rx' : row[4].map(rx => ({'cs' : rx[0], 'freq' : rx[1]}))
                   .sort((r1, r2) => (r1.cs > r2.cs) - (r1.cs < r2.cs))};
  }
  // Sort rows by time
  data.sort((row1, row2) => (row1.ts - row2.ts));
  return data;
}

// Both old_data and new_data are sorted by row.ts. Extends old_data with
// items in new_data whose timestamps are not present in old_data and
// returns the result.
function mergeData(old_data, new_data) {
  let result = [];
  let i = 0;  // index in old_data
  let j = 0;  // index in new_data

  for (;;) {
    if (i >= old_data.length) {
      // Add remaining items from new_data
      while (j < new_data.length) result.push(new_data[j++]);
      break;
    } else if (j >= new_data.length) {
      // Add remaining items from old_data
      while (i < old_data.length) result.push(old_data[i++]);
      break;
    } else {
      if (old_data[i].ts < new_data[j].ts) {
        result.push(old_data[i++]);
      } else if (old_data[i].ts > new_data[j].ts) {
        result.push(new_data[j++]);
      } else {
        // Both are equal. Take old and skip all new with the same timestamp.
        result.push(old_data[i]);
        while (j < new_data.length &&
               new_data[j].ts.valueOf() == old_data[i].ts.valueOf()) {
          j++;
        }
        i++;
      }
    }
  }
  return result;
}

// Given two sets of sorted RX reports, check if any callsign
// is in both and the RX frequency is similar
function findCoreceiver(rx1, rx2) {
  let i = 0;  // index in rx1
  let j = 0;  // index in rx2
  for (;;) {
    if (i >= rx1.length || j >= rx2.length) return false;
    let r1 = rx1[i];
    let r2 = rx2[j];
    if (r1.cs == r2.cs) {
      if (Math.abs(r1.freq - r2.freq) < 5) return true;
      i++;
      j++;
    } else if (r1.cs < r2.cs) {
      i++;
    } else {
      j++;
    }
  }
}

// Combines telemetry data from corresponding WSPR messages (regular callsign +
// basic telemetry transmissions)
function matchTelemetry(reg_cs_data, basic_tel_data) {
  let spots = [];
  let i = 0;  // index in reg_cs_data
  let j = 0;  // index in basic_tel_data

  for (;;) {
    if (i >= reg_cs_data.length) {
      // We have run out of regular callsign messages
      break;
    }
    if (j >= basic_tel_data.length ||
        reg_cs_data[i].ts < basic_tel_data[j].ts - 120 * 1000 ||
        reg_cs_data[i].basic) {
      // Unmatched regular callsign message or this row has already
      // been matched before (in case of incremental updates)
      spots.push(reg_cs_data[i++]);
    } else if (reg_cs_data[i].ts > basic_tel_data[j].ts - 120 * 1000 ||
               !basic_tel_data[j].rx) {
      // Unmatched basic telemetry message or already previously matched
      // to a regular callsign message (indicated by rx deletion)
      j++;
    } else {
      // Possible match. Check if the messages were co-received by the same
      // callsign on a similar frequency.
      if (findCoreceiver(reg_cs_data[i].rx, basic_tel_data[j].rx)) {
        let data = reg_cs_data[i];
        // Combine the two messages
        data.basic = basic_tel_data[j];
        delete data.basic.rx;
        spots.push(data);
        i++;
        j++;
      } else {
        // Unmatched basic telemetry message
        j++;
      }
    }
  }
  return spots;
}

function maidenheadToLatLon(grid) {
  let A = 'A'.charCodeAt(0);
  let a = 'a'.charCodeAt(0);
  let zero = '0'.charCodeAt(0);
  let lon = (grid.charCodeAt(0) - A) * 20 - 180;
  let lat = (grid.charCodeAt(1) - A) * 10 - 90;
  lon += (grid.charCodeAt(2) - zero) * 2;
  lat += (grid.charCodeAt(3) - zero) * 1;

  // Move lat / lon to the center of the grid
  if (grid.length == 6) {
    lon += (grid.charCodeAt(4) - a) / 12 + 1 / 24;
    lat += (grid.charCodeAt(5) - a) / 24 + 1 / 48;
  } else {
    lon += 1;
    lat += 0.5;
  }
  return [lat, lon];
}

// Returns c's offset in ['A'..'Z'] if alphanum is false and in
// [0..9A..Z] otherwise
function charToNum(c, alphanum = false) {
  let code = c.charCodeAt(0);
  let A = 'A'.charCodeAt(0);
  if (alphanum) {
    if (code >= A) {
      return code - A + 10;
    } else {
      let zero = '0'.charCodeAt(0);
      return code - zero;
    }
  } else {
    return code - A;
  }
}

// Used for spot decoding
const kWsprPowers = [0, 3, 7, 10, 13, 17, 20, 23, 27, 30, 33, 37, 40,
  43, 47, 50, 53, 57, 60];

// Decodes and annotates a spot
// as documented at https://qrp-labs.com/flights/s4.html.
// Note: voltage calculation is documented incorrectly there.
function decodeSpot(spot) {
  spot.grid = spot.grid.slice(0, 4);  // normalize grid
  if (spot.basic) {
    // Basic telemetry message is present
    if (spot.basic.cs.length != 6) {
      spot.invalid = true;
      return;
    }
    spot.basic.grid = spot.basic.grid.slice(0, 4);
    // Extract values from callsign
    let cs = spot.basic.cs;
    let m = ((((charToNum(cs[1], true) * 26 + charToNum(cs[3])) * 26) +
             charToNum(cs[4]))) * 26 + charToNum(cs[5]);
    let p = Math.floor(m / 1068);
    spot.grid6 = spot.grid + String.fromCharCode(97 + Math.floor(p / 24)) +
        String.fromCharCode(97 + (p % 24));
    [spot.lat, spot.lon] = maidenheadToLatLon(spot.grid6);
    spot.altitude = (m % 1068) * 20;
    // Extract values from grid + power
    let grid = spot.basic.grid;
    let n = ((((charToNum(grid[0]) * 18 + charToNum(grid[1])) * 10) +
             charToNum(grid[2], true)) * 10 + charToNum(grid[3], true)) * 19 +
        kWsprPowers.indexOf(spot.basic.power);
    if (!(Math.floor(n / 2) % 2)) {
      // Invalid GPS bit
      spot.invalid = true;
      return;
    }
    spot.speed = (Math.floor(n / 4) % 42) * 2 * 1.852;
    spot.voltage = ((Math.floor(n / 168) + 20) % 40) * 0.05 + 3;
    spot.temp = (Math.floor(n / 6720) % 90) - 50;
  } else {
    [spot.lat, spot.lon] = maidenheadToLatLon(spot.grid);
  }
}

// Annotates telemetry spots (appends lat, lon, speed, etc)
function decodeSpots() {
  spots.forEach((spot, index) => { decodeSpot(spot); });
}

// Value formatting

function formatDuration(ts1, ts2) {
  const delta = Math.abs(ts1 - ts2) / 1000;
  const days = Math.floor(delta / 86400);
  const hours = Math.floor((delta % 86400) / 3600);
  const mins = Math.floor((delta % 3600) / 60);
  if (delta >= 86400) {
    return `${days}d ${hours}h`;
  } else if (delta >= 3600) {
    return `${hours}h ${mins}m`;
  } else {
    return `${mins}m`;
  }
}

function formatDistance(m) {
  if (params.units == 'metric') {
    return Math.floor(m / 1000) + ' km';
  } else {
    return Math.floor(m * 0.621371 / 1000) + ' mi';
  }
}

function formatSpeed(kph) {
  if (params.units == 'metric') {
    return Math.floor(kph) + ' km/h';
  } else {
    return Math.floor(kph * 0.621371) + ' mph';
  }
}

function formatAltitude(m) {
  if (params.units == 'metric') {
    return (m / 1000).toFixed(2) + ' km';
  } else {
    // 10ft increments
    return Math.floor(m * 3.28084 / 10) * 10 + ' ft';
  }
}

function formatTemperature(c) {
  if (params.units == 'metric') {
    return c + 'C';
  } else {
    return Math.floor(c * 9 / 5 + 32) + 'F';
  }
}

function formatVoltage(v) {
  return v.toFixed(2) + 'V';
}

function changeUnits() {
  if (params.units == 'metric') {
    params.units = 'imperial';
  } else {
    params.units = 'metric';
  }
  // Redraw the track using new units
  displayTrack();

  // Remember units preference
  localStorage.setItem('units', params.units);
}

// Only count distance between points at least 100km apart.
// This improves accuracy.
function computeDistance(markers) {
  if (markers.length == 0) return 0;
  let dist = 0;
  let last_marker = markers[0];
  for (let i = 1; i < markers.length; i++) {
    const segment_dist = markers[i].getLatLng().distanceTo(
        last_marker.getLatLng());
    if (segment_dist > 100000 || i == markers.length - 1) {
      dist += segment_dist;
      last_marker = markers[i];
    }
  }
  return dist;
}

let markers = [];
let marker_group = null;
let segments = [];
let segment_group = null;

// Removes all existing markers and segments from the map
function clearTrack() {
  if (marker_group) {
    marker_group.clearLayers();
    segment_group.clearLayers();
    map.removeLayer(marker_group);
    map.removeLayer(segment_group);
    markers = [];
    segments = [];
    marker_group = null;
    segment_group = null;
  }
  document.getElementById('spot_info').style.display = 'none';
  document.getElementById('synopsis').innerHTML = '';
  document.getElementById('update_countdown').innerHTML = '';
  if (clicked_marker) {
    hideMarkerRXInfo(clicked_marker);
  }
  clicked_marker = null;
  last_marker = null;
}

// Last marker in the displayed track
let last_marker = null;

// Draws the track on the map
function displayTrack() {
  clearTrack();
  marker_group = L.featureGroup();
  segment_group = L.featureGroup();

  // To reduce clutter, we only show grid4 markers if they are more than
  // 200km and/or 2 hours from adjacent grid6 markers. In other words, we only
  // display grid4 markers if there are no good adjacent grid6 markers to show
  // instead.
  for (let i = 0; i < spots.length; i++) {
    let spot = spots[i];
    if (spot.invalid) continue;

    if (last_marker &&
        last_marker.getLatLng().distanceTo(
            [spot.lat, spot.lon]) / 1000 >
        300 * Math.max(3600, (spot.ts - last_marker.spot.ts) / 1000) / 3600) {
      // Spot is too far from previous marker to be feasible (over 300 km/h
      // speed needed to connect). Ignore.
      if (debug > 0) console.log('Filtering out an impossible spot');
      continue;
    }

    let marker = null;
    if (!spot.grid6) {
      if (!last_marker ||
          (spot.ts - last_marker.spot.ts > 2 * 3600 * 1000) ||
          (last_marker.getLatLng().distanceTo(
               [spot.lat, spot.lon]) > 200000)) {
        marker = L.circleMarker([spot.lat, spot.lon],
            {radius: 5, color: 'black', fillColor: 'white', weight: 1,
             stroke: true, fillOpacity: 1});
      }
    } else {
      if (last_marker && !last_marker.spot.grid6 &&
          (spot.ts - last_marker.spot.ts < 2 * 3600 * 1000) &&
          (last_marker.getLatLng().distanceTo(
               [spot.lat, spot.lon]) < 200000)) {
        // Remove last grid4 marker
        marker_group.removeLayer(last_marker);
        markers.pop();
      }
      marker = L.circleMarker([spot.lat, spot.lon],
          {radius: 7, color: 'black', fillColor: '#add8e6', weight: 1,
           stroke: true, fillOpacity: 1});
    }
    if (marker) {
      last_marker = marker;
      marker.spot = spot;
      marker.addTo(marker_group);
      markers.push(marker);
    }
  }

  // Highlight the last marker
  if (last_marker) {
    last_marker.setStyle({fillColor: 'red'});
  }

  // Populate flight synopsis
  let synopsis = document.getElementById('synopsis');
  if (markers.length > 0) {
    const last_spot = last_marker.spot;
    const duration = formatDuration(last_marker.spot.ts, markers[0].spot.ts);
    synopsis.innerHTML = `Duration: <b>${duration}</b>`;
    // Distance is a clickable link to switch units
    const dist = computeDistance(markers);
    synopsis.innerHTML += '<br>Distance: <b>' +
        '<a href="#" id="unit_switch_link" title="Click to change units" ' +
        'onclick="changeUnits(); event.preventDefault()">' +
        formatDistance(dist) + '</a></b>';
    synopsis.innerHTML += `<br><b>${markers.length}</b> spot` +
        ((markers.length > 1) ? 's' : '');
    if (last_spot.basic) {
      synopsis.innerHTML += '<br>Last altitude: <b>' +
          formatAltitude(last_spot.altitude) + '</b>';
      synopsis.innerHTML +=
          `<br>Last speed: <b>${formatSpeed(last_spot.speed)}</b>`;
      synopsis.innerHTML +=
          `<br>Last voltage: <b>${formatVoltage(last_spot.voltage)}</b>`;
    }
    const last_age = formatDuration(new Date(), last_spot.ts);
    synopsis.innerHTML += `<br><b>(<span id='last_age'>${last_age}</span> ago)</b>`;
  } else {
    synopsis.innerHTML = '<b>0</b> spots';
  }

  // Add segments between markers
  // Handle segments across map edges
  for (let i = 1; i < markers.length; i++) {
    let lat1 = markers[i - 1].getLatLng().lat;
    let lon1 = markers[i - 1].getLatLng().lng;
    let lat2 = markers[i].getLatLng().lat;
    let lon2 = markers[i].getLatLng().lng;
    if (lon1 < lon2) {
      // Reorder so that lon1 is east of lon2 when crossing the antimeridian
      [[lat1, lon1], [lat2, lon2]] = [[lat2, lon2], [lat1, lon1]];
    }
    if (lon1 - lon2 > 180) {
      // The segment crosses the antimeridian (lon=180 line). Leaflet doesn't
      // display these correctly. Instead, we will display 2 segments -- from
      // marker1 to antimeridian and from antimeridian to marker2. For this to
      // work, the latitude at which the segment crosses antimeridian needs to
      // be calculated.
      let lat180 = lat1 + (lat2 - lat1) * (180 - lon1) /
          (lon2 - lon1 + 360);
      L.polyline([[lat1, lon1], [lat180, 180]],
          {color: '#00cc00'}).addTo(segment_group);
      L.polyline([[lat2, lon2], [lat180, -180]],
          {color: '#00cc00'}).addTo(segment_group);
    } else {
      // Regular segment, no antimeridian crossing
      L.polyline(
        [markers[i - 1].getLatLng(), markers[i].getLatLng()],
        {color: '#00cc00'}).addTo(segment_group);
    }
  }

  segment_group.addTo(map);
  marker_group.addTo(map);

  marker_group.on('mouseover', onMarkerMouseover);
  marker_group.on('mouseout', onMarkerMouseout);
  marker_group.on('click', onMarkerClick);
}

let clicked_marker = null;

function onMarkerMouseover(e) {
  let marker = e.layer;
  if (clicked_marker && clicked_marker != marker) {
    hideMarkerRXInfo(clicked_marker);
    clicked_marker = null;
  }
  displaySpotInfo(marker, e.containerPoint);
}

function onMarkerMouseout(e) {
  let marker = e.layer;
  if (marker != clicked_marker) {
    let spot_info = document.getElementById('spot_info');
    spot_info.style.display = 'none';
  }
}

function onMarkerClick(e) {
  let marker = e.layer;
  const spot = marker.spot;
  if (marker == clicked_marker) {
    hideMarkerRXInfo(clicked_marker);
    document.getElementById('spot_info').style.display = 'none';
    clicked_marker = null;
  } else {
    if (clicked_marker) {
      hideMarkerRXInfo(clicked_marker);
    }
    clicked_marker = marker;
    displaySpotInfo(marker, e.containerPoint);
    marker.rx_markers = [];
    marker.rx_segments = [];
    spot.rx.forEach(r => {
      let rx_lat_lon = maidenheadToLatLon(r.grid);
      let rx_marker = L.circleMarker(
          rx_lat_lon,
          {radius: 6, color: 'black',
           fillColor: 'yellow', weight: 1, stroke: true,
           fillOpacity: 1}).addTo(map);
      rx_marker.on('click', function(e) {
        L.DomEvent.stopPropagation(e);
      });
      let dist = marker.getLatLng().distanceTo(rx_lat_lon);
      rx_marker.bindTooltip(
          r.cs + ' ' + Math.trunc(dist / 1000) + 'km ' + r.snr + 'dBm',
          { direction: 'top', opacity: 0.8});
      marker.rx_markers.push(rx_marker);
      let segment = L.polyline([marker.getLatLng(), rx_lat_lon],
          { weight: 2, color: 'blue' }).addTo(map).bringToBack();
      marker.rx_segments.push(segment);
    });
  }
  L.DomEvent.stopPropagation(e);
}

function hideMarkerRXInfo(marker) {
  if (marker.rx_markers) {
    marker.rx_markers.forEach(rx_marker => map.removeLayer(rx_marker));
    delete marker.rx_markers;
    marker.rx_segments.forEach(rx_segment => map.removeLayer(rx_segment));
    delete marker.rx_segments;
  }
}

function displaySpotInfo(marker, point) {
  let spot = marker.spot;
  let spot_info = document.getElementById('spot_info');
  spot_info.style.left = point.x + 50 + 'px';
  spot_info.style.top = point.y - 20 + 'px';
  const utc_ts = spot.ts.toISOString().slice(0, 16).replace('T', ' ');
  spot_info.innerHTML = `${utc_ts} UTC`;
  spot_info.innerHTML += `<br>${params.cs} ${spot.grid} ${spot.power}`;
  if (spot.basic) {
    spot_info.innerHTML +=
        `<br>${spot.basic.cs} ${spot.basic.grid} ${spot.basic.power}`;
  }
  spot_info.innerHTML += `<br>${spot.lat.toFixed(2)}, ${spot.lon.toFixed(2)}`;
  if (spot.basic) {
    spot_info.innerHTML += '<br>Altitude: ' + formatAltitude(spot.altitude);
    spot_info.innerHTML += `<br>Speed: ${formatSpeed(spot.speed)}`;
    spot_info.innerHTML += `<br>Temp: ${formatTemperature(spot.temp)}`;
    spot_info.innerHTML += `<br>Voltage: ${formatVoltage(spot.voltage)}`;
  }
  const sun_pos = SunCalc.getPosition(spot.ts, spot.lat, spot.lon);
  const sun_elev = Math.round(sun_pos.altitude * 180 / Math.PI);
  spot_info.innerHTML += `<br>Sun elevation: ${sun_elev}&deg;`
  spot_info.innerHTML += `<br> ${spot.rx.length} report` +
        ((spot.rx.length == 1) ? '' : 's');
  const max_snr = Math.max(...spot.rx.map(r => r.snr));
  spot_info.innerHTML += ` | ${max_snr} dBm`;
  const max_rx_dist = Math.max(...spot.rx.map(r =>
      marker.getLatLng().distanceTo(maidenheadToLatLon(r.grid))));
  spot_info.innerHTML += `<br> ${formatDistance(max_rx_dist)}`;

  if (marker == clicked_marker) {
    // Add GoogleEarth view
    const d = spot.altitude / 0.23075;
    const dl = d / (111320 * Math.cos(spot.lat * 0.01745));
    const dt = Math.round((spot.altitude ** 2 + d ** 2) ** 0.5);
    spot_info.innerHTML +=
        '<br><br><a href="https://earth.google.com/web/@' +
        spot.lat.toFixed(3) + ',' +
        (spot.lon + dl).toFixed(3) + ',0a,' +
        dt + 'd,35y,90h,77t" ' +
        'style="color: white;" target=new>GoogleEarth View</a>' +
        '<br>(use CTRL-arrows<br>to look around)';
  }

  spot_info.style.display = 'block';
}

function getHoursSinceSunrise(ts, lat, lon) {
  return (ts - SunCalc.getTimes(ts, lat, lon).sunrise) / 3600000;
}

function getHoursToSunset(ts, lat, lon) {
  return (SunCalc.getTimes(ts, lat, lon).sunset - ts) / 3600000;
}

// Sets a timer to incrementally update the track at the end of
// next expected TX slot
function scheduleNextUpdate() {
  const [starting_minute_base, wspr_band] = kBandInfo[params.band];
  const tx_minute = (starting_minute_base + (params.ch % 5) * 2 + 2) % 10;

  const now = new Date();

  // Wait 1m 15s after the end of the next basic telemetry TX.
  // The delay is needed so that WSPR telemetry can trickle in.
  let next_update_ts = now.getTime() / 1000 -
      (now.getUTCMinutes() % 10) * 60 - now.getUTCSeconds() +
      tx_minute * 60 + 195;
  if (next_update_ts < now.getTime() / 1000 + 10) {
    // Wait for the next cycle if the map was just updated recently
    next_update_ts += 600;
  }

  // Number of seconds to wait until the next update
  const wait = next_update_ts - now.getTime() / 1000;

  let update_countdown = document.getElementById('update_countdown');

  let status_updater = setInterval(() => {
    const now = new Date();
    const wait = next_update_ts - now.getTime() / 1000;

    if (wait <= 0) {
      clearInterval(status_updater);
    } else {
      if (wait >= 60) {
          update_countdown.innerHTML =
              `Update in <b>${Math.floor((wait + 10) / 60)}m</b>`;
      } else {
          update_countdown.innerHTML =
              `Update in <b>&lt;1m</b>`;
      }
    }

    // Update "Last ago" timestamp
    let last_age = document.getElementById("last_age");
    if (last_age && last_marker) {
      last_age.innerHTML = formatDuration(now, last_marker.spot.ts);
    }
  }, 60 * 1000);

  update_countdown.innerHTML =
      `Update in <b>${Math.floor((wait + 10) / 60)}m</b>`;

  setTimeout(() => {
    clearInterval(status_updater);
    update(true);  // update incrementally
  }, wait * 1000);
}

// Regular callsign data fetched from wspr.live
let reg_cs_data = [];

// Basic telemetry data fetched from wspr.live
let basic_tel_data = [];

// Combined and annotated telemetry data
let spots = [];

// Fetch new data from wspr.live and update the map
async function update(incremental_update = false) {
  const button = document.getElementById('button');

  try {
    // Disable the button and show progress
    button.disabled = true;

    displayProgress(button, 1);

    const reg_cs_query = createRegularCallsignQuery(incremental_update);
    const new_reg_cs_data = importRegularCallsignData(
        await runQuery(reg_cs_query));
    if (debug > 2) console.log(new_reg_cs_data);

    displayProgress(button, 2);

    const basic_tel_query = createBasicTelemetryQuery(incremental_update);
    const new_basic_tel_data = importBasicTelemetryData(
       await runQuery(basic_tel_query));
    if (debug > 2) console.log(new_basic_tel_data);

    displayProgress(button, 3);

    if (!incremental_update) {
      reg_cs_data = new_reg_cs_data;
      basic_tel_data = new_basic_tel_data;
    } else {
      reg_cs_data = mergeData(reg_cs_data, new_reg_cs_data);
      basic_tel_data = mergeData(basic_tel_data, new_basic_tel_data);
    }

    spots = matchTelemetry(reg_cs_data, basic_tel_data);
    if (debug > 2) console.log(spots);

    decodeSpots();
    displayTrack();

    const now = new Date();
    last_update_ts = now;

    if (incremental_update ||
        now - params.end_date < 86400 * 1000) {
      // Only schedule updates for current flights
      scheduleNextUpdate();
    }
  } catch (error) {
    clearTrack();
    alert(error);
  } finally {
    // Restore the submit button
    button.disabled = false;
    button.textContent = 'Go';
  }
}

// Try to update the internal state based on submitted params
function processSubmission() {
  params = parseParams();
  if (params) {
    if (debug > 0) console.log(params);
    update();
  }
}

// ------------------------------------------------------
// This code runs on page load
// ------------------------------------------------------

// Prepopulate fields from URL decorators
document.getElementById('cs').value = getUrlParameter('cs');
document.getElementById('ch').value = getUrlParameter('ch');
let band_param = getUrlParameter('band');
if (!band_param || !(band_param in kBandInfo)) {
  band_param = '20m';
}
document.getElementById('band').value = band_param;
let start_date_param = getUrlParameter('start_date');
if (!start_date_param) {
  // Prefill to a date 1 month in the past
  start_date_param = new Date(
      new Date().setUTCMonth(
          new Date().getUTCMonth() - 1)).toISOString().slice(0, 10);
}
document.getElementById('start_date').value = start_date_param;
let end_date_param = getUrlParameter('end_date');
let units_param = getUrlParameter('units');

// Initial center and zoom level, if stored previously
let init_lat = localStorage.getItem('init_lat') || 40;
let init_lon = localStorage.getItem('init_lon') || -100;
let init_zoom_level = localStorage.getItem('init_zoom_level') || 2;

// On mobile devices, allow for a larger click area
let click_tolerance = 0;
if (/Mobi|Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop|BlackBerry|BB|PlayBook/.test(
    navigator.userAgent)) {
  click_tolerance = 15;
}

// Initialize the map
map = L.map('map',
    {renderer : L.canvas({tolerance: click_tolerance}),
     worldCopyJump: true})
    .setView([init_lat, init_lon], init_zoom_level);

// Use local English-label tiles for lower levels
L.tileLayer(
    'osm_tiles/{z}/{x}/{y}.png',
    {maxZoom: 6,
     attribution: '<a href="https://github.com/wsprtv/wsprtv.github.io">WSPR TV</a> | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

// Use OSM-hosted tiles for higher levels
L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    {minZoom: 7, maxZoom: 12,
     attribution: '<a href="https://github.com/wsprtv/wsprtv.github.io">WSPR TV</a> | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

// Add day / night visualization and the scale indicator
let terminator = L.terminator().addTo(map);
L.control.scale().addTo(map);

// Draw the antimeridian
L.polyline([[90, 180], [-90, 180]],
    {color: 'gray', weight: 2, dashArray: '8,5', opacity: 0.4})
    .addTo(map).bringToBack();
L.polyline([[90, -180], [-90, -180]],
    {color: 'gray', weight: 2, dashArray: '8,5', opacity: 0.4 })
    .addTo(map).bringToBack();

// Draw the equator
L.polyline([[0, -180], [0, 180]],
    {color: 'gray', weight: 1, opacity: 0.2})
    .addTo(map).bringToBack();


// On pan / zoom, save location and zoom level
map.on('moveend', function() {
  let center = map.getCenter();
  localStorage.setItem('lat', center.lat);
  localStorage.setItem('lon', center.lng);
});

map.on('zoomend', function() {
  localStorage.setItem('zoom_level', map.getZoom());
});

// Display aux info for clicks on the map outside of markers
map.on('click', function(e) {
  // Hide spot info if currently displayed
  document.getElementById('spot_info').style.display = 'none';

  // Display lat / lng / sun elevation of clicked point
  const lat = e.latlng.lat.toFixed(2);
  const lon = e.latlng.lng.toFixed(2);

  const now = new Date();

  const sun_pos = SunCalc.getPosition(now, lat, lon);
  const sun_elev = Math.round(sun_pos.altitude * 180 / Math.PI);

  const hrs_sunrise = getHoursSinceSunrise(now, lat, lon).toFixed(1);
  const hrs_sunset = getHoursToSunset(now, lat, lon).toFixed(1);

  // Update the display
  let aux_info = document.getElementById('aux_info');
  aux_info.innerHTML = `${lat}, ${lon} | ${sun_elev}&deg; `;
  if (!isNaN(hrs_sunrise)) {
    aux_info.innerHTML += `/ ${hrs_sunrise} / ${hrs_sunset} hr`;
  }

  if (clicked_marker) {
    // Display distance to the previously clicked marker
    let dist = e.latlng.distanceTo(clicked_marker.getLatLng());
    aux_info.innerHTML += ' | ' + formatDistance(dist);
    // Clicking anywhere on the map hides the info bar for the last
    // clicked marker
    hideMarkerRXInfo(clicked_marker);
    clicked_marker = null;
  }
  aux_info.style.display = 'block';
});

// Handle button clicks
document.getElementById('button').addEventListener(
    'click', processSubmission);

// Submit the form if parameters were provided in the URL
if (document.getElementById('cs').value) {
  processSubmission();
}

// Update the terminator (day / night overlay) periodically
setInterval(() => {
  terminator.setTime(new Date());
}, 120 * 1000);
