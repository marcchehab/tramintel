# Tramintel

Real-time Zurich tram departure board for Raspberry Pi display.

## Features

- **Real-time delays** from official GTFS-RT API
- **Two stops**: Roswiesen (Line 7) and Heerenwiesen (Line 9)
- **Live countdown** showing minutes until actual departure
- **Auto-refresh** every 30 seconds
- **Clean interface** optimized for always-on display

## Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Create `.env` file with your GTFS-RT API key:
   ```bash
   cp .env.example .env
   ```

   Get your API key from [opentransportdata.swiss](https://opentransportdata.swiss/)

3. Start the server:
   ```bash
   node server.js
   ```

4. Open http://localhost:3000

## Configuration

Edit `server.js` to change stops and lines:

```javascript
const STOPS = {
  roswiesen: {
    name: 'Roswiesen',
    stopId: '8591325:0:10000',
    line: '7'
  },
  heerenwiesen: {
    name: 'Heerenwiesen',
    stopId: '8591181:0:10001',
    line: '9'
  }
};
```

## Data Sources

- **Schedules**: transport.opendata.ch
- **Real-time delays**: opentransportdata.swiss GTFS-RT API

## License

MIT
