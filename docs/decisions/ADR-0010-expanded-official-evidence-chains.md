# ADR-0010: Expand official evidence without weakening claim boundaries

**Status:** Accepted
**Date:** 2026-08-30

## Context

Agent orchestration made multi-hazard investigations easier, but orchestration
alone could not repair thin evidence. Several chains still relied on a single
observation family, United States station coverage was unnecessarily encoded
as national, and optional source gaps could make an otherwise supported result
look weaker than the evidence justified.

## Decision

- Add bounded, deterministic adapters for NOAA NCEI Storm Events, NHC HURDAT2,
  NOAA MRMS rolling QPE, NIFC WFIGS fire perimeters, EPA AQS historical PM2.5,
  Smithsonian GVP eruption records, and the Canadian Drought Monitor.
- Accept an event or station only when its reported coordinate is inside the
  exact user-selected geometry and its observation interval matches the
  requested date. Never expand the user's radius to find evidence.
- Treat USGS earthquake records, USGS HANS volcano notices, and Smithsonian
  GVP eruption records as primary evidence for their own distinct claims.
  Satellite SO2 remains a separate atmospheric observation.
- Use NOAA Global Historical Climatology Network hourly stations globally,
  subject to the same in-area station rule, rather than filtering the official
  inventory to United States stations.
- Preserve every optional source outcome, limitation, and verification link.
  Add an optional source to mission attribution only when it returns an
  observation, so a supplemental no-observation result cannot erase supported
  evidence from the chain's core sources.
- Present numeric precipitation only when an official endpoint supplies a
  finite validated value. A rendered IMERG image is not converted into a
  millimetre estimate.
- Keep authenticated raw NASA IMERG and SMAP products, deep NEXRAD archive
  processing, and Canada's migrating CWFIS/CWFIF fire service registered but
  deferred until their access, parser, and live-schema gates can be verified.

## Consequences

- Broad storm investigations can combine geolocated event reports, station
  measurements, hurricane-track context, recent radar-derived QPE, flood
  imagery, and water gauges while keeping Wind and Flood results separate.
- Fire, air-quality, drought, earthquake, and volcano investigations gain
  additional official evidence without turning regional observations into
  property, health, route-safety, or emergency conclusions.
- Credential-free paths remain functional when EPA AQS credentials are absent;
  the closed credential gate is visible and no secret enters provenance.
- Source additions require parser, bounding, provenance, limitation, and
  failure-state tests before they may be described as integrated.
