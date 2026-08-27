# Evidence-forward demo live verification — 2026-08-27

## Verification boundary

- Candidate: uncommitted working tree based on
  `3411173c151fb81f776b25cefbd77249adeab843`.
- Surface: local Next.js product routes on `http://localhost:3137`.
- Requests: fixed historical dates and bounded areas for Houston, Los Angeles,
  and Tucson.
- Transport: credential-free official public sources; no secrets, paid calls,
  retries, or fixture substitutions.
- Storage: raw upstream payloads were not printed or written.

This is local live-source evidence. It is separate from deterministic tests,
CI, a deployed build, and a native model-scored Agent journey.

## Results

All six primary and related evidence chains returned
`observations_returned` from the requested historical dates.

### Houston roof concern — 2024-07-08

Wind & Storm returned three observations from two official sources:

- NOAA NCEI GHCNh peak gust: **39.6 m/s** at
  `2024-07-08T14:35:00Z`;
- NOAA NCEI GHCNh peak wind speed: **25.7 m/s** at the same time;
- NWS Houston/Galveston post-event context documenting Hurricane Beryl and
  widespread regional wind damage in Southeast Texas.

Verification links:

- [NOAA GHCNh station-year file](https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/access/by-year/2024/psv/GHCNh_USW00000188_2024.psv)
- [NWS Beryl post-tropical cyclone report](https://www.weather.gov/media/hgx/TropicalEventSummary/PSHHGX_2024AL02_Beryl_Summary.pdf)

Flood & Heavy Rain returned three observations from NASA IMERG, NASA VIIRS,
and USGS. The strongest numeric ground observation was a **22.82 ft** USGS
gage height at `2024-07-08T23:45:00Z`; IMERG returned the requested day's
regional precipitation visualization.

### Los Angeles symptom concern — 2025-01-09

Fire & Smoke returned two observations from NOAA HMS:

- **2,819** fire-detection records in the selected area;
- **189** smoke-polygon coordinate pairs in the selected area;
- both observations are dated `2025-01-09T00:00:00Z`.

Verification links:

- [NOAA HMS fire points for 2025-01-09](https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Fire_Points/Text/2025/01/hms_fire20250109.txt)
- [NOAA HMS smoke polygons for 2025-01-09](https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/2025/01/hms_smoke20250109.kml)

Air Quality returned 19 observations from the credential-free AirNow daily
monitoring file and NASA MAIAC aerosol-optical-depth visualization. Returned
monitor values included an **AQI 54** OZONE-8HR observation, alongside the
same-day regional aerosol visualization.

### Tucson pet concern — 2025-07-10

Extreme Heat returned three observations from NOAA USCRN and NASA GIBS:

- hourly outdoor air temperature: **42.6 °C**;
- hourly heat index: **39.1 °C**;
- NASA MODIS land-surface-temperature visualization for the selected date.

Verification link:

- [NOAA USCRN Tucson Heat01](https://www.ncei.noaa.gov/pub/data/uscrn/products/heat01/CRNHE0101-AZ_Tucson_11_W.csv)

Drought & Land returned two observations from NASA NDVI and the U.S. Drought
Monitor. The native NDVI observation date was `2025-06-26T00:00:00Z`; the
official drought statistics were reported for `2025-07-08T00:00:00Z`, the
applicable weekly record for the requested day.

## Product conclusion

The three curated demos now have actual official historical evidence in every
primary and related chain. Each two-chain journey has at least four independent
official source IDs, which satisfies the deterministic
`moderate` relationship-assessment confidence rule while preserving each
underlying observation's own source confidence and citation.
