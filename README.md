# WSPR Telemetry Viewer (WSPR TV)
WSPR TV is a picoballoon telemetry visualization tool serving a small but growing community of radio amateurs worldwide.
The code in this repository is accessible through https://wsprtv.github.com and also the DNS alias https://wsprtv.com.

## Features
- Supports several telemetry protocols, including U4B, WB8ELK and Zachtek.
- Displays extended U4B telemetry (currently only as an opaque number).
- Visualizes real-time flight data on a full-screen map, as well as in a table format and through interactive charts.
- Provides a way to download the entire dataset for a flight as a JSON file.
- Mobile friendly -- works great even on small screens.

## Acknowledgements
This project relies heavily [WSPR Live](https://wspr.live) -- a free and publicly available database of over 10 billion
WSPR reports accessible via a SQL interface. The service is hosted on [WsprDaemon's](http://http://wsprdaemon.org) servers.

WSPR TV's UI is built around the excellent [Leaflet](https://leafletjs.com) mapping library and the snappy
[uPlot](https://github.com/leeoniya/uPlot) charts.
