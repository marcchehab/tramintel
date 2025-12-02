# Cancelled Tram Detection Research

## Summary

The current cancellation detection in the M5Paper code is **fundamentally flawed**. The `stop.cancelled` field we're checking **does not exist** in the transport.opendata.ch API. Our heuristic checks are unreliable and currently hiding valid late-night trams.

## The Proper Way: GTFS-RT API

The **official** method to detect cancelled trams is through the **opentransportdata.swiss GTFS-RT API**, which uses the standard GTFS Realtime specification:

- **Cancelled trips**: `TripUpdate` with `schedule_relationship = CANCELED`
- **Skipped stops**: `TripUpdate` with `schedule_relationship = SKIPPED`
- **API endpoint**: `https://api.opentransportdata.swiss/la/gtfs-rt` (requires API key)
- **Format**: Protocol Buffers (binary format defined by GTFS-RT spec)

### GTFS-RT Implementation Plan

**Architecture**: Raspberry Pi as GTFS-RT gateway
- Raspberry Pi fetches GTFS-RT feed from opentransportdata.swiss
- Decodes Protocol Buffers data
- Merges with transport.opendata.ch data to add cancellation flags
- Exposes simple JSON API for M5Paper to consume
- **Benefit**: Offloads complex processing from ESP32, provides proper cancellation detection

## The Problem with transport.opendata.ch

### Investigation Results

1. **NO `cancelled` field exists** in the API response
   - Checked source code (OpendataCH/Transport GitHub repo) - no parsing of cancellation data
   - Checked official documentation - no mention of a `cancelled` field
   - Checked live API responses - field does not exist

2. **Available fields in `stop` object**:
   ```
   - arrival
   - arrivalTimestamp
   - delay
   - departure
   - departureTimestamp
   - location
   - platform
   - prognosis
   - realtimeAvailability
   - station
   ```

3. **Current heuristic checks are unreliable**:
   - ✗ `stop.cancelled` - **This field doesn't exist!** (check does nothing in M5Paper code)
   - ⚠ `stop.departure` is null - Could indicate cancellation, but also data issues
   - ⚠ `stop.prognosis.departure` is null - **False positive**: Late-night trams show this when realtime tracking isn't available yet
   - ⚠ `stop.prognosis.departure` in the past - Sometimes works, but unreliable

### Evidence of False Positives

Live API test at 22:29 showed multiple valid late-night trams being incorrectly filtered:
- T7 to Wollishoferplatz at 23:33 - prognosis.departure=null (NOT cancelled, just no tracking yet)
- T7 to Wollishoferplatz at 00:03 - prognosis.departure=null
- T7 to Stettbach at 00:07 - prognosis.departure=null
- etc.

**Current M5Paper code is hiding valid trams from the display.**

### Why transport.opendata.ch Lacks This Data

- Uses HAFAS XML backend from search.ch
- HAFAS XML has HIMMessage (HAFAS Information Manager) with cancellation types:
  - Type 2: "cancelation of train"
  - Type 6: "cancelation of stop"
- **But**: The PHP API wrapper does not parse or expose this HIM data in JSON responses
- The cancellation information exists in the backend XML but is lost during JSON conversion

## Current M5Paper Implementation Issues

### Code Location: `/home/chris/git/tramintel/m5paper/src/main.cpp` lines 125-167

```cpp
// Skip if marked as cancelled
if (!stationboard[i]["stop"]["cancelled"].isNull() &&
    stationboard[i]["stop"]["cancelled"].as<bool>()) {
    continue;  // THIS NEVER TRIGGERS - FIELD DOESN'T EXIST
}

// Skip if departure is null (cancelled)
if (stationboard[i]["stop"]["departure"].isNull()) {
    continue;  // Could be valid check for some edge cases
}

// Skip if prognosis departure is null (also indicates cancelled)
if (!stationboard[i]["stop"]["prognosis"].isNull() &&
    stationboard[i]["stop"]["prognosis"]["departure"].isNull()) {
    continue;  // FALSE POSITIVE: Hides late-night trams without tracking
}

// Check if prognosis departure is in the past (cancelled indicator)
if (!stationboard[i]["stop"]["prognosis"].isNull()) {
    String progDeparture = stationboard[i]["stop"]["prognosis"]["departure"];
    if (!progDeparture.isEmpty()) {
        // ... parse and check if >5 min in past
        if ((now - progTime) > 300) {
            continue;  // HACK: Sometimes works, but unreliable
        }
    }
}
```

## Solution: Raspberry Pi GTFS-RT Gateway

### Architecture

```
┌─────────────────────────────────────┐
│ opentransportdata.swiss             │
│ GTFS-RT API (protobuf)              │
│ - schedule_relationship = CANCELED  │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│ Raspberry Pi Gateway                │
│ - Fetch GTFS-RT feed                │
│ - Decode protobuf                   │
│ - Fetch transport.opendata.ch JSON  │
│ - Merge: add "cancelled" flag       │
│ - Expose clean JSON API             │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│ M5Paper                             │
│ - Fetch from local Raspberry Pi     │
│ - Simple JSON with cancelled field  │
│ - Low processing overhead           │
└─────────────────────────────────────┘
```

### Benefits

1. **Proper cancellation detection** using official GTFS-RT data
2. **Offloads complexity** from ESP32 to Raspberry Pi
3. **Reduces M5Paper WiFi time** - local network is faster than internet
4. **Simple JSON** - M5Paper just checks `cancelled: true/false`
5. **Can add caching/optimization** on Raspberry Pi
6. **Future extensibility** - can add more data enrichment

### Implementation Steps

1. Set up Node.js/Python service on Raspberry Pi
2. Fetch GTFS-RT from opentransportdata.swiss (requires API key from API Manager)
3. Decode Protocol Buffers using gtfs-realtime-bindings library
4. Fetch transport.opendata.ch data
5. Match trips and add `cancelled` flag based on schedule_relationship
6. Expose HTTP endpoint: `http://raspberrypi:3000/stationboard?station=Roswiesen`
7. Update M5Paper to fetch from local endpoint
8. Add simple `if (stop["cancelled"]) continue;` check

## M5Paper Battery Optimization Research

### Current Power Consumption Profile

**Estimated current implementation (60-second update cycle)**:
- WiFi connection maintained: ~80-90mA continuous
- ESP32 active (fetching/parsing): ~150-200mA for 2-3 seconds
- E-ink update (UPDATE_MODE_DU4): ~60mA peak for 120ms
- E-ink controller idle: ~60-100mA between updates
- **Average current**: ~85-100mA
- **Battery life estimate**: 1150mAh / 90mA ≈ **12-13 hours**

Wait, that's much worse than the 6 months estimate in the plan! Let me recalculate:

Actually, the 6-month estimate assumed deep sleep between updates. Current implementation with continuous WiFi and no sleep:
- **Continuous operation**: 1150mAh / 90mA = 12-13 hours
- **With occasional sleep (WiFi on)**: Maybe 1-2 days
- **This doesn't match reality** - need to measure actual consumption

### Power Consumption Breakdown (Theoretical)

#### Major Power Consumers (highest to lowest):

1. **WiFi Radio (80-90mA)**
   - **TX**: 150-200mA when transmitting
   - **RX**: 80-100mA when receiving
   - **Idle/Connected**: 15-30mA (with modem sleep)
   - **Off**: ~0.01mA
   - **Your hunch is correct**: WiFi is likely the biggest consumer

2. **ESP32 CPU (20-40mA)**
   - **Active (240MHz)**: 30-40mA
   - **Light sleep**: 0.8mA
   - **Deep sleep**: 10-150µA (varies by wake source)
   - **Can be optimized**: Lower CPU frequency, use sleep modes

3. **E-ink Display Controller (varies)**
   - **During refresh**: 60-160mA (depends on mode)
   - **Idle/standby**: 10-60mA
   - **Powered off**: ~0mA
   - **UPDATE_MODE_DU4**: ~60mA for 120ms (already optimized)
   - **UPDATE_MODE_GC16**: ~160mA for 450ms (we switched away from this)

4. **Peripherals (10-20mA)**
   - RTC (BM8563): ~2.6µA (negligible)
   - Touch controller: 5-10mA when active
   - Flash/PSRAM: 5-10mA during access
   - LiPo management: ~1mA

### How to Measure Actual Power Consumption

#### Method 1: Battery Voltage Monitoring (Software)
```cpp
// Add to M5Paper code
void logPowerConsumption() {
    uint32_t voltage = M5.getBatteryVoltage();
    // Log voltage over time to calculate consumption
    // Limitation: Not real-time, only shows total drain
}
```
**Pros**: No hardware needed, can log over time
**Cons**: Imprecise, can't isolate individual components

#### Method 2: USB Power Monitor (Recommended)
- Use USB power meter (e.g., UM25C, UM34C, AVHzY CT-3)
- Plug between USB power source and M5Paper
- Shows real-time mA consumption
- **Cost**: $15-30
- **Accuracy**: ±1mA

**This is the best way to verify WiFi consumption**

#### Method 3: Multimeter in Series (Most Accurate)
- Cut/tap into battery positive lead
- Insert multimeter in series
- Measure actual battery current
- **Pros**: Most accurate, measures from battery
- **Cons**: Requires hardware modification, voids warranty

#### Method 4: INA219 Current Sensor (Best for Development)
- Add INA219 breakout board between battery and M5Paper
- Logs current consumption over I2C
- Can identify exact power spikes
- **Cost**: $5-10
- **Accuracy**: ±0.5mA

### Power Optimization Strategies (Ordered by Impact)

#### 1. WiFi Disconnect/Reconnect (HIGHEST IMPACT)
**Current**: WiFi stays connected 24/7 (~80mA)
**Optimized**: Disconnect after fetch, reconnect before next (~3s @ 150mA per cycle)

```cpp
void loop() {
    WiFi.begin(ssid, password);
    while (WiFi.status() != WL_CONNECTED) delay(100);

    fetchAndDisplayTrams();  // 2-3 seconds

    WiFi.disconnect(true);   // Turn off WiFi radio
    WiFi.mode(WIFI_OFF);

    delay(60000 - 3000);     // Sleep 57 seconds
}
```

**Power savings**:
- Before: 80mA × 60s = 4800mAs per minute
- After: 150mA × 3s = 450mAs per minute
- **Reduction**: ~90% of WiFi power consumption
- **New battery life estimate**: ~2-3 days

#### 2. Deep Sleep with RTC Wake (VERY HIGH IMPACT)
**Current**: ESP32 active continuously
**Optimized**: Deep sleep between updates, RTC wakes device

```cpp
void loop() {
    fetchAndDisplayTrams();
    M5.shutdown(60);  // Deep sleep for 60 seconds, RTC wake
    // Device restarts from setup() after wake
}
```

**Power consumption**:
- Active (3s): ~150mA avg
- Deep sleep (57s): ~10-150µA
- **Average**: (150mA × 3s + 0.15mA × 57s) / 60s ≈ **8-10mA**
- **Battery life estimate**: 1150mAh / 10mA ≈ **115 hours = 4-5 days**

But wait, ESP32 deep sleep requires restart, so need to handle:
- WiFi reconnection on every wake
- Time sync (use RTC, not NTP every time)
- GPIO state preservation with `gpio_hold_en()`

#### 3. Fetch from Local Raspberry Pi Instead of Internet (MEDIUM IMPACT)
**Current**: Fetch from transport.opendata.ch over internet
**Optimized**: Fetch from `http://raspberrypi.local:3000` on LAN

**Power savings**:
- Faster response time: 2-3s → 0.5-1s
- Less data transfer: No TLS overhead
- **WiFi active time reduced by 50-70%**
- **Extra benefit**: Simpler JSON parsing (less CPU time)

#### 4. Lower WiFi TX Power (LOW-MEDIUM IMPACT)
```cpp
WiFi.setTxPower(WIFI_POWER_11dBm);  // Default is 19.5dBm
```
**Power savings**: 20-30mA during transmission
**Risk**: May not connect if router is far
**Test first**: Try 15dBm, 11dBm, 8.5dBm

#### 5. Reduce CPU Frequency (LOW IMPACT)
```cpp
setCpuFrequencyMhz(80);  // Default is 240MHz
```
**Power savings**: ~10-15mA
**Risk**: Slower processing, may not be noticeable for our use case

### Recommended Battery Optimization Path

**Phase 1: Quick Wins (Already Done)**
- ✅ Switch to UPDATE_MODE_DU4 (2.7x faster refresh)
- ✅ Add WiFi retry logic
- Next: Implement WiFi disconnect/reconnect

**Phase 2: Raspberry Pi Gateway (Next)**
- Set up Raspberry Pi GTFS-RT service
- Update M5Paper to fetch from local endpoint
- **Expected gain**: 50-70% reduction in WiFi time

**Phase 3: Deep Sleep (Future)**
- Implement RTC wake from deep sleep
- Handle restart-on-wake workflow
- **Expected gain**: 4-5 days battery life

**Phase 4: Fine-tuning (If Needed)**
- Measure actual consumption with USB power meter
- Adjust TX power, CPU frequency based on measurements
- Consider adaptive update intervals (slower at night)

### How to Verify WiFi Power Consumption

**Test 1: WiFi On vs Off**
```cpp
// Baseline: WiFi always on
void loop() {
    delay(60000);
}

// Compare: WiFi off
void setup() {
    WiFi.mode(WIFI_OFF);
}
void loop() {
    delay(60000);
}
```
Measure battery drain over 1 hour with USB power meter.

**Test 2: Connect Time**
```cpp
void loop() {
    unsigned long start = millis();
    WiFi.begin(ssid, password);
    while (WiFi.status() != WL_CONNECTED) delay(10);
    unsigned long connectTime = millis() - start;
    Serial.println("WiFi connect time: " + String(connectTime) + "ms");

    // Fetch data...

    WiFi.disconnect(true);
    delay(60000);
}
```
Log how long WiFi connection actually takes.

**Expected Results**:
- WiFi on continuously: ~80-90mA
- WiFi off: ~20-30mA (just ESP32 + display controller)
- **Difference confirms WiFi is the main consumer**

## Sources

- [GTFS Realtime (GTFS-RT) – Open data platform mobility Switzerland](https://opentransportdata.swiss/en/cookbook/realtime-prediction-cookbook/gtfs-rt/)
- [GTFS-RT: Service Alerts – Open data platform mobility Switzerland](https://opentransportdata.swiss/en/cookbook-gtfs-sa/)
- [Trip Updates - Transit Partners](https://resources.transitapp.com/article/462-trip-updates)
- [GTFS Realtime Dataset - opentransportdata.swiss](https://data.opentransportdata.swiss/dataset/gtfsrt)
- [OpendataCH/Transport GitHub Repository](https://github.com/OpendataCH/Transport) (source code analysis)
- [HAFAS XML Interface Schema](https://github.com/OpendataCH/Transport/blob/master/hafasXMLInterface.xsd)
- [M5Paper Hardware Reference](https://docs.m5stack.com/en/core/m5paper)
- [ESP32 Power Management](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/system/power_management.html)

## Next Steps

1. ✅ Document research findings (this file)
2. ⏳ Set up Raspberry Pi GTFS-RT gateway service
3. ⏳ Implement WiFi disconnect/reconnect on M5Paper
4. ⏳ Measure actual power consumption with USB meter
5. ⏳ Optimize based on measurements
6. ⏳ Test battery life over 24+ hours
