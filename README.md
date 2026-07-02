# HR Startups Investment Map

Interactive map of HRTech startup funding and M&A deals across 2024-2026.

The visualization places startup deal bubbles on a quarter-by-quarter timeline. The vertical axis represents disclosed investment volume; M&A and undisclosed transactions are kept in the dataset and can be filtered separately. Hovering over a bubble opens a persistent tooltip with the startup website, deal metadata, short product description, extracted tags, and source link.

## Contents

- `index.html` - static app shell and metadata.
- `styles.css` - standalone visual system, layout, tooltips, and filters.
- `app.js` - canvas rendering, quarter layout, filters, and interactions.
- `graph-data.js` - generated data payload used by the frontend.
- `export_hrtech_graph_data.py` - optional exporter for regenerating `graph-data.js` from the taxonomy workbook.

## Local Preview

Run a static server from the repository root:

```bash
python3 -m http.server 51236 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:51236/
```

## GitHub Pages

The repository includes a GitHub Actions workflow for Pages deployment.

Published site URL:

```text
https://evgvolnov.github.io/hr-startups/
```

If the first deployment does not start automatically, open repository settings and select:

```text
Settings -> Pages -> Source -> GitHub Actions
```

## Regenerating Data

The checked-in `graph-data.js` is already generated. To regenerate it, place the master taxonomy workbook at:

```text
../outputs/hrtech_startups_master/hrtech_startups_master_taxonomy.xlsx
```

and run:

```bash
python3 export_hrtech_graph_data.py
```

The exporter also expects the domain taxonomy JSON at:

```text
../outputs/hrtech_startups_master/domain_taxonomy.json
```
