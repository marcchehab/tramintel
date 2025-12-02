#!/usr/bin/env python3
"""Find truly cancelled trams from Roswiesen"""
import json
from datetime import datetime, timezone, timedelta
import urllib.request

# Fetch data
url = 'https://transport.opendata.ch/v1/stationboard?station=Roswiesen&limit=50&transportations[]=tram'
with urllib.request.urlopen(url) as response:
    data = json.load(response)

tz = timezone(timedelta(hours=1))
now = datetime.now(tz)

cancelled_found = False

for entry in data['stationboard']:
    stop = entry['stop']
    number = entry['number']
    to = entry['to']
    scheduled_departure = stop.get('departure')

    if not scheduled_departure:
        continue

    sched_dt = datetime.fromisoformat(scheduled_departure.replace('+0100', '+01:00'))

    # Only look at FUTURE trams (at least 2 minutes from now to avoid edge cases)
    time_until = (sched_dt - now).total_seconds()
    if time_until < 120:  # Skip if departing in less than 2 minutes
        continue

    # Skip far future (beyond what API provides real data for)
    if time_until > 3600:  # Skip if more than 1 hour away
        continue

    prognosis = stop.get('prognosis', {})

    # Check for cancellation
    is_cancelled = False
    reason = None

    # Method 1: cancelled field
    if stop.get('cancelled'):
        is_cancelled = True
        reason = 'cancelled=true'

    # Method 2: prognosis.departure is null (for future tram)
    elif prognosis and prognosis.get('departure') is None:
        is_cancelled = True
        reason = 'prognosis.departure=null'

    # Method 3: prognosis.departure in the past (weird timestamp bug)
    elif prognosis and prognosis.get('departure'):
        prog_dt = datetime.fromisoformat(prognosis['departure'].replace('+0100', '+01:00'))
        if (now - prog_dt).total_seconds() > 120:  # Prognosis is >2 min in past
            is_cancelled = True
            reason = f'prognosis={prog_dt.strftime("%H:%M")} (in past)'

    if is_cancelled:
        cancelled_found = True
        print(f'T{number} to {to}')
        print(f'  Scheduled: {sched_dt.strftime("%H:%M")} (in {int(time_until/60)} min)')
        print(f'  Reason: {reason}')
        print()

if not cancelled_found:
    print('No cancelled trams found in the next hour.')
