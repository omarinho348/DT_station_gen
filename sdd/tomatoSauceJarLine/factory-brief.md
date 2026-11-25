# Factory brief: Tomato sauce jars: fill, cap, label, carton pack

Line id `tomatoSauceJarLine`.

## Product
**Tomato sauce jar (350 g)**: A 350 g tomato sauce filled into a glass jar with a 75 mm across, 110 mm tall body and a metal twist lid. Each jar gets one side label and is then packed 4-jars per slotted shipping carton (2×2 upright).

Shown in the twin as a parametric bottle, 75 × 75 × 110 mm.

## Throughput
- Target: **75 units per hour**, so a takt of **48 s** per unit.
- A simulated run: 8 units.

## Process
| # | Step | What happens |
|---|---|---|
| 1 | Fill | Fill the 350 g tomato sauce into each glass jar using a food-grade filling method appropriate for thick, non-foaming sauce. |
| 2 | TwistCap | Apply the metal twist lid and twist it closed onto the jar. |
| 3 | ApplyLabel | Stick one label on the front of each jar (10×10 mm), with no printed-variable codes. |
| 4 | PackCarton | Place jars upright in a 2×2 arrangement into a slotted shipping carton and close the carton immediately before discharge. |

## Quality
Every jar is checked by weight during filling with an assumed acceptance tolerance of ±2 g around 350 g; any out-of-tolerance jar is rejected (diverted to a reject stream) and not passed to capping/labeling/carton packing.

## Constraints
- Food grade (materials, contact surfaces, and hygienic operation).
- Cartons: slotted shipping cartons; 4 jars per carton in a fixed 2×2 upright orientation.
- Carton is immediately closed before discharge.

## Assumptions
- 600 units/shift over 8 h implies 75 finished cartons/units per hour on average across the whole shift.
- Weight-based filling targets 350 g per jar (no foaming behavior; fill method adjusted for thick viscosity).
- Carton internal clearance and foam/liner allowance are sized to fit 75 mm × 110 mm jars in a 2×2 upright layout using standard practical packing clearances (details to be confirmed).
- Rejection handling: rejected units are detected and diverted before they enter the next steps that would waste downstream labor/pack material.

## Checks
- ⚠ The brief says bad units are rejected, but product.model.params.rejectEvery is unset: no unit will ever fail, so the reject path never runs in the twin. Reject the brief with how often one should fail (e.g. "every 10th fails").

## Open questions
- **product**: Do you want the jar’s outer profile to be modeled as a simple cylinder (75 mm diameter) or do you have a specific jar neck/shoulder shape (e.g., smaller neck diameter and larger body), so the capping and label placement can be accurate? _(Capping/grip fixtures and label placement depend on jar geometry, not just overall max diameter.)_
- **quality**: Where should the ±2 g check be applied relative to the steps: immediately after filling (before capping), or after capping (before labeling/packing)? _(This decides which station performs the checkweighing and which downstream stations must be blocked/diverted on reject.)_
- **layout**: For the 4-jars cartons (2×2 upright), do you have a preferred target carton internal size or should we size it to: jar diameter (75 mm) × 2 with ~1–2 cm total clearance plus a practical foam/liner thickness, and jar height (110 mm) plus lid height allowance? _(Carton erection/closing tooling and packing station clearances require carton dimensions or clear rules for the clearance/foam.)_
