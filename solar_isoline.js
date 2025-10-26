// Displays solar elevation isoline on a Leaflet map.
//
// Based on https://github.com/joergdietrich/Leaflet.Terminator.
//
// Original code is licensed under the MIT License:
// https://opensource.org/licenses/MIT.
//
// Modified code is licensed under AGPL-3.0.
// Copyright (C) 2025 WSPR TV authors.

L.SolarIsoline = L.Polyline.extend({
	options: {
		elevation: 13,  // Sun elevation, degrees
		interactive: false, // Disable "clickable" mouse pointer
		color: 'gray',
		weight: 1.3,
		opacity: 0.5,
		resolution: 2,
		longitudeRange: 360
	},

	initialize: function (options) {
		this.version = '0.1.0';
		this._R2D = 180 / Math.PI;
		this._D2R = Math.PI / 180;
		L.Util.setOptions(this, options);
		var latLng = this._compute(this.options.time);
		this.setLatLngs(latLng);
	},

	setTime: function (date) {
		this.options.time = date;
		var latLng = this._compute(date);
		this.setLatLngs(latLng);
	},

	_julian: function (date) {
		/* Calculate the present UTC Julian Date. Function is valid after
	 	* the beginning of the UNIX epoch 1970-01-01 and ignores leap
	 	* seconds. */
		return (date / 86400000) + 2440587.5;
	},

	_GMST: function (julianDay) {
		/* Calculate Greenwich Mean Sidereal Time according to
			 http://aa.usno.navy.mil/faq/docs/GAST.php */
		var d = julianDay - 2451545.0;
		// Low precision equation is good enough for our purposes.
		return (18.697374558 + 24.06570982441908 * d) % 24;
	},

	_sunEclipticPosition: function (julianDay) {
		/* Compute the position of the Sun in ecliptic coordinates at
			 julianDay.  Following
			 http://en.wikipedia.org/wiki/Position_of_the_Sun */
		// Days since start of J2000.0
		var n = julianDay - 2451545.0;
		// mean longitude of the Sun
		var L = 280.460 + 0.9856474 * n;
		L %= 360;
		// mean anomaly of the Sun
		var g = 357.528 + 0.9856003 * n;
		g %= 360;
		// ecliptic longitude of Sun
		var lambda = L + 1.915 * Math.sin(g * this._D2R) +
			0.02 * Math.sin(2 * g * this._D2R);
		// distance from Sun in AU
		var R = 1.00014 - 0.01671 * Math.cos(g * this._D2R) -
			0.0014 * Math.cos(2 * g * this._D2R);
		return {lambda: lambda, R: R};
	},

	_eclipticObliquity: function (julianDay) {
		// Following the short term expression in
		// http://en.wikipedia.org/wiki/Axial_tilt#Obliquity_of_the_ecliptic_.28Earth.27s_axial_tilt.29
		var n = julianDay - 2451545.0;
		// Julian centuries since J2000.0
		var T = n / 36525;
		var epsilon = 23.43929111 -
			T * (46.836769 / 3600
				- T * (0.0001831 / 3600
					+ T * (0.00200340 / 3600
						- T * (0.576e-6 / 3600
							- T * 4.34e-8 / 3600))));
		return epsilon;
	},

	_sunEquatorialPosition: function (sunEclLng, eclObliq) {
		/* Compute the Sun's equatorial position from its ecliptic
		 * position. Inputs are expected in degrees. Outputs are in
		 * degrees as well. */
		var alpha = Math.atan(Math.cos(eclObliq * this._D2R)
			* Math.tan(sunEclLng * this._D2R)) * this._R2D;
		var delta = Math.asin(Math.sin(eclObliq * this._D2R)
			* Math.sin(sunEclLng * this._D2R)) * this._R2D;

		var lQuadrant = Math.floor(sunEclLng / 90) * 90;
		var raQuadrant = Math.floor(alpha / 90) * 90;
		alpha = alpha + (lQuadrant - raQuadrant);

		return {alpha: alpha, delta: delta};
	},

	_hourAngle: function (lng, sunPos, gst) {
		/* Compute the hour angle of the sun for a longitude on
		 * Earth. Return the hour angle in degrees. */
		var lst = gst + lng / 15;
		return lst * 15 - sunPos.alpha;
	},

	_latitudes: function (ha, sunPos) {
		// Auxiliary angle solution (R method)
		var sinDelta = Math.sin(sunPos.delta * this._D2R);
		var cosDelta = Math.cos(sunPos.delta * this._D2R);
		var cosHa = Math.cos(ha * this._D2R);
		var sinElev = Math.sin(this.options.elevation * this._D2R);

		var beta = Math.atan2(sinDelta, cosDelta * cosHa);
		var R = Math.sqrt(sinDelta * sinDelta + (cosDelta * cosHa) * (cosDelta * cosHa));
		if (R == 0) return [];
		var ER = sinElev / R;
		if (Math.abs(ER) > 1) return [];

		var lat1 = (beta + Math.acos(ER)) * this._R2D;
		var lat2 = (beta - Math.acos(ER)) * this._R2D;

		if (lat1 > 180) lat1 -= 360;
		if (lat1 <= -180) lat1 += 360;
		if (lat2 > 180) lat2 -= 360;
		if (lat2 <= -180) lat2 += 360;

		if (lat1 < -90 || lat1 > 90) lat1 = (sunPos.delta < 0) ? -90 : 90;
		if (lat2 < -90 || lat2 > 90) lat2 = (sunPos.delta < 0) ? -90 : 90;

		if (Math.abs(lat1) == 90 && Math.abs(lat2) == 90) return [];

		return (lat1 > lat2) ? [lat1, lat2] : [lat2, lat1];
	},

	_compute: function (time) {
		var today = time ? new Date(time) : new Date();
		var julianDay = this._julian(today);
		var gst = this._GMST(julianDay);
		var sunEclPos = this._sunEclipticPosition(julianDay);
		var eclObliq = this._eclipticObliquity(julianDay);
		var sunEqPos = this._sunEquatorialPosition(sunEclPos.lambda, eclObliq);

		var latLngs1 = [];
		var latLngs2 = [];
                var latLngs = [];
		for (var i = 0; i <= this.options.longitudeRange * this.options.resolution; i++) {
			var lng = -this.options.longitudeRange/2 + i / this.options.resolution;
			var ha = this._hourAngle(lng, sunEqPos, gst);
			var lats = this._latitudes(ha, sunEqPos);
			if (lats.length == 0) {
				if (latLngs1.length > 0) {
					latLngs.push([...latLngs1, ...[...latLngs2].reverse(), latLngs1[0]]);
					latLngs1 = [];
					latLngs2 = [];
				}
				continue;
			}
			latLngs1.push([lats[0], lng]);
			latLngs2.push([lats[1], lng]);
		}
		if (latLngs1.length > 0) {
			latLngs.push([...latLngs1, ...[...latLngs2].reverse(), latLngs1[0]]);
		}
		return latLngs;
	}
});

L.solar_isoline = function (options) {
	return new L.SolarIsoline(options);
};
