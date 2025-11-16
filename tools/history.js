// WSPR TV History
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
let debug = 0;  // controls console logging

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem('history'));
  } catch (error) {
    return [];
  }
}

// Extracts a parameter value from the URL
function getParameterFromURL(url, name) {
  const regex = new RegExp('[?&]' + name + '(=([^&]*)|(?=[&]|$))');
  const match = regex.exec(url);
  if (!match) return null;
  return match[2] != undefined ?
      decodeURIComponent(match[2].replace(/\+/g, ' ')) : '';
}

function formatDuration(ts1, ts2) {
  const delta = Math.abs(ts1 - ts2);
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

function createTableCell(type, content) {
  const cell = document.createElement(type);
  cell.textContent = content;
  return cell;
}

function deleteEntry(ts) {
  let history = loadHistory();
  for (let i = 0; i < history.length; i++) {
    if (history[i].ts == ts) {
      history.splice(i, 1);
      localStorage.setItem('history', JSON.stringify(history));
      break;
    }
  }
  showTable();
}

function showTable() {
  let div = document.getElementById('table');
  div.innerHTML = '';
  document.getElementById('help').style.display = 'none';

  const history = loadHistory();
  if (!history || history.length == 0) {
    div.innerHTML = 'No history stored on this device.';
    return;
  }

  // Prefill the table with row numbers
  let table_headers = ['', 'Callsign', 'Ch', 'Band', 'Viewed', ''];

  // Populate the table
  let table = document.createElement('table');
  table.classList.add('data_table');
  // Fill the header
  let row = document.createElement('tr');
  for (let i = 0; i < table_headers.length; i++) {
    let th = createTableCell('th', table_headers[i]);
    row.appendChild(th);
  }
  table.appendChild(row);

  const now = Math.floor(Date.now() / 1000);

  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    if (!entry.ts || !entry.url) continue;
    if (now - entry.ts > 14 * 86400) continue;
    let row = document.createElement('tr');
    let cell = document.createElement('td');
    // Go button
    const go_button = document.createElement('a');
    go_button.href = '../' + entry.url;
    go_button.textContent = 'Go';
    go_button.className = 'button';
    cell.appendChild(go_button);
    row.appendChild(cell);
    const cs = getParameterFromURL(entry.url, 'cs').toUpperCase();
    const ch = getParameterFromURL(entry.url, 'ch');
    const band = getParameterFromURL(entry.url, 'band').toLowerCase();
    row.appendChild(createTableCell('td', cs));
    row.appendChild(createTableCell('td', ch));
    row.appendChild(createTableCell('td', band));
    row.appendChild(createTableCell('td',
        formatDuration(now, entry.ts) + ' ago'));
    // Delete button
    cell = document.createElement('td');
    const delete_button = document.createElement('button');
    delete_button.textContent = 'Delete';
    delete_button.className = 'button';
    delete_button.addEventListener(
      'click', () => deleteEntry(entry.ts));
    cell.appendChild(delete_button);
    row.appendChild(cell);
    table.appendChild(row);
  }
  div.appendChild(table);
  document.getElementById('help').style.display = 'block';
}

function changeDefaultViewSetting() {
  localStorage.setItem('load_last',
      document.getElementById('load_last').checked ? '1' : '0');
}

// Entry point
function start() {
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) {
      showTable();
    }
  });

  showTable();

  document.getElementById('load_last').checked =
      (localStorage.getItem('load_last') == '1') || false;
}

start();
