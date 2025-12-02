#!/usr/bin/env python3
"""
Check if scheduled time + delay equals prognosis departure time
"""
import requests
from datetime import datetime, timedelta

# Fetch data from both stations
stations = [
    ("Roswiesen", "https://transport.opendata.ch/v1/stationboard?station=Roswiesen&limit=100&transportations[]=tram"),
    ("Heerenwiesen", "https://transport.opendata.ch/v1/stationboard?station=Heerenwiesen&limit=100&transportations[]=tram")
]

all_entries = []
for station_name, url in stations:
    response = requests.get(url)
    data = response.json()
    for entry in data['stationboard']:
        entry['_station'] = station_name
        all_entries.append(entry)

total = 0
matches = 0
differences = 0
no_prognosis = 0
mismatches = []

for entry in all_entries:
    total += 1
    station = entry['_station']
    line = f"{entry['category']}{entry['number']}"
    to = entry['to']

    # Get scheduled departure
    scheduled_str = entry['stop']['departure']
    scheduled = datetime.fromisoformat(scheduled_str.replace('+0100', '+01:00'))

    # Get delay in minutes
    delay_min = entry['stop'].get('delay', 0) or 0

    # Calculate: scheduled + delay
    calculated = scheduled + timedelta(minutes=delay_min)

    # Get prognosis departure
    prognosis = entry['stop'].get('prognosis', {})
    prognosis_str = prognosis.get('departure') if prognosis else None

    if prognosis_str:
        prognosis_time = datetime.fromisoformat(prognosis_str.replace('+0100', '+01:00'))
        diff_seconds = (prognosis_time - calculated).total_seconds()

        if diff_seconds == 0:
            matches += 1
        else:
            differences += 1
            mismatches.append({
                'station': station,
                'line': line,
                'to': to,
                'scheduled': scheduled,
                'delay': delay_min,
                'calculated': calculated,
                'prognosis': prognosis_time,
                'diff_seconds': diff_seconds
            })
    else:
        no_prognosis += 1

print(f"Analysis of {total} tram departures:\n")
print(f"  Exact matches (scheduled+delay == prognosis): {matches}")
print(f"  Differences found: {differences}")
print(f"  No prognosis data: {no_prognosis}")

if mismatches:
    print(f"\n{differences} departures with differences:")
    for m in mismatches:
        print(f"\n  {m['station']}: {m['line']} to {m['to']}")
        print(f"    Scheduled: {m['scheduled'].strftime('%H:%M:%S')} + {m['delay']}min delay = {m['calculated'].strftime('%H:%M:%S')}")
        print(f"    Prognosis: {m['prognosis'].strftime('%H:%M:%S')}")
        print(f"    Difference: {m['diff_seconds']} seconds")
else:
    print("\n✓ All departures match! scheduled+delay == prognosis.departure")
