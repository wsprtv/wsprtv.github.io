#! /usr/bin/python3

from datetime import datetime, timedelta, timezone
import json
import string

def GetMaidenhead(lat, lon, grid6 = False):
  grid = ''
  grid += chr(ord('A') + int((lon + 180) / 20))
  grid += chr(ord('A') + int((lat + 90) / 10))
  grid += chr(ord('0') + int((lon + 180) / 2) % 10)
  grid += chr(ord('0') + int(lat + 90) % 10)
  if grid6:
    grid += chr(ord('a') + int((lon + 180) * 12) % 24)
    grid += chr(ord('a') + int((lat + 90) * 24) % 24)
  return grid

def OutputMessage(ts, cs, grid, power):
  rx = [{ 'cs': 'TE5T', 'grid': 'FN20', 'freq': 14097146, 'snr': -8 }]
  return {
    'ts': ts.strftime('%Y-%m-%d %H:%M'),
    'cs': cs,
    'grid': grid,
    'power': power,
    'rx': rx
  }

def OutputBigNum(ts, v):
  if v & 1 == 0:
    v = v >> 1
    v = (v // 320) * 320 + (v % 5) * 64 + ((v // 5) % 4) + \
        ((v // 20) % 16) * 4
    v = v << 1
  m = v // 615600
  n = v % 615600
  alpha = list(string.ascii_uppercase)
  alphanum = list(string.digits + string.ascii_uppercase)
  cs5 = alpha[m % 26]
  m //= 26
  cs4 = alpha[m % 26]
  m //= 26
  cs3 = alpha[m % 26]
  m //= 26
  cs1 = alphanum[m % 36]
  cs = 'Q' + cs1 + '1' + cs3 + cs4 + cs5
  power = [0, 3, 7, 10, 13, 17, 20, 23, 27, 30, 33, 37, 40,
      43, 47, 50, 53, 57, 60][n % 19]
  n //= 19
  g3 = alphanum[n % 10]
  n //= 10
  g2 = alphanum[n % 10]
  n //= 10
  g1 = alpha[n % 18]
  n //= 18
  g0 = alpha[n % 18]
  grid = g0 + g1 + g2 + g3
  return OutputMessage(ts, cs, grid, power)

def OutputSlot0(ts, lat, lon):
  grid = GetMaidenhead(lat, lon)
  return OutputMessage(ts, 'TE5T', grid, 13)

def OutputCT(ts, slot, v):
  v *= 5
  v += slot
  v = v << 1
  return OutputBigNum(GetSlotTimestamp(ts, slot), v)

def OutputST(ts, lat, lon, altitude, temp, voltage, speed):
  grid = GetMaidenhead(lat, lon, True)
  m = (ord(grid[4]) - ord('a')) * 24 + (ord(grid[5]) - ord('a'))
  m *= 1068
  m += altitude // 20
  n = temp + 50
  n *= 40
  n += int((voltage - 2) * 20)
  n *= 42
  n += int(speed / 3.704)
  n *= 2
  n += 1
  n *= 2
  n += 1
  return OutputBigNum(GetSlotTimestamp(ts, 1), m * 615600 + n)

def GetSlotTimestamp(ts, slot):
  return ts + slot * timedelta(minutes = 2)

def ParseTimestamp(ts):
  t = datetime.strptime(ts, '%Y-%m-%d %H:%M')
  t = t.replace(tzinfo = timezone.utc)
  return t

def PackCT(values):
  v = 0
  for (size, value) in values:
    v = v * size + value
  return v

############################################
# Test1
# Custom standard telemetry
# (higher lat/lon/alt res, no voltage / temp)
############################################

slots = []

ts = ParseTimestamp('2026-03-01 02:00')
lat = 37.810
lon = -122.477
altitude = 12000
speed = 120
slots.append(OutputSlot0(ts, lat, lon))

v = PackCT([[100, speed // 3],
            [1690, altitude // 10],
            [480, int((lat + 90) * 480) % 480],
            [480, int((lon + 180) * 240) % 480]])

slots.append(OutputCT(ts, 1, v))

open('test_1.json', 'w').write(json.dumps(slots))

############################################
# Test2
# 1-day old spot in slot 2 -- grid6 + alt
############################################

slots = []

ts = ParseTimestamp('2026-03-01 02:00')
lat1 = 40.735
lon1 = -73.967
altitude1 = 12000
temp1 = -30
voltage1 = 4.1
speed1 = 120
slots.append(OutputSlot0(ts, lat1, lon1))
slots.append(OutputST(ts, lat1, lon1, altitude1, temp1, voltage1, speed1))

lat2 = 40.11
lon2 = -75.15
altitude2 = 10000

v = PackCT([[20, altitude2 // 20],
            [4320, int(4320 * (lon2 + 180) / 360)],
            [4320, int(4320 * (lat2 + 90) / 180)]])

slots.append(OutputCT(ts, 2, v))

open('test_2.json', 'w').write(json.dumps(slots))

############################################
# Test3
# Two grid6 spots sent in the same cycle
############################################

slots = []

ts = ParseTimestamp('2026-03-01 02:00')
lat1 = 51.518
lon1 = -0.117
altitude1 = 12130
temp1 = -40
voltage1 = 4.1
speed1 = 160
slots.append(OutputSlot0(ts, lat1, lon1))
slots.append(OutputST(ts, lat1, lon1, altitude1, temp1, voltage1, speed1))

lat2 = 48.858
lon2 = 2.347
altitude2 = 13130
voltage2 = 3.65
speed2 = 242
temp2 = -65

v = PackCT([[115, speed2 // 3],
            [180, int((lon2 + 180) / 2)],
            [180, int(lat2 + 90)],
            [10080, 2 * 720]])

slots.append(OutputCT(ts, 2, v))

v = PackCT([[120, temp2 + 70],
            [80, round((voltage2 - 2) / 0.05)],
            [1700, altitude2 // 10],
            [24, int((lon2 + 180) * 12) % 24],
            [24, int((lat2 + 90) * 24) % 24]])

slots.append(OutputCT(ts, 3, v))

open('test_3.json', 'w').write(json.dumps(slots))

############################################
# Test4
# Type aliasing
############################################

slots = []

ts1 = ParseTimestamp('2026-03-01 02:00')
lat1 = 51.518
lon1 = -0.117
altitude1 = 12130
temp1 = -40
voltage1 = 4.1
speed1 = 110
slots.append(OutputSlot0(ts1, lat1, lon1))
slots.append(OutputST(ts, lat1, lon1, altitude1, temp1, voltage1, speed1))

v = PackCT([[100, 20], [100, 10]])
slots.append(OutputCT(ts, 2, v))

ts2 = ParseTimestamp('2026-03-01 05:00')
lat2 = 48.858
lon2 = 2.347
altitude2 = 13130
temp2 = -45
voltage2 = 3.65
speed2 = 120

slots.append(OutputSlot0(ts2, lat2, lon2))
slots.append(OutputST(ts2, lat2, lon2, altitude2, temp2, voltage2, speed2))

v = PackCT([[100, 40], [100, 30]])
slots.append(OutputCT(ts2, 3, v))

open('test_4.json', 'w').write(json.dumps(slots))
