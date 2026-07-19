# Suicide Burn Formula

A **suicide burn** (or **hover slam**) is a landing maneuver where you fire at **full throttle** only when necessary, so that you reach **zero vertical speed exactly at touchdown**. It minimizes fuel use but requires knowing the altitude at which to start the burn.

---

## 1. Idea

- You are descending with downward speed \(v\) at altitude \(d\).
- You burn **full throttle** upward until velocity is zero.
- Under constant acceleration, there is a unique **altitude at which you must start** that burn so you reach \(v = 0\) exactly at the ground.

That altitude is the **suicide burn altitude**: if you start the burn any lower, you hit the ground before stopping; any higher, you could have started later and saved fuel.

---

## 2. Physics (constant gravity)

Assume:

- \(m\) = spacecraft mass (kg)
- \(T\) = max upward thrust (N)
- \(g\) = gravity magnitude (m/s²), constant for this derivation
- \(v\) = **magnitude** of downward speed (m/s), \(v \geq 0\)

While burning full throttle, **upward** acceleration is:

$$a = \frac{T}{m} - g$$

You need \(T > m g\) (thrust can overcome gravity). From downward speed \(v\), time to reach zero speed:

$$t_{stop} = \frac{v}{a} = \frac{v}{\frac{T}{m} - g} = \frac{v \, m}{T - m \, g}$$

Distance traveled (in the direction of motion) while slowing from \(v\) to 0 under constant \(a\) is:

$$d = v \, t_{stop} - \frac{1}{2} a \, t_{stop}^2$$

Substitute \(t_{stop} = v/a\):

$$d = \frac{v^2}{a} - \frac{1}{2} \frac{v^2}{a} = \frac{v^2}{2a} = \frac{v^2}{2 \left( \frac{T}{m} - g \right)} = \frac{v^2 \, m}{2 \, (T - m \, g)}$$

So you must start the full burn at **altitude** (above ground):

$$\boxed{d = \frac{v^2 \, m}{2 \, (T - m \, g)}}$$

**Suicide burn rule:** When your downward speed is \(v\), start full throttle at altitude \(d\) given above.

---

## 3. When to start the burn (trigger condition)

At each moment you have:

- Current **altitude** \(h\) (height above ground)
- Current **downward speed** \(v\)

Compute the **required burn altitude** for your current \(v\):

$$d_{required}(v) = \frac{v^2 \, m}{2 \, (T - m \, g)}$$

- If **\(h \leq d_{required}(v)\)** → **start the burn now** (you are at or below the suicide burn altitude).
- If **\(h > d_{required}(v)\)** → keep coasting (or use a small burn to control approach); start full burn when \(h = d_{required}(v)\).

So the **trigger** is:

$$\text{Start full throttle when} \quad h \leq \frac{v^2 \, m}{2 \, (T - m \, g)}$$

---

## 4. Game-adjusted version (altitude-dependent gravity)

The game uses **inverse-square gravity** (see `Autoland_Formula_Adjusted.md`):

$$g(r) = g_{surface} \times \left( \frac{R}{r} \right)^2$$

With **planet radius** \(R = 550000\) m and **surface gravity** \(g_{surface} = 10\) m/s², at **altitude** \(h\) (height above ground), \(r = R + h\):

$$g_{eff}(h) = 10 \times \left( \frac{550000}{550000 + h} \right)^2$$

For the suicide burn altitude we use gravity **at the current altitude** (or an average over the burn; using current is a good approximation). So:

**Effective gravity at current altitude \(h\):**

$$G_{eff} = 10 \times \left( \frac{550000}{550000 + h} \right)^2$$

**Game-adjusted suicide burn altitude:**

$$\boxed{d = \frac{v^2 \, m}{2 \, (T - m \, G_{eff})}}$$

with \(G_{eff}\) evaluated at your current altitude (or at \(h = d\) for a slightly more consistent iterate). Ensure \(T > m \, G_{eff}\) or you cannot hover.

**Trigger:**

$$\text{Start full throttle when} \quad h \leq \frac{v^2 \, m}{2 \, (T - m \, G_{eff})}$$

Use the same **effective max thrust** \(T\) as in the autoland formula (e.g. 6 × 125000 N, or reduced by atmosphere efficiency).

---

## 5. Summary (copy-paste style)

**Constants (example):**

- \(R = 550000\) m  
- \(g_{surface} = 10\) m/s²  
- \(T = 750000\) N (6 × Atmospheric Lift Fan 125000 N; reduce if accounting for atmosphere)  
- \(m\) = ship mass (kg)

**At current altitude \(h\) and downward speed \(v\):**

```
G_eff = g_surface * (R / (R + h))^2
d_required = (v^2 * m) / (2 * (T - m * G_eff))
```

**Trigger:**

- If `h <= d_required` → **start full-throttle burn**  
- Otherwise → wait until altitude drops to `d_required` (or use a guided approach).

**Note:** If \(T \leq m \, G_{eff}\), the craft cannot hover at that altitude; the formula denominator is not positive and the burn cannot bring you to zero speed before ground.

---

## 6. Optional: Burn time

Once you start the burn, time until touchdown (velocity zero at ground):

$$t_{burn} = \frac{v}{T/m - G_{eff}} = \frac{v \, m}{T - m \, G_{eff}}$$

Useful for timers or UI (e.g. “burn in 3… 2… 1…”).
