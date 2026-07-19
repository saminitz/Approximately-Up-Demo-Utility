# Adjusted Autoland Throttle Formula (Game-Matched)

Your ideal physics formula:

$$Throttle = \frac{Mass \times \left( \frac{Velocity^2}{2 \times Distance} + Gravity \right)}{Max\ Thruster\ Force}$$

Below is the **game-adjusted** version so it matches the decompiled implementation.

---

## 1. Gravity (not constant)

The game uses **inverse-square gravity** from `UniverseEntityGravity.GetGravity`:

```csharp
// UniverseEntityGravity.cs
float num = distanceFromCenter / planetRadius;
return this._gravity / (num * num);   // g(r) = _gravity * (R/r)²
```

With your planet: `_radius = 550000` m, `_gravity = 10` m/s².

- **Distance** = height above ground (m)  
- **r** = distance from planet center = `550000 + Distance`  
- **Gravity at current altitude:**

$$Gravity = 10 \times \left( \frac{550000}{550000 + Distance} \right)^2$$

So use this **effective gravity** in the throttle formula instead of a constant 10.

---

## 2. Thrust in the game

From `SCTick_Thruster_Forces.cs`:

- **Force** = `(frameEfficiency × frameEfficiencyPowerMultiplier01) × _maxForce`
- **frameEfficiency** = your throttle input (e.g. 0..1).
- **frameEfficiencyPowerMultiplier01** is reduced in atmosphere by `SCTick_Thruster_SpaceAtmosphereWater` using `_atmosphereDensity` (from `UniverseEntityAirDensity._amount = 0.7` at surface with your `_radiusMin=1`, `_radiusMax=1.03`).

So **effective max thrust** at full throttle is:

**Max Thruster Force (effective)** = (listed max force) × **atmosphere efficiency factor**

For 6 × Atmospheric Lift Fan (125000 N each):

- **Listed total:** 6 × 125000 = **750000 N**
- **At surface** (atmosphere density 0.7): effective max is about **750000 × efficiencyInAtmosphere** (lerp between efficiencyInSpace and efficiencyInAtmosphere with 0.7). If the fan is tuned to 1 in atmosphere and 0 in space, that’s ~0.7, so ~**525000 N** effective at surface. Use your ship’s **effective** max upward force (from testing or from the component’s efficiency in atmosphere) for best match.

---

## 3. Adjusted throttle formula (game-matched)

Use **effective gravity** and **effective max thrust** as above:

**Definitions:**

- \( Mass \) = spacecraft mass (kg)  
- \( Velocity \) = **magnitude** of vertical speed toward ground (m/s), positive = descending  
- \( Distance \) = height above ground (m)  
- \( R \) = planet radius = **550000** m  
- \( g\_surface \) = surface gravity = **10** m/s²  
- \( F_{max} \) = effective max upward thrust (N), e.g. **750000** (or lower if you account for atmosphere efficiency)

**Effective gravity at altitude:**

$$G_{eff} = g_{surface} \times \left( \frac{R}{R + Distance} \right)^2 = 10 \times \left( \frac{550000}{550000 + Distance} \right)^2$$

**Game-adjusted throttle:**

$$Throttle = \frac{Mass \times \left( \frac{Velocity^2}{2 \times Distance} + G_{eff} \right)}{F_{max}}$$

Clamp **Throttle** to `[0, 1]` before sending to the game. Use **vertical** velocity and **vertical** (upward) max force; the game applies force along thruster direction and gravity along world down.

---

## 4. Optional: atmosphere efficiency factor

If you read the game’s `_atmosphereDensity` (0 at space, up to 0.7 at surface with your asset) and know the fan’s efficiency in space vs atmosphere:

- Effective max force ≈ **750000 × lerp(efficiencyInSpace, efficiencyInAtmosphere, _atmosphereDensity)**  
- Use this as \( F_{max} \) in the formula for better match at different altitudes.

---

## 5. Summary (copy-paste style)

```
R = 550000
g_surface = 10
F_max = 750000   // or lower if accounting for atmosphere; 6 × 125000

G_eff = g_surface * (R / (R + Distance))^2
RequiredForce = Mass * (Velocity^2 / (2 * Distance) + G_eff)
Throttle = clamp(RequiredForce / F_max, 0, 1)
```

**Main adjustments vs your original formula:**

1. **Gravity:** use altitude-dependent gravity \( G_{eff} = 10 \times (550000/(550000 + Distance))^2 \) instead of constant 10.  
2. **Max thrust:** use effective max upward force (optionally reduced by atmosphere efficiency).  
3. **Velocity/Distance:** use vertical speed and height above ground in m and m/s.

These match how `UniverseEntityGravity`, `SCTick_Thruster_Forces`, and `SpaceshipPartsApplyForces` (with `dt = 1/60`) work in the decompiled code.
