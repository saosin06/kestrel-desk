# Compliance policy sources — UNVERIFIED

`data/compliance-policy.json` (KESTREL-UAS-1) is *modeled on* US federal restrictions on
foreign-made drone components. **None of the points below have been verified.** Check
each one with a mentor or counsel before treating the policy as anything more than a model.
The UI must show: "Policy modeled on federal drone component restrictions — verify with counsel."

| # | Candidate source | What we believe it covers (unverified) | Status |
|---|---|---|---|
| 1 | FY2020 NDAA §848 | DoD procurement of UAS, or of certain components (flight controllers, radios, data transmission devices, cameras, gimbals, ground control systems, operating software), made in or by entities of "covered foreign countries" | unverified |
| 2 | American Security Drone Act of 2023 (enacted in the FY2024 NDAA) | Federal agency procurement and operation of UAS made or assembled by "covered foreign entities" | unverified |

## Modeling choices (ours, not the law's)
- Covered component classes in our BOM: `flight_controller`, `radio_datalink`, `camera`, `gimbal`.
- Restricted origins: CN, RU, IR, KP. Restricted manufacturer category: `covered_foreign_entity`.
- Applies when the product is sold to `federal` customers.
- A missing certificate of origin for a covered component is `unknown` → escalate, never a pass.
