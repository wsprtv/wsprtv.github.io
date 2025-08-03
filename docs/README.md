# WSPR TV User Guide

WSPR TV is an open-source telemetry viewer for several WSPR-based protocols. While the user interface is
designed to be as intuitive as possible, this guide explains some of the site's more advanced features.

## Returning to This Page

If you ever forget something and need to return to this page, the band selection menu
in the control panel (where you specify the HF band) has a `Help` option at the bottom
that will bring you back here.

<img src="images/img1.png" width=360>

Additionally, a small
WSPR TV [link](https://github.com/wsprtv/wsprtv.github.io) next to the OSM attribution in the bottom-right
corner of the screen links to the project's main GitHub page.

## Control Panel

The control panel in the top-left corner of the screen contains most of the parameters for
telemetry visualization.

<img src="images/img2.png" width=360>

### Callsign

This is typically a 4-6 character callsign such as `AB1CDE`. However, for protocols
that use a combination of type 2 / type 3 WSPR messages (see below), a suffix or a prefix can
also be specified: `P/AB1CDE` or `AB1CDE/S`.

### Channel

This field encodes both the protocol and the channel identifier. The following
formats are supported:

- **U4B [`<CH>`]**. U4B is a commonly used telemetry protocol that encodes 6-character Maidenhead
grid location, altitude, speed, voltage, and temperature through a pair of sequential type 1 WSPR messages. 
The first message is a "regular" callsign message, while the second message uses unallocated callsign
space starting with `Q`, `0`, or `1`. `<CH>` is a number between 0 and 599 representing the first and
third characters of the special callsign, the starting minute, and one of 4 frequency "lanes". Example:
`459` on the 10m band signifies transmissions that use Q\*2\* special callsigns, begin 2 minutes after
the start of a 10 minute cycle, and use the last 40 Hz of the frequency band.

  Additional special callsign messages may follow in slots 2-4, representing **enhanced telemetry (ET)**.
These are not shown by default for two reasons: to minimize the load on WSPR Live servers
when only basic telemetry is used, and to update the map as soon as possible,
without waiting for additional slots to be transmitted.

  To specify extended telemetry, use the `E<NUM_ADDITIONAL_SLOTS>` suffix. For example, `459E2` designates
the channel as before but also instructs WSPR TV to look for two additional extended telemetry messages.
`E` used by itself is equivalent to `E1`. `E0` is a special designator that allows extended telemetry
to alternate with basic telemetry in slot 1.

- **U4B [`U<CS1><CS3><M>`]**. This is an alternative U4B channel representation that specifies the first
and third characters of the special callsign as well as the starting minute explicitly. Extended telemetry
(`E`) suffixes may be appended as before. Note: this format carries no frequency lane information,
which WSPR TV does not use anyway. Example: `UQ22E` to represent channel `459` (but also `454`, `449`, etc.)
on the 10 meter band: Q\*2\* special callsigns, starting minute equal to 2,
and one additional extended telemetry message.

- **Generic 1 [`g<M>`]**. This is the simplest type of telemetry, consisting of a single type 1 WSPR message.
Location is indicated
by a 4-character Maidenhead grid locator and provides ~70x100 mi spatial resolution. No other attributes, such as
altitude or speed, are encoded. `<M>` is the starting minute within a 10-minute cycle (must be one of 0, 2, 4, 6,
or 8). Example: `g2` if transmissions begin 2, 12, 22, etc. minutes after the hour.

- **Zachtek 1 [`z<M>`]**. This is an older Zachtek protocol that is similar to `Generic 1` but also coarsely encodes
altitude in the WSPR message's power field (resolution ~1 km). Example: `z8`.

- **Generic 2 [`G<M>`]**. This encoding uses a pair of type 2 / type 3 WSPR messages. The first message
encodes a compound callsign, while the second message adds a 6-character Maidenhead grid locator, improving
spatial resolution to ~3x4 mi. No other attributes are encoded. Both messages must be received for a spot to be
decoded. `<M>` is the starting minute within a 10-minute cycle
(must be one of 0, 2, 4, 6, or 8). Example: `G4` if the first (type 2) message is transmitted
4, 14, 24, etc. minutes after the hour.

- **Zachtek 2 [`Z<M>`]**. A newer Zachtek protocol that is similar to `Generic 2`. The power fields of both
WSPR messages are used to encode the altitude to a resolution of ~60 m. Example: `Z6`.

- **WB8ELK [`W<CS1><CS3><M>`]**. Transmitted via a pair of type 1 messages.
The second message uses special `Q/0/1` callsigns
similar to `U4B`, although the encoding is completely different. Provides altitude to ~60 m resolution, voltage,
and approximate number of GPS satellites (not displayed by WSPR TV). Location is a 6-character Maidenhead grid
locator (~3x4 mi resolution).
`<CS1>` and `<CS3>` are the first and third characters of the special callsign. `<M>` is the starting
minute (must be one of 0, 2, 4, 6, or 8). Example: `WQ46` if Q\*4\* special callsigns are used and
transmissions begin 6 minutes after the start of a 10 minute cycle.

### Band

Specifies the frequency band for WSPR transmissions. There may be additional,
band-unrelated options at the end of this menu, such as a link to this user guide.

### Start Date

The start date is UTC-based and should be in the `YYYY-mm-dd` format, such as `2025-07-15`.
This field defaults to
30 days before today and is a good choice for minimizing the load on WSPR Live servers and making the WSPR TV
user interface more responsive. The start date cannot be more than a year before the end date (specified via
a URL parameter, see below). For historical telemetry, you can specify a start date over a year
ago by appending the appropriate `end_date` parameter to the URL.

## URL Parameters

Because WSPR TV is optimized for use on mobile devices with small screens, the control panel includes
only the most commonly used telemetry parameters. Additional parameters may be specified by appending them
to the URL using the `param1=value1&param2=value2` format.

- **end_date=`<YYYY-mm-dd>`** specifies the end date (up to 23:59:59 in UTC) for a track. `end_date` defaults to
today and cannot be less than `start_date` or more than a year after `start_date`.

- **units=`<metric|imperial>`** specifies the display units. There are other ways to switch units
in WSPR TV (see below).

- **dnu** (abbreviation for "do not update", no value needed) instructs WSPR TV not to update the track
every 10 minutes. `dnu` is implied if `end_date` is in the past. Adding this parameter may make sense
when sharing WSPR TV links widely to minimize the additional load on WSPR Live servers.

The callsign, channel, start date, and band can be specified as URL parameters as well
(using `cs`, `ch`, `start_date`, and `band`
respectively) and will pre-fill the control panel parameters.
Example: `cs=AB1CDE&ch=321&band=10m&start_date=2025-07-15`.

Extended-telemetry-related URL parameters `et_dec`, `et_labels`, `et_llabels`, `et_units`, and `et_res`
are discussed in the Extended Telemetry section of this guide.

## Map View

A track is rendered as a sequence of small white grid4 markers (low resolution) and larger light blue grid6
markers (high resolution). Markers are connected by green lines. Not all grid4 markers are shown
on the map, as that could make tracks look excessively jagged. To see all spots, switch to the data view.

<img src="images/img3.png" width=360>

One peculiarity of the mapping framework used by WSPR TV (Leaflet) is that data is not duplicated across
the antimeridian (i.e., -180/180 longitude). Therefore, as you pan, you may suddenly notice the track
disappear from view. This is not a bug -- the track is still there, but it's now on the other side of the map
(zoom out to see it). WSPR TV provides a visual cue when you are close to the antimeridian: the antimeridian
is shown as a dashed line, and the side of the map that has no data is shaded in grey.

<img src="images/img4.png" width=360>

The Equator is shown as a grey horizontal line. The first spot in the track (after `start_date`) is green,
while the latest one is red. Night / day regions are indicated on the map by grey shading.

### Spot Info

Hovering over a spot (or touching it on a mobile device) brings up the Spot Info panel. This displays most of
the available telemetry, including raw WSPR messages, reception statistics,
and up to 8 extended telemetry values.

<img src="images/img5.png" width=360>

*Clicking* on a spot (vs. hovering) also opens the Spot Info panel, but now the panel remains open when
you move away from the spot, and additional information is displayed:

- A Google Earth link to see "what the balloon is seeing", with the camera positioned at the correct latitude,
longitude, and altitude, and facing East.
Once in Google Earth, holding `CTRL` while pressing the arrow keys (left, right, etc.)
allows you to "look around" without moving the position of the camera.

- RX stations, shown as yellow dots and connected by blue lines. When hovering over an RX marker, the
callsign of the receiving station, distance, and signal strength are shown.

<img src="images/img6.png" width=360>

To close the Spot Info panel, click or touch anywhere on the map outside of a marker.

### Flight Synopsis

A summary of telemetry is displayed in the control panel below the parameter fields. These should be
self-explanatory. The track updates automatically every 10 minutes (unless `end_date` is in the past
or the `dnu` URL parameter was used), and the time of the next update is shown in light yellow.

<img src="images/img7.png" width=360>

There is an easter egg of sorts included in the Flight Synopsis panel -- clicking the distance value
(25313 mi in the example above) will toggle units from imperial to metric or vice versa. This preference
will be remembered if you return to the page later.

Allowing the map to update itself is by far the most efficient way to view real-time data.
Do not refresh the page via the browser -- doing so results in considerably more load on WSPR Live
servers. Periodic updates are already timed to occur at the optimal time -- roughly 75 seconds
after the last message in a TX sequence is received (it takes some time for WSPR messages to trickle
into the WSPR Live database).

### Auxiliary Info

Clicking anywhere on the map outside of a marker brings up the Auxiliary Info bar in the
bottom-left corner of the screen.

<img src="images/img12.png" width=360>

The displayed values include:

- The latitude and longitude of the clicked location (43.07, -52.78 in the example above)
- Current sun elevation at the clicked spot (20°)
- Time since sunrise at the clicked spot (12.4 hours, can be negative during the night)
- Time until sunset at the clicked spot (2.0 hours, can be negative during the night)
- If a track marker was already selected, the great circle distance between that marker
and the clicked spot (157 miles)

## Data View

Clicking on the chart icon (in the top-left corner, below the map zoom buttons) will close the map view
and open the data view. The data view contains:

- A variety of charts for all tracked telemetry values, including extended telemetry.
- A table showing all received spots, including grid4 spots not displayed on the map.
- Buttons to export spots as a CSV table, all raw data as a JSON file, and to switch units.
- A button to display / graph more data, such as computed speed and vertical speed.

<img src="images/img8.png" width=600>

To return to the map view, click on the `X` icon in the top-right corner of the screen.

The map will continue to update every 10 minutes while the data view is open,
but the data view currently does not update periodically. To see fresh values, switch to
the map view and then back to the data view.

### Chart Controls

The charts are interactive and can be zoomed in and out:

- To zoom in on the X-axis: click on a starting point and then drag left or right
(without changing the Y position by more than 20 pixels). You will see a horizontal
slice of the chart being selected.

<img src="images/img9.png" width=600>

- To zoom in on the Y-axis: click on a starting point and then drag up or down
(without changing the X position by more than 20 pixels). You will see a vertical
slice of the chart being selected.

<img src="images/img10.png" width=600>

- If you click and drag left or right, and then drag up or down by more than 20 pixels
(while still clicking), a rectangular area of the chart will be highlighted. If you selected
a rectangular area by mistake, drag to minimize the unwanted dimension to 0; this will
revert the selection to either a horizontal or vertical slice.

<img src="images/img11.png" width=600>

- To zoom out to the original (full) view, double click anywhere on the chart.

### Telemetry Detail

By default, only the core telemetry values are shown in the data view (e.g., speed, altitude,
temperature, and voltage for U4B). The `Show More` button can graph / display several
additional fields:

- Computed values, such as computed speed (based on location changes over time) and vertical
speed (i.e., rate of ascent / descent). These may not be available for every spot, due to
computational uncertainty. Moving from one 6-character grid to the next can
mean covering a distance of 0.1 miles or 7.9 miles. For this reason, waiting until the
location has changed over several grids can be necessary for reasonably accurate (+/- ~10%)
speed estimates.

- RX statistics, such as the number of receiving stations for each spot, maximum SNR, and
maximum RX distance.

- The TX power field reported by WSPR, but only for the U4B protocol and only if the values
differ from spot to spot.

### Unit Conversion

The `Toggle Units` button switches units from metric to imperial and vice versa. The
preference affects all displayed, charted, and CSV exported values in both the map
and data views, and is remembered across browser sessions.

Extended telemetry units are opaque to WSPR TV and are not impacted
by unit conversion.

Another way to switch units is to click on the `Distance` value in the control panel
of the map view.

### Data Export

The `Export CSV` button exports the data view table exactly as it is displayed (in currently
selected units, in the same field order, etc).

The `Get Raw Data` button returns the entire telemetry dataset as a tree-like JSON object. This
includes raw WSPR messages and per-spot RX information.

Example of a raw record:

```
{ "slots":[
     {"ts":"2025-06-02T05:06:00.000Z",
      "cs":"AB1CDE",
      "grid":"JL88",
      "power":7,
      "rx":[{"cs":"DK6UG","grid":"JN49cm","freq":28126141,"snr":-21} ...]},
     ...more slots],
  "ts":"2025-06-02T05:06:00.000Z",
  "grid":"JL88mt",
  "speed":51.856,  // in km/h
  "voltage":3.7, // in V
  "temp":-6,  // in C
  "altitude":13560,  // in meters
  "lat":28.8125,
  "lon":17.041
}
```

Raw data is always exported in metric units and does not depend on the current unit
selection.

The format of raw records may change in future versions of WSPR TV.

## U4B Extended Telemetry

The U4B protocol contains a provision to send extended telemetry as additional
`Q/0/1` messages. The informational content of such a message is first
converted to a so-called `BigNumber`, which is a value between 0 and
389512281599 (equivalent to ~38.5 bits). The least significant bit of
this message (`HdrTelemetryType`) is 1 for basic U4B telemetry
and 0 for extended telemetry. Therefore, approximately 37.5 bits are
available in an extended telemetry message.

The format of basic telemetry messages is well defined in the U4B protocol.
For extended telemetry, there is an existing protocol that we will call ET0
(because the version or HdrRESERVED bits of this protocol are set to 0). This
protocol contains the following header fields, starting from the least
significant bit after `HdrTelemetryType`.

```
HdrRESERVED - 4 values, set to 0 for ET0
HdrType - 16 values, of which only 0 (USER_DEFINED) and 15 (VENDOR_DEFINED) are specified
HdrSlot - 5 values, meant to prevent interference between adjacent U4B channels
```

This header uses up another ~8.3 bits (320 values), with approximately 29.1 bits
remaining for user data.

`HdrRESERVED` values other than 0 are currently not used by any protocols.
A very lightweight extended telemetry protocol could therefore be constructed
as follows:

- Setting the LSB of `HdrRESERVED` to 1. This eliminates interference with ET0,
where messages with `HdrRESERVED` != 0 are filtered out.
- Sending only 1 extended telemetry message per TX cycle in slot 2. This eliminates
interference with other uses of this lightweight protocol in adjacent U4B channels.
- Using the remaining ~36.5 bits for user data.

Note: there is currently no community agreement on such `HdrRESERVED`
bit usage. While most likely OK for one-off uses, this lightweight protocol
should not be deployed at scale (use ET0 instead).

### Decoding ###

WSPR TV has an extremely flexible extended telemetry specification that is able to
handle ET0, the lightweight protocol proposed above, or any past or future protocols
that pack values into contiguous (but possibly fractional) bits of the U4B `BigNumber`.

More precisely, WSPR TV operates on `BigNumber / 2`, with the least significant bit
(`HdrTelemetryType`) removed since it is always 0. When `BigNumber` is mentioned later
in this section, it will always be this truncated, 37.5 bit version.

The basic building block of WSPR TV's extended telemetry specification is the **decoder**.
A decoder contains a set of rules on what conditions a message must pass to be
decoded (aka filters), plus a set of rules on how individual values should be
extracted from `BigNumber` (aka extractors). The `et_dec` URL parameters consists
of one or more *decoders*, separated by the `~` character:

```
et_dec=<decoder1_spec>~<decoder2_spec>~...
```

Each decoder in turn consists of zero or more filters and one or more extractors. The
filters are separated from the extractors with underscores (`_`), whereas individual
filters and extractors are separated from each other with commas (`,`):

```
decoder_spec: <filter1>,<filter2>..._<extractor1>,<extractor2>...
```

### Filter Specification

All filters in a decoder must pass for value extraction to happen. Filters express
conditions on snippets of the `BigNumber`, which are usually headers or message type
selectors. For example, in the ET0 protocol, the following conditions should be
true for a message to be accepted:

- `HdrRESERVED` (4 values) is set to 0
- `HdrType` (16 values) is set to the desired type (e.g., 0 for USER_DEFINED)
- `HdrSlot` is set to the slot in which the ET message was received

The basic filter definition in WSPR TV is

```
<divisor>:<modulus>:<expected_value>
```

expressing the following condition:

```
(BigNumber / divisor) % modulus == expected_value
```

To support ET0, the special variable `s` is available to represent the TX slot in which the
extended telemetry message was received. This allows us to express the filter set for
ET0 as follows:

```
1:4:0,4:16:0,64:5:s
```

To explain, we first check that the truncated `BigNumber` (here again we refer to our version of
`BigNumber` with the `HdrTelemetryType` bit removed)
has 0 in its least significant 2 bits. To do this, we divide `BigNumber` by 1 and then extract
the 4 possible values of the `HdrRESERVED` field using a modulus of 4. This value has to be equal to 0.
Hence the first filter is `1:4:0`.

We then access the adjacent `HdrType` field by dividing `BigNumber` by 4 (this skips over `HdrRESERVED`)
and extracting 1 of 16 possible values using a modulus of 16. This value also has to be equal to 0
(for USER_DEFINED). Hence the second filter is `4:16:0`. 

Finally, we check that `HdrSlot` matches the slot in which the message was received. Now we have to skip
over both the `HdrRESERVED` and `HdrType` fields, hence the division is by 4 * 16 = 64. We use a modulus of 5
to extract the 5 possible values. The expected value is the variable `s`. The third filter is therefore
`64:5:s`.

If this is confusing, there is a built-in **shorthand for ET0 telemetry**: `et0:<type>`. This allows us to
replace `1:4:0,4:16:0,64:5:s` with simply `et0:0` for USER_DEFINED messages.

### Time-Dependent Filters

WSPR TV has a powerful mechanism for multiplexing multiple message types in the same slot, without
using any additional bits to specify which schema is used -- the variable `t`. This variable is set to the
TX sequence number, which starts at 0 at UTC midnight and then increments every 2 minutes (e.g., at 6:30 UTC
the value is (6 * 60 + 30) / 2 = 195). The counter resets at 00:00 UTC every day. Note: `t` refers to the
time of the regular callsign message in the current TX sequence (slot 0), not the slot of the extended
telemetry message.

This variable can be used instead of `BigNumber` in filters:

```
t:<divisor>:<modulus>:<expected_value>
```

expressing the condition

```
(TX_sequence_num / divisor) % modulus == expected_value
```

This allows WSPR TV to decode messages differently every other transmission,
during odd hours of the day, etc. Several message types can be multiplexed
into the same ET slot.

Another time-dependent filter uses the variable `s` and has the format `s:<slot>`,
such as `s:2`. This allows, for example, different handling of messages in slot 2
vs slot 3.

### Value Extraction

Once all filters in a decoder pass, a set of values are extracted. Generally,
extraction is specified using the following tuple of parameters:

```
<divisor>:<modulus>:<offset>:<slope>
```

`divisor` and `modulus` here specify how to extract the raw value from `BigNum`,
while `offset` and `slope` are used to linearly transform the raw value into its
decoded form:

```
raw_value = (BigNumber / divisor) % modulus
value = offset + raw_value * slope
```

As an example, suppose an ET0 message has 110 values of `Pressure` in its least
significant bits, and then 90 values of `Heading` immediately after. `Pressure`
starts at 0 and increments 0.001 Bar with every step, while `Heading` starts
at 0 and increments by 4 degrees. These values can then be extracted as follows:

```
320:110:0:0.001,35200:90:0:4
```

The divisor here starts at 320 because we need to skip over the ET0 header (which has 320 values).
35200 is 320 * 110 -- we are skipping over both the header and the `Pressure` value.

Because extracted values are often contiguous, a **simplified** 3-term extractor
specification is also available:

```
<modulus>:<offset>:<slope>
```

The divisor here is implied by taking the last divisor and multiplying it by the modulus
of the previous extractor. If no initial divisor is specified anywhere (i.e., all extractors
are 3-term), the divisor starts at 1 for unspecified protocols and at the end of headers
for known protocols (e.g., initial_divisor = 320 when one of the filters in the decoder
specification is of the `et0:<slot>` form).

For the previous Pressure / Heading example, the filter specification becomes:

```
110:0:0.001,90:0:4
```

and the full decoder may look as follows:

```
et0:0,s:2_110:0:0.001,90:0:4
```

Note that the `<modulus aka num_values>:<offset>:<slope>` format is different from Traquito's
`<min_value>:<high_value>:<step_size>`. However, there is a trivial mapping between the two:

```
num_values = 1 + (max_value - min_value) / step_size
offset = min_value
slope = step_size
```

### Extended Telemetry Annotation

With just an `et_dec` specification, all available extended telemetry values will
be extracted, displayed, and graphed. However, they will be assigned default names
such as `ET0`, `ET1`, etc., will have no units attached, and will be displayed as
integers.

WSPR TV offers a set of extended telemetry annotation parameters --
`et_labels`, `et_llabels`, `et_units`, and `et_res` to customize the display
of ET values. All of these are a comma-separated list of parameters, with
one value per extractor specification. For example, if there are 2 decoders
containing 4 and 5 extractors respectively, then the 7th item in `et_units`
will correspond to the 3rd extractor of the second decoder.

Only non-default values need to be specified in the above URL parameters.
For example, here is how to assign units to the 4th extractor while keeping
all the other values unitless.

```
et_units=,,,mph
```

The following is a brief summary of ET annotation parameters:

- **et_labels** contains *short* labels (one label per extractor) that will
be shown instead of the default `ET0`, `ET1`, etc., field names.
Short labels are used in table headers and in the Spot Info panel.
These are typically abbreviations, such as "VSpeed" for "Vertical Speed".
The labels should be no longer than 32 characters and contain only
alphanumeric characters, spaces, and the characters `#` and `_`.

- **et_llabels** is for specifying *long* labels that will be shown instead
of the default `ET0`, `ET1`, etc., field names.
Long labels are used in chart titles and in CSV file headers.
These are typically descriptive names such as "Vertical Speed".
The labels should be no longer than 64 characters and contain only 
alphanumeric characters, spaces, and the characters `#` and `_`.

- **et_units** contains units that will be attached to extracted values
where appropriate. These should be at most 8 character long and contain
only alphanumeric characters, spaces, and the character `/`.

- **et_res** specifies resolution for ET values, which are shown as
integers by default. A resolution of 2 means that 2 digits will be
displayed after the decimal point (e.g., 3.14 instead of 3).

### Extended Telemetry URL Generation

In a future version of WSPR TV, a wizard will be available to generate
ET URL parameters using a web form. For now, these parameters must be constructed
by hand with some practice and bookmarked for future use.

## License

WSPR TV is open-source under the AGPL-3.0
license and can be used freely as long as the license conditions are met.
In particular, the license requires that:

- If any part of your project is derived from WSPR TV in any way, your entire
project must also be open-source under AGPL-3.0.
- All components of your project must be AGPL-3.0 compatible. For example,
you cannot use MapBox JS mapping libraries because those are only available
under proprietary licenses in recent releases.
- Proper attribution to WSPR TV must be provided both in your source code and in
the UI. In the source code, you must clearly state what code was copied and
how it was modified. All copyright and license notices must be preserved.

See the [AGPL-3.0 license](https://www.gnu.org/licenses/agpl-3.0.en.html#license-text)
for details.

The source code for WSPR TV is available on [GitHub](https://github.com/wsprtv/wsprtv.github.io).
