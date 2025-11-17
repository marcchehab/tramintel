# Raspberry Pi Deployment Guide

Quick guide to get Tramintel running on your Raspberry Pi.

## Prerequisites

Install Node.js and pnpm:

### For Fedora/RHEL-based systems:

```bash
# Install Node.js (v18 or higher)
sudo dnf install nodejs

# Or use NodeSource for latest version:
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo dnf install nodejs

# Install pnpm
npm install -g pnpm
```

### For Debian/Raspbian:

```bash
# Install Node.js (v18 or higher)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm
npm install -g pnpm
```

## Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/marcchehab/tramintel.git
   cd tramintel
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Configure API key:**
   ```bash
   cp .env.example .env
   nano .env
   ```
   Add your GTFS-RT API key from [opentransportdata.swiss](https://opentransportdata.swiss/)

4. **Test it:**
   ```bash
   node server.js
   ```
   Visit `http://localhost:3000` to verify it works.

## Run on Boot with PM2

PM2 keeps the server running and auto-restarts on crashes:

```bash
# Install PM2
npm install -g pm2

# Start the server
pm2 start server.js --name tramintel

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Follow the command it outputs
```

## Display in Kiosk Mode

### Manual Start (for testing)

```bash
chromium-browser --kiosk --disable-restore-session-state http://localhost:3000
```

### Auto-start on Boot

Create autostart file:
```bash
mkdir -p ~/.config/autostart
nano ~/.config/autostart/tramintel.desktop
```

Add this content:
```ini
[Desktop Entry]
Type=Application
Name=Tramintel
Exec=chromium-browser --kiosk --disable-restore-session-state http://localhost:3000
X-GNOME-Autostart-enabled=true
```

## Optional: Hide Cursor

**Fedora:**
```bash
sudo dnf install unclutter-xfixes
```

**Debian/Raspbian:**
```bash
sudo apt-get install unclutter
```

Add to `~/.config/autostart/tramintel.desktop`:
```ini
Exec=sh -c "unclutter -idle 0 & chromium-browser --kiosk --disable-restore-session-state http://localhost:3000"
```

## Tips

- **Screen blanking**: Disable in Raspberry Pi settings to keep display always on
- **WiFi reliability**: Use ethernet cable for more stable connection
- **Monitor logs**: `pm2 logs tramintel` to see server output
- **Update**: `git pull && pnpm install && pm2 restart tramintel`
