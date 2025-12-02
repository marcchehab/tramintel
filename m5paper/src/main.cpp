#include <M5EPD.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

M5EPD_Canvas canvas(&M5.EPD);

// WiFi credentials - UPDATE THESE!
const char* ssid = "KGBshelter";
const char* password = "Chasch3MalrataewassPasswortisch!";

const char* roswiesenUrl = "https://transport.opendata.ch/v1/stationboard?station=Roswiesen&limit=6&transportations[]=tram";
const char* heerenwiesenUrl = "https://transport.opendata.ch/v1/stationboard?station=Heerenwiesen&limit=6&transportations[]=tram";

// Touch timeout configuration
// 15 * 60 * 1000; // 15 minutes
const unsigned long SLEEP_TIMEOUT = 2 * 60 * 1000; // 2 minutes in milliseconds
unsigned long lastTouchTime = 0;

// Forward declarations
void fetchAndDisplayTrams();
void displayStation(const char* stationName, const char* url, int startX, int startY);
bool connectWiFi();
void displayBatteryLevel();
void goToDeepSleep();
void checkForTouch();

bool connectWiFi() {
    const int maxRetries = 3;
    const int retryDelay = 3000; // 3 seconds between attempts

    for (int attempt = 1; attempt <= maxRetries; attempt++) {
        canvas.fillCanvas(0);
        canvas.setTextSize(3);
        canvas.drawString("Connecting to WiFi... (attempt " + String(attempt) + "/3)", 20, 20);
        canvas.pushCanvas(0, 0, UPDATE_MODE_DU4);

        WiFi.begin(ssid, password);

        int timeout = 0;
        while (WiFi.status() != WL_CONNECTED && timeout < 20) { // 10 second timeout
            delay(500);
            timeout++;
        }

        if (WiFi.status() == WL_CONNECTED) {
            return true;
        }

        if (attempt < maxRetries) {
            canvas.drawString("Failed. Retrying in 3s...", 20, 60);
            canvas.pushCanvas(0, 0, UPDATE_MODE_DU4);
            delay(retryDelay);
        }
    }

    return false; // Failed after all retries
}

void setup() {
    M5.begin();
    M5.EPD.SetRotation(0);  // 0 = landscape
    M5.EPD.Clear(true);

    // Start serial for debugging (optional)
    // Serial.begin(115200);

    canvas.createCanvas(960, 540);  // width x height for landscape
    canvas.setTextSize(3);

    // Connect to WiFi with retry logic
    if (!connectWiFi()) {
        // WiFi connection failed after retries
        canvas.fillCanvas(0);
        canvas.setTextSize(4);
        canvas.drawString("WiFi Error", 300, 200);
        canvas.drawString("Retrying in 60s...", 250, 250);
        canvas.pushCanvas(0, 0, UPDATE_MODE_DU4);
        delay(60000);
        ESP.restart(); // Restart and try again
    }

    canvas.fillCanvas(0);
    canvas.setTextSize(3);
    canvas.drawString("Connected! Syncing time...", 20, 20);
    canvas.pushCanvas(0, 0, UPDATE_MODE_DU4);

    // Configure NTP time sync (Zurich timezone)
    configTime(3600, 3600, "pool.ntp.org"); // UTC+1, DST+1

    // Wait for time sync
    time_t now = time(nullptr);
    while (now < 1000000000) {
        delay(500);
        now = time(nullptr);
    }

    fetchAndDisplayTrams();

    // Initialize last touch time
    lastTouchTime = millis();
}

struct Departure {
    String line;
    int minutesUntil;
    time_t actualTime;
};

void displayStation(const char* stationName, const char* url, int startX, int startY) {
    HTTPClient http;
    http.begin(url);
    int httpCode = http.GET();

    // Draw station header
    canvas.setTextSize(4);
    canvas.drawString(stationName, startX, startY);

    if (httpCode == 200) {
        // Get payload as String
        String payload = http.getString();

        // Parse JSON - use c_str() to ensure proper null termination
        JsonDocument doc;
        DeserializationError error = deserializeJson(doc, payload.c_str());

        if (!error) {
            JsonArray stationboard = doc["stationboard"];

            // Parse all departures into array
            Departure departures[10];
            int depCount = 0;
            time_t now = time(nullptr);

            for (int i = 0; i < stationboard.size() && depCount < 10; i++) {
                // Skip if marked as cancelled
                if (!stationboard[i]["stop"]["cancelled"].isNull() &&
                    stationboard[i]["stop"]["cancelled"].as<bool>()) {
                    continue;
                }

                // Skip if departure is null (cancelled)
                if (stationboard[i]["stop"]["departure"].isNull()) {
                    continue;
                }

                // Skip if prognosis departure is null (also indicates cancelled)
                if (!stationboard[i]["stop"]["prognosis"].isNull() &&
                    stationboard[i]["stop"]["prognosis"]["departure"].isNull()) {
                    continue;
                }

                // Check if prognosis departure is in the past (cancelled indicator)
                if (!stationboard[i]["stop"]["prognosis"].isNull()) {
                    String progDeparture = stationboard[i]["stop"]["prognosis"]["departure"];
                    if (!progDeparture.isEmpty()) {
                        // Parse prognosis departure time
                        int pYear = progDeparture.substring(0, 4).toInt();
                        int pMonth = progDeparture.substring(5, 7).toInt();
                        int pDay = progDeparture.substring(8, 10).toInt();
                        int pHour = progDeparture.substring(11, 13).toInt();
                        int pMin = progDeparture.substring(14, 16).toInt();

                        struct tm pTimeinfo = {0};
                        pTimeinfo.tm_year = pYear - 1900;
                        pTimeinfo.tm_mon = pMonth - 1;
                        pTimeinfo.tm_mday = pDay;
                        pTimeinfo.tm_hour = pHour;
                        pTimeinfo.tm_min = pMin;
                        time_t progTime = mktime(&pTimeinfo);

                        // Skip if prognosis is more than 5 minutes in the past (cancelled)
                        if ((now - progTime) > 300) {  // 5 minutes = 300 seconds
                            continue;
                        }
                    }
                }

                String category = stationboard[i]["category"];
                String number = stationboard[i]["number"];
                String to = stationboard[i]["to"];
                String departure = stationboard[i]["stop"]["departure"];
                int delay = stationboard[i]["stop"]["delay"] | 0; // delay in minutes

                // Parse departure time: "2025-11-19T14:36:00+0100"
                int year = departure.substring(0, 4).toInt();
                int month = departure.substring(5, 7).toInt();
                int day = departure.substring(8, 10).toInt();
                int hour = departure.substring(11, 13).toInt();
                int minute = departure.substring(14, 16).toInt();

                // Convert to epoch time (seconds since 1970)
                struct tm timeinfo = {0};
                timeinfo.tm_year = year - 1900;
                timeinfo.tm_mon = month - 1;
                timeinfo.tm_mday = day;
                timeinfo.tm_hour = hour;
                timeinfo.tm_min = minute;
                time_t scheduledTime = mktime(&timeinfo);

                // Add delay (in seconds)
                time_t actualTime = scheduledTime + (delay * 60);
                int minutesUntil = (actualTime - now) / 60;

                // Build line string (destination only, no line number)
                String line = to;

                // Clean up destination names
                line.replace("Zürich, ", "");
                line.replace("Zuerich, ", "");
                line.replace("Universitaet", "U. ");
                if (line.indexOf(", Bahnhof") > 0) {
                    line = line.substring(0, line.indexOf(", Bahnhof"));
                }
                // Shorten Wollishoferplatz to Wollishofe
                line.replace("Wollishoferplatz", "Wollishofe");

                // Replace umlauts for display
                line.replace("ü", "ue");
                line.replace("ä", "ae");
                line.replace("ö", "oe");

                // Limit length
                if (line.length() > 18) {
                    line = line.substring(0, 18);
                }

                departures[depCount].line = line;
                departures[depCount].minutesUntil = minutesUntil;
                departures[depCount].actualTime = actualTime;
                depCount++;
            }

            // Sort by actual departure time
            for (int i = 0; i < depCount - 1; i++) {
                for (int j = i + 1; j < depCount; j++) {
                    if (departures[j].actualTime < departures[i].actualTime) {
                        Departure temp = departures[i];
                        departures[i] = departures[j];
                        departures[j] = temp;
                    }
                }
            }

            // Display first 5
            int y = startY + 50;
            for (int i = 0; i < 5 && i < depCount; i++) {
                String countdown = String(departures[i].minutesUntil) + "'";
                if (departures[i].minutesUntil < 0) {
                    countdown = "--";
                }

                // Draw destination
                canvas.setTextSize(5);
                canvas.drawString(departures[i].line, startX + 5, y);

                // Draw countdown (right side of column)
                canvas.setTextSize(6);
                canvas.drawString(countdown, startX + 350, y - 5);

                y += 90;
            }
        } else {
            canvas.setTextSize(2);
            canvas.drawString("JSON parse error", startX, startY + 50);
        }
    } else {
        canvas.setTextSize(2);
        canvas.drawString("HTTP error: " + String(httpCode), startX, startY + 50);
    }

    http.end();
}

void displayBatteryLevel() {
    // Get battery voltage (M5Paper uses ADC on GPIO 35)
    uint32_t batteryVoltage = M5.getBatteryVoltage();

    // Calculate battery percentage (rough estimate)
    // M5Paper LiPo: 4.2V = 100%, 3.0V = 0%
    int batteryPercent = map(batteryVoltage, 3000, 4200, 0, 100);
    batteryPercent = constrain(batteryPercent, 0, 100);

    // Draw battery icon and percentage in top right
    int x = 850;  // Top right corner
    int y = 10;

    canvas.setTextSize(3);
    String batteryText = String(batteryPercent) + "%";
    canvas.drawString(batteryText, x, y);

    // Draw simple battery icon
    canvas.setTextSize(2);

    // Battery outline (rectangle)
    canvas.drawRect(x - 50, y, 40, 20, 15);
    // Battery terminal (small rectangle on right)
    canvas.fillRect(x - 10, y + 6, 5, 8, 15);

    // Fill battery based on level
    int fillWidth = map(batteryPercent, 0, 100, 0, 36);
    if (fillWidth > 0) {
        canvas.fillRect(x - 48, y + 2, fillWidth, 16, 15);
    }
}

void fetchAndDisplayTrams() {
    canvas.fillCanvas(0); // Clear screen

    // Display battery level in top right
    displayBatteryLevel();

    // Display both stations side-by-side in two columns
    displayStation("T7 Roswiesen", roswiesenUrl, 10, 10);      // Left column
    displayStation("T9 Heerenwiesen", heerenwiesenUrl, 490, 10);  // Right column

    canvas.pushCanvas(0, 0, UPDATE_MODE_DU4);
}

void checkForTouch() {
    M5.TP.update();
    if (M5.TP.available()) {
        lastTouchTime = millis();
    }
}

void goToDeepSleep() {
    // Display "touch me" message
    canvas.fillCanvas(0);
    canvas.setTextSize(8);

    // Center the text
    int x = 280;
    int y = 220;
    canvas.drawString("Touch Me", x, y);

    canvas.pushCanvas(0, 0, UPDATE_MODE_DU4);

    delay(1000); // Show message for 1 second

    // Prepare for deep sleep
    M5.TP.flush(); // Clear touch buffer (critical!)

    // Configure wake on touch (GPIO 36 for GT911 touch controller)
    esp_sleep_enable_ext0_wakeup(GPIO_NUM_36, LOW);

    // Go to deep sleep
    esp_deep_sleep_start();
    // Device will restart from setup() when touched
}

void loop() {
    // Check for touch events
    checkForTouch();

    // Check if sleep timeout has been reached
    if (millis() - lastTouchTime > SLEEP_TIMEOUT) {
        goToDeepSleep();
        // Never returns - device wakes and restarts from setup()
    }

    // Update display every 60 seconds
    static unsigned long lastUpdate = 0;
    if (millis() - lastUpdate >= 60000) {
        fetchAndDisplayTrams();
        lastUpdate = millis();
    }

    delay(100); // Small delay to reduce CPU usage
}
