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
//
// This program uses WSPR Live, which includes the following
// disclaimer (see https://wspr.live):
//
// "... You are allowed to use the services provided on wspr.live for your
// own research and projects, as long as the results are accessible free of
// charge for everyone. You are not allowed to use this service for any
// commercial or profit-oriented use cases. The complete WSPR
// infrastructure is maintained by volunteers in their spare time, so
// there are no guarantees on correctness, availability, or stability of
// this service."

// Global vars
let map;  // Leaflet map object
let markers = [];
let marker_group;
let marker_line;
let last_marker;  // used to periodically update the 'last ago' message
let selected_marker;  // currently selected (clicked) marker

let data = [];  // raw wspr.live telemetry data
let spots = [];  // merged / annotated telemetry data

let params;  // form / URL params
let debug = 0;  // controls console logging

let num_fetch_retries = 0;

// URL-only parameters
let end_date_param;
let ate1y_param;  // ate1y = allow tracks exceeding 1 year
let dnu_param;  // dnu = do not update
let detach_grid4_param;
let show_unattached_param;
let sun_elevation_param;

// Extended telemetry URL parameters
let et_decoders_param;
let et_labels_param;
let et_long_labels_param;
let et_units_param;
let et_resolutions_param;

// Other URL parameters
let units_param;
let time_param;
let detail_param;

let last_update_ts;
let next_update_ts;

let update_task;  // telemetry / map update task

// Last scroll position of the table / chart viewer
let last_data_view_scroll_pos = 0;

let is_mobile;  // running on a mobile device

let solar_isoline;

// WSPR band info. For each band, the value is
// [U4B start minute offset, WSPR Live band id, start freq].
const kWSPRBandInfo = {
  '2200m': [0, -1, 137400],
  '630m': [4, 0, 475600],
  '160m': [8, 1, 1838000],
  '80m': [2, 3, 3570000],
  '60m': [6, 5, 5288600],
  '40m': [0, 7, 7040000],
  '30m': [4, 10, 10140100],
  '20m': [8, 14, 14097000],
  '17m': [2, 18, 18106000],
  '15m': [6, 21, 21096000],
  '12m': [0, 24, 24926000],
  '10m': [4, 28, 28126000],
  '6m': [8, 50, 50294400],
  '4m': [2, 70, 70092400],
  '2m': [6, 144, 144490400],
  '70cm': [0, 432, 432301400],
  '23cm': [4, 1296, 1296501400]
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
function parseDate(date_str, use_utc) {
  const date_regex = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
  const match = date_str.match(date_regex);
  if (!match) return null;
  const year = parseInt(match[1]);
  const month = parseInt(match[2]) - 1;  // 0-indexed
  const day = parseInt(match[3]);
  if (use_utc) {
    const date = new Date(Date.UTC(year, month, day));
    if (date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month ||
        date.getUTCDate() !== day) return null;
    return date;
  } else {
    // Local time
    const date = new Date(year, month, day);
    if (date.getFullYear() !== year ||
        date.getMonth() !== month ||
        date.getDate() !== day) return null;
    return date;
  }
}

// Formats a Date() object to a string such as '2025-07-15 12:00:00'
function formatTimestamp(ts, force_utc = 0) {
  if (params && params.use_utc == 0 && !force_utc) {
    ts = new Date(ts.getTime() - ts.getTimezoneOffset() * 60000);
  }
  return ts.toISOString().slice(0, 16).replace('T', ' ');
}

// Extracts a parameter value from the URL
function getParameterFromURL(url, name) {
  const regex = new RegExp('[?&]' + name + '(=([^&]*)|(?=[&]|$))');
  const match = regex.exec(url);
  if (!match) return null;
  return match[2] != undefined ?
      decodeURIComponent(match[2].replace(/\+/g, ' ')) : '';
}

function getURLParameter(name) {
  return getParameterFromURL(location.search, name);
}

// Parses a versioned parameter such as fooV12 into its prefix
// and the version number (or 0 if not present)
function parseVersionedParameter(param) {
  const match = param.match(/^(.*?)(?:V(\d+))?$/i);
  return [match[1], match[2] ? Number(match[2]) : 0];
}

// Parses and validates input params, returning them as a dictionary.
// Alerts the user and returns null if validation failed.
function parseParameters() {
  const cs = document.getElementById('cs').value.trim().toUpperCase();
  const band = document.getElementById('band').value.trim();
  if (!(band in kWSPRBandInfo)) {
    alert('Invalid band');
    return null;
  }
  // Channel may also encode tracker type, such as Z4 for Zachtek
  const [raw_ch, version] =
      parseVersionedParameter(document.getElementById('ch').value.trim());
  let ch;
  let tracker;
  const [starting_minute_offset, _, _2] = kWSPRBandInfo[band];
  if (raw_ch.length > 1 && /^[A-Z]$/i.test(raw_ch[0])) {
    if (/[GZ]/i.test(raw_ch[0])) {
      // generic1 (g): unspecified protocol, single type 1 message
      // generic2 (G): unspecified protocol, type 2 + type 3 message combo
      // zachtek1 (z): older Zachtek protocol, single type 1 message
      // zachtek2 (Z): newer Zachtek protocol, type 2 + type 3 message combo
      tracker = { 'g': 'generic1', 'G': 'generic2',
                  'z': 'zachtek1', 'Z': 'zachtek2' }[raw_ch[0]];
      if (!/^[02468]$/.test(raw_ch.slice(1))) {
        alert('Starting minute should be one of 0, 2, 4, 6 or 8');
        return null;
      }
      // Convert channel to an equivalent u4b one
      ch = ((raw_ch[1] - '0' - starting_minute_offset) / 2 + 5) % 5;
    } else if (/[UW]/i.test(raw_ch[0])) {
      // Q34 format, where Q and 3 are special callsign ids and 4 is
      // the starting minute
      if (!/^[Q01][0-9][02468]$/i.test(raw_ch.slice(1))) {
        alert('Incorrect U/W channel format');
        return null;
      }
      // Convert channel to an equivalent u4b one
      ch = ['0', '1', 'Q'].indexOf(raw_ch[1].toUpperCase()) * 200 +
          (raw_ch[2] - '0') * 20 +
          ((raw_ch[3] - '0' - starting_minute_offset) / 2 + 5) % 5;
      tracker = raw_ch[0].toUpperCase() == 'W' ? 'wb8elk' : 'u4b';
    } else if (/^C(\d+)?$/i.test(raw_ch)) {
      ch = raw_ch.length > 1 ? Number(raw_ch.slice(1)) : 0;
      tracker = 'custom';
    } else {
      alert('Unknown tracker type: ' + raw_ch[0]);
      return null;
    }
  } else if (raw_ch == '') {
    // Showing regular callsign reports from all slots
    ch = 0;
    tracker = 'unknown';
  } else {
    // Default: U4B
    if (!/^\d+$/i.test(raw_ch)) {
      alert('Invalid U4B channel');
      return null;
    }
    ch = Number(raw_ch);
    if (ch < 0 || ch > 599) {
      alert('Invalid U4B channel');
      return null;
    }
    tracker = 'u4b';  // default
  }

  const units = (units_param == null) ?
      (localStorage.getItem('units') == 1 ? 1 : 0) :
      (units_param == 'imperial' ? 1 : 0);
  const use_utc = (time_param == null) ?
      (localStorage.getItem('use_utc') == 1 ? 1 : 0) :
      (time_param == 'utc' ? 1 : 0);
  const detail = (detail_param == null) ?
      (localStorage.getItem('detail') == 0 ? 0 : 1) :
      (detail_param == '0' ? 0 : 1);
  const start_date = parseDate(
      document.getElementById('start_date').value, use_utc);
  const end_date = end_date_param ?
      parseDate(end_date_param, use_utc) : new Date();
  if (use_utc) {
    start_date.setUTCHours(0, 0, 0);
    end_date.setUTCHours(24, 0,  0);
  } else {
    start_date.setHours(0, 0, 0);
    end_date.setHours(24, 0, 0);
  }

  let cs_regex;
  if (['generic2', 'zachtek2', 'unknown'].includes(tracker)) {
    // Compound callsigns allowed
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

  if (ate1y_param != null) {
    if (end_date - start_date > 731 * 86400 * 1000) {
      alert('Start date cannot be more than two years before the end date. ' +
            'For past flights, end date can be specified with the ' +
            '&end_date=YYYY-mm-dd URL param');
      return null;
    }
  } else {
    if (end_date - start_date > 366 * 86400 * 1000) {
      alert('Start date cannot be more than a year before the end date. ' +
            'For past flights, end date can be specified with the ' +
            '&end_date=YYYY-mm-dd URL param');
      return null;
    }
  }

  const et_spec = et_decoders_param ? parseExtendedTelemetrySpec() : null;
  if (et_decoders_param && !et_spec) {
    alert('Invalid ET spec');
    return null;
  }

  const et_slots = getExtendedTelemetrySlots(et_spec);

  // Successful validation
  return { 'cs': cs, 'ch': ch, 'band': band, 'tracker': tracker,
           'start_date': start_date, 'end_date': end_date,
           'et_slots': et_slots, 'units': units, 'use_utc': use_utc,
           'detail': detail, 'et_spec': et_spec,
           'version': version };
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem('history')) || [];
  } catch (error) {
    return [];
  }
}

function updateHistory() {
  const history = loadHistory();
  const now = Math.floor(Date.now() / 1000);
  const url = getCurrentURL();
  let updated_history = [{ 'ts': now, 'url': url }];
  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    if (!entry.ts || !entry.url) continue;
    if (now - entry.ts > 14 * 86400) continue;
    const cs = getParameterFromURL(entry.url, 'cs');
    const ch = getParameterFromURL(entry.url, 'ch');
    const band = getParameterFromURL(entry.url, 'band');
    if (cs.toUpperCase() != params.cs ||
        ch != document.getElementById('ch').value.trim() ||
        band.toLowerCase() != params.band) {
      updated_history.push(entry);
      if (updated_history.length >= 30) break;
    }
  }
  localStorage.setItem('history', JSON.stringify(updated_history));
  if (debug > 0) console.log(updated_history);
}

// Returns the list of slots that may have U4B extended telemetry
function getExtendedTelemetrySlots(et_spec) {
  if (!et_spec) return [];
  let slots = new Set();
  for (const decoder of et_spec.decoders) {
    for (const filter of decoder[0]) {
      if (filter[0] == 's') {
        slots.add(filter[1]);
        found_slot = true;
        break;
      }
    }
  }
  return slots.size ? [...slots] : [2];
}

// Returns TX minute for given slot in the U4B protocol
function getU4BSlotMinute(slot) {
  const [starting_minute_offset, _, _2] = kWSPRBandInfo[params.band];
  return (starting_minute_offset + ((params.ch % 5) + slot) * 2) % 10;
}

// Create a wspr.live SQL clause corresponding to desired date range
function createQueryDateRange(incremental_update = false) {
  if (incremental_update) {
    // Fetch up to 6 hours prior to last update timestamp
    let cutoff_ts = last_update_ts;
    cutoff_ts.setHours(cutoff_ts.getHours() - 6);
    const cutoff_ts_str = formatTimestamp(cutoff_ts, true);
    return `time > '${cutoff_ts_str}:00'`;
  } else {
    const start_date = formatTimestamp(params.start_date, true);
    const end_date = formatTimestamp(params.end_date, true);
    return `time >= '${start_date}:00' AND time < '${end_date}:00'`
  }
}

// Creates wspr.live query for fetching telemetry reports.
// Do not change this query unless you understand the impact
// on wpsr.live servers.
function createWSPRLiveQuery(reg_slots = [0], q01_slots = [],
                             incremental_update = false) {
  const [_, wspr_live_band, _2] = kWSPRBandInfo[params.band];
  let reg_clause;
  let q01_clause;
  if (reg_slots.length > 0) {
    // Regular callsign query
    reg_clause = `tx_sign = '${params.cs}'`;
    if (reg_slots.length < 5) {
      const slot_minutes = reg_slots.map(slot => getU4BSlotMinute(slot));
      reg_clause += ` AND toMinute(time) % 10 IN (${slot_minutes})`;
    }
  }
  if (q01_slots.length > 0) {
    // Q01 callsign query
    const cs1 = ['0', '1', 'Q'][Math.floor(params.ch / 200)];
    const cs3 = Math.floor(params.ch / 20) % 10;
    q01_clause = `substr(tx_sign, 1, 1) = '${cs1}' AND ` +
                `substr(tx_sign, 3, 1) = '${cs3}'`;
    if (q01_slots.length < 5) {
      const slot_minutes = q01_slots.map(slot => getU4BSlotMinute(slot));
      q01_clause += ` AND toMinute(time) % 10 IN (${slot_minutes})`;
    }
  }
  const cs_slot_clause =
      `((${reg_clause || false}) OR (${q01_clause || false}))`;
  const date_range = createQueryDateRange(incremental_update);
  return `
    SELECT  /* wsprtv.github.io */
      time, tx_sign, tx_loc, power,
      groupArray(tuple(rx_sign, rx_loc, frequency, snr))
    FROM wspr.rx
    WHERE
      ${cs_slot_clause} AND
      band = ${wspr_live_band} AND
      ${date_range}
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
    data[i] = { 'ts': parseTimestamp(row[0]),
                'cs': row[1], 'grid': row[2], 'power': row[3],
                'rx': row[4].map(
                    rx => ({ 'cs': rx[0], 'grid': rx[1],
                            'freq': rx[2], 'snr': rx[3] }))
                    .sort((r1, r2) => (r1.cs > r2.cs) - (r1.cs < r2.cs))};
  }
  return data;
}

// Compares rows by (ts, cs)
function compareDataRows(r1, r2) {
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
    let cmp = compareDataRows(old_data[i], new_data[j]);
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
    const r1 = rx1[i];
    const r2 = rx2[j];
    if (r1.cs == r2.cs) {
      if (Math.abs(r1.freq - r2.freq) <= 5) return true;
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
// basic telemetry messages for U4B, type 2 and type 3 for Zachtek).
// Returns a list of spots, with each spot having one or more messages
// attached.
function matchTelemetry(data) {
  let spots = [];

  let starting_minute = getU4BSlotMinute(0);
  let last_spot;

  for (let i = 0; i < data.length; i++) {
    row = data[i];
    if (params.tracker == 'unknown') {
      spots.push({ 'slots': [row] });
      continue;
    }
    const slot = (((row.ts.getMinutes() - starting_minute) + 10) % 10) / 2;
    if (slot == 0) {
      if (!last_spot || last_spot.slots[0].ts != row.ts) {
        // New spot
        last_spot = { 'slots': [row] };
        spots.push(last_spot);
      }
    } else if (last_spot && row.ts - last_spot.slots[0].ts < 10 * 60 * 1000 &&
               !last_spot.slots[slot]) {
      // Same TX sequence as last spot, try to attach the row
      if (params.tracker == 'zachtek2' || params.tracker == 'generic2') {
        // Always a match
        last_spot.slots[slot] = row;
      } else if (params.tracker == 'wb8elk') {
        if (last_spot.slots[0].grid == row.grid) {
          last_spot.slots[slot] = row;
        }
      } else if (params.tracker == 'u4b') {
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
    if (params.et_slots.includes(1)) {
      // Possible extended telemetry in slot1
      return processExtendedTelemetryMessage(spot, 1);
    }
    return false;
  }
  let p = Math.floor(m / 1068);
  let grid = spot.grid + String.fromCharCode(97 + Math.floor(p / 24)) +
      String.fromCharCode(97 + (p % 24));
  let altitude = (m % 1068) * 20;

  spot.voltage = ((Math.floor(n / 168) + 20) % 40) * 0.05 + 3;
  spot.temp = (Math.floor(n / 6720) % 90) - 50;
  const is_valid_gps = Math.floor(n / 2) % 2;
  if (!is_valid_gps && params.version < 100) {
    // Invalid GPS bit
    spot.is_invalid_gps = true;
    return false;
  }
  spot.speed = (Math.floor(n / 4) % 42) * 2 * 1.852;
  spot.grid = grid;
  spot.altitude = altitude;

  if (params.version >= 100) {
    handleU4BVariants(spot, is_valid_gps);
  }
  return true;
}

// Handles U4B variants where a different meaning is assigned to
// the gps_valid flag
function handleU4BVariants(spot, flag) {
  switch (params.version) {
    case 100: {
      // Increased speed range
      if (!flag) spot.speed += 42 * 2 * 1.852;
      break;
    }
    case 101: {
      // Improved altitude resolution
      if (!flag) spot.altitude += 10;
      break;
    }
    case 102: {
      // Improved longitude resolution
      [spot.lat, spot.lon] = maidenheadToLatLon(spot.grid);
      spot.lon += flag ? (-1 / 48) : (1 / 48);
      break;
    }
    case 103: {
      // Improved latitude resolution
      [spot.lat, spot.lon] = maidenheadToLatLon(spot.grid);
      spot.lat += flag ? (-1 / 96) : (1 / 96);
      break;
    }
  }
}

function processExtendedTelemetryMessage(spot, slot) {
  const [m, n] = extractU4BQ01Payload(spot.slots[slot]);
  if (n % 2) {
    // Not an extended telemetry message
    return false;
  }
  const v = Math.floor((m * 615600 + n) / 2);
  if (!spot.raw_et) {
    spot.raw_et = [];
  }
  spot.raw_et[slot] = v;
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
  spot.grid = (params.tracker == 'unknown') ?
      spot.slots[0].grid : spot.slots[0].grid.slice(0, 4);
  if (params.tracker == 'wb8elk') {
    spot.altitude = 1000 * kWSPRPowers.indexOf(spot.slots[0].power);
    if (spot.slots[1]) {
      if (!processWB8ELKSlot1Message(spot)) {
        spot.slots[1].is_invalid = true;
      }
    }
  } else if (params.tracker == 'zachtek1') {
    spot.altitude = spot.slots[0].power * 300;
  } else if (params.tracker == 'generic1') {
    // Nothing to do here
  } else if (params.tracker == 'zachtek2' || params.tracker == 'generic2') {
    if (!spot.slots[1]) {
      // Slot 1 needs to be present as it contains the location. WSPRNet
      // guesses the location for type 2 (slot 0) messages. Relying
      // just on type 3 (slot 1) messages risks 15-bit hash collisions.
      return false;
    }
    if (params.tracker == 'zachtek2') {
      spot.altitude = spot.slots[0].power * 300 + spot.slots[1].power * 20;
    }
    // Grid comes from slot1 (type 3) message
    spot.grid = spot.slots[1].grid;
  } else if (params.tracker == 'u4b') {
    // Default: U4B
    if (spot.slots[1]) {
      if (!processU4BSlot1Message(spot)) {
        spot.slots[1].is_invalid = true;
      }
    }
    // Process extended telemetry, if any
    for (let i = 2; i < spot.slots.length; i++) {
      if (spot.slots[i] && !processExtendedTelemetryMessage(spot, i)) {
        spot.slots[i].is_invalid = true;
      }
    }
  }
  if (spot.lat == undefined) {
    [spot.lat, spot.lon] = maidenheadToLatLon(spot.grid);
  }
  if (spot.raw_et) decodeExtendedTelemetry(spot);
  return true;
}

function decodeExtendedTelemetry(spot) {
  if (!params.et_spec || !spot.raw_et) return null;
  let et = [];
  let tx_seq = (spot.ts.getUTCDate() - 1) * 720 +
      spot.ts.getUTCHours() * 30 +
      Math.floor(spot.ts.getUTCMinutes() / 2);
  for (let i = 0; i < spot.raw_et.length; i++) {
    let index = 0;  // index within data
    const raw_et = spot.raw_et[i];
    if (raw_et == undefined) continue;
    const decoders = params.et_spec.decoders;
    for (let j = 0; j < decoders.length; j++) {
      const [filters, extractors] = decoders[j];
      let matched = true;
      for (let filter of filters) {
        if (filter.length == 4 && filter[0] == 't' &&
            Math.trunc(tx_seq / filter[1]) % filter[2] != filter[3]) {
          matched = false;
          break;
        }
        if (filter.length == 2 && filter[0] == 's' &&
            filter[1] != i) {
          matched = false;
          break;
        }
        if (filter.length != 3) continue;
        let [divisor, modulus, expected_value] = filter;
        if (expected_value == 's') expected_value = i; // slot
        if (Math.trunc(raw_et / divisor) % modulus != expected_value) {
          matched = false;
          break;
        }
      }
      if (matched) {
        // Extract the values
        for (const [divisor, modulus, offset, slope] of extractors) {
          et[index++] = offset +
              (Math.trunc(raw_et / divisor) % modulus) * slope;
        }
        break;  // do not try other decoders
      } else {
        // Skip over the missing indices
        index += extractors.length;
      }
    }
  }
  if (et.length) spot.et = et;
  return data;
}

// Categorizes spots on whether they should be part of the track
function categorizeSpots() {
  let last_attached_spot;
  for (let i = 0; i < spots.length; i++) {
    const spot = spots[i];
    if (spot.is_invalid_gps || params.tracker == 'unknown' ||
        (detach_grid4_param != null &&  spot.grid.length < 6)) {
      spot.is_unattached = true;
      continue;
    }

    if (last_attached_spot) {
      let dist = getDistance(last_attached_spot, spot) / 1000;
      dist -= spot.grid.length < 6 ? 125 : 5.2;
      dist -= last_attached_spot.grid.length < 6 ? 125 : 5.2;
      const delta_ts = Math.max(1, (spot.ts - last_attached_spot.ts) / 1000);
      if (dist > 300 * delta_ts / 3600) {
        // Spot is too far from previous marker to be feasible (over 300 km/h
        // speed needed to connect).
        if (debug > 0) console.log('Unattaching an impossible spot');
        spot.is_unattached = true;
        continue;
      }

      if (spot.grid.length < 6) {
        // Grid4 spot
        if (!['zachtek1', 'generic1'].includes(params.tracker) &&
            ((spot.ts - last_attached_spot.ts) < 2 * 3600 * 1000) &&
            (getDistance(last_attached_spot, spot) < 200000)) {
          // Do not attach grid4 spots unless there are no other spots nearby
          spot.is_unattached = true;
          continue;
        }
      } else {
        // Grid6 spot
        if ((last_attached_spot.grid.length < 6) &&
            (spot.ts - last_attached_spot.ts < 2 * 3600 * 1000) &&
            (getDistance(last_attached_spot, spot) < 200000)) {
          // Unattach last grid4 marker
          last_attached_spot.is_unattached = true;
        }
      }
    }
    last_attached_spot = spot;
  }
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

function formatDistance(m, append_units = true) {
  const v = getDistanceInCurrentUnits(m);
  const [units, _] = kUnitInfo['distance'][params.units]
  return v + (append_units ? units : '');
}

function formatSpeed(kph, append_units = true) {
  const v = getSpeedInCurrentUnits(kph);
  const [units, _] = kUnitInfo['speed'][params.units];
  return v + (append_units ? units : '');
}

// Vertical speed, mpm = m/min
function formatVSpeed(mpm, append_units = true) {
  const v = getVSpeedInCurrentUnits(mpm);
  const [units, _] = kUnitInfo['vspeed'][params.units];
  return v + (append_units ? units : '');
}

function formatAltitude(m, append_units = true) {
  const v = getAltitudeInCurrentUnits(m);
  const [units, resolution] = kUnitInfo['altitude'][params.units];
  return (resolution ? v.toFixed(resolution) : v) +
      (append_units ? units : '');
}

function formatTemperature(c, append_units = true) {
  const v = getTemperatureInCurrentUnits(c);
  const [units, _] = kUnitInfo['temp'][params.units]
  return v + (append_units ? units : '');
}

function formatVoltage(v, append_units = true) {
  return v.toFixed(2) + (append_units ? 'V' : '');
}

function getDistanceInCurrentUnits(m) {
  return (params.units == 0) ?
      Math.round(m / 1000) :
      Math.round(m * 0.621371 / 1000);
}

function getAltitudeInCurrentUnits(m) {
  return (params.units == 0) ?
      m / 1000 : Math.round(m * 3.28084 / 10) * 10;
}

function getSpeedInCurrentUnits(kph) {
  return (params.units == 0) ?
       Math.round(kph) : Math.round(kph * 0.621371);
}

function getVSpeedInCurrentUnits(mpm) {
  return (params.units == 0) ?
       Math.round(mpm) : Math.round(mpm * 3.28084);
}

function getTemperatureInCurrentUnits(c) {
  return (params.units == 0) ?
      Math.round(c) : Math.round(c * 9 / 5 + 32);
}

function getSunElevation(ts, lat, lon) {
  const sun_pos = SunCalc.getPosition(ts, lat, lon);
  return Math.round(toDegrees(sun_pos.altitude));
}

function getTimeSinceSunrise(ts, lat, lon) {
  return ts - SunCalc.getTimes(ts, lat, lon).sunrise;
}

function getTimeToSunset(ts, lat, lon) {
  return SunCalc.getTimes(ts, lat, lon).sunset - ts;
}

// Returns [num_rx, max_rx_dist, max_snr, avg_freq]
function getRXStats(spot) {
  const [_, _2, base_freq] = kWSPRBandInfo[params.band];
  let cs = {};
  let grids = {};
  let max_snr = -100;
  let freq_sum = 0;
  let num_freqs = 0;
  for (let i = 0; i < spot.slots.length; i++) {
    const slot = spot.slots[i];
    if (slot) {
      for (let j = 0; j < slot.rx.length; j++) {
        const rx = slot.rx[j];
        max_snr = Math.max(max_snr, rx.snr);
        freq_sum += Math.min(250, Math.max(-50, rx.freq - base_freq));
        cs[rx.cs] = 1;
        grids[rx.grid] = 1;
      }
      num_freqs += slot.rx.length;
    }
  }
  const lat_lon = L.latLng([spot.lat, spot.lon]);
  const max_rx_dist = Math.max(...Object.keys(grids).map(grid =>
      lat_lon.distanceTo(maidenheadToLatLon(grid))));
  return [Object.keys(cs).length, max_rx_dist, max_snr,
          Math.floor(freq_sum / (num_freqs || 1))];
}

// Units / localization

// Metric / imperial, with second param being the display resolution.
// Spaces in units are deliberate: 5 mph vs 5V.
const kUnitInfo = {
  'speed': [[' km/h', 0], [' mph', 0]],
  'vspeed': [[' m/min', 0], [' ft/min', 0]],
  'altitude': [[' km', 2], [' ft', 0]],
  'distance': [[' km', 0], [' mi', 0]],
  'temp': [['°C', 0], ['°F', 1]],
  'voltage': [['V', 2], ['V', 2]],
  'power': [[' dBm', 0], [' dBm', 0]],
  'snr': [[' dB', 0], [' dB', 0]],
  'angle': [['°', 0], ['°', 0]],
  'freq': [[' Hz', 0], [' Hz', 0]]
};

function toggleUnits() {
  params.units ^= 1;
  localStorage.setItem('units', params.units);
  redraw();
}

function toggleUTC() {
  params.use_utc ^= 1;
  localStorage.setItem('use_utc', params.use_utc);
  redraw();
}

function redraw() {
  if (document.getElementById('map').style.display == 'block') {
    // Redraw the track
    displayTrack();
  } else {
    // Redraw the data view
    showDataView();
  }

  setURL(getCurrentURL());
}

// Returns the distance between two spots in meters
function getDistance(spot1, spot2) {
  return L.latLng([spot1.lat, spot1.lon]).distanceTo([spot2.lat, spot2.lon]);
}

// Only count distance between points at least 100km apart.
// This improves accuracy when there are zig-zags.
function computeTrackDistance(spots) {
  if (!spots) return 0;
  let dist = 0;
  let last_spot;
  for (let i = 0; i < spots.length; i++) {
    const spot = spots[i];
    if (spot.is_unattached) continue;
    if (!last_spot) {
      last_spot = spot;
    } else {
      const segment_dist = getDistance(spot, last_spot);
      if (segment_dist > 100000 || i == spots.length - 1) {
        dist += segment_dist;
        last_spot = spot;
      }
    }
  }
  return dist;
}

// Returns number of east-bound laps for given track
function getNumLaps(spots) {
  if (!spots) return 0;
  let num_degrees = 0;
  let max_num_degrees = 0;
  let last_lon = null;
  for (let i = 0; i < spots.length; i++) {
    const spot = spots[i];
    if (spot.is_unattached) continue;
    if (last_lon == null) {
      last_lon = spot.lan;
    } else {
      let delta = ((spot.lon - last_lon + 180) % 360) - 180;
      if (delta < -120) delta += 360;  // prefer east-bound legs
      num_degrees += delta;
      max_num_degrees = Math.max(num_degrees, max_num_degrees);
    }
    last_lon = spot.lon;
  }
  return max_num_degrees / 360;
}

// Removes all existing markers and segments from the map
function clearTrack() {
  if (marker_group) {
    marker_group.clearLayers();
    map.removeLayer(marker_group);
    map.removeLayer(marker_line);
    markers = [];
    marker_group = null;
    marker_line = null;
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

function createToggleUTCLink(value) {
  return '<a href="#" class="plain_link" title="Click to toggle UTC" ' +
      'onclick="toggleUTC(); event.preventDefault()">' +
      value + '</a>';
}

function createToggleUnitsLink(value) {
  return '<a href="#" class="plain_link" title="Click to toggle units" ' +
      'onclick="toggleUnits(); event.preventDefault()">' +
      value + '</a>';
}

function toRadians(deg) {
  return deg * Math.PI / 180;
}

function toDegrees(rad) {
  return rad * 180 / Math.PI;
}

function toCartesian(lat, lon) {
  return [
      Math.cos(toRadians(lat)) * Math.cos(toRadians(lon)),
      Math.cos(toRadians(lat)) * Math.sin(toRadians(lon)),
      Math.sin(toRadians(lat))
  ];
}

function fromCartesian(x, y, z) {
  const r = Math.sqrt(x * x + y * y + z * z);
  if (r == 0) return [0, 0];
  return [
    toDegrees(Math.asin(z / r)),
    toDegrees(Math.atan2(y / r, x / r))
  ];
}

function extendPath(path, lat, lon, great_circle = false,
                    prefer_eastbound = false) {
  if (!path.length) return;
  const last_path = path[path.length - 1];
  if (!last_path.length) return;
  const [init_lat, init_lon] = last_path[last_path.length - 1];
  const delta_lon = Math.abs(lon - init_lon);
  if (delta_lon >
          180 + (prefer_eastbound ? ((lon > init_lon) ? 60 : -60) : 0)) {
    // Antimeridian crossing
    let lat180;
    if (great_circle) {
      const [x1, y1, z1] = toCartesian(init_lat, init_lon);
      const [x2, y2, z2] = toCartesian(lat, lon);
      const r = Math.abs(y1 / (y1 - y2));
      const x = x1 + r * (x2 - x1);
      const y = y1 + r * (y2 - y1);
      const z = z1 + r * (z2 - z1);
      lat180 = fromCartesian(x, y, z)[0];
    } else {
      const r = (180 - Math.abs(init_lon)) / (360 - delta_lon);
      lat180 = init_lat + r * (lat - init_lat);
    }
    extendPath(path, lat180, (lon > init_lon) ? -180 : 180, great_circle);
    path.push([[lat180, (lon > init_lon) ? 180 : -180]]);
    extendPath(path, lat, lon, great_circle);
    return;
  }
  if (great_circle && delta_lon > 2) {
    // Interpolate in cartesian space, then project back to unit sphere
    const [x1, y1, z1] = toCartesian(init_lat, init_lon);
    const [x2, y2, z2] = toCartesian(lat, lon);
    const num_steps = Math.ceil(delta_lon / 2);
    for (let i = 1; i < num_steps; i++) {
      const r = i / num_steps;
      const x = x1 + r * (x2 - x1);
      const y = y1 + r * (y2 - y1);
      const z = z1 + r * (z2 - z1);
      const step_lat_lon = fromCartesian(x, y, z);
      last_path.push(step_lat_lon);
    }
  }
  last_path.push([lat, lon]);
}

// Draws the track on the map
function displayTrack() {
  clearTrack();
  marker_group = L.featureGroup();

  for (let i = 0; i < spots.length; i++) {
    let spot = spots[i];
    if (spot.is_unattached &&
        show_unattached_param == null && params.tracker != 'unknown') {
      continue;
    }

    let marker = null;
    if (spot.grid.length < 6) {
      // Grid4
      marker = L.circleMarker([spot.lat, spot.lon],
          { radius: 5, color: 'black',
            fillColor: spot.fill ? spot.fill :
                (spot.is_invalid_gps ? '#fbb' : 'white'),
            weight: 1,
            stroke: true, fillOpacity: 1 });
    } else {
      // Grid6
      marker = L.circleMarker([spot.lat, spot.lon],
          { radius: 7, color: 'black',
            fillColor: spot.fill ? spot.fill :
                (spot.is_unattached ? 'white' : '#add8e6'),
            weight: 1,
            stroke: true, fillOpacity: 1 });
    }
    marker.spot = spot;
    marker.addTo(marker_group);
    markers.push(marker);
  }

  // Add lines between markers
  let path = [];
  let first_attached_marker;
  let last_attached_marker;
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    if (marker.spot.is_unattached) continue;
    if (last_attached_marker) {
      let lat1 = last_attached_marker.getLatLng().lat;
      let lon1 = last_attached_marker.getLatLng().lng;
      let lat2 = marker.getLatLng().lat;
      let lon2 = marker.getLatLng().lng;
    } else {
      first_attached_marker = marker;
      path = [[[marker.getLatLng().lat, marker.getLatLng().lng]]];
    }
    extendPath(path, marker.getLatLng().lat, marker.getLatLng().lng,
               false, true);
    last_attached_marker = marker;
  }

  marker_line = L.polyline(path, { color: '#00cc00' });
  marker_line.addTo(map);

  // Highlight first / last markers
  if (first_attached_marker) {
    first_attached_marker.setStyle({ fillColor: '#3cb371' });
  } else if (markers.length > 0) {
    markers[0].setStyle({ fillColor: '#3cb371' });
  }
  if (last_attached_marker) {
    last_attached_marker.setStyle({ fillColor: 'red' });
  } else if (markers.length > 0) {
    markers[markers.length - 1].setStyle({ fillColor: 'red' });
  }

  marker_group.addTo(map);

  // Populate flight synopsis
  let synopsis = document.getElementById('synopsis');
  if (last_attached_marker) {
    const last_spot = last_attached_marker.spot;
    const first_spot = first_attached_marker.spot;
    const duration = formatDuration(last_spot.ts, first_spot.ts);
    synopsis.innerHTML = `Duration: <b>${duration}</b>`;
    if (params.tracker != 'unknown') {
      // Distance is a clickable link to switch units
      const dist = computeTrackDistance(spots);
      synopsis.innerHTML += '<br>Distance: <b>' +
          createToggleUnitsLink(formatDistance(dist)) + '</b>';
      const num_laps = getNumLaps(spots);
      if (num_laps > 0) {
        synopsis.innerHTML +=
            `<br>Laps: <b>${(num_laps - 0.0004999).toFixed(3)}</b>`;
      }
    }
    const num_track_spots = markers.filter(m => !m.spot.is_unattached).length;
    synopsis.innerHTML += `<br><b>${num_track_spots}</b> track spot` +
        ((num_track_spots > 1) ? 's' : '');
    if (num_track_spots != markers.length) {
      const num_unattached_spots = markers.length - num_track_spots;
      synopsis.innerHTML +=
          `<br><b>${num_unattached_spots}</b> unattached spot` +
          ((num_unattached_spots > 1) ? 's' : '');
    }
    if ('altitude' in last_spot) {
      synopsis.innerHTML += '<br>Last altitude: <b>' +
          createToggleUnitsLink(formatAltitude(last_spot.altitude)) + '</b>';
    }
    if ('speed' in last_spot) {
      synopsis.innerHTML += '<br>Last speed: <b>' +
          createToggleUnitsLink(formatSpeed(last_spot.speed)) + '</b>';
    }
    if ('voltage' in last_spot) {
      synopsis.innerHTML +=
          `<br>Last voltage: <b>${formatVoltage(last_spot.voltage)}</b>`;
    }
    const last_age = createToggleUTCLink(
        formatDuration(new Date(), last_spot.ts));
    synopsis.innerHTML += `<br><b>(<span id='last_age'>${last_age}` +
        `</span> ago)</b>`;
    last_marker = last_attached_marker;
  } else {
    // No markers in the track
    synopsis.innerHTML = `<b>${markers.length}</b> spot` +
        ((markers.length != 1) ? 's' : '');
    if (markers.length > 0) {
      last_marker = markers[markers.length - 1];
      const last_age = formatDuration(new Date(), last_marker.spot.ts);
      synopsis.innerHTML += `<br><b>(<span id='last_age'>${last_age}` +
          `</span> ago)</b>`;
    }
  }

  displayNextUpdateCountdown();

  if (spots) {
    // Display the data view button if there are any spots
    document.getElementById('show_data_button').style.display =
        document.getElementById('map').style.display;
  }

  // Update solar isoline based on last 3 days of data
  const now = new Date();
  if (solar_isoline && !sun_elevation_param && first_attached_marker &&
      last_attached_marker.spot.ts - first_attached_marker.spot.ts >
          12 * 3600 * 1000 &&
      now - last_attached_marker.spot.ts < 14 * 86400 * 1000) {
    let min_sun_elevation = null;
    for (let i = 0; i < spots.length; i++) {
      const spot = spots[i];
      if (spot.is_unattached) continue;
      if (last_attached_marker.spot.ts - spot.ts > 3 * 86400 * 1000) continue;
      const sun_elevation = getSunElevation(spot.ts, spot.lat, spot.lon);
      min_sun_elevation = (min_sun_elevation == null) ?
          sun_elevation : Math.min(min_sun_elevation, sun_elevation);
    }
    if (min_sun_elevation > 0 && min_sun_elevation < 45) {
      solar_isoline.setElevation(min_sun_elevation);
    }
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
    marker.rx_paths = [];
    const unique_rx = [...new Map(spot.slots.flatMap(slot => slot.rx).
        map(rx => [rx.cs, rx])).values()];
    unique_rx.forEach(rx => {
      let rx_lat_lon = maidenheadToLatLon(rx.grid);
      let rx_marker = L.circleMarker(
          rx_lat_lon,
          { radius: 6, color: 'black',
            fillColor: 'yellow', weight: 1, stroke: true,
            fillOpacity: 1 }).addTo(map);
      rx_marker.on('click', function(e) {
        L.DomEvent.stopPropagation(e);
      });
      let dist = marker.getLatLng().distanceTo(rx_lat_lon);
      rx_marker.bindTooltip(
          `${rx.cs} ${formatDistance(dist)} ${rx.snr} dBm`,
          { direction: 'top', opacity: 0.8 });
      marker.rx_markers.push(rx_marker);
      let path = [[[marker.getLatLng().lat, marker.getLatLng().lng]]];
      extendPath(path, rx_lat_lon[0], rx_lat_lon[1], true);
      let rx_path = L.polyline(path,
          { weight: 2, color: 'blue', opacity: 0.4 }
          ).addTo(map).bringToBack();
      marker.rx_paths.push(rx_path);
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

  const sun_elevation = getSunElevation(now, lat, lon);
  const hrs_sunrise = (getTimeSinceSunrise(now, lat, lon) / 3600000).toFixed(1);
  const hrs_sunset = (getTimeToSunset(now, lat, lon) / 3600000).toFixed(1);

  // Update the display
  let aux_info = document.getElementById('aux_info');
  aux_info.innerHTML = `<span title="Latitude">${lat}</span>, ` +
      `<span title="Longitude">${lon}</span> | ` +
      `<span title="Sun elevation">${sun_elevation}&deg;</span> `;
  if (!isNaN(hrs_sunrise)) {
    aux_info.innerHTML +=
        `/ <span title="Hours since sunrise">${hrs_sunrise}</span>` +
        ` / <span title="Hours to sunset">${hrs_sunset}</span> hr`;
  }

  if (selected_marker) {
    // Display distance to the previously clicked marker
    let dist = e.latlng.distanceTo(selected_marker.getLatLng());
    aux_info.innerHTML += ' | <span title="Distance from selected marker">' +
        formatDistance(dist) + '</span>';
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
    marker.rx_paths.forEach(rx_path => map.removeLayer(rx_path));
    delete marker.rx_paths;
  }
}

function displaySpotInfo(marker, point) {
  let spot = marker.spot;
  let spot_info = document.getElementById('spot_info');
  spot_info.style.left = point.x + 50 + 'px';
  spot_info.style.top = point.y - 20 + 'px';
  const ts = formatTimestamp(spot.ts);
  let tz = params.use_utc ? ' UTC' : '';
  spot_info.innerHTML =
      `<span style="color: #ffc">${ts}${tz}</span>`;
  for (let i = 0; i < spot.slots.length; i++) {
    const slot = spot.slots[i];
    if (slot && !slot.is_invalid) {
      spot_info.innerHTML +=
          `<br>${i}: ${slot.cs} ${slot.grid} ${slot.power}`;
    }
  }
  if (spot.is_invalid_gps) {
    spot_info.innerHTML +=
        '<br><span style="color: red">Invalid GPS fix</span>';
  }
  spot_info.innerHTML +=
      `<br>${spot.lat.toFixed(2)}°, ${spot.lon.toFixed(2)}°`;
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
  if (spot.raw_et && !spot.et) {
    // Display opaque extended telemetry
    spot.raw_et.forEach((v, i) =>
        spot_info.innerHTML += `<br>Raw ET${i}: ${v}`);
  }
  if (spot.et) {
    // Display decoded extended telemetry
    let count = 0;
    spot.et.forEach((v, i) => {
      if (count++ < 8) {
        const [label, long_label, units, formatter] =
            getExtendedTelemetryAttributes(i);
        spot_info.innerHTML += `<br>${label}: ${formatter(v, true)}`
      }
    });
  }
  const sun_elevation = getSunElevation(spot.ts, spot.lat, spot.lon);
  spot_info.innerHTML += `<br>Sun elevation: ${sun_elevation}&deg;`
  const [num_rx, max_rx_dist, max_snr, avg_freq] = getRXStats(spot);
  spot_info.innerHTML += `<br> ${num_rx} report` +
        ((num_rx == 1) ? '' : 's');
  spot_info.innerHTML += ` | ${max_snr} dBm`;
  spot_info.innerHTML +=
      `<br> ${formatDistance(max_rx_dist)} | ${avg_freq} Hz`;

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

// Shows the 'Next update in Xm' message in the flight synopsis bar
function displayNextUpdateCountdown() {
  let update_countdown = document.getElementById('update_countdown');

  if (!next_update_ts) {
    update_countdown.innerHTML = '';
    return;
  }

  // Number of seconds until the next update
  const now = new Date();
  const remaining_time = (next_update_ts - now) / 1000;

  if (remaining_time >= 60) {
    update_countdown.innerHTML =
        `Update in <b>${Math.floor(remaining_time / 60)}m</b>`;
  } else if (remaining_time >= 0) {
    update_countdown.innerHTML =
              `Update in <b>&lt;1m</b>`;
  } else {
    // Can happen if the device went to sleep after last setTimeout()
    update_countdown.innerHTML = 'Update pending';
    if (remaining_time < -20) {
      // Retry update in 10 seconds
      const next_update_ts = new Date(now.getTime() + 10 * 1000);
      scheduleNextUpdate(next_update_ts);
    }
  }
}

function displaySpinner() {
  document.getElementById('go_button').innerHTML =
      '<div class="spinner"></div>';
}

// Cancels the next pending update, if any, set by setTimeout()
// in update()
function cancelPendingUpdate() {
  if (update_task) {
    clearTimeout(update_task);
    update_task = null;
  }
  next_update_ts = null;
  document.getElementById('update_countdown').innerHTML = '';
}

// Sets a timer to incrementally update the track at the end of
// next expected TX slot
function scheduleNextUpdate(update_ts = null) {
  cancelPendingUpdate();

  const now = new Date();

  if (!update_ts) {
    // Wait 1m 15s after the end of the next basic telemetry TX.
    // The delay is needed so that WSPR telemetry can trickle in.
    // It is randomized so that a large number of people watching
    // a flight do not all hit wspr.live servers at exactly the same
    // time.

    // Number of slots in telemetry sequence
    const num_slots = Math.max(
        ['zachtek1', 'generic1'].includes(params.tracker) ? 0 : 1,
        ...params.et_slots) + 1;
    const tx_end_minute = (params.tracker == 'custom') ?
        0 : getU4BSlotMinute(num_slots);
    const refresh_interval = (params.tracker == 'custom') ? 2 : 10;

    next_update_ts = new Date(now.getTime() +
        (tx_end_minute * 60 + 70 -
         (now.getUTCMinutes() % refresh_interval) * 60 -
         now.getUTCSeconds()) * 1000 +
         ((params.tracker == 'custom') ?
              5000 : Math.floor(Math.random() * 10000)));

    if (!next_update_ts) {
      throw new Error('Internal error');
    }

    while (next_update_ts - now < 10 * 1000) {
      next_update_ts.setMinutes(
          next_update_ts.getMinutes() + refresh_interval);
    }
  } else {
    next_update_ts = update_ts;
  }

  if (debug > 0) {
    console.log('Next update: ', next_update_ts)
  }

  displayNextUpdateCountdown();

  update_task = setTimeout(() => {
    update(true);  // update incrementally
  }, next_update_ts - now);
}

function importCustomData(data) {
  let spots = [];
  for (let i = 0; i < data.length; i++) {
    const spot = data[i];
    spot.ts = new Date(spot.ts);
    if (spot.ts < params.start_date) continue;
    if (end_date_param && spot.ts >= params.end_date) continue;
    spots.push(spot);
  }
  return spots;
}

async function updateFromCustomSource(incremental_update) {
  const url =
      `${params.cs.toUpperCase()}_${params.ch}_${params.band}.json`;
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error('HTTP error ' + response.status);
  spots = importCustomData(await response.json());
  if (debug > 2) console.log(spots);
}

async function updateFromWSPRLive(incremental_update) {
  let new_data = [];

  const u4b_extra_slots = [...new Set([1, ...params.et_slots])];

  const query = createWSPRLiveQuery(
      { 'zachtek2': [0, 1], 'generic2': [0, 1],
        'unknown': [0, 1, 2, 3, 4] }[params.tracker] || [0]  /* reg slots */,
      { 'u4b': u4b_extra_slots,
        'wb8elk': [1] }[params.tracker] || []  /* Q01 slots */,
      incremental_update);
  new_data = importWSPRLiveData(await runQuery(query));

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
  categorizeSpots();
}

// Fetch new data from wspr.live and update the map
async function update(incremental_update = false) {
  cancelPendingUpdate();

  const go_button = document.getElementById('go_button');

  try {
    // Disable the button and show progress
    go_button.disabled = true;

    displaySpinner();

    if (params.tracker == 'custom') {
      await updateFromCustomSource(incremental_update);
    } else {
      await updateFromWSPRLive(incremental_update);
    }

    num_fetch_retries = 0;

    if (document.getElementById('map').style.display == 'block') {
      // Map view active
      displayTrack();
    } else {
      // Data view is active
    }

    // Recenter the map on first load
    if (!incremental_update && last_marker) {
      map.setView(last_marker.getLatLng(), map.getZoom(), { animate: false });
    }

    const now = new Date();
    last_update_ts = now;

    if (incremental_update ||
        ((dnu_param == null) && now < params.end_date)) {
      // Only schedule updates for current flights
      scheduleNextUpdate();
    }
  } catch (error) {
    cancelPendingUpdate();
    if (error instanceof TypeError && error.message == 'Failed to fetch') {
      if (num_fetch_retries < 3) {
        const now = new Date();
        const next_update_ts = new Date(
            now.getTime() + (5 ** (num_fetch_retries + 1)) * 1000);
        scheduleNextUpdate(next_update_ts);
        console.log('Failed to fetch, retrying...');
        num_fetch_retries++;
      } else {
        alert('Network request failed. Reload the page to resume updates.');
      }
    } else {
      alert(debug > 0 ? `\n${error.stack}` : error);
    }
  } finally {
    // Restore the submit button
    go_button.disabled = false;
    go_button.textContent = 'Go';
  }
}

// Updates the URL based on current params, for bookmarking etc
function getCurrentURL() {
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
  if (ate1y_param != null) {
    url += '&ate1y';
  }
  if (units_param) {
    url += '&units=' + encodeURIComponent(
        params.units ? 'imperial' : 'metric');
  }
  if (time_param) {
    url += '&time=' + (params.use_utc ? 'utc' : 'local');
  }
  if (detail_param) {
    url += '&detail=' + encodeURIComponent(params.detail);
  }
  if (show_unattached_param != null) {
    url += '&show_unattached';
  }
  if (dnu_param != null) {
    url += '&dnu';
  }
  if (detach_grid4_param != null) {
    url += '&detach_grid4';
  }
  if (sun_elevation_param != null) {
    url += '&sun_elev=' + encodeURIComponent(sun_elevation_param);
  }
  if (et_decoders_param) {
    url += '&et_dec=' + encodeURLParameter(et_decoders_param);
  }
  if (et_labels_param) {
    url += '&et_labels=' + encodeURLParameter(et_labels_param);
  }
  if (et_long_labels_param) {
    url += '&et_llabels=' + encodeURLParameter(et_long_labels_param);
  }
  if (et_units_param) {
    url += '&et_units=' + encodeURLParameter(et_units_param);
  }
  if (et_resolutions_param) {
    url += '&et_res=' + encodeURLParameter(et_resolutions_param);
  }
  return url;
}

function setURL(url) {
  try {
    history.replaceState(null, '', url);
  } catch (error) {
    console.log('Security error triggered by history.replaceState()');
  }
}

// Similar to encodeURIComponent but does not escape ',' and ':', and
// escapes ' ' as '+'
function encodeURLParameter(param) {
  return Array.from(param).map(c =>
      (',: '.includes(c) ? c : encodeURIComponent(c)).replace(/\s/g, '+')
  ).join('');
}

// Invoked when the "Go" button is pressed or when URL params are provided
// on load
function processSubmission(e, on_load = false) {
  last_data_view_scroll_pos = 0;
  cancelPendingUpdate();
  const old_params = params;
  params = parseParameters();

  if (params) {
    if (old_params &&
        `${params.cs}.${params.ch}.${params.band}` !=
        `${old_params.cs}.${old_params.ch}.${old_params.band}`) {
      // Discard URL-only params when looking up new flights
      end_date_param = null;
      ate1y_param = null;
      dnu_param = null;
      detach_grid4_param = null;
      units_param = null;
      time_param = null;
      detail_param = null;
      et_decoders_param = null;
      et_labels_param = null;
      et_long_labels_param = null;
      et_units_param = null;
      et_resolutions_param = null;
      params = parseParameters();
    }
  }
  if (params) {
    if (debug > 0) console.log(params);
    if (!on_load) {
      setURL(getCurrentURL());
    }
    update();
    updateHistory();
  } else {
    clearTrack();
  }
}

// Table / charts

const kDataFields = [
  ['ts', {
    'color': '#7b5d45',
    'type': 'timestamp'
  }],
  ['grid', { 'align': 'left' }],
  ['gps_lock', {
    'label': 'GPS',
    'long_label': 'GPS Fix Validity'
  }],
  ['track_attachment', {
    'label': 'Track',
    'long_label': 'Track Attachment'
  }],
  ['lat', {
    'label': 'Lat',
    'color': '#0066cc',
    'type': 'angle',
    'formatter': (v, au) => `${v.toFixed(2)}` + (au ? '°' : '')
  }],
  ['lon', {
    'label': 'Lon',
    'color': '#0066cc',
    'type': 'angle',
    'formatter': (v, au) => `${v.toFixed(2)}` + (au ? '°' : '')
  }],
  ['altitude', { 'graph': {} }],
  ['vspeed', {
    'min_detail': 1,
    'label': 'VSpeed',
    'long_label': 'Vertical Speed',
    'graph': {}
  }],
  ['speed', { 'graph': {} }],
  ['cspeed', {
    'min_detail': 1,
    'type': 'speed',
    'label': 'CSpeed',
    'long_label': 'Computed Speed',
    'graph': {}
  }],
  ['voltage', { 'graph': {} }],
  ['temp', {
    'long_label': 'Temperature',
    'graph': {}
  }],
  ['power', {
    'min_detail': 1,
    'label': 'Pwr',
    'long_label': 'TX Power',
    'type': 'power',
    'graph': {},
  }],
  ['sun_elev', {
    'min_detail': 1,
    'label': 'Sun',
    'long_label': 'Sun Elevation',
    'type': 'angle',
    'graph': {},
  }],
  ['num_rx', {
    'min_detail': 1,
    'label': '# RX',
    'long_label': '# RX Reports',
    'graph': {},
  }],
  ['avg_freq', {
    'min_detail': 1,
    'label': 'Freq',
    'long_label': 'Average RX Frequency',
    'graph': {},
    'type': 'freq'
  }],
  ['max_rx_dist', {
    'min_detail': 1,
    'type': 'distance',
    'label': 'Max RX',
    'long_label': 'Max RX Distance',
    'graph': {}
  }],
  ['max_snr', {
    'min_detail': 1,
    'label': 'Max SNR',
    'graph': {},
    'type': 'snr'
  }]
];

const kDerivedFields = [
  'track_attachment', 'gps_lock', 'power', 'sun_elev', 'cspeed',
  'vspeed', 'num_rx', 'max_rx_dist', 'max_snr', 'avg_freq'];

const kFormatters = {
  'timestamp': (v, au) => formatTimestamp(v),
  'distance': formatDistance,
  'altitude': formatAltitude,
  'speed': formatSpeed,
  'vspeed': formatVSpeed,
  'voltage': formatVoltage,
  'temp': formatTemperature,
  'power': (v, au) => v + (au ? ' dBm' : ''),
  'snr': (v, au) => v + (au ? ' dB' : ''),
  'angle': (v, au) => v + (au ? '°' : ''),
  'freq': (v, au) => v + (au ? ' Hz' : '')
};

const kFetchers = {
  'distance': getDistanceInCurrentUnits,
  'altitude': getAltitudeInCurrentUnits,
  'speed': getSpeedInCurrentUnits,
  'vspeed': getVSpeedInCurrentUnits,
  'temp': getTemperatureInCurrentUnits
};

function computeDerivedData(spots) {
  let derived_data = {};
  for (const field of kDerivedFields) {
    derived_data[field] = new Array(spots.length).fill(undefined);
  }
  let last_altitude_spot = null;
  let last_grid6_spot = null;
  for (let i = 0; i < spots.length; i++) {
    const spot = spots[i];
    if (['u4b', 'generic1', 'generic2', 'unknown'].includes(params.tracker)) {
      derived_data['power'][i] = spot.slots[0]['power']
    }
    derived_data['gps_lock'][i] = spot.is_invalid_gps ? 0 : 1;
    derived_data['track_attachment'][i] = spot.is_unattached ? 0 : 1;
    if (!spot.is_unattached) {
      if (last_altitude_spot && spot.altitude) {
        // Calculate vspeed
        derived_data['vspeed'][i] =
            (spot.altitude - last_altitude_spot.altitude) * 60000 /
            ((spot.ts - last_altitude_spot.ts) || 1);
      }
      if (spot.grid.length == 6) {
        if (last_grid6_spot) {
          // Calculate cspeed (computed speed)
          let dist = getDistance(last_grid6_spot, spot) / 1000;
          let ts_delta = (spot.ts - last_grid6_spot.ts) || 1;
          let cspeed = dist * 3600000 / ts_delta;
          let min_cspeed = Math.max(dist - 4, 0) * 3600000 / ts_delta;
          let max_cspeed = (dist + 4) * 3600000 / ts_delta;
          if (cspeed > (max_cspeed - min_cspeed) * 4 ||
              max_cspeed - min_cspeed <= 10) {
            // Close enough
            derived_data['cspeed'][i] = Math.min(350, cspeed);
            last_grid6_spot = spot;
          }
        } else {
          last_grid6_spot = spot;
        }
      }
      if (spot.altitude) last_altitude_spot = spot;
    }
    derived_data['sun_elev'][i] =
        getSunElevation(spot.ts, spot.lat, spot.lon);
    [derived_data['num_rx'][i], derived_data['max_rx_dist'][i],
     derived_data['max_snr'][i], derived_data['avg_freq'][i]] =
        getRXStats(spot);
  }
  for (const field of kDerivedFields) {
    if (derived_data[field].every(v => v == undefined)) {
      delete derived_data[field];
    }
  }
  // Only keep power and track attachment if some values are different
  for (const field of ['power', 'track_attachment']) {
    if (derived_data[field] &&
        new Set(derived_data[field].filter(v => v != undefined)).size < 2) {
      delete derived_data[field];
    }
  }
  // Only keep track attachment in detailed view or if the
  // show_unattached parameter is used
  if (!params.detail && show_unattached_param == null) {
    delete derived_data['track_attachment'];
  }
  // Only keep gps_lock if some values are set to 0
  if (derived_data['gps_lock'] &&
      derived_data['gps_lock'].every(v => v == 1)) {
    delete derived_data['gps_lock'];
  }

  return derived_data;
}

function extractExtendedTelemetryData(spots) {
  let et_data = [];
  for (let i = 0; i < spots.length; i++) {
    const spot = spots[i];
    if (spot.raw_et) {
      spot.raw_et.forEach((v, slot) => {
        let field = `raw_et${slot}`;
        let field_data = et_data[field];
        if (!field_data) {
          field_data = new Array(spots.length).fill(undefined);
          et_data[field] = field_data;
        }
        field_data[i] = v;
      });
    }
    if (spot.et) {
      spot.et.forEach((v, slot) => {
        let field = `et${slot}`;
        let field_data = et_data[field];
        if (!field_data) {
          field_data = new Array(spots.length).fill(undefined);
          et_data[field] = field_data;
        }
        field_data[i] = v;
      });
    }
  }
  return et_data;
}

function createTableCell(type, content, align = null, color = null,
                         format = null) {
  const cell = document.createElement(type);
  if (format == 'html') {
    cell.innerHTML = content;
  } else {
    cell.textContent = content;
  }
  if (align) {
    cell.style.textAlign = align;
  }
  if (color) {
    cell.style.color = color;
  }
  return cell;
}

function createDataViewButton(text, action) {
  const button = document.createElement('button');
  button.classList.add('data_view_button');
  button.textContent = text;
  button.addEventListener('click', action);
  return button;
}

function clearDataView() {
  let data_view = document.getElementById('data_view');
  if (data_view.u_plots) {
    for (let u_plot of data_view.u_plots) {
      u_plot.destroy();
    }
    delete data_view.u_plots;
  }
  data_view.innerHTML = '';
}

function getExtendedTelemetryAttributes(i) {
  let label = `ET${i}`;
  if (params.et_spec['labels'] && params.et_spec['labels'][i]) {
    label = params.et_spec['labels'][i];
  }
  let long_label = label;
  if (params.et_spec['long_labels'] && params.et_spec['long_labels'][i]) {
    long_label = params.et_spec['long_labels'][i];
  }
  let units;
  if (params.et_spec['units'] && params.et_spec['units'][i]) {
    units = params.et_spec['units'][i];
  }
  let resolution;
  if (params.et_spec['resolutions'] && params.et_spec['resolutions']) {
    resolution = params.et_spec['resolutions'][i];
  }
  let formatter = (v, au) => {
    if (resolution != null) v = v.toFixed(resolution);
    if (units && au) v += units;
    return v;
  };
  return [label, long_label, units, formatter];
}

function createWSPRViewLink(i) {
  return `<a href="#" class="plain_link" title="Click to toggle WSPR view" ` +
      `onclick="toggleWSPRView(${i}); event.preventDefault()">📄</a>`;
}

function toggleWSPRView(i) {
  const row = document.getElementById(`row_${i}`);
  if (!row) return;
  let wspr_row = document.getElementById(`wspr_row_${i}`);
  if (wspr_row) {
    wspr_row.parentNode.removeChild(wspr_row);
    return;
  }
  wspr_row = document.createElement('tr');
  wspr_row.id = `wspr_row_${i}`;
  const wspr_cell = document.createElement('td');
  wspr_cell.classList.add('wspr_cell');
  wspr_cell.colSpan = row.cells.length;
  wspr_row.appendChild(wspr_cell);
  row.parentNode.insertBefore(wspr_row, row.nextSibling);
  const field_align = [0, 0, 0, 1, 0, 0, 1, 1, 1];
  const wspr_data = [
      ['Time', 'TXCall', 'TXGrid', 'Pwr', 'RXCall', 'RXGrid',
       'SNR', 'Dist', 'Freq'],
  ];
  const blank_row = Array(field_align.length).fill('');
  for (const slot of spots[i].slots) {
    if (!slot) continue;
    wspr_data.push(blank_row);
    for (const rx of slot.rx) {
       if (!rx) continue;
       const dist = L.latLng([spots[i].lat, spots[i].lon]).distanceTo(
           maidenheadToLatLon(rx.grid));
       wspr_data.push([
           formatTimestamp(slot.ts || spots[i].ts).slice(11),
           slot.cs, slot.grid, slot.power,
           rx.cs, rx.grid, rx.snr, formatDistance(dist, false), rx.freq]);
    }
  }
  const max_widths = wspr_data[0].map((_, j) =>
      Math.max(...wspr_data.map(r => r[j].toString().length)));
  for (const r of wspr_data) {
    wspr_cell.textContent +=
        r.map((c, j) => (field_align[j] ?
            String.prototype.padStart : String.prototype.padEnd)
                .call(c, max_widths[j], r[0] == '' ? '-' : ' '))
                    .join('  ') + '\n';
  }
}

function showDataView() {
  // Hide map UI
  document.getElementById('map').style.display = 'none';
  document.getElementById('show_data_button').style.display = 'none';
  document.getElementById('control_panel').style.display = 'none';
  clearTrack();
  clearDataView();

  let data_view = document.getElementById('data_view');
  data_view.style.display = 'block';
  document.getElementById('close_data_button').style.display = 'block';

  let div = document.createElement('div');
  div.id = 'data_view_wrapper';

  let notice = document.createElement('div');
  if (is_mobile) {
    notice.innerHTML = '&lt;-- Tap here to close. ' +
        'Charts are touch-enabled, supporting pan and zoom gestures.';
  } else {
    notice.innerHTML = '⟵ Click here to close. To <b>zoom in</b> ' +
        'on charts, click and drag. To <b>zoom out</b>, double click.';
  }
  notice.classList.add('notice');
  notice.style.marginLeft = '40px';
  div.appendChild(notice);

  let supplementary_data =
      { ...computeDerivedData(spots),
        ...extractExtendedTelemetryData(spots) };

  // Find the union of all present fields
  const present_spot_fields = Object.fromEntries(
      [...new Set(spots.flatMap(Object.keys))].map(f => [f, 1]));
  const present_supplementary_fields = Object.fromEntries(
      Object.keys(supplementary_data).map(f => [f, 1]));
  let present_fields = Object.fromEntries(
      [...Object.entries(present_spot_fields),
       ...Object.entries(present_supplementary_fields)]);

  // Prefill the table with row numbers
  let table_headers = ['#'];
  let long_headers = ['#'];
  let table_data = [Array.from(
      { length: spots.length }, (_, i) => i + 1)];
  let field_specs = [{}];
  let table_formatters = [null];
  let table_fetchers = [null];

  let graph_labels = [];
  let graph_data_indices = [];  // indices into table_data
  const ts_values = spots.map(spot => spot.ts.getTime() / 1000);

  let can_show_more = false;
  let can_show_less = false;

  // Add ET to the list of possible fields
  let data_fields = [...kDataFields];
  for (let i = 1; i < 5; i++) {
    if (supplementary_data[`raw_et${i}`]) {
      data_fields.push(
          [`raw_et${i}`,
           { 'color': '#7b5d45', 'label': `Raw ET${i}` }]);
    }
  }
  for (let i = 0; i < 32; i++) {
    if (supplementary_data[`et${i}`]) {
      const [label, long_label, units, formatter] =
          getExtendedTelemetryAttributes(i);
      data_fields.push([`et${i}`,
        { 'label': label, 'long_label': long_label, 'units': units,
          'formatter': formatter, 'graph': {} }]);
    }
  }

  // Iterate through possible fields
  for (const [field, spec] of data_fields) {
    if (!present_fields[field]) continue;
    if ((spec.min_detail || 0) > params.detail) {
      can_show_more = true;
      continue;
    }

    if (spec.min_detail || 0) {
      can_show_less = true;
    }

    // Attach the correct formatter / fetcher
    let formatter = null;
    let fetcher = null;
    let type = spec.type || field;
    if (spec.formatter) {
      formatter = spec.formatter;
    } else {
      if (kFormatters[type]) {
        formatter = kFormatters[type];
      }
    }
    if (spec.fetcher) {
      fetcher = spec.fetcher;
    } else {
      if (kFetchers[type]) {
        fetcher = kFetchers[type];
      }
    }
    table_formatters.push(formatter);
    table_fetchers.push(fetcher);

    // Add table / graph labels
    const default_label = (field == 'ts') ?
        (params.use_utc ? 'UTC Time' : 'Local Time') :
        field[0].toUpperCase() + field.slice(1);
    let table_header = spec['label'] || default_label;
    let long_label =
        spec['long_label'] || spec['label'] || default_label;
    let units = spec['units'] ||
        (kUnitInfo[type] && kUnitInfo[type][params.units][0]);
    if (units) {
      long_label += ' (' + units.trim() + ')';
      table_header += '\n(' + units.trim() + ')';
    }
    table_headers.push(table_header);
    long_headers.push(long_label);
    field_specs.push(spec);
    if (spec.graph) {
      graph_labels.push(long_label);
      graph_data_indices.push(table_data.length);
    }

    // Data for this field
    let field_data;
    if (supplementary_data[field]) {
      field_data = supplementary_data[field];
    } else {
      field_data = spots.map(spot =>
          spot[field] == undefined ?
              undefined : (spec.fetcher ?
                  spec.fetcher(spot[field]) : spot[field]));
    }
    table_data.push(field_data);
  }

  // Add raw WSPR data column
  // table_headers.push('🛈');
  table_headers.push('WSPR');
  long_headers.push('Raw WSPR Data');
  table_data.push(Array.from(
      { length: spots.length }, (_, i) => createWSPRViewLink(i)));
  field_specs.push({ align: 'center', format: 'html' });
  table_formatters.push(null);
  table_fetchers.push(null);

  // Add graphs
  data_view.u_plots = [];  // references to created uPlot instances
  for (let i = 0; i < graph_data_indices.length; i++) {
    let index  = graph_data_indices[i];
    const opts = {
      tzDate: ts => params.use_utc ?
          uPlot.tzDate(new Date(ts * 1e3), 'Etc/UTC') :
          uPlot.tzDate(new Date(ts * 1e3)),
      cursor: {
        drag: { x: true, y: true, uni: 20 },
        sync: { key: 1, setSeries: true, scales: ['x'] }
      },
      width: 600,
      height: 300,
      plugins: [touchZoomPlugin()],
      series: [{
        label: params.use_utc ? 'UTC Time' : 'Local Time',
        value: '{YYYY}-{MM}-{DD} {HH}:{mm}'
      }, {
        label: graph_labels[i],
        stroke: 'blue',
        value: (self, value) => value
      }],
      scales: [{ label: 'x' }],
      axes: [{
        values: [
          // inc, default, year, month, day, hour, min, sec, mode
          [3600 * 24 * 365, '{YYYY}', null, null, null, null, null,
           null, 1],
          [3600 * 24 * 28, '{MMM}', '\n{YYYY}', null, null, null, null,
           null, 1],
          [3600 * 24, '{M}/{D}', '\n{YYYY}', null, null, null, null,
           null, 1],
          [3600, '{HH}', '\n{YYYY}/{M}/{D}', null, '\n{M}/{D}', null, null,
           null, 1],
          [60, '{HH}:{mm}', '\n{YYYY}/{M}/{D}', null, '\n{M}/{D}', null,
           null, null, 1],
          [1, ':{ss}', '\n{YYYY}/{M}/{D} {HH}:{mm}', null,
           '\n{M}/{D} {HH}:{mm}', null, '\n{HH}:{mm}', null, 1]
        ]
      }, { size: 52 }]
    };

    const fetcher = table_fetchers[index] || ((v) => v);
    data_view.u_plots.push(
        new uPlot(opts, [ts_values, table_data[index].map((v, idx) =>
            (v == undefined ||
             (spots[idx].is_unattached && params.tracker != 'unknown')) ?
                undefined : fetcher(v))], div));
  }

  div.appendChild(document.createElement('br'));

  if (params.detail != null && (can_show_less || can_show_more)) {
    div.appendChild(
        createDataViewButton(params.detail ? 'Show Less' : 'Show More',
                             toggleDataViewDetail));
  }
  div.appendChild(
      createDataViewButton('Toggle UTC', toggleUTC));
  div.appendChild(
      createDataViewButton('Toggle Units', toggleUnits));
  // When exporting CSV, omit the last column, which is a link to
  // raw WSPR data
  div.appendChild(
      createDataViewButton('Export CSV',
          () => downloadCSV(long_headers.slice(0, -1),
              table_data.slice(0, -1), table_formatters)));
  div.appendChild(
      createDataViewButton('Get Raw Data', () => downloadJSON(spots)));

  // Populate the table
  let table = document.createElement('table');
  table.classList.add('data_table');
  // Fill the header
  let row = document.createElement('tr');
  for (let i = 0; i < table_headers.length; i++) {
    let th = createTableCell('th', table_headers[i]);
    th.title = long_headers[i];
    row.appendChild(th);
  }
  table.appendChild(row);

  for (let i = table_data[0].length - 1; i >= 0; i--) {
    let row = document.createElement('tr');
    row.id = `row_${i}`;
    for (let j = 0; j < table_data.length; j++) {
      let value = table_data[j][i];
      if (value == null) {
        value = '';
      } else {
        if (table_formatters[j]) {
          value = table_formatters[j](value, false /* append units */);
        }
      }
      const spec = field_specs[j];
      row.appendChild(createTableCell(
          'td', value, spec.align, spec.color, spec.format));
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

function toggleDataViewDetail() {
  params.detail ^= 1;
  showDataView();

  // Remember user preference
  localStorage.setItem('detail', params.detail);

  setURL(getCurrentURL());
}

function getDownloadFilename(ext) {
  const raw_ch = document.getElementById('ch').value.trim().toUpperCase();
  return params.cs.toUpperCase().replace(/\//g, '_') + '_' + raw_ch + '_' +
      formatTimestamp(params.start_date).slice(0, 10).replace(/-/g, '') + '-' +
      formatTimestamp(params.end_date).slice(0, 10).replace(/-/g, '') +
      '.' + ext;
}

function downloadJSON(spots) {
  const json = JSON.stringify(spots,
    (key, value) => (value == undefined ? null : value));
  downloadFile(json, 'application/json', getDownloadFilename('json'));
}

function downloadCSV(headers, data, formatters) {
  let rows = [headers];
  for (let i = data[0].length - 1; i >= 0; i--) {
    let row = [];
    for (let j = 0; j < data.length; j++) {
      let value = data[j][i];
      if (value == null) {
        value = '';
      } else {
        if (formatters[j]) {
          value = formatters[j](value, false /* append_units */);
        }
      }
      row.push(value);
    }
    rows.push(row);
  }
  let csv = rows.map(row =>
      row.map(v => {
        v = String(v).replace(/"/g, '""');
        return /[",\r\n]/.test(v) ? `"${v}"` : v;
      }).join(',')
  ).join('\n');
  downloadFile(csv, 'text/csv', getDownloadFilename('csv'))
}

function downloadFile(data, mime_type, filename) {
  const blob = new Blob([data], { type: mime_type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function closeDataView() {
  // Hide data view UI
  clearDataView();
  data_view.style.display = 'none';
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
  document.getElementById('cs').value = getURLParameter('cs');
  document.getElementById('ch').value = getURLParameter('ch');
  let band_param = getURLParameter('band');
  if (!band_param || !(band_param in kWSPRBandInfo)) {
    band_param = '20m';
  }
  document.getElementById('band').value = band_param;
  let start_date_param = getURLParameter('start_date');
  if (!start_date_param) {
    // Prefill to a date 1 month in the past
    start_date_param = formatTimestamp(
        new Date(new Date().setUTCMonth(new Date().getUTCMonth() - 1)))
        .slice(0, 10);
  }
  document.getElementById('start_date').value = start_date_param;
}

function parseExtendedTelemetrySpec() {
  if (!et_decoders_param) return null;
  if (!/^[0-9ets,:_~.-]+$/.test(et_decoders_param)) return null;
  let decoders = [];
  let num_extractors = 0;
  for (const decoder_spec of et_decoders_param.toLowerCase().split('~')) {
    let header_divisor = 1;
    let [filters_spec, extractors_spec] = decoder_spec.split('_');
    // Parse filters
    let filters = [];
    if (filters_spec) {
      for (const filter_spec of filters_spec.split(',')) {
        let filter = filter_spec.split(':');
        if (filter.length == 1 && filter[0] == 'et3') {
          if (header_divisor != 1) return null;
          filters.push([1, 4, 3]);
          filters.push(['s', 2]);
          header_divisor = 4;
          continue;
        } else if (filter.length == 2 && ['et0', 's'].includes(filter[0])) {
          filter[1] = Number(filter[1]);
          if (!Number.isInteger(filter[1]) || filter[1] < 0) return null;
          if (filter[0] == 'et0') {
            if (header_divisor != 1) return null;
            filters.push([1, 4, 0]);
            filters.push([4, 16, filter[1]]);
            filters.push([64, 5, 's']);
            header_divisor = 320;
            continue;
          }
        } else if (filter.length == 4 && filter[0] == 't') {
          filter = [filter[0], Number(filter[1]), Number(filter[2]),
                    Number(filter[3])];
          if (!filter.slice(1).every(v => Number.isInteger(v)) ||
              filter[1] <= 0 || filter[2] <= 1 || filter[3] < 0) {
            return null;
          }
        } else if (filter.length == 3) {
          filter = [Number(filter[0]), Number(filter[1]),
                    filter[2] == 's' ? 's' : Number(filter[2])];
          if (!filter.every(v => Number.isInteger(v) || v == 's') ||
              filter[0] <= 0 || filter[1] <= 1 || filter[2] < 0) {
            return null;
          }
        } else {
          return null;
        }
        filters.push(filter);
      }
    }
    // Parse extractors
    let extractors = [];
    let next_divisor = header_divisor;
    if (extractors_spec) {
      for (const extractor_spec of extractors_spec.split(',')) {
        let extractor = extractor_spec.split(':').map(Number);
        if (extractor.length == 3) {
          extractor.unshift(next_divisor);
        }
        if (extractor.length != 4) return null;
        for (let i = 0; i < extractor.length; i++) {
          if ((i <= 1) && (!Number.isInteger(extractor[i]) ||
              extractor[i] < 1)) {
            return null;
          }
          if (Number.isNaN(extractor[2])) return null;
          if (Number.isNaN(extractor[3]) || extractor[3] <= 0) return null;
          next_divisor = extractor[0] * extractor[1];
        }
        extractors.push(extractor);
      }
    }
    decoders.push([filters, extractors]);
    num_extractors += extractors.length;
  }
  if (!decoders) return null;
  // Parse optional params
  let labels;
  let long_labels;
  let units;
  let resolutions;
  if (et_labels_param) {
    if (!/^[0-9a-z ,#_]+$/i.test(et_labels_param)) return null;
    labels = et_labels_param.split(',');
    if (!labels.every(v => v.length <= 32)) return null;
  }
  if (et_long_labels_param) {
    if (!/^[0-9a-z ,#_]+$/i.test(et_long_labels_param)) return null;
    long_labels = et_long_labels_param.split(',');
    if (!long_labels.every(v => v.length <= 64)) return null;
  }
  if (et_units_param) {
    if (!/^[a-z ,/°]+$/i.test(et_units_param)) return null;
    units = et_units_param.split(',');
    if (!units.every(v => v.length <= 8)) return null;
  }
  if (et_resolutions_param) {
    resolutions = et_resolutions_param.split(',').map(
        v => v == '' ? null : Number(v));
    if (!resolutions.every(
        v => v == null || (Number.isInteger(v) && v >= 0 && v <= 6))) {
      return null;
    }
  }
  let spec = { 'decoders': decoders };
  if (labels) spec['labels'] = labels;
  if (long_labels) spec['long_labels'] = long_labels;
  if (units) spec['units'] = units;
  if (resolutions) spec['resolutions'] = resolutions;
  return spec;
}

// Entry point
function start() {
  if (!location.search.includes('?') &&
      localStorage.getItem('load_last') == '1') {
    const history = loadHistory();
    if (history.length > 0) {
      setURL(history[0].url);
    }
  }

  // Prevent bots from loading flights
  if (!/bot|spider|crawler/i.test(navigator.userAgent)) {
    initializeFormFields();
  }

  end_date_param = getURLParameter('end_date');
  ate1y_param = getURLParameter('ate1y');
  dnu_param = getURLParameter('dnu');
  detach_grid4_param = getURLParameter('detach_grid4');
  show_unattached_param = getURLParameter('show_unattached');
  units_param = getURLParameter('units');
  time_param = getURLParameter('time');
  detail_param = getURLParameter('detail');
  sun_elevation_param =
      getURLParameter('sun_el') || getURLParameter('sun_elev');
  et_decoders_param = getURLParameter('et_dec');
  et_labels_param = getURLParameter('et_labels');
  et_long_labels_param = getURLParameter('et_llabels');
  et_units_param = getURLParameter('et_units');
  et_resolutions_param = getURLParameter('et_res');

  // On mobile devices, allow for a larger click area
  let click_tolerance = 0;
  const agent_regexp = new RegExp(
      'Mobi|Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop|' +
      'BlackBerry|BB|PlayBook');
  if (agent_regexp.test(navigator.userAgent)) {
    click_tolerance = 15;
    is_mobile = true;
  }

  // Recall previously stored map location and zoom level
  let init_lat = localStorage.getItem('lat') || 40;
  let init_lon = localStorage.getItem('lon') || -100;
  let init_zoom_level = localStorage.getItem('zoom_level') || 2;

  // Make the map div visible (if not already)
  document.getElementById('map').style.display = 'block';

  // Initialize the map
  map = L.map('map',
      { renderer : L.canvas({tolerance: click_tolerance })});

  // Use local English-label tiles for lower levels
  L.tileLayer(
      'osm_tiles/{z}/{x}/{y}.png',
      { maxZoom: 6,
        attribution:
            '<a href="https://github.com/wsprtv/wsprtv.github.io">' +
            'WSPR TV</a> | &copy; <a href="https://www.openstreetmap.org' +
            '/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);

  // Use OSM-hosted tiles for higher levels
  L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { minZoom: 7, maxZoom: 16,
        attribution:
            '<a href="https://github.com/wsprtv/wsprtv.github.io">' +
            'WSPR TV</a> | &copy; <a href="https://www.openstreetmap.org' +
            '/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);

  map.setView([init_lat, init_lon], init_zoom_level);

  // Add day / night visualization and the scale indicator
  let terminator = L.terminator(
      { opacity: 0, fillOpacity: 0.3, interactive: false }).addTo(map);

  let sun_elevation = Number(sun_elevation_param);
  solar_isoline = (!sun_elevation_param || sun_elevation) ?
      L.solar_isoline({
          elevation: sun_elevation, dashArray: '8,5',
          opacity: 0.4 }).addTo(map) : null;

  L.control.scale().addTo(map);

  // Draw the antimeridian
  L.polyline([[90, 180], [-90, 180]],
      { color: 'gray', weight: 2, dashArray: '8,5', opacity: 0.4 })
      .addTo(map).bringToBack();
  L.polyline([[90, -180], [-90, -180]],
      { color: 'gray', weight: 2, dashArray: '8,5', opacity: 0.4 })
      .addTo(map).bringToBack();

  // Grey out areas beyond the antimeridian to indicate there is no
  // data there
  L.polygon([[[-90, -1440], [90, -1440], [90, -180], [-90, -180]]], {
    fillColor: 'black', fillOpacity: 0.12, stroke: false,
    interactive: false
  }).addTo(map);

  L.polygon([[[-90, 180], [90, 180], [90, 1440], [-90, 1440]]], {
    fillColor: 'black', fillOpacity: 0.12, stroke: false,
    interactive: false
  }).addTo(map);

  // Draw the equator
  L.polyline([[0, -180], [0, 180]],
      { color: 'gray', weight: 1, opacity: 0.2 })
      .addTo(map).bringToBack();

  // On pan / zoom, save map location and zoom level
  map.on('moveend', function() {
    const center = map.getCenter();
    localStorage.setItem('lat', center.lat);
    localStorage.setItem('lon', center.lng);

    // Readjust the map when moving across the antimeridian
    const wrapped_center = map.wrapLatLng(center);
    if (Math.abs(center.lng - wrapped_center.lng) > 1e-8) {
      map.setView(wrapped_center, map.getZoom(), { animate: false });
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

  // Handle special menu selections
  document.getElementById('band').addEventListener('change', function () {
    if (this.value == 'user_guide') {
      window.open('docs/user_guide.html', '_new');
    } else if (this.value == 'history') {
      window.location.href = 'tools/history.html';
    } else if (this.value == 'channel_map') {
      window.open('tools/channel_map.html', '_new');
    } else if (this.value == 'et_wizard') {
      window.open('tools/et_wizard.html', '_new');
    } else {
      return;
    }
    this.value = params ? params.band : "20m";
  });

  // Handle clicks on the "Show data" button
  document.getElementById('show_data_button').addEventListener(
      'click', showDataView);

  // Handle clicks on the "Close data" button
  document.getElementById('close_data_button').addEventListener(
      'click', closeDataView);

  // Submit the form if parameters were provided in the URL
  if (document.getElementById('cs').value) {
    processSubmission(null, true /* on_load */);
  }

  // Update UI elements that change over time (e.g. "X min ago" messages)
  setInterval(() => {
    displayNextUpdateCountdown();

    // Update the "Last ago" timestamp
    let last_age = document.getElementById('last_age');
    if (last_age && last_marker) {
      last_age.innerHTML = createToggleUTCLink(
          formatDuration(new Date(), last_marker.spot.ts));
    }

    // Update the terminator (day / night overlay) periodically
    terminator.setTime(new Date());
    if (solar_isoline) solar_isoline.setTime(new Date());
  }, 30 * 1000);
}

start();
