// Store current departures data
let currentDepartures = {
    roswiesen: [],
    heerenwiesen: []
};

// Fetch and display departures
async function fetchDepartures() {
    try {
        const response = await fetch('/api/departures');
        if (!response.ok) {
            throw new Error('Failed to fetch departures');
        }

        const data = await response.json();

        // Store the departure data
        currentDepartures.roswiesen = data.roswiesen.departures;
        currentDepartures.heerenwiesen = data.heerenwiesen.departures;

        // Update Roswiesen departures
        updateDeparturesList('roswiesen-departures', data.roswiesen.departures);

        // Update Heerenwiesen departures
        updateDeparturesList('heerenwiesen-departures', data.heerenwiesen.departures);

        // Update last update time
        const lastUpdateElement = document.getElementById('lastUpdate');
        lastUpdateElement.textContent = formatTime(new Date(data.lastUpdate));

    } catch (error) {
        console.error('Error fetching departures:', error);
        showError('roswiesen-departures');
        showError('heerenwiesen-departures');
    }
}

// Update the departures list for a stop
function updateDeparturesList(elementId, departures) {
    const container = document.getElementById(elementId);

    if (!departures || departures.length === 0) {
        container.innerHTML = '<div class="error">No departures available</div>';
        return;
    }

    container.innerHTML = departures.map(departure => {
        const scheduledDate = new Date(departure.time);
        const delaySeconds = departure.delay || 0;

        // Calculate actual departure time (scheduled + delay)
        const actualDate = new Date(scheduledDate.getTime() + (delaySeconds * 1000));
        const msUntilActual = actualDate - new Date();
        const minutesUntilActual = Math.floor(msUntilActual / 60000);
        const secondsUntilActual = Math.floor((msUntilActual % 60000) / 1000);

        // Format the big countdown with minutes and seconds
        let countdown;
        if (msUntilActual < 0) {
            countdown = '🤷';
        } else {
            countdown = `${minutesUntilActual}:${String(secondsUntilActual).padStart(2, '0')}`;
        }

        const countdownClass = minutesUntilActual <= 3 && minutesUntilActual >= 0 ? 'soon' : '';

        // Format delay text
        const delayClass = delaySeconds === 0 ? 'on-time' : (delaySeconds > 0 ? 'delayed' : 'early');
        let delayText;
        if (delaySeconds === 0) {
            delayText = 'On time';
        } else if (Math.abs(delaySeconds) < 60) {
            delayText = delaySeconds > 0 ? `+${delaySeconds}s` : `${delaySeconds}s`;
        } else {
            const absSeconds = Math.abs(delaySeconds);
            const mins = Math.floor(absSeconds / 60);
            const secs = absSeconds % 60;
            const sign = delaySeconds > 0 ? '+' : '-';
            if (secs === 0) {
                delayText = `${sign}${mins} min`;
            } else {
                delayText = `${sign}${mins}:${String(secs).padStart(2, '0')} min`;
            }
        }

        return `
            <div class="departure-item">
                <div class="departure-scheduled">
                    <div class="scheduled-time">${formatTime(scheduledDate)}</div>
                    <div class="delay-info ${delayClass}">${delayText}</div>
                </div>
                <div class="departure-countdown ${countdownClass}" data-departure-time="${actualDate.getTime()}">
                    ${countdown}
                </div>
                <div class="departure-destination">
                    <span class="arrow">→</span> ${departure.destination}
                </div>
            </div>
        `;
    }).join('');
}

// Show error message
function showError(elementId) {
    const container = document.getElementById(elementId);
    container.innerHTML = '<div class="error">Failed to load departures. Retrying...</div>';
}

// Format time as HH:MM
function formatTime(date) {
    return date.toLocaleTimeString('de-CH', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

// Update current time display
function updateCurrentTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('de-CH', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    document.getElementById('currentTime').textContent = timeString;
}

// Update all countdown timers
function updateCountdowns() {
    const now = new Date().getTime();
    const countdownElements = document.querySelectorAll('.departure-countdown');

    countdownElements.forEach(element => {
        const departureTime = parseInt(element.getAttribute('data-departure-time'));
        if (!departureTime) return;

        const msUntilActual = departureTime - now;
        const minutesUntilActual = Math.floor(msUntilActual / 60000);
        const secondsUntilActual = Math.floor((msUntilActual % 60000) / 1000);

        // Update countdown display
        let countdown;
        if (msUntilActual < 0) {
            countdown = '🤷';
        } else {
            countdown = `${minutesUntilActual}:${String(secondsUntilActual).padStart(2, '0')}`;
        }

        // Update the element
        element.textContent = countdown;

        // Update class for "soon" styling
        if (minutesUntilActual <= 3 && minutesUntilActual >= 0) {
            element.classList.add('soon');
        } else {
            element.classList.remove('soon');
        }
    });
}

// Initial fetch and time update
fetchDepartures();
updateCurrentTime();

// Refresh every 30 seconds (stay within rate limits: 2 calls/min)
setInterval(fetchDepartures, 30000);

// Update current time and countdowns every second
setInterval(() => {
    updateCurrentTime();
    updateCountdowns();
}, 1000);
