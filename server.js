require('dotenv').config();
const express = require('express');
const https = require('https');
const path = require('path');
const zlib = require('zlib');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');

const app = express();
const PORT = process.env.PORT || 3000;
const isDevelopment = process.env.NODE_ENV !== 'production';

// Hot reloading setup for development
if (isDevelopment) {
  const livereload = require('livereload');
  const connectLivereload = require('connect-livereload');

  // Create livereload server
  const liveReloadServer = livereload.createServer({
    exts: ['html', 'css', 'js'],
    delay: 500
  });
  liveReloadServer.watch(path.join(__dirname, 'public'));

  // Inject livereload script into HTML
  app.use(connectLivereload());

  console.log('🔥 Hot reloading enabled for development');
}

// API Configuration
// Get your own API key from https://api-manager.opentransportdata.swiss/
const API_KEY = process.env.GTFS_API_KEY || 'eyJvcmciOiI2NDA2NTFhNTIyZmEwNTAwMDEyOWJiZTEiLCJpZCI6IjRhMjJjNDExZGMyMjRjNmFhODI3MTYxZmY1OTUwMzIzIiwiaCI6Im11cm11cjEyOCJ9';
const GTFS_RT_URL = 'https://api.opentransportdata.swiss/la/gtfs-rt';

// Serve static files from public directory (but not index.html in dev mode)
app.use(express.static('public', {
  index: isDevelopment ? false : 'index.html'
}));

// Configuration for the tram stops
// Using official GTFS stop IDs with platform suffixes from GTFS-RT feed
// Trying exact platform IDs found in debug output
const STOPS = {
  roswiesen: {
    name: 'Roswiesen',
    stopId: '8591325:0:10000',  // Exact platform ID from GTFS-RT (Seq 5)
    line: '7'
  },
  heerenwiesen: {
    name: 'Heerenwiesen',
    stopId: '8591181:0:10001',  // Exact platform ID from GTFS-RT (Seq 5)
    line: '9'
  }
};

// Fetch GTFS-RT feed from opentransportdata.swiss
function fetchGTFSRTFeed() {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'Tramintel/1.0',
        'Accept-Encoding': 'gzip, deflate'
      }
    };

    const handleResponse = (res) => {
      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        https.get(res.headers.location, { headers: { 'User-Agent': 'Tramintel/1.0' } }, handleResponse)
          .on('error', reject);
        return;
      }

      const chunks = [];

      //  The redirected URL returns uncompressed data
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });

      res.on('end', () => {
        let buffer;
        try {
          buffer = Buffer.concat(chunks);
          const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
            new Uint8Array(buffer)
          );
          resolve(feed);
        } catch (error) {
          console.error('GTFS-RT decode error:', error.message);
          if (buffer) {
            console.error('Buffer size:', buffer.length);
            console.error('First 50 bytes:', buffer.slice(0, 50));
          }
          reject(error);
        }
      });

      res.on('error', (error) => {
        reject(error);
      });
    };

    https.get(GTFS_RT_URL, options, handleResponse).on('error', reject);
  });
}

// Parse GTFS-RT feed to extract departures for a specific stop and line
function extractDepartures(feed, stopId, lineNumber, debugMode = false) {
  const now = Math.floor(Date.now() / 1000);
  const departures = [];
  const matchedRoutes = new Set();
  const stopsForLine = new Set();

  // Debug: Sample stop IDs and route IDs from the feed
  if (debugMode) {
    const sampleStops = new Set();
    const sampleRoutes = new Set();
    let count = 0;

    for (const entity of feed.entity) {
      if (!entity.tripUpdate || count >= 50) break;
      const trip = entity.tripUpdate.trip;
      const stopTimeUpdates = entity.tripUpdate.stopTimeUpdate || [];

      if (trip.routeId) sampleRoutes.add(trip.routeId);
      for (const stu of stopTimeUpdates) {
        if (stu.stopId) sampleStops.add(stu.stopId);
      }
      count++;
    }

    console.log(`\n=== GTFS-RT Debug for Stop ${stopId}, Line ${lineNumber} ===`);
    console.log('Sample route IDs:', Array.from(sampleRoutes).slice(0, 10));
    console.log('Sample stop IDs:', Array.from(sampleStops).slice(0, 15));
  }

  for (const entity of feed.entity) {
    if (!entity.tripUpdate) continue;

    const trip = entity.tripUpdate.trip;
    const stopTimeUpdates = entity.tripUpdate.stopTimeUpdate || [];

    // Check if any of the stop time updates match our stop
    // Stop IDs in GTFS-RT may have platform suffixes (::0, ::1, etc.)
    // So we check if the stop ID starts with our parent station ID
    const hasOurStop = stopTimeUpdates.some(stu => stu.stopId && stu.stopId.startsWith(stopId));
    if (hasOurStop) {
      matchedRoutes.add(trip.routeId);
    }

    // Filter for the specific line (route short name matches the line number)
    // GTFS route IDs for VBZ trams are like "1-7-A-j25-1" where the second number is the line
    const routeId = trip.routeId || '';
    const routeParts = routeId.split('-');
    const routeLine = routeParts.length >= 2 ? routeParts[1] : '';

    // Collect stops for routes matching our line
    if (routeLine === lineNumber) {
      for (const stu of stopTimeUpdates) {
        if (stu.stopId) stopsForLine.add(stu.stopId);
      }
    }

    if (routeLine !== lineNumber) continue;

    // Find stop time updates for our specific stop
    // Match by prefix to handle platform suffixes (::0, ::1, etc.)
    // If stopId is null, get ALL stops for this line
    for (const stu of stopTimeUpdates) {
      if (!stu.stopId) continue;
      if (stopId && !stu.stopId.startsWith(stopId)) continue;

      const departure = stu.departure;
      const arrival = stu.arrival;

      // Debug: Log what fields are available
      if (debugMode && stopId && stu.stopId.startsWith(stopId) && departures.length < 3) {
        console.log(`  Debug STU: stopId=${stu.stopId}, stopSeq=${stu.stopSequence}`);
        console.log(`    departure:`, departure ? JSON.stringify(departure) : 'null');
        console.log(`    arrival:`, arrival ? JSON.stringify(arrival) : 'null');
      }

      // GTFS-RT has departure.time OR we need to use arrival.time
      const timeData = departure || arrival;
      if (!timeData || !timeData.time) continue;

      const departureTime = Number(timeData.time);

      // Only include future departures
      if (departureTime < now) continue;

      // Get delay in seconds (0 if not available)
      const delaySeconds = timeData.delay || 0;

      departures.push({
        tripId: trip.tripId,
        routeId: trip.routeId,
        stopId: stu.stopId,  // Include stop ID so we can identify which stop
        departureTime: departureTime,
        delaySeconds: delaySeconds,
        stopSequence: stu.stopSequence
      });
    }
  }

  // Sort by departure time
  departures.sort((a, b) => a.departureTime - b.departureTime);

  if (debugMode) {
    console.log(`Routes at stop ${stopId}:`, Array.from(matchedRoutes).slice(0, 5));
    console.log(`Stops for line ${lineNumber}:`, Array.from(stopsForLine).slice(0, 10));
    console.log(`Found ${departures.length} departures`);
    console.log('===\n');
  }

  if (departures.length === 0 && matchedRoutes.size > 0) {
    console.log(`No departures for stop ${stopId} line ${lineNumber}, but found these routes at the stop:`, Array.from(matchedRoutes));
  }

  return departures;
}

// Get destination from trip ID (fallback method)
function extractDestination(tripId) {
  // Trip IDs often contain destination info, but this varies
  // This is a simplified approach - ideally we'd use static GTFS data
  const parts = tripId.split('.');
  if (parts.length > 0) {
    return parts[parts.length - 1];
  }
  return 'Unknown';
}

// Fallback to transport.opendata.ch for additional metadata (destination names)
function fetchStationboard(stationName, lineNumber) {
  return new Promise((resolve, reject) => {
    const url = `https://transport.opendata.ch/v1/stationboard?station=${encodeURIComponent(stationName)}&limit=20&transportations[]=tram`;

    https.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const filtered = parsed.stationboard
            .filter(dep => dep.category === 'T' && dep.number === lineNumber)
            .map(dep => ({
              departure: dep.stop.departure,
              destination: dep.to,
              operator: dep.operator,
              delay: (dep.stop.delay || 0) * 60, // Convert minutes to seconds
              tripName: dep.name // Trip identifier from OpenData
            }));
          resolve(filtered);
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', (error) => {
      reject(error);
    });
  });
}

// Hybrid approach: Get schedules from transport.opendata.ch, overlay GTFS-RT delays
async function getDeparturesWithRealTimeDelays(stopName, stopId, lineNumber, feed) {
  try {
    // 1. Get scheduled departures from transport.opendata.ch (has schedule + stop names + delays)
    const stationboard = await fetchStationboard(stopName, lineNumber);

    // 2. If GTFS-RT feed is unavailable, return OpenData's own delay info
    if (!feed) {
      return stationboard.map(dep => ({
        time: dep.departure,
        destination: dep.destination,
        delay: dep.delay || 0, // OpenData provides delay in seconds
        line: lineNumber
      }));
    }

    // 3. Build a map of GTFS-RT trip IDs to delays at our specific stop
    // GTFS-RT provides delays but NOT timestamps
    const gtfsRTDelaysByTrip = new Map();
    for (const entity of feed.entity) {
      if (!entity.tripUpdate) continue;

      // Filter by line number
      const trip = entity.tripUpdate.trip;
      const routeId = trip.routeId || '';
      const routeParts = routeId.split('-');
      const routeLine = routeParts.length >= 2 ? routeParts[1] : '';

      if (routeLine !== lineNumber) continue;

      const stopTimeUpdates = entity.tripUpdate.stopTimeUpdate || [];

      // Find the delay for our specific stop
      for (const stu of stopTimeUpdates) {
        if (stu.stopId && stu.stopId.startsWith(stopId)) {
          // GTFS-RT only has delay, not absolute time
          const delay = (stu.departure && stu.departure.delay) || (stu.arrival && stu.arrival.delay) || 0;

          // Store delay keyed by trip ID
          if (trip.tripId) {
            gtfsRTDelaysByTrip.set(trip.tripId, delay);
          }
          break; // Found our stop, move to next trip
        }
      }
    }

    if (isDevelopment) {
      console.log(`\n[${stopName}] Found ${stationboard.length} departures from OpenData, ${gtfsRTDelaysByTrip.size} trips with GTFS-RT delays`);
    }

    // 4. Match OpenData departures with GTFS-RT delays
    // PROBLEM: OpenData and GTFS-RT use incompatible trip identifiers
    // FALLBACK: Use sequential matching (match by order) - this is approximate
    const tripIdsArray = Array.from(gtfsRTDelaysByTrip.keys());

    const departures = stationboard.map((dep, index) => {
      // Sequential matching: match OpenData departure [i] with GTFS-RT trip [i]
      // This assumes both feeds list trips in roughly the same order
      let matchedDelay = 0;

      if (index < gtfsRTDelaysByTrip.size) {
        matchedDelay = gtfsRTDelaysByTrip.get(tripIdsArray[index]);
      }

      if (isDevelopment && index < 5) {
        console.log(`  [${index}] ${dep.destination} at ${new Date(dep.departure).toLocaleTimeString('de-CH')} → ${matchedDelay}s delay`);
      }

      return {
        time: dep.departure,
        destination: dep.destination,
        delay: matchedDelay,
        line: lineNumber
      };
    });

    return departures;
  } catch (error) {
    console.error('Error in getDeparturesWithRealTimeDelays:', error);
    // Fallback to just transport.opendata.ch data
    const stationboard = await fetchStationboard(stopName, lineNumber);
    return stationboard.map(dep => ({
      time: dep.departure,
      destination: dep.destination,
      delay: 0, // Unknown delay
      line: lineNumber
    }));
  }
}

// API endpoint to get tram departures
app.get('/api/departures', async (req, res) => {
  try {
    // Fetch GTFS-RT feed ONCE and reuse for both stops
    let feed = null;
    try {
      feed = await fetchGTFSRTFeed();
    } catch (gtfsError) {
      console.warn('GTFS-RT unavailable (rate limit or error), falling back to schedules only');
    }

    const [roswiesenDeps, heerenwiesenDeps] = await Promise.all([
      getDeparturesWithRealTimeDelays('Roswiesen', STOPS.roswiesen.stopId, STOPS.roswiesen.line, feed),
      getDeparturesWithRealTimeDelays('Heerenwiesen', STOPS.heerenwiesen.stopId, STOPS.heerenwiesen.line, feed)
    ]);

    res.json({
      roswiesen: {
        station: STOPS.roswiesen.name,
        departures: roswiesenDeps.slice(0, 10)
      },
      heerenwiesen: {
        station: STOPS.heerenwiesen.name,
        departures: heerenwiesenDeps.slice(0, 10)
      },
      lastUpdate: new Date().toISOString(),
      source: feed ? 'transport.opendata.ch + GTFS-RT delays' : 'transport.opendata.ch (scheduled times only)'
    });
  } catch (error) {
    console.error('Error fetching departures:', error);
    res.status(500).json({ error: 'Failed to fetch departures' });
  }
});

// Serve the main page
app.get('/', (req, res) => {
  if (isDevelopment) {
    const fs = require('fs');
    const indexPath = path.join(__dirname, 'public', 'index.html');
    fs.readFile(indexPath, 'utf8', (err, html) => {
      if (err) {
        return res.status(500).send('Error loading page');
      }
      // Inject livereload script
      const modifiedHtml = html.replace('</body>',
        '<script src="http://localhost:35729/livereload.js?snipver=1"></script></body>');
      res.send(modifiedHtml);
    });
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`Tramintel server running on http://localhost:${PORT}`);
});
