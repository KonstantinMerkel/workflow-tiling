## Structure
Each key is a number of windows on a monitor. Its value lists where those windows go.

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
All sizes are percentages

- `x`: Horizontal offset (0 to 100)
- `y`: Vertical offset (0 to 100)
- `w`: Width (0 to 100)
- `h`: Height (0 to 100)
- `id`: Which window takes this slot. Windows are numbered by when they were opened: `0` is the oldest, `1` the second oldest, and so on.

## Rules
- Layouts must start at `"1"` and must not skip a number.
- The layout for `n` windows has exactly `n` slots, with the ids `0` to `n - 1`, each used once.
- Every layout must cover the entire screen - what else would you use a tiling extension for ;)
- Slots must not overlap and must cover the whole monitor without gaps. (Use the *Gaps* settings for spacing between windows.)

## More Windows Than Layouts
If a monitor has more windows than your largest layout, the extra windows float as without the extension. The oldest floating window will get tiled if you close one of your tiled windows
