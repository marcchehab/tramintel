#include <M5EPD.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

M5EPD_Canvas canvas(&M5.EPD);

// WiFi credentials - UPDATE THESE!
const char* ssid = "KGBshelter";
const char* password = "Chasch3MalrataewassPasswortisch!";

const char* roswiesenUrl = "https://transport.opendata.ch/v1/stationboard?station=Roswiesen&limit=8&transportations[]=tram";
const char* heerenwiesenUrl = "https://transport.opendata.ch/v1/stationboard?station=Heerenwiesen&limit=8&transportations[]=tram";

// Forward declarations
void fetchAndDisplayTrams();
void displayStation(const char* stationName, const char* url, int startX, int startY);

void setup() {
    M5.begin();
    M5.EPD.SetRotation(0);  // 0 = landscape
    M5.EPD.Clear(true);

    canvas.createCanvas(960, 540);  // width x height for landscape
    canvas.setTextSize(3);

    // Connect to WiFi
    canvas.drawString("Connecting to WiFi...", 20, 20);
    canvas.pushCanvas(0, 0, UPDATE_MODE_GC16);

    WiFi.begin(ssid, password);
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
    }

    canvas.drawString("Connected! Syncing time...", 20, 60);
    canvas.pushCanvas(0, 0, UPDATE_MODE_GC16);

    // Configure NTP time sync (Zurich timezone)
    configTime(3600, 3600, "pool.ntp.org"); // UTC+1, DST+1

    // Wait for time sync
    time_t now = time(nullptr);
    while (now < 1000000000) {
        delay(500);
        now = time(nullptr);
    }

    fetchAndDisplayTrams();
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
        // Parse JSON directly from stream to save memory
        WiFiClient* stream = http.getStreamPtr();
        JsonDocument doc;
        DeserializationError error = deserializeJson(doc, *stream);

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

            // Display first 6
            int y = startY + 50;
            for (int i = 0; i < 6 && i < depCount; i++) {
                String countdown = String(departures[i].minutesUntil) + "'";
                if (departures[i].minutesUntil < 0) {
                    countdown = "--";
                }

                // Draw destination
                canvas.setTextSize(3);
                canvas.drawString(departures[i].line, startX + 5, y);

                // Draw countdown (right side of column)
                canvas.setTextSize(4);
                canvas.drawString(countdown, startX + 350, y - 3);

                y += 75;
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

void fetchAndDisplayTrams() {
    canvas.fillCanvas(0); // Clear screen

    // Display both stations side-by-side in two columns
    displayStation("T7 Roswiesen", roswiesenUrl, 10, 10);      // Left column
    displayStation("T9 Heerenwiesen", heerenwiesenUrl, 490, 10);  // Right column

    canvas.pushCanvas(0, 0, UPDATE_MODE_GC16);
}

void loop() {
    delay(60000); // Refresh every 60 seconds
    fetchAndDisplayTrams();
}
