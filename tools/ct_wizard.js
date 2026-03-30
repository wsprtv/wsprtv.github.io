// Custom Telemetry Wizard
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
let mode;  // basic / advanced
let num_imported_opaque_extractors;

// Extracts a parameter value from the URL
function getURLParameter(url, name) {
  const regex = new RegExp('[?&]' + name + '(=([^&]*)|(?=[&]|$))');
  const match = regex.exec(url);
  if (!match) return null;
  return match[2] != undefined ?
      decodeURIComponent(match[2].replace(/\+/g, ' ')) : '';
}

// Similar to encodeURIComponent but does not escape ',' and ':', and
// escapes ' ' as '+'
function encodeURLParameter(param) {
  return Array.from(param).map(c =>
      (',: '.includes(c) ? c : encodeURIComponent(c)).replace(/\s/g, '+')
  ).join('');
}

function setURL(url) {
  try {
    history.replaceState(null, '', url);
  } catch (error) {
    console.log('Security error triggered by history.replaceState()');
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
  button.classList.add('blue_button');
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

function addLabel(parent, text, tooltip = '') {
  let label = addTextElement(parent, 'span', text + ':', 'margin-right: 5px');
  if (tooltip) label.title = tooltip;
  return label;
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

// Entry point
function start() {
  let wizard = document.getElementById('wizard');
  wizard.innerHTML = '';

  const spec = getURLParameter(location.search, 'spec');
  if (spec) {
    importWSPRTVURL(spec);
    return;
  }

  addSelectMenu(wizard,
      ['What would you like to do?',
       '────────────',
       'Create a new definition [basic]',
       'Create a new definition [advanced]',
       'Import a WSPR TV URL',
      ], handleRootAction);
  // Add the user guide link
  const link = document.createElement('a');
  link.href =
      'https://wsprtv.com/docs/user_guide.html#u4b-custom-telemetry-(ct)';
  link.textContent = 'ℹ️';
  link.style.textDecoration = 'none';
  link.target = '_new3';
  wizard.appendChild(link);
}

function handleRootAction() {
  this.disabled = true;  // disable the root select menu
  const wizard = document.getElementById('wizard');
  wizard.appendChild(document.createElement('p'));
  if (this.value == '2') {
    mode = 'basic';
    createMessages();
  } else if (this.value == '3') {
    mode = 'advanced';
    createMessages();
  } else if (['4'].includes(this.value)) {
    const import_field = document.createElement('textarea');
    import_field.id = 'import_field';
    import_field.rows = '8';
    import_field.cols = '70';
    import_field.placeholder = `Copy-paste the URL here`;
    wizard.appendChild(import_field);
    wizard.appendChild(document.createElement('p'));
    const footer = addSection(wizard);
    footer.id = 'footer';
    addButton(footer, 'Import', () => handleImport(this.value - 4));
    addButton(footer, 'Start Over', startOver);
  }
}

function handleImport(type) {
  const input = document.getElementById('import_field');
  input.disabled = true;
  document.getElementById('footer').remove();
  try {
    [importWSPRTVURL][type](input.value);
  } catch (err) {
    alert(err);
    startOver();
  }
}

function importWSPRTVURL(url) {
  let spec = {};
  spec.cs = getURLParameter(url, 'cs');
  spec.ch = getURLParameter(url, 'ch');
  spec.band = getURLParameter(url, 'band');
  spec.start_date = getURLParameter(url, 'start_date');
  spec.end_date = getURLParameter(url, 'end_date');

  const decoders_param = getURLParameter(url, 'ct_dec') ||
      getURLParameter(url, 'et_dec');
  const labels_param = getURLParameter(url, 'ct_labels') ||
      getURLParameter(url, 'et_labels');
  const long_labels_param = getURLParameter(url, 'ct_llabels') ||
      getURLParameter(url, 'et_llabels');
  const units_param = getURLParameter(url, 'ct_units') ||
      getURLParameter(url, 'et_units');
  const resolutions_param = getURLParameter(url, 'ct_res') ||
      getURLParameter(url, 'et_res');

  mode = 'advanced';
  if (!decoders_param) {
    createMessages(spec);
    return;
  }
  if (!/^[0-9cets,:_~.-]+$/.test(decoders_param)) throw "Invalid ct_dec";
  spec.decoders = [];
  for (const decoder_spec of decoders_param.toLowerCase().split('~')) {
    let [filters_spec, extractors_spec] = decoder_spec.split('_');
    // Parse filters
    let filters = [];
    if (filters_spec) {
      for (const filter_spec of filters_spec.split(',')) {
        if (!filter_spec) continue;
        let filter = filter_spec.split(':');
        const is_temporal = filter[filter.length - 1] == 't';
        if (filter.length == (2 + (is_temporal ? 1 : 0)) &&
            !['ct', 'et', 'et0', 's'].includes(filter[0])) {
          filter.unshift('');
        }
        filters.push(filter);
      }
    }
    // Parse extractors
    let extractors = [];
    for (const extractor_spec of extractors_spec.split(',')) {
      if (!extractor_spec) continue;
      let extractor = extractor_spec.split(':');
      const native_index = extractor.findIndex(f => f.startsWith('t'));
      if ((native_index == -1 && extractor.length == 3) ||
          native_index == 1) {
        extractor.unshift('');  // add implicit divisor
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

function createMessages(spec = null) {
  num_imported_opaque_extractors = 0;
  const wizard = document.getElementById('wizard');
  let info_section = addSection(wizard, 'box');
  info_section.innerHTML =
      '<h3>Instructions</h3><br>Add one or more message definitions, ' +
      'then click "<b>Generate URL</b>" at the bottom of the page.<br><br>' +
      '<b>Custom Telemetry</b> - newer protocol providing 35.5 bits of ' +
      'payload (not supported by all trackers).<br>' +
      '<b>ET0</b> - older protocol providing 29.5 bits of payload.<br><br>' +
      '<b>Slot</b> - TX slot for this CT message, typically 2 - 4 ' +
      ' (standard telemetry is in slot 1).<br><br>' +
      'Fields are packed starting with the least significant position ' +
      'in BigNum.<br><br>Hover over labels such as "Size" and "Step" to see ' +
      'their meaning.';
  info_section.style.backgroundColor = '#fffff5';
  if (mode == 'advanced') info_section.hidden = true;

  const messages = addSection(wizard);
  messages.id = 'messages';
  if (spec && spec.decoders) {
    for (let decoder of spec.decoders) {
      createMessage(messages, decoder, spec);
    }
  } else {
    createMessage(messages);
  }
  addButton(wizard, 'Add Another CT Message', () => createMessage(messages));

  createMainParams(spec);
}

function createMessage(messages, decoder = null, spec = null) {
  let message = addSection(messages, 'box');
  message.style.backgroundColor = '#eee';
  addTextElement(message, 'h2', 'CT Message Definition');
  addTypeAndSlotSelectors(message, decoder, spec)
  if (mode == 'advanced') {
    // Filters
    let filter_section = addSection(message, 'box');
    filter_section.style.backgroundColor = '#fff';
    addTextElement(filter_section, 'h3', 'Custom Filters');
    let filters = addSection(filter_section);
    if (decoder && decoder[0]) {
      for (const filter_spec of decoder[0]) {
        if (filter_spec[0] == 's' ||
            ['ct', 'et', 'et0'].includes(filter_spec[0])) {
          continue;
        }
        createFilter(filters, filter_spec);
      }
    }
    addButton(filter_section, 'Add', () => createFilter(filters));
  }

  // Extractors
  let extractor_section = addSection(message, 'box');
  extractor_section.style.backgroundColor = '#fff';
  addTextElement(extractor_section, 'h3',
      (mode == 'basic') ? 'Fields' : 'Value Extractors');
  let extractors = addSection(extractor_section);
  if (decoder && decoder[1]) {
    for (const extractor_spec of decoder[1]) {
      if (extractor_spec &&
          extractor_spec.some(f => f.startsWith('t'))) {
        createExtractor(extractors, true, extractor_spec);
      } else {
        createExtractor(extractors, false, extractor_spec,
            (spec.labels || [])[num_imported_opaque_extractors],
            (spec.long_labels || [])[num_imported_opaque_extractors],
            (spec.units || [])[num_imported_opaque_extractors],
            (spec.resolutions || [])[num_imported_opaque_extractors]);
        num_imported_opaque_extractors++;
      }
    }
  }

  if (mode == 'basic') {
    createExtractor(extractors, false);
  }
  addButton(extractor_section,
      (mode == 'basic')? 'Add Another Field' : 'Add Opaque',
      () => createExtractor(extractors, false));

  if (mode == 'advanced') {
    addButton(extractor_section, 'Add Native',
        () => createExtractor(extractors, true));
  }

  addButton(message, 'Delete Message', deleteMessage);

  let info = addTextElement(message, 'span');
  updateMessageInfo(message);
}

function createFilter(parent, filter_spec = null) {
  let s = addSection(parent);
  addLabel(s, 'Type', 'Filter type');
  const filter_type = addSelectMenu(s, ['Regular', 'TX_SEQ'], null);
  if (filter_spec && filter_spec[filter_spec.length - 1] == 't') {
    filter_type.value = 1;
    filter_spec = filter_spec.slice(0, -1);
  }
  filter_type.onchange = () => {
    updateMessageInfo(parent.parentElement.parentElement);
  };
  addLabel(s, 'Div',
      'Divisor needed to extract the value');
  let f = addInputField(s, '', 50, 'implied');
  if (filter_spec) f.value = filter_spec[0];
  f.oninput = (e) => {
    updateMessageInfo(parent.parentElement.parentElement);
  };
  addLabel(s, 'Mod',
      'Modulus needed to extract the value ' +
      '(typically equal to field size)');
  f = addInputField(s, '', 50);
  if (filter_spec) f.value = filter_spec[1];
  f.oninput = (e) => {
    updateMessageInfo(parent.parentElement.parentElement);
  };
  addLabel(s, 'Value',
      'Expected value of extracted field');
  f = addInputField(s, '', 50);
  if (filter_spec) f.value = filter_spec[2];
  addButton(s, 'Delete', deleteFilter);
  f = addTextElement(s, 'span', '⬆', 'color: gray; cursor: pointer');
  f.title = 'Move up';
  f.onclick = () => {
    if (parent.firstChild != s) {
      const index = [...parent.children].indexOf(s);
      parent.insertBefore(s, parent.children[index - 1]);
      updateMessageInfo(parent.parentElement.parentElement);
    }
  };
  f = addTextElement(s, 'span', '⬇', 'color: gray; cursor: pointer');
  f.title = 'Move down';
  f.onclick = () => {
    if (parent.lastChild != s) {
      const index = [...parent.children].indexOf(s);
      parent.insertBefore(parent.children[index + 1], s);
      updateMessageInfo(parent.parentElement.parentElement);
    }
  };
  return s;
}

function createExtractor(parent, is_native, extractor_spec = null,
    label = '', long_label = '', units = '', resolution = '') {
  let s = addSection(parent);
  let l = addLabel(s, 'Div',
      'Divisor needed to shift BigNum right for value extraction');
  let f = addInputField(s, '', 50, 'implied');
  if (mode == 'basic') {
    l.hidden = true;
    f.hidden = true;
  }
  f.oninput = (e) => {
    updateMessageInfo(parent.parentElement.parentElement);
  };
  if (extractor_spec) f.value = extractor_spec[0];
  addLabel(s, (mode == 'basic') ? 'Size' : 'Mod',
      (mode == 'basic') ?
          'Field size (number of possible values)' :
          'Modulus (typically equal to field size)');
  f = addInputField(s, '', 50);
  if (extractor_spec) f.value = extractor_spec[1];
  f.oninput = (e) => {
    updateMessageInfo(parent.parentElement.parentElement);
  };
  let native_type_selector;
  if (is_native) {
    addLabel(s, 'Type');
    const type_choices = [
      '─ Enhanced ST',
      '[100] Grid6 Lon Res',
      '[101] Grid6 Lat Res',
      '[102] Altitude Res',
      '[103] Altitude Range',
      '[104] Temp Res',
      '[105] Temp Range',
      '[106] Voltage Res',
      '[107] Voltage Range',
      '[108] Speed Res',
      '[109] Speed Range',
      '─ Setters',
      '[120] Time Offset',
      '[121] Lon',
      '[122] Lat',
      '[123] Grid4 Lon Res',
      '[124] Grid4 Lat Res',
      '[125] Altitude',
      '[126] Temp',
      '[127] Voltage',
      '[128] Speed',
      '─ Other',
      '[140] New Spot',
      '[141] Switch To',
      '[142] Alias To'
    ];
    native_type_selector = addSelectMenu(s, type_choices, null);
    if (extractor_spec && extractor_spec[2][0] == 't') {
      let value = Number(extractor_spec[2].slice(1));
      for (let i = 0; i < type_choices.length; i++) {
        if (parseInt(type_choices[i].slice(1)) == value) {
          native_type_selector.value = i;
          break;
        }
      }
    }
  }
  const first_value_l = addLabel(s, 'First value',
      'Value at index 0');
  const first_value_f = addInputField(s, 0, 50);
  if (extractor_spec) first_value_f.value =
      extractor_spec[is_native ? 3 : 2] || '';
  const step_l = addLabel(s, 'Step',
      'Difference between successive values, can be negative');
  const step_f = addInputField(s, 1, 50);
  if (extractor_spec) step_f.value =
      extractor_spec[is_native ? 4 : 3] || '';

  if (is_native) {
    native_type_selector.onchange = () => {
      const value = parseInt(native_type_selector
          .options[native_type_selector.value].text.slice(1));
      let hide_first_value = false;
      let hide_step = false;
      if (value < 120 || [121, 122, 123, 124].includes(value)) {
        hide_first_value = true;
        hide_step = true;
      }
      if ([140, 141, 142].includes(value)) {
        hide_step = true;
      }
      first_value_f.hidden = hide_first_value;
      first_value_l.hidden = hide_first_value;
      step_f.hidden = hide_step;
      step_l.hidden = hide_step;
    };
    native_type_selector.dispatchEvent(new Event('change'));
  }
  if (!is_native) {
    addLabel(s, 'Label',
        'Short label such as "GpsSats", shown where space is tight. ' +
        'Defaults to a value such as "ET13".');
    f = addInputField(s, '', 75, 'default');
    f.value = label;
    addLabel(s, 'Long label',
        'Longer label such as "GPS Satellites", shown where more space is ' +
        'available. If left blank, defaults to the value of "Label".');
    f = addInputField(s, '', 100, '= Label');
    f.value = long_label;
    addLabel(s, 'Units',
        'Units such as " mph". Can be left blank. The space before units is ' +
        'significant: "4 V" vs. "4V".');
    f = addInputField(s, '', 50, 'none');
    f.value = units;
    addLabel(s, 'Resolution',
        'Number of digits to display after the decimal point ' +
        '(e.g. 2 for "4.45V"). If blank or zero, values are shown as integers.');
    f = addInputField(s, '', 30, '0');
    f.value = resolution;
  }
  addButton(s, 'Delete', deleteExtractor);
  f = addTextElement(s, 'span', '⬆', 'color: gray; cursor: pointer');
  f.title = 'Move up';
  f.onclick = () => {
    if (parent.firstChild != s) {
      const index = [...parent.children].indexOf(s);
      parent.insertBefore(s, parent.children[index - 1]);
      updateMessageInfo(parent.parentElement.parentElement);
    }
  };
  f = addTextElement(s, 'span', '⬇', 'color: gray; cursor: pointer');
  f.title = 'Move down';
  f.onclick = () => {
    if (parent.lastChild != s) {
      const index = [...parent.children].indexOf(s);
      parent.insertBefore(parent.children[index + 1], s);
      updateMessageInfo(parent.parentElement.parentElement);
    }
  };
}

function updateMessageInfo(message) {
  let info = message.lastElementChild;
  let filters = (mode == 'basic') ?
      [] : [...message.children[3].children[1].children];
  let extractors =
      [...message.children[mode == 'basic' ? 3 : 4].children[1].children];
  const message_type = message.children[1].value - 2;
  let next_div = [5, 320, 1][message_type];
  let max_next_div = next_div;
  for (const [i, row] of [...filters, ...extractors].entries()) {
    const fields = [...row.children];
    const is_filter = i < filters.length;
    if (is_filter && fields[1].value == 1) {
      // Temporal (tx_seq) filters do not effect next_div
      continue;
    }
    const div_str = fields[is_filter ? 3 : 1].value;
    const mod_str = fields[is_filter ? 5 : 3].value;
    if (!mod_str) continue;
    let div = next_div;
    if (div_str) {
      div = Number(div_str);
      if (!div || div < 1) {
        info.innerHTML = '';
        return;
      }
    }
    let mod = Number(mod_str);
    if (!mod || mod < 1) {
      info.innerHTML = '';
      return;
    }
    next_div = div * mod;
    max_next_div = Math.max(max_next_div, next_div);
  }
  const size_left = 194756140800.0 / max_next_div;
  if (size_left > 1) {
    info.innerHTML =
        `<font color="darkgreen">[ ${Math.log2(size_left).toFixed(2)} ` +
        `bits remaining (${Math.floor(size_left)} values) ]</font>`;
  } else if (size_left == 1) {
    info.innerHTML = '<font color="darkgreen">[ Full ]</font>';
  } else {
    info.innerHTML = `<font color="darkred">[ Overflow by ` +
        `${-Math.log2(size_left).toFixed(2)} bits ]</font>`;
  }
}

function addTypeAndSlotSelectors(message, decoder = null) {
  let message_type_choices = [
    'Message type',
    '────────────',
    'Custom Telemetry',
    'ET0 0 (User Defined)'
  ];
  if (mode == 'advanced') message_type_choices.push('Raw');
  const message_type_selector =
      addSelectMenu(message, message_type_choices, null);
  message_type_selector.onchange = () => {
    updateMessageInfo(message);
  };
  if (decoder && decoder[0].some(f => (f[0] == 'ct' || f[0] == 'et'))) {
    message_type_selector.value = 2;
  } else if (decoder && decoder[0].some(f => f[0] == 'et0')) {
    message_type_selector.value = 3;
  } else {
    message_type_selector.value = 2;
  }
  let slot_choices = [
      'Message slot (0 = regular CS)',
      '────────────',
      'Slot 1',
      'Slot 2',
      'Slot 3',
      'Slot 4'
  ];
  if (mode == 'advanced') slot_choices.push('Any slot');
  const slot_selector = addSelectMenu(message, slot_choices, null);
  slot_selector.value = 3;
  if (decoder) {
    let found_slot = false;
    for (let filter of decoder[0]) {
      if (filter[0] == 's') {
        slot_selector.value = 1 + +filter[1];
        found_slot = true;
        break;
      }
    }
    if (!found_slot) slot_selector.value = 6;  // any slot
  }
}

function createMainParams(spec = null) {
  const wizard = document.getElementById('wizard');
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
  if (spec && spec.end_date) {
    main_params.querySelector('#end_date').value = spec.end_date;
  }

  wizard.appendChild(main_params);

  let footer = addSection(wizard);
  footer.id = 'footer';
  addButton(footer, 'Generate URL', generateURL);
  addButton(footer, 'Start Over', startOver);
}

function deleteFilter() {
  const message =
      this.parentElement.parentElement.parentElement.parentElement;
  this.parentElement.remove();
  updateMessageInfo(message);
}

function deleteExtractor() {
  const message =
      this.parentElement.parentElement.parentElement.parentElement;
  this.parentElement.remove();
  updateMessageInfo(message);
}

function deleteMessage() {
  this.parentElement.remove();
}

function checkFilter(implied_div, row) {
  let div = implied_div;
  const fields = [...row.children];
  const is_temporal = fields[1].value == 1;
  try {
    if (fields[3].value || is_temporal) {
      div = Number(fields[3].value);
      if (!Number.isInteger(div) || div < 1) {
        throw ['Filter divisor must be an integer >= 1', 3];
      }
    }
    const mod = Number(fields[5].value || 'none');
    if (!Number.isInteger(mod) || mod < 1) {
      throw ['Filter modulus must be an integer >= 1', 5];
    }
    if (!is_temporal && div * mod > 194756140800) {
      throw ['Filter modulus is too large for BigNum', 5];
    }
    if (fields[7].value != 's') {
      const value = Number(fields[7].value || 'none');
      if (!Number.isInteger(value) || value < 0) {
        throw ['Filter value must be an integer >= 0', 7];
      }
      if (value >= mod) {
        throw ['Filter value should be less than the modulus', 7];
      }
    }
    fields[3].className = '';
    fields[5].className = '';
    fields[7].className = '';
  } catch ([error, field]) {
    alert(error);
    fields[field].className = 'error';
    return false;
  }
  return true;
}

function checkExtractor(implied_div, row) {
  const fields = [...row.children];
  const is_native = fields.some(f => f.matches('select'));
  try {
    let div = implied_div;
    if (fields[1].value) {
      div = Number(fields[1].value);
      if (!Number.isInteger(div) || div < 1) {
        throw ['Extractor divisor must be an integer >= 1', 1];
      }
    }
    const mod = Number(fields[3].value || 'none');
    if (!Number.isInteger(mod) || mod < 1) {
      if (mode == 'basic') {
        throw ['Field size must be an integer >= 1', 3];
      } else {
        throw ['Extractor modulus must be an integer >= 1', 3];
      }
    }
    if (div * mod > 194756140800) {
      if (mode == 'basic') {
        throw ['Field size is too large for BigNum', 3];
      } else {
        throw ['Extractor modulus is too large for BigNum', 3];
      }
    }
    const first_value_index = is_native ? 7 : 5;
    const step_index = is_native ? 9 : 7;
    if (!fields[first_value_index].hidden) {
      const first_value =
          Number(fields[first_value_index].value || 'none');
      if (Number.isNaN(first_value)) {
        throw ['Invalid first value', first_value_index];
      }
    }
    if (!fields[step_index].hidden) {
      const step = Number(fields[step_index].value || 'none');
      if (Number.isNaN(step) || step <= 0) {
        throw ['Invalid step', first_value_index];
      }
    }
    fields[1].className = '';
    fields[3].className = '';
    fields[first_value_index].className = '';
    fields[step_index].className = '';
  } catch ([error, field]) {
    alert(error);
    fields[field].className = 'error';
    return false;
  }
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
  num_opaque_extractors = 0;
  let all_opaque_extractors = [];
  for (const message of document.getElementById('messages').children) {
    let filters = [];
    let extractors = [];
    let next_div = 1;
    const message_type_selector = message.children[1];
    const slot_selector = message.children[2];
    message_type_selector.className = '';
    slot_selector.className = '';
    if (message_type_selector.value == 2) {
      // Custom Telemetry
      filters.push(['ct']);
      next_div = 5;
    } else if (message_type_selector.value == 3) {
      // ET0
      filters.push(['et0', '0']);
      next_div = 320;
    } else if (message_type_selector.value != 4) {
      alert('Invalid message type');
      message_type_selector.className = 'error';
      return;
    }
    if (slot_selector.value >= 2 && slot_selector.value <= 5) {
      filters.push(['s', slot_selector.value - 1]);
    } else if (slot_selector.value < 2) {
      alert('Invalid message slot');
      slot_selector.className = 'error';
      return;
    }
    let filter_rows =
        (mode == 'basic') ? [] :
        [...message.children[3].children[1].children];

    for (let i = 0; i < filter_rows.length; i++) {
      const filter_row = filter_rows[i];
      const filter_fields = [...filter_row.children];
      if (!checkFilter(next_div, filter_row)) return;
      let filter = [filter_fields[3].value,
                    filter_fields[5].value,
                    filter_fields[7].value];
      const is_temporal = filter_fields[1].value == 1;
      if (filter_fields[3].value == '') {
        next_div *= Number(filter[1]);
        filter.shift();
      } else {
        if (!is_temporal) {
          next_div = Number(filter[0]) * Number(filter[1]);
        } else {
          filter.push('t');
        }
      }
      filters.push(filter);
    }
    const index = (mode == 'basic') ? 3 : 4;
    let extractor_rows =
        [...message.children[index].children[1].children];
    for (let i = 0; i < extractor_rows.length; i++) {
      const extractor_row = extractor_rows[i];
      const extractor_fields = [...extractor_row.children];
      const is_native = extractor_fields.some(f => f.matches('select'));
      let extractor;
      if (is_native) {
        extractor = [extractor_fields[1].value,
                     extractor_fields[3].value,
                     't' + parseInt(extractor_fields[5].
                         options[extractor_fields[5].value].text.slice(1))];
        if (!extractor_fields[7].hidden) {
          extractor.push(extractor_fields[7].value);
        }
        if (!extractor_fields[9].hidden) {
          extractor.push(extractor_fields[9].value);
        }
      } else {
        extractor = [extractor_fields[1].value,
                     extractor_fields[3].value,
                     extractor_fields[5].value,
                     extractor_fields[7].value];
      }
      if (!checkExtractor(next_div, extractor_row)) return;
      if (extractor_fields[1].value == '') {
        next_div *= Number(extractor[1]);
        extractor.shift();
      } else {
        next_div = Number(extractor[0]) * Number(extractor[1]);
      }
      extractors.push(extractor);
      if (!is_native) {
        all_opaque_extractors.push(extractor);
        const label_field = extractor_fields[9];
        if (label_field.value) {
          if (!checkAnnotationField('label', label_field)) return;
          labels[num_opaque_extractors] = label_field.value;
        }
        const long_label_field = extractor_fields[11];
        if (long_label_field.value) {
          if (!checkAnnotationField('long_label', long_label_field)) return;
          long_labels[num_opaque_extractors] = long_label_field.value;
        }
        const units_field = extractor_fields[13];
        if (units_field.value) {
          if (!checkAnnotationField('units', units_field)) return;
          units[num_opaque_extractors] = units_field.value;
        }
        const resolution_field = extractor_fields[15];
        if (resolution_field.value) {
          if (!checkAnnotationField('resolution', resolution_field)) return;
          resolutions[num_opaque_extractors] = resolution_field.value;
        }
        num_opaque_extractors++;
      }
    }
    decoders.push([filters, extractors]);
  }

  // Construct the URL
  let url = window.location.origin + '?';
  const main_params = document.getElementById('main_params');
  let cs = main_params.children[0].value;
  let ch = main_params.children[1].value;
  let band = main_params.children[2].value;
  let start_date = main_params.children[3].value;
  let end_date = main_params.children[4].value;
  if (cs) {
    if (!/^([A-Z0-9]{1,4}\/)?[A-Z0-9]{4,6}(\/[A-Z0-9]{1,4})?$/i.test(cs)) {
      alert(`Invalid callsign: ${cs}`);
      return;
    }
    url += 'cs=' + encodeURLParameter(cs) + '&';
  }
  if (ch) {
    if (!/^(t?\d{1,3}|u[q01]\d{2})$/i.test(ch)) {
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
  if (end_date) {
    if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(end_date)) {
      alert(`Invalid end date: ${end_date}`);
      return;
    }
    url += 'end_date=' + encodeURLParameter(end_date) + '&';
  }
  let decoder_param = decoders.map(
      d => d[0].map(f => f.join(':')).join(',') + '_' +
           d[1].map(e => ((e[0] == '') ? e.slice(1) : e.slice(0))
               .join(':')).join(',')).join('~');
  if (decoder_param) {
    url += 'ct_dec=' + encodeURLParameter(decoder_param) + '&';
  }
  if (labels.length) {
    url += 'ct_labels=' + encodeURLParameter(labels.join(',')) + '&';
  }
  if (long_labels.length) {
    url += 'ct_llabels=' + encodeURLParameter(long_labels.join(',')) + '&';
  }
  if (units.length) {
    url += 'ct_units=' + encodeURLParameter(units.join(',')) + '&';
  }
  const resolutions_param =
      resolutions.map(v => v == '0' ? '' : v).join(',');
  if (resolutions_param) {
    url += 'ct_res=' + encodeURLParameter(resolutions_param) + '&';
  }
  if (url.endsWith('&')) url = url.slice(0, -1);  // remove trailing &
  displayURL(url, all_opaque_extractors, labels, long_labels,
             units, resolutions);
}

function displayURL(url, extractors, labels, long_labels, units, resolutions) {
  document.getElementById('footer').remove();
  const footer = addSection(wizard);
  footer.id = 'footer';

  let display_section = addSection(footer, 'box');
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
        '<p>Here is how custom telemetry values will be displayed in ' +
        '<b>short format</b> (used in spot info panels and data tables):<p>';
    let span2 = addTextElement(display_section, 'span');
    span2.innerHTML =
        '<p>Here is how custom telemetry values will be displayed in ' +
        '<b>long format</b> (used in charts and CVS headers):<p>';
    for (let i = 0; i < extractors.length; i++) {
      let extractor = [...extractors[i]];
      if (extractor.length == 4) extractor = extractor.slice(1);
      const value = Number(extractor[1]) +
          Math.floor(Number(extractor[0]) / 2) * Number(extractor[2]);
      const label = labels[i] || `CT${i}`;
      const long_label = long_labels[i] || labels[i] || `CT${i}`;
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
        `defintions and click the "<b>Update URL</b>" button below.`;
  }

  addVerticalSpace(display_section);
  const wizard_link = document.createElement('a');
  wizard_link.href = '?spec=' + encodeURIComponent(url);
  wizard_link.textContent = 'Current configuration link';
  wizard_link.target = '_new3';
  display_section.appendChild(wizard_link);

  addButton(footer, 'Update URL', generateURL);
  addButton(footer, 'Copy URL', () => navigator.clipboard.writeText(url));
  addButton(footer, 'Start Over', startOver);
}

function startOver() {
  setURL(location.pathname);
  start();
}

start();
