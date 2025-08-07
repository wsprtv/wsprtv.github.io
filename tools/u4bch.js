// U4B Channel Map
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
let params;  // form / URL params
let debug = 0;  // controls console logging

let is_mobile;  // running on a mobile device

// WSPR band info. For each band, the value is
// [U4B start minute offset, WSPR Live band id].
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

// Extracts a parameter value from the URL
function getUrlParameter(name) {
  const regex = new RegExp('[?&]' + name + '(=([^&]*)|(?=[&]|$))');
  const match = regex.exec(location.search);
  if (!match) return null;
  return match[2] != undefined ?
      decodeURIComponent(match[2].replace(/\+/g, ' ')) : '';
}

// Parses and validates input params, returning them as a dictionary.
// Alerts the user and returns null if validation failed.
function parseParams() {
  const band = document.getElementById('band').value.trim();
  if (!(band in kWSPRBandInfo)) {
    alert('Invalid band');
    return null;
  }

  const num_days_param = document.getElementById('num_days').value.trim();
  if (!num_days) {
    num_days = 30;
  } else {
    num_days = Number(num_days_param);
  }
  if (![3, 7, 14, 30].includes(num_days)) {
    alert('Invalid num_days');
    return null;
  }

  // Successful validation
  return { 'band': band, 'num_days': num_days };
}

// Returns 2 U4B channels for given bucket
function getU4BChannels(bucket) {
  const [start_minute_offset, _1, _2] = kWSPRBandInfo[params.band];
  const ch = ['0', '1', 'Q'].indexOf(bucket[0].toUpperCase()) * 200 +
      Number(bucket[1]) * 20 +
      ((Number(bucket[2]) + 10 - start_minute_offset) % 10) / 2 +
      (bucket[3] == '1' ? 10 : 0);
  return [ch, ch + 5];
}

// Displays progress by number of dots inside the button
function displayProgress(stage) {
//  document.getElementById('go_button').textContent = '.'.repeat(stage);
  document.getElementById('go_button').textContent = '●'.repeat(stage);
}

// Parses a UTC timestamp string like '2025-07-15 12:00:00' to a Date() object
function parseTimestamp(ts_str) {
  ts = new Date(Date.parse(ts_str.replace(' ', 'T') + 'Z'));
  if (!ts || isNaN(ts.getTime())) return null;
  return ts;
}

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

// Creates wspr.live query for fetching channel info.
// Do not change this query unless you understand the impact
// on wpsr.live servers.
function createWSPRLiveQuery() {
  const [_, wspr_live_band, start_freq] = kWSPRBandInfo[params.band];
  return `
    SELECT /* wsprtv.github.io */
      concat(cs1, cs3, tx_minute, freq_lane) AS bucket,
      COUNT(*) AS num_hours, MAX(last_ts) AS last_ts
    FROM (
      SELECT
        toStartOfHour(time) AS hour,
        substring(tx_sign, 1, 1) AS cs1,
        substring(tx_sign, 3, 1) AS cs3,
        (toMinute(time) + 8) % 10 AS tx_minute,
        floor((avg_freq - ${start_freq}) / 100) AS freq_lane,
        MAX(time) as last_ts,
        COUNT(*) AS num_tx
      FROM (
        SELECT
          time, tx_sign, tx_loc, power,
          AVG(frequency) AS avg_freq
        FROM wspr.rx
        WHERE
          match(tx_sign, '^[Q01]') != 0 AND
          time > subtractDays(now(), ${params.num_days}) AND
          band = ${wspr_live_band} AND
          (frequency BETWEEN ${start_freq} AND ${start_freq + 200}) AND
          (toInt8(substring(tx_loc, 4, 1)) +
           (power IN (0, 7, 13, 20, 27, 33, 40, 47, 53, 60))) % 2 = 0
        GROUP BY time, tx_sign, tx_loc, power
      )
      WHERE
        avg_freq <= ${start_freq + 80} OR avg_freq >= ${start_freq + 120}
      GROUP BY hour, cs1, cs3, tx_minute, freq_lane
    )
    WHERE num_tx > 1
    GROUP BY bucket
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

// Imports data from wspr.live for further processing
function importWSPRLiveData(data) {
  let bucket_data = {};
  for (let i = 0; i < data.length; i++) {
    let row = data[i];
    bucket_data[row[0]] = [row[1], parseTimestamp(row[2])];
  }
  return bucket_data;
}

// Fetch new data from wspr.live and update the map
async function update() {
  const go_button = document.getElementById('go_button');

  try {
    // Disable the button and show progress
    go_button.disabled = true;
    clearTable();

    let stage = 1;
    displayProgress(stage++);

    const query = createWSPRLiveQuery();

    bucket_data = importWSPRLiveData(await runQuery(query));
    if (debug > 1) console.log(bucket_data);

    showTable(bucket_data);

  } catch (error) {
    if (error instanceof TypeError) {
      alert('WSPR Live request failed. ' +
            'Refresh the page to resume updates.');
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
function updateURL() {
  try {
    let url = '?band=' +
        encodeURIComponent(document.getElementById('band').value);
    url += '&num_days=' +
        encodeURIComponent(document.getElementById('num_days').value);
    history.replaceState(null, '', url);
  } catch (error) {
    console.log('Security error triggered by history.replaceState()');
  }
}

// Invoked when the "Go" button is pressed or when URL params are provided
// on load
function processSubmission(e, on_load = false) {
  params = parseParams();
  if (params) {
    if (debug > 0) console.log(params);
    if (!on_load) {
      updateURL();
    }
    update();
  } else {
    clearTable();
  }
}

function createTableCell(type, content) {
  const cell = document.createElement(type);
  cell.textContent = content;
  return cell;
}

function createBucketSpan(bucket, data) {
  const [count, last_ts] = data;
  const span = document.createElement('span');
  span.classList.add('bucket_span');
  span.textContent = count;
  if (count == 0) {
    span.style.backgroundColor = '#00ab66';
  } else if (count < 5) {
    span.style.backgroundColor = '#ffffb0';
  } else if (count < 15) {
    span.style.backgroundColor = '#ffff80';
  } else if (count < 40) {
    span.style.backgroundColor = 'salmon';
  } else {
    span.style.backgroundColor = 'red';
  }

  let info = null;

  span.addEventListener('mouseenter', () => {
    info = document.createElement('div');
    info.id = 'info';
    const [ch1, ch2] = getU4BChannels(bucket);
    info.innerHTML = `<b>U4B Ch</b>: ${ch1}, ${ch2}`;
    info.innerHTML +=
        `<br><b>Special CS</b>: ${bucket[0].toUpperCase()}*${bucket[1]}*`;
    info.innerHTML += `<br><b>Reg CS Minute</b>: ${bucket[2]}`;
    info.innerHTML += '<br><b>Freq</b>: ' +
        (bucket[3] == '1' ? '&gt;=120' : '&lt;= 80');
    if (count == 0) {
      info.innerHTML += '<br><span style="color: #cefad0">Free Channel</span>';
    } else {
      info.innerHTML += `<br><b>Use:</b> ${count} hour` +
          ((count > 1) ? 's' : '');
      const duration = formatDuration(new Date(), last_ts);
      info.innerHTML += '<br><b>Last</b>: ' + duration + ' ago';
    }
    span.appendChild(info);
  });

  span.addEventListener('mouseleave', () => {
    if (info && span.contains(info)) {
      span.removeChild(info);
    }
    info = null;
  });

  return span;
}

function clearTable() {
  let table = document.getElementById('table');
  table.innerHTML = '';
}

function showTable(bucket_data) {
  clearTable();
  let div = document.getElementById('table');

  // Prefill the table with row numbers
  let table_headers = ['⬇️ CS1/3', ':00', ':02', ':04', ':06', ':08'];

  // Populate the table
  let table = document.createElement('table');
  table.classList.add('data_table');
  // Fill the header
  let row = document.createElement('tr');
  for (let i = 0; i < table_headers.length; i++) {
    let th = createTableCell('th', table_headers[i]);
    if (i > 1) {
      th.title = 'Regular Callsign TX Minute';
    }
    row.appendChild(th);
  }
  table.appendChild(row);

  for (let i = 0; i < 30; i++) {
    let row = document.createElement('tr');
    const cs13 = ['0', '1', 'Q'][Math.floor(i / 10)] + String(i % 10);
    for (let j = 0; j < 6; j++) {
      let cell = document.createElement('td');
      if (j == 0) {
        cell.textContent = cs13;
        cell.title = 'Special Callsign 1st / 3rd Characters';
      } else {
        const start_minute = (j - 1) * 2;
        const key = cs13 + start_minute;
        const bucket1 = cs13 + start_minute + '0';
        const data1 = bucket_data[bucket1] || [0, null];
        cell.appendChild(createBucketSpan(bucket1, data1));
        const bucket2 = cs13 + start_minute + '1';
        const data2 = bucket_data[bucket2] || [0, null];
        cell.appendChild(createBucketSpan(bucket2, data2));
      }
      row.appendChild(cell);
    }
    table.appendChild(row);
  }
  div.appendChild(table);
  div.appendChild(document.createElement('br'));
  let span = document.createElement('span');
  span.innerHTML = `${300 - Object.keys(bucket_data).length} of 300 ` +
      'channels are free' +
      '<br><br>This table shows how many unique hourly slots ' +
      'contained U4B basic telemetry for each channel.';
  div.appendChild(span);
}

// Prefills form fields from URL decorators
function initializeFormFields() {
  let band_param = getUrlParameter('band');
  if (!band_param || !(band_param in kWSPRBandInfo)) {
    band_param = '20m';
  }
  document.getElementById('band').value = band_param;

  let num_days_param = getUrlParameter('num_days');
  if (!num_days_param || !['3', '7', '14', '30'].includes(num_days_param)) {
    num_days_param = '30';
  }
  document.getElementById('num_days').value = num_days_param;
}

// Entry point
function Run() {
  initializeFormFields();

  // Handle special menu selections
  document.getElementById('band').addEventListener('change', function () {
    if (this.value == 'help') {
      window.open('/docs/user_guide.html', '_new');
      this.value = params.band;
    } else {
      processSubmission();
    }
  });

  document.getElementById('num_days').addEventListener('change', function () {
    processSubmission();
  });

  // Submit the form if parameters were provided in the URL
  if (document.getElementById('band').value) {
    processSubmission(null, true /* on_load */);
  }

  // Handle clicks on the "Go" button
  document.getElementById('go_button').addEventListener(
      'click', processSubmission);
}

Run();
