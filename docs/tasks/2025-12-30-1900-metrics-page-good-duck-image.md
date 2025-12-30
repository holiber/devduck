# Add "Good Duck" image to GitHub Pages metrics dashboard

## 0. Meta

- Date: 2025-12-30
- Area: GitHub Pages (`/metrics/`) dashboard

## 1. Task

Add a "Good Duck" image to the GitHub Pages metrics dashboard page so it is shown near the top of `/metrics/`.

### Definition of Done

- The generated dashboard HTML includes a header image.
- The image is copied into the published `metrics/` directory during `generate-metrics-report.mjs`.

## 2. Status Log

- Implemented a stable dashboard header image slot and asset copy with fallback.

## 3. Plan

1. Update the dashboard HTML template to render a hero image.
2. Copy the image asset into the published `metrics/` folder during report generation.

## 4. Implementation Notes

- The dashboard expects `media/good-duck.png` (preferred).
- If it is missing, it falls back to `media/logo.png` to avoid breaking the dashboard.
- The deployed filename is fixed to `metrics/good-duck.png` so the HTML stays stable.

## 5. CI Attempts

N/A

## 6. Final Report

Updated the GitHub Pages metrics dashboard generator to render a hero image at the top of `/metrics/` and to copy the image asset into the published folder. To use the exact "GOOD DUCK!" picture, add it as `media/good-duck.png` (it will override the fallback).

