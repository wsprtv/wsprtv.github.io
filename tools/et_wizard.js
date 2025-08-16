// Extended Telemetry Wizard
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
let debug = 0;  // controls console logging
let seq = 0;  // DOM element id sequence
let tail;
let message_sections;
let num_extractors = 0;

// Extracts a parameter value from the URL
function getURLParametereter(url, name) {
  const regex = new RegExp('[?&]' + name + '(=([^&]*)|(?=[&]|$))');
  const match = regex.exec(url);
  if (!match) return null;
  return match[2] != undefined ?
      decodeURIComponent(match[2].replace(/\+/g, ' ')) : '';
}

function importWSPRTVURL(url) {
  let spec = {};
  spec.cs = getURLParametereter(url, 'cs');
  spec.ch = getURLParametereter(url, 'ch');
  spec.band = getURLParametereter(url, 'band');
  spec.start_date = getURLParametereter(url, 'start_date');

  const decoders_param = getURLParametereter(url, 'et_dec');
  const labels_param = getURLParametereter(url, 'et_labels');
  const long_labels_param = getURLParametereter(url, 'et_llabels');
  const units_param = getURLParametereter(url, 'et_units');
  const resolutions_param = getURLParametereter(url, 'et_res');

  if (!decoders_param) {
    createMessages(spec);
    return;
  }
  if (!/^[0-9ets,:_~.-]+$/.test(decoders_param)) throw "Invalid et_dec";
  spec.decoders = [];
  for (const decoder_spec of decoders_param.toLowerCase().split('~')) {
    let [filters_spec, extractors_spec] = decoder_spec.split('_');
    // Parse filters
    let filters = [];
    if (filters_spec) {
      for (const filter_spec of filters_spec.split(',')) {
        if (!filter_spec) continue;
        let filter = filter_spec.split(':');
        filters.push(filter);
      }
    }
    // Parse extractors
    let extractors = [];
    for (const extractor_spec of extractors_spec.split(',')) {
      if (!extractor_spec) continue;
      let extractor = extractor_spec.split(':');
      if (extractor.length == 3) {
        extractor.unshift('');
      }
      extractors.push(extractor);
    }
    spec.decoders.push([filters, extractors]);
  }
  // Parse optional params
  let labels;
  let long_labels;
  let units;
  let resolutions;
  if (labels_param) {
    spec.labels = labels_param.split(',');
  }
  if (long_labels_param) {
    spec.long_labels = long_labels_param.split(',');
  }
  if (units_param) {
    spec.units = units_param.split(',');
  }
  if (resolutions_param) {
    spec.resolutions = resolutions_param.split(',');
  }
  createMessages(spec);
}

function importTraquitoURL(url) {
  let spec = {};
  spec.cs = getURLParametereter(url, 'callsign');
  spec.ch = getURLParametereter(url, 'channel');
  spec.band = getURLParametereter(url, 'band');
  spec.start_date = getURLParametereter(url, 'dtGte');
  for (let i = 0; i < 4; i++) {
    const slot_param = getURLParametereter(url, `slot${i + 1}MsgDefUserDefined`);
    if (!slot_param) continue;
    const slot_spec =  JSON.parse(
        '[' + slot_param.replace(/\/\/.*$/gm, '').replace(/,\s*$/, '') + ']');
    spec[i] = slot_spec;
  }
  importTraquitoSpec(spec);
}

function importTraquitoJSON(json) {
  const parsed_json = JSON.parse(json);
  let spec = [];
  for (let i = 0; i < 4; i++) {
    const slot_param = parsed_json[`slot${i + 1}MsgDef`];
    if (!slot_param) continue;
    const slot_spec =  JSON.parse('[' +
        slot_param.replace(/\/\/.*$/gm, '').replace(/,\s*$/, '') + ']');
    spec[i] = slot_spec;
  }
  importTraquitoSpec(spec);
}

function importTraquitoSpec(traquito_spec) {
  let decoders = [];
  let labels = [];
  let units = [];
  for (let i = 2; i <= 4; i++) {
    if (traquito_spec[i]) {
      let filters = [['et0', '0'], ['s', i]];
      let extractors = [];
      let divisor = 320;
      for (let extractor_spec of traquito_spec[i]) {
        let offset = extractor_spec.lowValue;
        let slope = extractor_spec.stepSize;
        let modulus = Math.ceil(
            (extractor_spec.highValue - extractor_spec.lowValue) /
            extractor_spec.stepSize) + 1;
        extractors.push([divisor, modulus, offset, slope, 1]);
        divisor *= modulus;
        labels.push(extractor_spec.name);
        units.push(extractor_spec.unit);
      }
      decoders.push([filters, extractors]);
    }
  }
  let spec = { 'decoders': decoders, 'labels': labels, 'units': units };
  if (traquito_spec.cs) spec.cs = traquito_spec.cs;
  if (traquito_spec.ch) spec.ch = traquito_spec.ch;
  if (traquito_spec.band) spec.band = traquito_spec.band;
  if (traquito_spec.start_date) spec.start_date = traquito_spec.start_date;
  createMessages(spec);
  return;
}

function handleImport(type) {
  const input = document.getElementById('import_field');
  input.disabled = true;
  tail.remove();
  try {
    [importWSPRTVURL, importTraquitoURL,
     importTraquitoJSON][type](input.value);
  } catch (err) {
    alert(err);
    start();
  }
}

// Similar to encodeURIComponent but does not escape ',' and ':', and
// escapes ' ' as '+'
function encodeURLParameter(param) {
  return Array.from(param).map(c =>
      (',: '.includes(c) ? c : encodeURIComponent(c)).replace(/\s/g, '+')
  ).join('');
}

function handleRootAction() {
  this.disabled = true;
  const wizard = document.getElementById('wizard');
  wizard.appendChild(document.createElement('p'));
  if (this.value == '2') {
    createMessages();
  } else if (['3', '4', '5'].includes(this.value)) {
    const import_field = document.createElement('textarea');
    import_field.id = 'import_field';
    import_field.rows = '8';
    import_field.cols = '70';
    import_field.placeholder =
        `Copy-paste the ${this.value == 5 ? 'JSON' : 'URL'} here`;
    wizard.appendChild(import_field);
    wizard.appendChild(document.createElement('p'));
    tail = addSection(wizard);
    addButton(tail, 'Import', () => handleImport(this.value - 3));
    addButton(tail, 'Start Over', start);
  }
}

function addSection(parent, class_name = '') {
  const id = seq++;
  const section = document.createElement('div');
  section.id = `id${id}`;
  if (class_name) section.className = class_name;
  parent.appendChild(section);
  return section;
}

function addSelectMenu(parent, options, handler) {
  const id = seq++;
  const select = document.createElement('select');
  select.id = `id${id}`;
  for (let i = 0; i < options.length; i++) {
    const option = document.createElement('option');
    option.value = i;
    option.textContent = options[i];
    if (options[i].slice(0, 1) == '─') {
      option.disabled = true;
    }
    select.appendChild(option);
  }
  if (handler) {
    select.addEventListener('change', handler);
  }
  parent.appendChild(select);
  return select;
}

function addButton(parent, text, action) {
  const id = seq++;
  const button = document.createElement('button');
  button.id = `id${id}`;
  button.classList.add('pretty_button');
  button.textContent = text;
  button.addEventListener('click', action);
  parent.appendChild(button);
  return button;
}

function addTextElement(parent, type, text, style = '') {
  let element = document.createElement(type);
  element.textContent = text;
  if (style) element.style = style;
  parent.appendChild(element);
  return element;
}

function addLabel(parent, text) {
  return addTextElement(parent, 'span', text + ':', 'margin-right: 5px');
}

function addInputField(parent, value = '', width = 30, placeholder = '') {
  const id = seq++;
  let input = document.createElement('input');
  input.id = `id${id}`;
  input.type = 'text';
  input.value = value;
  if (placeholder) input.placeholder = placeholder;
  input.style.width = width + 'px';
  input.style.marginRight = '10px';
  parent.appendChild(input);
  return input;
}

function addVerticalSpace(parent, space = 20) {
  let div = document.createElement('div');
  div.style.height = space + 'px';
  parent.appendChild(div);
  return div;
}

function createFilter(parent, filter = null) {
  let s = addSection(parent);
  addLabel(s, 'Type');
  const filter_type = addSelectMenu(s, ['Regular', 'Temporal'], null);
  if (filter && filter[0] == 't') {
    filter_type.value = 1;
    filter = filter.slice(1);
  }
  addLabel(s, 'Div');
  let f = addInputField(s, '', 50);
  if (filter) f.value = filter[0];
  addLabel(s, 'Mod');
  f = addInputField(s, '', 50);
  if (filter) f.value = filter[1];
  addLabel(s, 'Value');
  f = addInputField(s, '', 50);
  if (filter) f.value = filter[2];
  addButton(s, 'Delete', deleteFilter);
  return s;
}

function createExtractor(parent, extractor = null, spec = null) {
  let s = addSection(parent);
  addLabel(s, 'Div');
  let f = addInputField(s, '', 50, 'implied');
  if (extractor && extractor[4] == 0) f.value = extractor[0];
  addLabel(s, 'Mod');
  f = addInputField(s, '', 50);
  if (extractor) f.value = extractor[1];
  addLabel(s, 'Offset');
  f = addInputField(s, 0, 50);
  if (extractor) f.value = extractor[2];
  addLabel(s, 'Slope');
  f = addInputField(s, 1, 50);
  if (extractor) f.value = extractor[3];
  addLabel(s, 'Label');
  f = addInputField(s, '', 75);
  if (spec && spec.labels && spec.labels[num_extractors]) {
    f.value = spec.labels[num_extractors];
  }
  addLabel(s, 'Long label');
  f = addInputField(s, '', 100);
  if (spec && spec.long_labels && spec.long_labels[num_extractors]) {
    f.value = spec.long_labels[num_extractors];
  }
  addLabel(s, 'Units');
  f = addInputField(s, '', 50);
  if (spec && spec.units && spec.units[num_extractors]) {
    f.value = spec.units[num_extractors];
  }
  addLabel(s, 'Resolution');
  f = addInputField(s, '', 30);
  if (spec && spec.resolutions && spec.resolutions[num_extractors]) {
    f.value = spec.resolutions[num_extractors];
  }
  addButton(s, 'Delete', deleteExtractor);
  num_extractors++;
}

function createMessage(decoder = null, spec = null) {
  let message_section = addSection(message_sections, 'box');
  message_section.style.backgroundColor = '#eee';
  addTextElement(message_section, 'h2', 'Message Definition');
  const message_type_selector = addSelectMenu(message_section,
      ['Message type',
       '────────────',
       'ET0 User Defined',
       'ET3',
       'Custom'
      ], null);
  if (decoder && decoder[0].some(f => f[0] == 'et0')) {
    message_type_selector.value = 2;
  } else if (decoder && decoder[0].some(f => f[0] == 'et3')) {
    message_type_selector.value = 3;
  } else {
    message_type_selector.value = 4;
  }
  const slot_selector = addSelectMenu(message_section,
      ['Message slot (0 = regular CS)',
       '────────────',
       'Any slot',
       'Slot 1',
       'Slot 2',
       'Slot 3',
       'Slot 4',
      ], null);
  slot_selector.value = 4;
  if (decoder) {
    for (let filter of decoder[0]) {
      if (filter[0] == 's') {
        slot_selector.value = 2 + +filter[1];
        break;
      }
    }
  }
  // Filters
  let filters_wrapper = addSection(message_section, 'box');
  filters_wrapper.style.backgroundColor = '#fff';
  let filters_section = addSection(filters_wrapper);
  addTextElement(filters_section, 'h3', 'Custom Filters');
  if (decoder && decoder[0]) {
    for (const filter of decoder[0]) {
      if (filter[0] == 's' || ['et0', 'et3'].includes(filter[0])) {
        continue;
      }
      createFilter(filters_section, filter);
    }
  }
  addButton(filters_wrapper, 'Add',
      () => createFilter(filters_section));

  // Extractors
  let extractors_wrapper = addSection(message_section, 'box');
  extractors_wrapper.style.backgroundColor = '#fff';
  let extractors_section = addSection(extractors_wrapper);
  addTextElement(extractors_section, 'h3', 'Value Extractors');
  if (decoder && decoder[1]) {
    for (const extractor of decoder[1]) {
      createExtractor(extractors_section, extractor, spec);
    }
  }
  addButton(extractors_wrapper, 'Add',
      () => createExtractor(extractors_section));

  addButton(message_section, 'Delete Message', deleteMessage);
}

function createMessages(spec = null) {
  num_extractors = 0;
  const wizard = document.getElementById('wizard');
  message_sections = addSection(wizard);
  if (spec && spec.decoders) {
    for (let decoder of spec.decoders) {
      createMessage(decoder, spec);
    }
  } else {
    createMessage();
  }
  addButton(wizard, 'Add Another Message', () => createMessage());

  const template = document.getElementById('main_params_template');
  let main_params = template.content.cloneNode(true).firstElementChild;
  main_params.id = 'main_params';

  if (spec && spec.cs) {
    main_params.querySelector('#cs').value = spec.cs;
  }
  if (spec && spec.ch) {
    main_params.querySelector('#ch').value = spec.ch;
  }
  if (spec && spec.band) {
    main_params.querySelector('#band').value = spec.band;
  }
  if (spec && spec.start_date) {
    main_params.querySelector('#start_date').value = spec.start_date;
  }

  wizard.appendChild(main_params);

  tail = addSection(wizard);
  addButton(tail, 'Generate URL', generateURL);
  addButton(tail, 'Start Over', start);
}

function deleteFilter() {
  this.parentElement.remove();
}

function deleteExtractor() {
  this.parentElement.remove();
}

function deleteMessage() {
  this.parentElement.remove();
}

function checkFilter(filter, row) {
  try {
    const div = Number(filter[0] || 'none');
    if (!Number.isInteger(div) || div < 1) {
      throw ['Filter divisor must be an integer >= 1', 3];
    }
    const mod = Number(filter[1] || 'none');
    if (!Number.isInteger(mod) || mod < 2) {
      throw ['Filter modulus must be an integer >= 2', 5];
    }
    if (div * mod > 194756140800) {
      throw ['Filter modulus is too large for BigNum', 5];
    }
    if (filter[2] != 's') {
      const value = Number(filter[2] || 'none');
      if (!Number.isInteger(value) || value < 0) {
        throw ['Filter value must be an integer >= 0', 7];
      }
      if (value >= mod) {
        throw ['Filter value should be less than the modulus', 7];
      }
    }
  } catch ([error, field]) {
    alert(error);
    row.children[field].className = 'error';
    return false;
  }
  row.children[3].className = '';
  row.children[5].className = '';
  row.children[7].className = '';
  return true;
}

function checkExtractor(filter, implied_div, row) {
  try {
    let div = implied_div;
    if (filter[0]) {
      div = Number(filter[0]);
      if (!Number.isInteger(div) || div < 1) {
        throw ['Extractor divisor must be an integer >= 1', 1];
      }
    }
    const mod = Number(filter[1] || 'none');
    if (!Number.isInteger(mod) || mod < 2) {
      throw ['Extractor modulus must be an integer >= 2', 3];
    }
    if (div * mod > 194756140800) {
      throw ['Extractor modulus is too large for BigNum', 3];
    }
    const offset = Number(filter[2] || 'none');
    const slope = Number(filter[3] || 'none');
  } catch ([error, field]) {
    alert(error);
    row.children[field].className = 'error';
    return false;
  }
  row.children[1].className = '';
  row.children[3].className = '';
  row.children[5].className = '';
  return true;
}

function checkAnnotationField(name, field) {
  const value = field.value;
  try {
    if (name == 'label') {
      if (value.length > 32) {
        throw `Label's length cannot exceed 32`;
      }
      if (!/^[0-9a-z #_]+$/i.test(value)) {
        throw 'Label can only contain alphanumeric and ' +
              '[ #_] characters';
      }
    } else if (name == 'long_label') {
      if (value.length > 64) {
        throw `Long label's length cannot exceed 64`;
      }
      if (!/^[0-9a-z #_]+$/i.test(value)) {
        throw 'Long label can only contain alphanumeric and ' +
              '[ #_] characters';
      }
    } else if (name == 'units') {
      if (value.length > 8) {
        throw `Units length cannot exceed 8`;
      }
      if (!/^[a-z /°]+$/i.test(value)) {
        throw 'Units can only contain letters ' +
              'and [ /°] characters';
      }
    } else if (name == 'resolution') {
      const resolution = Number(value || 'none');
      if (!Number.isInteger(resolution) || resolution < 0 || resolution > 6) {
        throw `Resolution should be between 0 and 6`;
      }
    }
  } catch (error) {
    alert(error);
    field.className = 'error';
    return false;
  }
  field.className = '';
  return true;
}

function generateURL() {
  let decoders = [];
  let labels = [];
  let long_labels = [];
  let units = [];
  let resolutions = [];
  num_extractors = 0;
  let all_extractors = [];
  for (const message_section of message_sections.children) {
    let filters = [];
    let extractors = [];
    let next_divisor = 1;
    const message_type_selector = message_section.children[1];
    const slot_selector = message_section.children[2];
    message_type_selector.className = '';
    slot_selector.className = '';
    if (message_type_selector.value == 2) {
      // ET0
      filters.push(['et0', '0']);
      next_divisor = 320;
    } else if (message_type_selector.value == 3) {
      // ET3
      filters.push(['et3']);
      next_divisor = 4;
      if (slot_selector.value != 4) {
        alert('ET3 telemetry can only be in slot 2');
        return;
      }
    } else if (message_type_selector.value != 4) {
      alert('Invalid message type');
      message_type_selector.className = 'error';
      return;
    }
    if (slot_selector.value >= 3 && slot_selector.value <= 6) {
      filters.push(['s', slot_selector.value - 2]);
    } else if (slot_selector.value == 0) {
      alert('Invalid message slot');
      slot_selector.className = 'error';
      return;
    }
    let filter_rows = message_section.children[3].children[0].children;
    for (let i = 1; i < filter_rows.length; i++) {
      const filter_row = filter_rows[i];
      let filter = [filter_row.children[3].value,
                    filter_row.children[5].value,
                    filter_row.children[7].value];
      if (!checkFilter(filter, filter_row)) return;
      if (filter_row.children[1].value == 1) {
        // Temporal option selected
        filter.unshift('t');
      }
      filters.push(filter);
    }
    let extractor_rows = message_section.children[4].children[0].children;
    for (let i = 1; i < extractor_rows.length; i++) {
      const extractor_row = extractor_rows[i];
      let extractor = [extractor_row.children[1].value,
                       extractor_row.children[3].value,
                       extractor_row.children[5].value,
                       extractor_row.children[7].value];
      if (!checkExtractor(extractor, next_divisor, extractor_row)) return;
      if (extractor_row.children[1].value == '') {
        next_divisor *= Number(extractor[1]);
        extractor.shift();
      } else {
        next_divisor = Number(extractor[0]) * Number(extractor[1]);
      }
      extractors.push(extractor);
      all_extractors.push(extractor);
      const label_field = extractor_row.children[9];
      if (label_field.value) {
        if (!checkAnnotationField('label', label_field)) return;
        labels[num_extractors] = label_field.value;
      }
      const long_label_field = extractor_row.children[11];
      if (long_label_field.value) {
        if (!checkAnnotationField('long_label', long_label_field)) return;
        long_labels[num_extractors] = long_label_field.value;
      }
      const units_field = extractor_row.children[13];
      if (units_field.value) {
        if (!checkAnnotationField('units', units_field)) return;
        units[num_extractors] = units_field.value;
      }
      const resolution_field = extractor_row.children[15];
      if (resolution_field.value) {
        if (!checkAnnotationField('resolution', resolution_field)) return;
        resolutions[num_extractors] = resolution_field.value;
      }
      num_extractors++;
    }
    decoders.push([filters, extractors]);
  }

  // Construct the URL
  let url = 'https://wsprtv.com?';
  const main_params = document.getElementById('main_params');
  let cs = main_params.children[0].value;
  let ch = main_params.children[1].value;
  let band = main_params.children[2].value;
  let start_date = main_params.children[3].value;
  if (cs) {
    if (!/^([A-Z0-9]{1,4}\/)?[A-Z0-9]{4,6}(\/[A-Z0-9]{1,4})?$/i.test(cs)) {
      alert(`Invalid callsign: ${cs}`);
      return;
    }
    url += 'cs=' + encodeURLParameter(cs) + '&';
  }
  if (ch) {
    if (!/^(\d{1,3}|u[q01]\d{2})$/i.test(ch)) {
      alert(`Invalid channel: ${ch}`);
      return;
    }
    url += 'ch=' + encodeURLParameter(ch) + '&';
  }
  if (band) {
    url += 'band=' + encodeURLParameter(band) + '&';
  }
  if (start_date) {
    if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(start_date)) {
      alert(`Invalid start date: ${start_date}`);
      return;
    }
    url += 'start_date=' + encodeURLParameter(start_date) + '&';
  }
  let decoder_param = decoders.map(
      d => d[0].map(f => f.join(':')).join(',') + '_' +
           d[1].map(e => ((e[4] == 1) ? e.slice(1, 4) : e.slice(0, 4))
               .join(':')).join(',')).join('~');
  if (decoder_param) {
    url += 'et_dec=' + encodeURLParameter(decoder_param) + '&';
  }
  if (labels.length) {
    url += 'et_labels=' + encodeURLParameter(labels.join(',')) + '&';
  }
  if (long_labels.length) {
    url += 'et_llabels=' + encodeURLParameter(long_labels.join(',')) + '&';
  }
  if (units.length) {
    url += 'et_units=' + encodeURLParameter(units.join(',')) + '&';
  }
  const resolutions_param =
      resolutions.map(v => v == '0' ? '' : v).join(',');
  if (resolutions_param) {
    url += 'et_res=' + encodeURLParameter(resolutions_param) + '&';
  }
  if (url.endsWith('&')) url = url.slice(0, -1);  // remove trailing &
  displayURL(url, all_extractors, labels, long_labels, units, resolutions);
}

function displayURL(url, extractors, labels, long_labels, units, resolutions) {
  tail.remove();
  tail = addSection(wizard);

  let display_section = addSection(tail, 'box');
  display_section.style.backgroundColor = '#f4f4f4';
  addTextElement(display_section, 'h3', 'WSPR TV URL');

  const link = document.createElement('a');
  link.href = url;
  link.textContent = url;
  link.target = '_new3';
  display_section.appendChild(link);

  if (extractors.length) {
    let span1 = addTextElement(display_section, 'span');
    span1.innerHTML =
        '<p>Here is how extended telemetry values will be displayed in ' +
        '<b>short format</b> (used in spot info panels and data tables):<p>';
    let span2 = addTextElement(display_section, 'span');
    span2.innerHTML =
        '<p>Here is how extended telemetry values will be displayed in ' +
        '<b>long format</b> (used in charts and CVS headers):<p>';
    for (let i = 0; i < extractors.length; i++) {
      let extractor = extractors[i];
      if (extractor.length == 4) extractor = extractor.shift();
      const value = Number(extractor[1]) +
          Math.floor(Number(extractor[0]) / 2) * Number(extractor[2]);
      const label = labels[i] || `ET${i}`;
      const long_label = long_labels[i] || labels[i] || `ET${i}`;
      const units_ = units[i] || '';
      const resolution = Number(resolutions[i]) || 0;
      span1.innerHTML +=
          `<font color="darkgreen">` +
          `<b>${label}</font></b>: ${value.toFixed(resolution)}${units_}<br>`;
      span2.innerHTML += `<font color="#8b4513"><b>${long_label}` +
          ((units_) ? ` (${units_.trim()})` : '') +
          `</b></font>: ${value.toFixed(resolution)}<br>`;
    }
    span2.innerHTML += `<br>If this doesn't look right, adjust the message ` +
        `defintions and then click the "Update URL" button below.`;
  }

  addButton(tail, 'Update URL', generateURL);
  addButton(tail, 'Copy URL', () => navigator.clipboard.writeText(url));
  addButton(tail, 'Start Over', start);
}

// Entry point
function start() {
  let wizard = document.getElementById('wizard');
  wizard.innerHTML = '';
  addSelectMenu(wizard,
      ['What would you like to do?',
       '────────────',
       'Create a new definition',
       'Import a WSPR TV URL',
       'Import a Traquito URL',
       'Import a Traquito JSON file'
      ], handleRootAction);
  // Add the user guide link
  const link = document.createElement('a');
  link.href =
      'https://wsprtv.com/docs/user_guide.html#u4b-extended-telemetry';
  link.textContent = 'ℹ️';
  link.style.textDecoration = 'none';
  link.target = '_new3';
  wizard.appendChild(link);
}

start();
