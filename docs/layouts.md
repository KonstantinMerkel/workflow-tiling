# Layout Customization (JSON)

Workflow Tiling uses an "Escalator" system (`lib/layout.js`) to generate window estates dynamically. 
Custom layout transitions are defined via a JSON object.

## Structure
The JSON keys represent the total number of windows on a monitor. The values are arrays of window geometry definitions for that count.

```json
{
  "1": [
    {"x": 0, "y": 0, "w": 100, "h": 100, "id": 0}
  ],
  "2": [
    {"x": 0, "y": 0, "w": 50, "h": 100, "id": 0},
    {"x": 50, "y": 0, "w": 50, "h": 100, "id": 1}
  ]
}
```

## Properties
- `x`: X percentage offset (0 to 100)
- `y`: Y percentage offset (0 to 100)
- `w`: Width percentage (0 to 100)
- `h`: Height percentage (0 to 100)
- `id` (Required): The logical 0-indexed ID this window occupies. The IDs map to the insertion order of windows. E.g., `id: 0` is the oldest window, `id: 1` is the second oldest. It MUST be unique and cover 0 to `count - 1`.

## Fallback
If the window count exceeds the highest key defined in the JSON, extra windows will fall back to floating mode (unmanaged by the auto-tiler).
