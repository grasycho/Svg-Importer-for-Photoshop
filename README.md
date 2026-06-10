# SVG Advanced Importer for Photoshop (v3.1)

Import SVG artwork as **native Photoshop Shape Layers** while preserving fills, strokes, opacity, transforms, group hierarchy, and vector paths.

---

## Overview

SVG Advanced Importer is an Adobe Photoshop ExtendScript (`.jsx`) that converts SVG files into editable Photoshop vector shape layers.

Unlike raster-based imports, this script recreates SVG geometry as native Photoshop vector paths, allowing full editing of fills, strokes, shapes, groups, and layer properties directly inside Photoshop.

The importer supports a large portion of the SVG specification including:

* Paths
* Rectangles
* Rounded Rectangles
* Circles
* Ellipses
* Polygons
* Polylines
* Lines
* SVG Groups (`<g>`)
* SVG Definitions (`<defs>`)
* SVG References (`<use>`)
* Transform Matrices
* ViewBox Scaling
* Fill Colors
* Stroke Styles
* Layer Opacity
* Even-Odd Hole Handling

---

# Features

## Native Photoshop Shape Layers

Creates actual Photoshop shape layers instead of rasterized artwork.

Benefits:

* Infinite scalability
* Editable vector paths
* Editable fills and strokes
* Smaller file sizes
* Non-destructive workflow

---

## SVG Group Hierarchy Preservation

SVG groups are converted into Photoshop Layer Groups.

Example:

```svg
<g id="Logo">
    <g id="Icon">
        ...
    </g>
    <g id="Text">
        ...
    </g>
</g>
```

Becomes:

```text
Logo
├── Icon
└── Text
```

inside Photoshop.

---

## Full Transform Support

Supports nested transform stacks including:

* matrix()
* translate()
* scale()
* rotate()
* skewX()
* skewY()

Transforms are accumulated through the SVG hierarchy and applied correctly to imported paths.

---

## Fill Support

Supported fill formats:

* Hex colors (`#ff0000`)
* Short hex (`#f00`)
* RGB colors (`rgb(255,0,0)`)
* Percentage RGB
* Named colors

Examples:

```svg
fill="#ff0000"
fill="#f00"
fill="rgb(255,0,0)"
fill="blue"
```

---

## Stroke Support

Preserves:

* Stroke color
* Stroke width
* Stroke opacity
* Line caps
* Line joins

Supported caps:

* butt
* round
* square

Supported joins:

* miter
* round
* bevel

---

## Opacity Support

Preserves:

* opacity
* fill-opacity
* stroke-opacity

Layer opacity is automatically applied to Photoshop layers.

---

## SVG `<use>` Dereferencing

Referenced objects inside `<defs>` can be reused throughout the document.

Example:

```svg
<defs>
    <path id="star" ... />
</defs>

<use href="#star" />
```

The importer resolves references and creates actual Photoshop layers.

---

## Proper Arc Conversion

SVG arc commands:

```svg
A
a
```

are converted into cubic Bézier curves.

This allows Photoshop to recreate arc geometry accurately.

---

## Smooth Quadratic Curve Support

Supports:

```svg
Q
q
T
t
```

including smooth quadratic continuation.

---

## Even-Odd Hole Handling (XOR)

Supports complex shapes containing holes.

Useful for:

* Typography
* Logos
* Icons
* Compound paths

Optional XOR processing can be enabled from the UI.

---

## ViewBox Scaling

The script respects SVG viewBox definitions and scales imported artwork correctly.

Example:

```svg
viewBox="0 0 1024 1024"
```

---

## Duplicate Shape Detection

Optional duplicate detection prevents importing identical shapes multiple times.

Useful for exported SVGs containing repeated geometry.

---

## Group Simplification

Optional group collapsing automatically removes unnecessary group levels when a group contains only a single shape.

This helps keep Photoshop layer structures clean.

---

# Supported SVG Elements

| Element  | Supported |
| -------- | --------- |
| path     | ✅         |
| rect     | ✅         |
| circle   | ✅         |
| ellipse  | ✅         |
| polygon  | ✅         |
| polyline | ✅         |
| line     | ✅         |
| g        | ✅         |
| defs     | ✅         |
| use      | ✅         |
| svg      | ✅         |

---

# User Interface

The importer includes a ScriptUI-based interface.

## File Management

* Add SVG files
* Remove selected files
* Clear list
* Multi-file import

---

## Import Options

### Import Fills

Preserves SVG fill colors.

### Import Strokes

Preserves stroke settings.

### Apply Opacity

Transfers SVG opacity to Photoshop layers.

### Preserve Group Hierarchy

Creates Photoshop LayerSets matching SVG groups.

### Even-Odd Holes (XOR)

Creates compound vector shapes with holes.

### Collapse Single-Shape Groups

Simplifies layer hierarchy.

### Skip Duplicate Shapes

Avoids importing duplicate geometry.

### Debug Log

Writes a diagnostic log file to the desktop.

---

# Import Targets

## New Document

Creates a new Photoshop document sized from:

```text
SVG ViewBox × Scale
```

Options:

* 72 ppi
* 150 ppi
* 300 ppi

---

## Active Document

Imports artwork into the currently open Photoshop document.

---

# Positioning Options

## Top-Left

Places artwork using the SVG coordinate origin.

## Center on Canvas

Centers imported artwork inside the destination document.

---

# Photoshop Compatibility

Designed for Adobe Photoshop versions supporting:

* ExtendScript
* Shape Layers
* Action Manager APIs
* ScriptUI

Recommended:

* Photoshop CC 2020+
* Photoshop 2021+
* Photoshop 2022+
* Photoshop 2023+
* Photoshop 2024+
* Photoshop 2025+

---

# Installation

## Method 1 — Run Directly

1. Open Photoshop.
2. Select:

```text
File → Scripts → Browse...
```

3. Select:

```text
svg_importer_advanced_v3_1.jsx
```

4. Run the script.

---

## Method 2 — Install Permanently

Copy the script into Photoshop's Scripts folder.

Example:

```text
Adobe Photoshop/
└── Presets/
    └── Scripts/
        └── svg_importer_advanced_v3_1.jsx
```

Restart Photoshop.

The script will then appear under:

```text
File → Scripts
```

---

# Workflow Example

1. Launch the script.
2. Add one or more SVG files.
3. Choose import options.
4. Select destination:

   * New Document
   * Active Document
5. Click Import.
6. Wait for processing.
7. Review the generated Photoshop layer structure.

---

# Import Report

After completion the script displays:

* Imported shape count
* Processed file count
* Skipped shapes
* Duplicate shapes skipped
* Errors encountered

---

# Debug Logging

Enable:

```text
Write Debug Log
```

The script generates:

```text
svg_import_log.txt
```

on the desktop.

Useful for troubleshooting:

* SVG parsing
* Layer creation
* Duplicate detection
* Import failures

---

# Technical Highlights

Internally, the importer includes:

* SVG tokenizer
* Attribute parser
* Transform matrix engine
* Arc-to-Bézier converter
* Path command parser
* Group hierarchy resolver
* Definition/reference resolver
* Photoshop Action Manager shape generator

Implemented entirely in ExtendScript without external dependencies.

---

# Limitations

Currently not intended to support:

* SVG filters
* Gradients
* Patterns
* Clipping paths
* Masks
* Embedded raster images
* CSS stylesheets outside inline styles
* Text elements as editable text layers

Unsupported features may be ignored or imported partially.

---

# License

Use, modify, and distribute according to the license chosen for this repository.

---

# Acknowledgements

Built for designers and artists who need reliable SVG-to-Photoshop vector conversion while preserving editable structure and appearance.
