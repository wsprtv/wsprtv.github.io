// WSPR Telemetry Viewer (WSPR TV)
// https://github.com/wsprtv/wsprtv.github.io
//
// This file is part of the WSPR TV project.
// Copyright (C) 2025 WSPR TV authors.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published
// by the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Global vars
let map;  // Leaflet map object
let markers = [];
let marker_group;
let segments = [];  // lines between markers
let segment_group;
let last_marker;  // last marker in the displayed track
let selected_marker;  // currently selected (clicked) marker

let data = [];  // raw wspr.live telemetry data
let spots = [];  // merged / annotated telemetry data

let params;  // form / URL params
let debug = 0;  // controls console logging

// URL-only parameters
let end_date_param;
let units_param;
let dnu_param;  // dnu = do not update

let last_update_ts;
let next_update_ts;

let update_task;  // telemetry / map update task

// Last scroll position of the table / chart viewer
let last_data_view_scroll_pos = 0;

let mobile;  // running on a mobile device

// WSPR band info. For each band, the value is
// [U4B starting minute offset, WSPRLive band id]
const kWSPRBandInfo = {
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

// Used for spot decoding
const kWSPRPowers = [0, 3, 7, 10, 13, 17, 20, 23, 27, 30, 33, 37, 40,
    43, 47, 50, 53, 57, 60];

// Parses a UTC timestamp string like '2025-07-15 12:00:00' to a Date() object
function parseTimestamp(ts_str) {
  ts = new Date(Date.parse(ts_str.replace(' ', 'T') + 'Z'));
  if (!ts || isNaN(ts.getTime())) return null;
  return ts;
}

// Parses a string such as '2025-07-13' into a Date object or
// returns null if the string couldn't be parsed
function parseDate(date_str) {
  const date_regex = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
  const match = date_str.match(date_regex);
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

// Formats a Date() object to a UTC string such as '2025-07-15 12:00:00'
function formatTimestamp(ts) {
  return ts.toISOString().slice(0, 16).replace('T', ' ');
}

// Extract a parameter value from URL
function getUrlParameter(name) {
  name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
  const regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
  const results = regex.exec(location.search);
  return results === null ?
      '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
}

// Parses and validates input params, returning them as a dictionary.
// Alerts the user and returns null if validation failed.
function parseParams() {
  const cs = document.getElementById('cs').value.trim().toUpperCase();
  const band = document.getElementById('band').value.trim();
  if (!(band in kWSPRBandInfo)) {
    alert('Invalid band');
    return null;
  }
  // Channel may also encode tracker type, such as Z4 for Zachtek
  const raw_ch = document.getElementById('ch').value.trim().toUpperCase();
  let ch;
  let tracker;
  let fetch_extended;
  const [starting_minute_offset, _] = kWSPRBandInfo[band];
  if (raw_ch.length > 1 && /^[A-Z]$/.test(raw_ch[0])) {
    if (raw_ch[0] == 'Z' || raw_ch[0] == 'X') {
      // 'zachtek1': original protocol using a single type 1 message
      // 'zachtek2': later protocol using type 2 and type 3 messages
      tracker = (raw_ch[0] == 'Z') ? 'zachtek2' : 'zachtek1';
      if (!/^[02468]$/.test(raw_ch.slice(1))) {
        alert('Zachtek starting minute should be one of 0, 2, 4, 6 or 8');
        return null;
      }
      // Convert channel to an equivalent u4b one
      ch = ((raw_ch[1] - '0' - starting_minute_offset) / 2 + 5) % 5;
    } else if (raw_ch[0] == 'W' || raw_ch[0] == 'U') {
      // Q34 format, where Q and 3 are special callsign ids and 4 is
      // the starting minute
      if (!/^[Q01][0-9][02468]$/.test(raw_ch.slice(1))) {
        alert('Incorrect U/W channel format');
        return null;
      }
      // Convert channel to an equivalent u4b one
      ch = ['0', '1', 'Q'].indexOf(raw_ch[1]) * 200 +
          (raw_ch[2] - '0') * 20 +
          ((raw_ch[3] - '0' - starting_minute_offset) / 2 + 5) % 5;
      if (raw_ch[0] == 'W') {
        tracker = 'wb8elk';
      }
    } else {
      alert('Unknown tracker type: ' + raw_ch[0]);
      return null;
    }
  } else {
    // Default: U4B
    const match = raw_ch.match(/^(\d+)(E(\d*))?$/);
    if (!match) {
      alert('Invalid U4B channel');
      return null;
    }
    ch = Number(match[1]);
    fetch_extended = match[2] ? (match[3] ? Number(match[3]) : 1) : null;
    if (ch < 0 || ch > 599 ||
        (fetch_extended != null &&
         (fetch_extended < 1 || fetch_extended > 3))) {
      alert('Invalid U4B channel');
      return null;
    }
    tracker = 'u4b';  // deafult
  }
  const start_date = parseDate(
      document.getElementById('start_date').value);
  const end_date = end_date_param ?
      parseDate(end_date_param) : new Date();
  const units = units_param || localStorage.getItem('units') || "metric";

  let cs_regex;
  if (tracker == 'zachtek2') {
    // Zachtek allows compound callsigns
    cs_regex = /^([A-Z0-9]{1,4}\/)?[A-Z0-9]{4,6}(\/[A-Z0-9]{1,4})?$/i;
  } else {
    cs_regex = /^[A-Z0-9]{4,6}$/i;
  }
  if (!cs_regex.test(cs)) {
    alert('Please enter a valid callsign');
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
    return null;
  }

  if (end_date - start_date > 366 * 86400 * 1000) {
    alert('Start date cannot be more than a year before the end date. ' +
          'For past flights, end date can be specified with the ' +
          '&end_date=YYYY-mm-dd URL param');
    return null;
  }

  // Successful validation
  return {'cs' : cs, 'ch' : ch, 'band' : band, 'tracker' : tracker,
          'start_date' : start_date, 'end_date' : end_date,
          'fetch_extended' : fetch_extended, 'units' : units};
}

// Returns TX minute for given slot in the U4B protocol
function getU4BSlotMinute(slot) {
  const [starting_minute_offset, _] = kWSPRBandInfo[params.band];
  return (starting_minute_offset + ((params.ch % 5) + slot) * 2) % 10;
}

// Create a wspr.live SQL clause corresponding to desired date range
function createQueryDateRange(incremental_update = false) {
  if (incremental_update) {
    // Fetch up to 6 hours prior to last update timestamp
    let cutoff_ts = last_update_ts;
    cutoff_ts.setHours(cutoff_ts.getHours() - 6);
    const cutoff_ts_str = formatTimestamp(cutoff_ts);
    return `time > '${cutoff_ts_str}:00'`;
  } else {
    const start_date = formatTimestamp(params.start_date).slice(0, 10);
    const end_date = formatTimestamp(params.end_date).slice(0, 10);
    return `time >= '${start_date}' AND time <= '${end_date} 23:58:00'`
  }
}

// Creates wspr.live query for fetching telemetry reports.
// Do not change this query unless you understand the impact
// on wpsr.live servers.
function createWSPRLiveQuery(
    fetch_q01 = false, slots = [0],
    incremental_update = false) {
  const [_, wspr_live_band] = kWSPRBandInfo[params.band];
  const slot_minutes = slots.map(slot => getU4BSlotMinute(slot));
  const date_range = createQueryDateRange(incremental_update);
  let cs_clause;
  if (fetch_q01) {
    // Fetching from the Q/0/1 callsign space
    if (params.tracker == 'u4b' || params.tracker == 'wb8elk') {
      const cs1 = ['0', '1', 'Q'][Math.floor(params.ch / 200)];
      const cs3 = Math.floor(params.ch / 20) % 10;
      cs_clause = `substr(tx_sign, 1, 1) = '${cs1}' AND ` +
                  `substr(tx_sign, 3, 1) = '${cs3}'`;
    } else {
      throw new Error('Internal error');
    }
  } else {
    // Regular callsign query
    cs_clause = `tx_sign = '${params.cs}'`;
  }
  return `
    SELECT  /* wsprtv.github.io */
      time, tx_sign, tx_loc, power,
      groupArray(tuple(rx_sign, rx_loc, frequency, snr))
    FROM wspr.rx
    WHERE
      ${cs_clause} AND
      band = ${wspr_live_band} AND
      ${date_range} AND
      toMinute(time) % 10 IN (${slot_minutes})
    GROUP BY time, tx_sign, tx_loc, power
    FORMAT JSONCompact`;
}

// Executes a wspr.live query and returns the results as a JSON object
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
function importWSPRLiveData(data) {
  for (let i = 0; i < data.length; i++) {
    let row = data[i];
    data[i] = {'ts' : parseTimestamp(row[0]),
               'cs' : row[1], 'grid' : row[2], 'power' : row[3],
               'rx' : row[4].map(
                   rx => ({'cs' : rx[0], 'grid' : rx[1],
                           'freq' : rx[2], 'snr' : rx[3]}))
                   .sort((r1, r2) => (r1.cs > r2.cs) - (r1.cs < r2.cs))};
  }
  return data;
}

// Compares rows by (ts, cs)
function compareRows(r1, r2) {
  return r1.ts - r2.ts || (r1.cs > r2.cs) - (r1.cs < r2.cs);
}

// Both old_data and new_data are sorted by (row.ts, row.cs).
// Extends old_data with items in new_data whose keys are not
// present in old_data and returns the result.
function mergeData(old_data, new_data) {
  let result = [];
  let i = 0;  // index in old_data
  let j = 0;  // index in new_data

  while (i < old_data.length && j < new_data.length) {
    let cmp = compareRows(old_data[i], new_data[j]);
    if  (cmp < 0) {
      result.push(old_data[i++]);
    } else if (cmp > 0) {
      result.push(new_data[j++]);
    } else {
      // Prefer new_data -- it is more complete
      result.push(new_data[j++]);
      i++;
    }
  }

  // Append remaining elements, if any
  while (i < old_data.length) result.push(old_data[i++]);
  while (j < new_data.length) result.push(new_data[j++]);

  return result;
}

// Given two sets of sorted RX reports, check if any callsign
// is in both, and the RX frequency is similar
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
// basic telemetry messages for U4B, type2 and type3 for Zachtek).
// Returns a list of spots, with each spot having one or more messages
// attached.
function matchTelemetry(data) {
  let spots = [];

  let starting_minute = getU4BSlotMinute(0);
  let last_spot;

  for (let i = 0; i < data.length; i++) {
    row = data[i];
    slot = (((row.ts.getMinutes() - starting_minute) + 10) % 10) / 2;

    if (slot == 0) {
      if (!last_spot || last_spot.slots[0].ts != row.ts) {
        last_spot = {'slots' : [row]};
        spots.push(last_spot);
      }
    } else if (last_spot && row.ts - last_spot.slots[0].ts < 10 * 60 * 1000 &&
               !last_spot.slots[slot]) {
      // Same TX sequence as last spot, try to attach the row
      if (params.tracker == 'zachtek2') {
        // Always a match
        last_spot.slots[slot] = row;
      } else if (params.tracker == 'wb8elk') {
        if (last_spot.slots[0].grid == row.grid) {
          last_spot.slots[slot] = row;
        }
      } else {
        // U4B frequency matching
        for (let j = 0; j < slot; j++) {
          if (last_spot.slots[j] &&
              findCoreceiver(last_spot.slots[j].rx, row.rx)) {
            last_spot.slots[slot] = row;
            break;
          }
        }
      }
    }
  }
  return spots;
}

// Returns the lat / lon of a Maidenhead grid at its center
function maidenheadToLatLon(grid) {
  let A = 'A'.charCodeAt(0);
  let a = 'a'.charCodeAt(0);
  let zero = '0'.charCodeAt(0);
  let lon = (grid.charCodeAt(0) - A) * 20 - 180;
  let lat = (grid.charCodeAt(1) - A) * 10 - 90;
  lon += (grid.charCodeAt(2) - zero) * 2;
  lat += (grid.charCodeAt(3) - zero) * 1;

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

// Given a Q01 message, extracts m and n values from
// callsign and (grid, power) respectively
function extractU4BQ01Payload(p) {
  let m = ((((charToNum(p.cs[1], true) * 26 + charToNum(p.cs[3])) * 26) +
           charToNum(p.cs[4]))) * 26 + charToNum(p.cs[5]);
  let n = ((((charToNum(p.grid[0]) * 18 + charToNum(p.grid[1])) * 10) +
      charToNum(p.grid[2], true)) * 10 + charToNum(p.grid[3], true)) * 19 +
      kWSPRPowers.indexOf(p.power);
  return [m, n];
}

function processU4BSlot1Message(spot) {
  if (spot.slots[1].cs.length != 6) {
    return false;
  }
  // Extract values from callsign
  const [m, n] = extractU4BQ01Payload(spot.slots[1]);
  if (!(n % 2)) {
    // Possible extended telemetry in slot1
    // return processU4BExtendedTelemetryMessage(spot, 1);
    return false;
  }
  let p = Math.floor(m / 1068);
  let grid = spot.grid + String.fromCharCode(97 + Math.floor(p / 24)) +
      String.fromCharCode(97 + (p % 24));
  let altitude = (m % 1068) * 20;

  if (!(Math.floor(n / 2) % 2)) {
    // Invalid GPS bit
    return false;
  }
  // Fill values
  spot.speed = (Math.floor(n / 4) % 42) * 2 * 1.852;
  spot.voltage = ((Math.floor(n / 168) + 20) % 40) * 0.05 + 3;
  spot.temp = (Math.floor(n / 6720) % 90) - 50;
  spot.grid = grid;
  spot.altitude = altitude;
  return true;
}

function processU4BExtendedTelemetryMessage(spot, i) {
  const [m, n] = extractU4BQ01Payload(spot.slots[i]);
  if (n % 2) {
    // Not an extended telemetry message
    return false;
  }
  const v = Math.floor((m * 615600 + n) / 2);
  if (!spot.ext) {
    spot.ext = [];
  }
  spot.ext[i] = v;
  return true;
}

function processWB8ELKSlot1Message(spot) {
  if (spot.slots[1].cs.length != 6) {
    return false;
  }
  spot.altitude += 60 * kWSPRPowers.indexOf(spot.slots[1].power);
  let grid = spot.slots[1].grid.slice(0, 4);
  if (spot.grid != grid ||
      !/^[A-X][A-X]$/.test(spot.slots[1].cs.slice(4))) {
    return false;
  }
  spot.grid += spot.slots[1].cs.slice(4,6).toLowerCase();
  spot.voltage =
      3.3 + (spot.slots[1].cs.charCodeAt(3) - 'A'.charCodeAt(0)) * 0.1;
  return true;
}

// Annotates telemetry spots (appends lat, lon, speed, etc)
function decodeSpots() {
  spots = spots.filter(spot => decodeSpot(spot));
}

// Decodes and annotates a spot
// as documented at https://qrp-labs.com/flights/s4.html.
// Note: voltage calculation is documented incorrectly there.
function decodeSpot(spot) {
  spot.ts = spot.slots[0].ts;
  spot.grid = spot.slots[0].grid.slice(0, 4);
  if (params.tracker == 'wb8elk') {
    spot.altitude = 1000 * kWSPRPowers.indexOf(spot.slots[0].power);
    if (spot.slots[1]) {
      if (!processWB8ELKSlot1Message(spot)) {
        spot.slots[1].invalid = true;
        return true;
      }
    }
  } else if (params.tracker == 'zachtek1') {
    spot.altitude = spot.slots[0].power * 300;
  } else if (params.tracker == 'zachtek2') {
    if (!spot.slots[1]) {
      // Zachtek2 requires both slots to be present
      return false;
    }
    spot.altitude = spot.slots[0].power * 300 + spot.slots[1].power * 20;
    // Grid comes from slot1 (type 3) message
    spot.grid = spot.slots[1].grid;
  } else {
    // Default: U4B
    if (spot.slots[1]) {
      if (!processU4BSlot1Message(spot)) {
        spot.slots[1].invalid = true;
      }
    }
    // Process extended telemetry, if any
    for (let i = 2; i < spot.slots.length; i++) {
      if (spot.slots[i] && !processU4BExtendedTelemetryMessage(spot, i)) {
        spot.slots[i].invalid = true;
      }
    }
  }
  [spot.lat, spot.lon] = maidenheadToLatLon(spot.grid);
  const sun_pos = SunCalc.getPosition(spot.ts, spot.lat, spot.lon);
  spot.sun_elev = Math.round(sun_pos.altitude * 180 / Math.PI);
  return true;
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
  const [v, precision, units] = getDistanceInCurrentUnits(m);
  return v + ' ' + units;
}

function formatSpeed(kph) {
  const [v, precision, units] = getSpeedInCurrentUnits(kph);
  return v + ' ' + units;
}

function formatAltitude(m) {
  const [v, precision, units] = getAltitudeInCurrentUnits(m);
  return (precision ? v.toFixed(precision) : v) + ' ' + units;
}

function formatTemperature(c) {
  const [v, precision, units] = getTemperatureInCurrentUnits(c);
  return (precision ? v.toFixed(precision) : v) + ' ' + units;
}

function formatVoltage(v) {
  return v.toFixed(2) + 'V';
}

// Following functions return [value, suggested_precision, units]
// Example [12.6232, 2, 'km'] for '12.62 km'
function getDistanceInCurrentUnits(m) {
  return params.units == 'metric' ?
      [Math.round(m / 1000), 0, 'km'] :
      [Math.round(m * 0.621371 / 1000), 0, 'mi'];
}

function getAltitudeInCurrentUnits(m) {
  return params.units == 'metric' ?
      [m / 1000, 2, 'km'] :
      [Math.round(m * 3.28084 / 10) * 10, 0, 'ft'];
}

function getSpeedInCurrentUnits(kph) {
  return params.units == 'metric' ?
      [Math.round(kph), 0, 'km/h'] :
      [Math.round(kph * 0.621371), 0, 'mph'];
}

function getTemperatureInCurrentUnits(c) {
  return params.units == 'metric' ?
      [Math.round(c), 0, 'C'] :
      [Math.round(c * 9 / 5 + 32), 0, 'F'];
}

function toggleUnits() {
  if (params.units == 'metric') {
    params.units = 'imperial';
  } else {
    params.units = 'metric';
  }
  if (document.getElementById('map').style.display == 'block') {
    // Redraw the track using new units
    displayTrack();
  } else {
    // Redraw the data view
    showDataView();
  }

  // Remember units preference
  localStorage.setItem('units', params.units);
}

// Only count distance between points at least 100km apart.
// This improves accuracy when there are zig-zags.
function computeDistance(markers) {
  if (!markers) return 0;
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
  document.getElementById('show_data_button').style.display = 'none';
  document.getElementById('aux_info').style.display = 'none';
  if (selected_marker) {
    hideMarkerRXInfo(selected_marker);
  }
  selected_marker = null;
  last_marker = null;
}

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

    if (last_marker &&
        last_marker.getLatLng().distanceTo(
            [spot.lat, spot.lon]) / 1000 >
        300 * Math.max(1800, (spot.ts - last_marker.spot.ts) / 1000) / 3600) {
      // Spot is too far from previous marker to be feasible (over 300 km/h
      // speed needed to connect). Ignore.
      if (debug > 0) console.log('Filtering out an impossible spot');
      continue;
    }

    let marker = null;
    if (spot.grid.length < 6) {
      if (!last_marker ||
          (spot.ts - last_marker.spot.ts > 2 * 3600 * 1000) ||
          (last_marker.getLatLng().distanceTo(
               [spot.lat, spot.lon]) > 200000)) {
        marker = L.circleMarker([spot.lat, spot.lon],
            {radius: 5, color: 'black', fillColor: 'white', weight: 1,
             stroke: true, fillOpacity: 1});
      }
    } else {
      if (last_marker && last_marker.spot.grid.length < 6 &&
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
        'onclick="toggleUnits(); event.preventDefault()">' +
        formatDistance(dist) + '</a></b>';
    synopsis.innerHTML += `<br><b>${markers.length}</b> spot` +
        ((markers.length > 1) ? 's' : '');
    if ('altitude' in last_spot) {
      synopsis.innerHTML += '<br>Last altitude: <b>' +
          formatAltitude(last_spot.altitude) + '</b>';
    }
    if ('speed' in last_spot) {
      synopsis.innerHTML +=
          `<br>Last speed: <b>${formatSpeed(last_spot.speed)}</b>`;
    }
    if ('voltage' in last_spot) {
      synopsis.innerHTML +=
          `<br>Last voltage: <b>${formatVoltage(last_spot.voltage)}</b>`;
    }
    const last_age = formatDuration(new Date(), last_spot.ts);
    synopsis.innerHTML += `<br><b>(<span id='last_age'>${last_age}` +
        `</span> ago)</b>`;
  } else {
    synopsis.innerHTML = '<b>0</b> spots';
  }

  displayNextUpdateCountdown();

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

  if (spots) {
    // Display the data view button if the map is visible
    document.getElementById('show_data_button').style.display =
        document.getElementById('map').style.display;
  }

  marker_group.on('mouseover', onMarkerMouseover);
  marker_group.on('mouseout', onMarkerMouseout);
  marker_group.on('click', onMarkerClick);
}

function onMarkerMouseover(e) {
  let marker = e.layer;
  if (selected_marker && selected_marker != marker) {
    hideMarkerRXInfo(selected_marker);
    selected_marker = null;
  }
  displaySpotInfo(marker, e.containerPoint);
}

function onMarkerMouseout(e) {
  let marker = e.layer;
  if (marker != selected_marker) {
    let spot_info = document.getElementById('spot_info');
    spot_info.style.display = 'none';
  }
}

function onMarkerClick(e) {
  let marker = e.layer;
  const spot = marker.spot;
  if (marker == selected_marker) {
    hideMarkerRXInfo(selected_marker);
    document.getElementById('spot_info').style.display = 'none';
    selected_marker = null;
  } else {
    if (selected_marker) {
      hideMarkerRXInfo(selected_marker);
    }
    selected_marker = marker;
    displaySpotInfo(marker, e.containerPoint);
    marker.rx_markers = [];
    marker.rx_segments = [];
    spot.slots[0].rx.forEach(r => {
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
          `${r.cs} ${formatDistance(dist)} ${r.snr} dBm`,
          { direction: 'top', opacity: 0.8});
      marker.rx_markers.push(rx_marker);
      let segment = L.polyline([marker.getLatLng(), rx_lat_lon],
          { weight: 2, color: 'blue' }).addTo(map).bringToBack();
      marker.rx_segments.push(segment);
    });
  }
  L.DomEvent.stopPropagation(e);
}

function onMapClick(e) {
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

  if (selected_marker) {
    // Display distance to the previously clicked marker
    let dist = e.latlng.distanceTo(selected_marker.getLatLng());
    aux_info.innerHTML += ' | ' + formatDistance(dist);
    // Clicking anywhere on the map hides the info bar for the last
    // clicked marker
    hideMarkerRXInfo(selected_marker);
    selected_marker = null;
  }
  aux_info.style.display = 'block';
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
  const utc_ts = formatTimestamp(spot.ts);
  spot_info.innerHTML = `${utc_ts} UTC`;
  for (let i = 0; i < spot.slots.length; i++) {
    const slot = spot.slots[i];
    if (slot && slot.invalid != true) {
      spot_info.innerHTML +=
          `<br>${i}: ${slot.cs} ${slot.grid} ${slot.power}`;
    }
  }
  spot_info.innerHTML += `<br>${spot.lat.toFixed(2)}, ${spot.lon.toFixed(2)}`;
  if ('altitude' in spot) {
    spot_info.innerHTML += '<br>Altitude: ' + formatAltitude(spot.altitude);
  }
  if ('speed' in spot) {
    spot_info.innerHTML += `<br>Speed: ${formatSpeed(spot.speed)}`;
  }
  if ('temp' in spot) {
    spot_info.innerHTML += `<br>Temp: ${formatTemperature(spot.temp)}`;
  }
  if ('voltage' in spot) {
    spot_info.innerHTML += `<br>Voltage: ${formatVoltage(spot.voltage)}`;
  }
  if (spot.ext) {
    // Display opaque extended telemetry
    for (let i = 0; i < spot.ext.length; i++) {
      if (spot.ext[i] != undefined) {
        spot_info.innerHTML +=
            `<br>Ext ${i}: ${spot.ext[i]}`;
      }
    }
  }
  spot_info.innerHTML += `<br>Sun elevation: ${spot.sun_elev}&deg;`
  spot_info.innerHTML += `<br> ${spot.slots[0].rx.length} report` +
        ((spot.slots[0].rx.length == 1) ? '' : 's');
  const max_snr = Math.max(...spot.slots[0].rx.map(r => r.snr));
  spot_info.innerHTML += ` | ${max_snr} dBm`;
  const max_rx_dist = Math.max(...spot.slots[0].rx.map(r =>
      marker.getLatLng().distanceTo(maidenheadToLatLon(r.grid))));
  spot_info.innerHTML += `<br> ${formatDistance(max_rx_dist)}`;

  if (marker == selected_marker) {
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

// Shows the 'Next update in Xm' message in the flight synopsis bar
function displayNextUpdateCountdown() {
  if (!next_update_ts) return;

  // Number of seconds until the next update
  const remaining_time = (next_update_ts - (new Date())) / 1000;

  let update_countdown = document.getElementById('update_countdown');

  if (remaining_time >= 60) {
    update_countdown.innerHTML =
        `Update in <b>${Math.floor(remaining_time / 60)}m</b>`;
  } else if (remaining_time >= 0) {
    update_countdown.innerHTML =
              `Update in <b>&lt;1m</b>`;
  } else {
    // Can happen if the device went to sleep after last setTimeout()
    update_countdown.innerHTML = 'Update pending';
  }

}

// Displays progress by number of dots inside the button
function displayProgress(stage) {
//  document.getElementById('go_button').textContent = '.'.repeat(stage);
  document.getElementById('go_button').textContent = '●'.repeat(stage);
}

// Cancels the next pending update, if any, set by setTimeout()
// in update()
function cancelPendingUpdate() {
  if (update_task) {
    clearTimeout(update_task);
    update_task = null;
  }
  next_update_ts = null;
}

// Sets a timer to incrementally update the track at the end of
// next expected TX slot
function scheduleNextUpdate() {
  cancelPendingUpdate();

  // Number of slots in telemetry sequence
  const num_slots = (params.tracker == 'zachtek1' ? 1 : 2);
  const tx_end_minute = getU4BSlotMinute(num_slots);

  const now = new Date();

  // Wait 1m 15s after the end of the next basic telemetry TX.
  // The delay is needed so that WSPR telemetry can trickle in.
  // It is randomized so that a large number of people watching
  // a flight do not all hit wspr.live servers at exactly the same
  // time.
  next_update_ts = new Date(now.getTime() +
      (tx_end_minute * 60 + 70 -
       (now.getUTCMinutes() % 10) * 60 - now.getUTCSeconds()) * 1000 +
       Math.floor(Math.random() * 10000));

  if (!next_update_ts) {
    alert('Internal error');
    return;
  }

  while (next_update_ts - now < 10 * 1000) {
    // Add 10 minutes
    next_update_ts.setMinutes(next_update_ts.getMinutes() + 10);
  }

  if (debug > 0) {
    console.log('Next update: ', next_update_ts)
  }

  displayNextUpdateCountdown();

  update_task = setTimeout(() => {
    update(true);  // update incrementally
  }, next_update_ts - now);
}

// Fetch new data from wspr.live and update the map
async function update(incremental_update = false) {
  cancelPendingUpdate();

  const go_button = document.getElementById('go_button');

  try {
    // Disable the button and show progress
    go_button.disabled = true;

    let new_data = [];

    let stage = 1;
    displayProgress(stage++);

    const query = createWSPRLiveQuery(
        false /* fetch_q01 */,
        (params.tracker == 'zachtek2') ? [0, 1] : [0] /* slots */,
        incremental_update);
    new_data = importWSPRLiveData(await runQuery(query));

    displayProgress(stage++);

    if (params.tracker == 'u4b' || params.tracker == 'wb8elk') {
      // Fetch Q/0/1 callsign telemetry
      const slots = params.fetch_extended ?
          Array.from({length: params.fetch_extended + 1}, (_, i) => i + 1) :
          [1];
      const q01_query = createWSPRLiveQuery(
          true /* fetch_q01 */, slots, incremental_update);
      new_data.push(...importWSPRLiveData(await runQuery(q01_query)));
      displayProgress(stage++);
    }

    // Sort new_data by (ts, cs)
    new_data.sort((row1, row2) =>
        (row1.ts - row2.ts) ||
        (row1.cs > row2.cs) - (row1.cs < row2.cs));

    if (debug > 2) console.log(new_data);

    if (!incremental_update) {
      data = new_data;
    } else {
      data = mergeData(data, new_data);
      if (debug > 3) console.log(data);
    }

    spots = matchTelemetry(data);
    if (debug > 2) console.log(spots);

    decodeSpots();

    if (document.getElementById('map').style.display == 'block') {
      // Map view active
      displayTrack();
    } else {
      // Data view is active
    }

    // Recenter the map on first load
    if (!incremental_update && last_marker) {
      const map_bounds = map.getBounds();
      if (!map_bounds.contains(last_marker.getLatLng())) {
        map.setView(last_marker.getLatLng(), map.getZoom(), {animate: false});
      }
    }

    const now = new Date();
    last_update_ts = now;

    if (incremental_update ||
        (!dnu_param && now - params.end_date < 86400 * 1000)) {
      // Only schedule updates for current flights
      scheduleNextUpdate();
    }
  } catch (error) {
    clearTrack();
    alert(debug > 0 ? `\n${error.stack}` : error);
  } finally {
    // Restore the submit button
    go_button.disabled = false;
    go_button.textContent = 'Go';
  }
}

// Updates the URL based on current params, for bookmarking etc
function updateURL() {
  try {
    let url = '?cs=' +
        encodeURIComponent(document.getElementById('cs').value.trim());
    url += '&ch=' +
        encodeURIComponent(document.getElementById('ch').value.trim());
    url += '&band=' +
        encodeURIComponent(document.getElementById('band').value);
    url += '&start_date=' +
        encodeURIComponent(document.getElementById('start_date').value.trim());
    if (end_date_param) {
      url += '&end_date=' + encodeURIComponent(end_date_param);
    }
    if (units_param) {
      url += '&units=' + encodeURIComponent(units_param);
    }
    history.replaceState(null, '', url);
  } catch (error) {
    console.log('Security error triggered by history.replaceState()');
  }
}

// Invoked when the "Go" button is pressed
function processSubmission() {
  last_data_view_scroll_pos = 0;
  cancelPendingUpdate();
  params = parseParams();
  if (params) {
    if (debug > 0) console.log(params);
    updateURL();
    update();
  } else {
    clearTrack();
  }
}

// Table / charts
const kTableDataFields = [
  ['ts', {
    'label': '#',
    'type': 'row_index'
  }],
  ['ts', {
    'label': 'Time UTC',
    'color': '#7b5d45',
    'formatter': (spot) => formatTimestamp(spot.ts)
  }],
  ['grid', {
    'align': 'left',}],
  ['lat', {
    'label': 'Lat / Lon',
    'align': 'center',
    'color': '#0066cc',
    'formatter':
        (spot) => `[${spot.lat.toFixed(2)}, ${spot.lon.toFixed(2)}]`
  }],
  ['altitude', {
    'graph': {
      'fetcher': (spot) => getAltitudeInCurrentUnits(spot.altitude)[0],
      'units': () => getAltitudeInCurrentUnits(0)[2],
      'precision': () => getAltitudeInCurrentUnits(0)[1]
    },
    'formatter': (spot) => formatAltitude(spot.altitude)
  }],
  ['speed', {
    'graph': {
      'fetcher': (spot) => getSpeedInCurrentUnits(spot.speed)[0],
      'units': () => getSpeedInCurrentUnits(0)[2],
      'precision': () => 0
    },
    'formatter': (spot) => formatSpeed(spot.speed)
  }],
  ['voltage', {
    'graph': {
      'units': () => 'V'
    },
    'formatter': (spot) => formatVoltage(spot.voltage)
  }],
  ['temp', {
    'graph': {
      'fetcher': (spot) => getTemperatureInCurrentUnits(spot.temp)[0],
      'units': () => getTemperatureInCurrentUnits(0)[2],
      'precision': () => 0
    },
    'formatter': (spot) => formatTemperature(spot.temp)
  }],
  ['sun_elev', {
    'label': 'Sun',
    'graph': {
      'label': 'Sun Elevation (°)'
    },
    'formatter': (spot) => `${spot.sun_elev}°`,
  }],
  ['slots', {
    'graph': {
      'label': '# RX Reports',
      'fetcher':
          (spot) => spot.slots[0].rx.length
    },
    'label': '# RX',
    'formatter':
        (spot) => spot.slots[0].rx.length,
  }],
  ['slots', {
    'label': 'Max RX',
    'formatter':
        (spot) => {
          const lat_lon = L.latLng(spot.lat, spot.lon);
          const max_dist = Math.max(...spot.slots[0].rx.map(r =>
              lat_lon.distanceTo(maidenheadToLatLon(r.grid))));
          return formatDistance(max_dist);
        }
  }],
  ['slots', {
    'label': 'Max SNR',
    'formatter':
        (spot) => (Math.max(...spot.slots[0].rx.map(r => r.snr)) + ' dBm')
  }],
  ['ext', {
    'color': '#7b5d45',
    'formatter':
        (spot) => spot.ext ?
            `[${spot.ext.filter(x => x !== undefined).join(', ')}]` : ''
  }]
]

function createTableCell(type, content, align = null, color = null) {
  const cell = document.createElement(type);
  cell.textContent = content;
  if (align) {
    cell.style.textAlign = align;
  }
  if (color) {
    cell.style.color = color;
  }
  return cell;
}

function createPrettyButton(text, action) {
  const button = document.createElement('button');
  button.classList.add('pretty_button');
  button.textContent = text;
  button.addEventListener('click', action);
  return button;
}

function showDataView() {
  // Hide map UI
  document.getElementById('map').style.display = 'none';
  document.getElementById('show_data_button').style.display = 'none';
  document.getElementById('control_panel').style.display = 'none';
  clearTrack();

  // Display data view UI
  let data_view = document.getElementById('data_view');

  data_view.innerHTML = '';
  data_view.style.display = 'block';

  document.getElementById('close_data_button').style.display = 'block';

  let div = document.createElement('div');
  div.id = 'data_view_wrapper';

  if (!mobile) {
    let notice = document.createElement('div');
    notice.innerHTML = '&lt-- Click here to close. To <b>zoom in</b>, ' +
        'click and drag. To <b>zoom out</b>, double click.';
    notice.classList.add('notice');
    notice.style.marginLeft = '40px';
    div.appendChild(notice);
  }

  let reverse_spots = structuredClone(spots);
  reverse_spots.sort((spot1, spot2) => spot2.ts - spot1.ts);

  // Find the union of all present fields
  const present_fields = reverse_spots.flatMap(Object.keys)
      .reduce((result, key) => ({...result, [key]: true}), {});

  // Add graphs
  const x_values = spots.map(spot => spot.ts.getTime() / 1000);
  for (const [field, spec] of kTableDataFields) {
    if (!spec.graph || !present_fields[field]) {
      continue;
    }
    const y_values = spots.map(spot => spot[field] != undefined ?
        (spec.graph.fetcher ? spec.graph.fetcher(spot) : spot[field]) :
        undefined);
    let label = spec.graph.label || (field[0].toUpperCase() + field.slice(1));
    if (spec.graph.units) {
      label += ' (' + spec.graph.units() + ')';
    }
    const opts = {
      tzDate: ts => uPlot.tzDate(new Date(ts * 1e3), 'Etc/UTC'),
      cursor: {
        drag: {x: true, y: true, uni: 20},
        sync: {key: 1, setSeries: true, scales: ['x']}
      },
      width: 600,
      height: 300,
      plugins: [touchZoomPlugin()],
      series: [{label: 'Time UTC'},
        {
          label: label,
          stroke: 'blue',
          value: (self, value) => value
        }
      ],
      scales: [{label: 'x'}],
      axes: [{}, {size: 52}]
    };

    new uPlot(opts, [x_values, y_values], div);
  }

  div.appendChild(document.createElement('br'));

  div.appendChild(
      createPrettyButton('Toggle Units', toggleUnits));
  div.appendChild(
      createPrettyButton('Download JSON', () => downloadJSON(reverse_spots)));

  let table = document.createElement('table');
  table.classList.add('data_table');
  // Populate table's header
  let row = document.createElement('tr');
  for (const [field, spec] of kTableDataFields) {
    if (present_fields[field]) {
      row.appendChild(createTableCell('th',
          spec['label'] || (field[0].toUpperCase() + field.slice(1))));
    }
  }
  table.appendChild(row);
  for (let i = 0; i < reverse_spots.length; i++) {
    const spot = reverse_spots[i];
    let row = document.createElement('tr');
    for ([field, spec] of kTableDataFields) {
      if (present_fields[field]) {
        let value = spec.type == 'row_index' ? reverse_spots.length - i :
            (spot[field] == undefined ?
                '' : (spec.formatter ? spec.formatter(spot) : spot[field]));
        row.appendChild(createTableCell('td', value, spec.align, spec.color));
      }
    }
    table.appendChild(row);
  }
  div.appendChild(table);
  data_view.appendChild(div);

  data_view.onscrollend = () => {
    last_data_view_scroll_pos = data_view.scrollTop;
  }

  setTimeout(() => {
    data_view.scrollTop = last_data_view_scroll_pos;
  }, 5);
}

function downloadJSON(spots) {
  const json = JSON.stringify(spots,
    (key, value) => (value == undefined ? null : value));
  const blob = new Blob([json], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'wsprtv_export.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


function closeDataView() {
  // Hide data view UI
  let data_view = document.getElementById('data_view');
  data_view.style.display = 'none';
  data_view.innerHTML = '';
  document.getElementById('close_data_button').style.display = 'none';
  document.getElementById('map').style.display = 'block';

  // Display map UI
  map.invalidateSize();  // in case the screen rotated in data view
  document.getElementById('show_data_button').style.display = 'block';
  document.getElementById('control_panel').style.display = 'block';
  displayTrack();
}

// Prefills form fields from URL decorators
function initializeFormFields() {
  document.getElementById('cs').value = getUrlParameter('cs');
  document.getElementById('ch').value = getUrlParameter('ch');
  let band_param = getUrlParameter('band');
  if (!band_param || !(band_param in kWSPRBandInfo)) {
    band_param = '20m';
  }
  document.getElementById('band').value = band_param;
  let start_date_param = getUrlParameter('start_date');
  if (!start_date_param) {
    // Prefill to a date 1 month in the past
    start_date_param = formatTimestamp(
        new Date(new Date().setUTCMonth(new Date().getUTCMonth() - 1)))
        .slice(0, 10);
  }
  document.getElementById('start_date').value = start_date_param;
}

// Entry point
function Run() {
  initializeFormFields();

  end_date_param = getUrlParameter('end_date');
  units_param = getUrlParameter('units');
  dnu_param = getUrlParameter('dnu');

  // On mobile devices, allow for a larger click area
  let click_tolerance = 0;
  const agent_regexp = new RegExp(
      'Mobi|Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop|' +
      'BlackBerry|BB|PlayBook');
  if (agent_regexp.test(navigator.userAgent)) {
    click_tolerance = 15;
    mobile = true;
  }

  // Recall previously stored map location and zoom level
  let init_lat = localStorage.getItem('lat') || 40;
  let init_lon = localStorage.getItem('lon') || -100;
  let init_zoom_level = localStorage.getItem('zoom_level') || 2;

  // Make the map div visible (if not already)
  document.getElementById('map').style.display = 'block';

  // Initialize the map
  map = L.map('map',
      {renderer : L.canvas({tolerance: click_tolerance})});

  // Use local English-label tiles for lower levels
  L.tileLayer(
      'osm_tiles/{z}/{x}/{y}.png',
      {maxZoom: 6,
       attribution:
           '<a href="https://github.com/wsprtv/wsprtv.github.io">' +
           'WSPR TV</a> | &copy; <a href="https://www.openstreetmap.org' +
           '/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);

  // Use OSM-hosted tiles for higher levels
  L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {minZoom: 7, maxZoom: 12,
       attribution:
           '<a href="https://github.com/wsprtv/wsprtv.github.io">' +
           'WSPR TV</a> | &copy; <a href="https://www.openstreetmap.org' +
           '/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);

  map.setView([init_lat, init_lon], init_zoom_level);

  // Add day / night visualization and the scale indicator
  let terminator = L.terminator(
      {opacity : 0, fillOpacity : 0.3, interactive : false,
       longitudeRange: 360}).addTo(map);
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

  // On pan / zoom, save map location and zoom level
  map.on('moveend', function() {
    const center = map.getCenter();
    localStorage.setItem('lat', center.lat);
    localStorage.setItem('lon', center.lng);

    // Readjust the map when moving across the antimeridian
    const wrapped_center = map.wrapLatLng(center);
    if (Math.abs(center.lng - wrapped_center.lng) > 1e-8) {
      map.setView(wrapped_center, map.getZoom(), {animate: false});
    }
  });
  map.on('zoomend', function() {
    localStorage.setItem('zoom_level', map.getZoom());
  });

  // Display auxiliary info for clicks on the map outside of markers
  map.on('click', onMapClick);

  // Handle clicks on the "Go" button
  document.getElementById('go_button').addEventListener(
      'click', processSubmission);

  // Handle clicks on the "Show data" button
  document.getElementById('show_data_button').addEventListener(
      'click', showDataView);

  // Handle clicks on the "Close data" button
  document.getElementById('close_data_button').addEventListener(
      'click', closeDataView);

  // Submit the form if parameters were provided in the URL
  if (document.getElementById('cs').value) {
    processSubmission();
  }

  // Update UI elements that change over time (e.g. "X min ago" messages)
  setInterval(() => {
    displayNextUpdateCountdown();

    // Update the "Last ago" timestamp
    let last_age = document.getElementById('last_age');
    if (last_age && last_marker) {
      last_age.innerHTML = formatDuration(new Date(), last_marker.spot.ts);
    }
  }, 60 * 1000);

  // Update the terminator (day / night overlay) periodically
  setInterval(() => {
    terminator.setTime(new Date());
  }, 120 * 1000);
}

Run();
