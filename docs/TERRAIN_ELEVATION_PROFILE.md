# Terrain elevation profile

The elevation explorer supports both single-point lookup and a sampled profile along a user-drawn polyline.

## Method
- The user selects two or more map vertices.
- The profile service resamples the great-circle path at up to 40 evenly spaced distances (the page currently requests 24).
- A single multi-coordinate request is sent to the Open-Meteo Elevation API.
- The response is accepted only when the elevation array length matches the requested sample count.
- Missing or invalid elevations remain null; they are never converted to zero.
- The page reports known minimum/maximum elevations, endpoint elevation difference, cumulative horizontal distance, and segment grade only where both adjacent elevations are available.

## Interpretation limits
- The elevation source is Copernicus DEM GLO-90, approximately 90 m spatial resolution.
- A drawn line is sampled from a terrain model, not a field survey. Small landforms, road camber, buildings, walls, and property boundaries are not represented reliably.
- The endpoint grade is a broad average, not a road gradient or engineering slope certification.
- Results are for exploratory context only and must not be used for cadastral, construction, drainage design, or safety-critical decisions.

## Validation
The profile service validates coordinates and sample limits, checks returned array lengths, preserves missing values, and tests path interpolation, distance, extrema, grade, and no-data cases.
