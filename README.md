# matterbridge-mova

A [Matterbridge](https://github.com/Luligu/matterbridge) plugin for MOVAhome robot vacuum cleaners.

The plugin exposes supported MOVA robots as Matter 1.4 Robotic Vacuum Cleaner devices, including start, pause, stop, return-to-dock, cleaning mode, battery status, and room selection where map room data is available.

## Features

- MOVAhome cloud login.
- Automatic discovery of MOVA robot vacuums.
- Matter RVC support for run mode, clean mode, operational state, battery, and service areas.
- Room cleaning through the Matter ServiceArea cluster.
- Configurable suction level for Matter-started cleaning.
- Configurable behavior for Apple Home's combined Vacuum & Mop mode.
- Dynamic cloud command routing through each robot's `bindDomain`.
- MQTT status updates with cloud polling fallback.

## Known Limitations

- Live "currently cleaning room" progress is not implemented yet. Matterbridge exposes room selection, but `ServiceArea.currentArea` may remain empty or stale during multi-room cleaning.
- Model support is intentionally broad (`mova.vacuum.*`) but has currently only been tested on a S70 Roller.

## Installation

You can get the plugin via the Matterbridge UI from npm:

```text
matterbridge-mova
```

You can also install it manually:

```bash
npm install -g matterbridge-mova
matterbridge -add matterbridge-mova
matterbridge -enable matterbridge-mova
```

Restart Matterbridge after installing or updating the plugin.

## Configuration

Matterbridge reads the plugin schema from `matterbridge-mova.schema.json`.

Example:

```json
{
  "name": "matterbridge-mova",
  "type": "DynamicPlatform",
  "username": "your-movahome-account",
  "password": "your-password",
  "country": "eu",
  "suctionLevel": "standard",
  "vacuumAndMopMode": "vac-mop",
  "refreshInterval": 120
}
```

### Options

| Option                 | Required | Default    | Description                                                                          |
| ---------------------- | -------- | ---------- | ------------------------------------------------------------------------------------ |
| `username`             | Yes      |            | MOVAhome account username.                                                           |
| `password`             | Yes      |            | MOVAhome account password.                                                           |
| `country`              | Yes      | `eu`       | MOVA region: `cn`, `eu`, `us`, `sg`, or `ru`.                                        |
| `suctionLevel`         | No       | `standard` | Suction used for Matter-started cleaning: `quiet`, `standard`, `strong`, or `turbo`. |
| `vacuumAndMopMode`     | No       | `vac-mop`  | What Apple Home's Vacuum & Mop mode should do: `vac-mop` or `vac-then-mop`.          |
| `refreshInterval`      | No       | `120`      | Cloud polling interval in seconds.                                                   |
| `unregisterOnShutdown` | No       | `false`    | Unregister devices when the plugin shuts down. Mostly useful during development.     |
