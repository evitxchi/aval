# WhatsApp message templates

**Submit these to Meta now.** Each locale variant is reviewed separately, review
takes anywhere from a few minutes to several days, and a rejection restarts the
clock. Nothing in P4 can ship without them, so this is on the critical path
regardless of how the code is going.

---

## Why templates exist at all

WhatsApp allows free-form replies only inside a **24-hour customer service
window**, which opens each time the user messages the business number. Outside
it, the only thing that may be sent is a template Meta has pre-approved.

Every P2 answer is inside the window by construction — it is a reply to a
question that was just asked. Every P4 subscription is outside it by
construction: a Monday summary arrives because it is Monday, not because anyone
texted. So the read product needs no templates and the subscription product
cannot work without them.

`lib/channels/outbound.ts` enforces the window itself (`withinSessionWindow`)
and returns `outside_window` rather than throwing, so the caller can fall back
to a template instead of losing the message.

---

## Category

All of these are **UTILITY**, not MARKETING.

That distinction is not cosmetic. Utility templates relate to an existing
transaction or account and are priced lower; marketing templates are
promotional, cost more, and are subject to per-user frequency caps that would
silently drop a delinquency alert. A template that reads as promotional gets
recategorised by Meta during review, which changes its price and its delivery
guarantees without changing its text.

Keep every one of these strictly factual and account-related. No greetings
beyond the recipient's name, no calls to action that aren't about the account
itself, no product language.

---

## Naming

`aval_<purpose>_<locale>` — lowercase, underscores only, which is Meta's
constraint. The locale suffix is part of the name because each variant is a
separate submission with its own approval state.

---

## 1. Delinquency threshold crossed

**Name:** `aval_delinquency_alert_en` / `aval_delinquency_alert_es`
**Category:** UTILITY
**Languages:** `en_US`, `es_MX`

### en_US

```
Body:
{{1}} residents at {{2}} are past due, totalling {{3}}.

Reply to see the list or take action.
```

### es_MX

```
Body:
{{1}} residentes en {{2}} tienen saldo vencido, por un total de {{3}}.

Responde para ver la lista o tomar acción.
```

| Variable | Example | Source |
|---|---|---|
| `{{1}}` | `3` | `GateResult.rows.length` |
| `{{2}}` | `Riverside` | property name from the gate |
| `{{3}}` | `$28,500` | `GateResult.totalCents` |

**Review note.** Meta rejects templates whose variables could produce an empty
or nonsensical body, and a body that is *only* variables. All three here are
embedded in sentence text and the gate never fires with a zero count, so none
can be empty — but say so in the submission's sample values rather than leaving
the reviewer to infer it.

---

## 2. Weekly summary

**Name:** `aval_weekly_summary_en` / `aval_weekly_summary_es`
**Category:** UTILITY
**Languages:** `en_US`, `es_MX`

### en_US

```
Body:
Your week at {{1}}: {{2}} collected, {{3}} open work orders.

Reply for the detail.
```

### es_MX

```
Body:
Tu semana en {{1}}: {{2}} de renta cobrada, {{3}} órdenes de trabajo abiertas.

Responde para ver el detalle.
```

| Variable | Example | Source |
|---|---|---|
| `{{1}}` | `Alpha Properties` | organization name |
| `{{2}}` | `$142,300` | `weeklySummaryGate` total |
| `{{3}}` | `7` | open work-order count |

Note the Spanish says *renta*, per `terms.es-mx.json`. A per-org term map can
override the word in free-form replies (`lib/channels/vocabulary.ts`), but **not
here** — template text is fixed at approval time. An org that insists on
*arriendo* needs its own approved variant, which is a real cost worth knowing
about before promising it to a customer.

---

## 3. Link confirmation

**Name:** `aval_link_confirmed_en` / `aval_link_confirmed_es`
**Category:** UTILITY
**Languages:** `en_US`, `es_MX`

### en_US

```
Body:
You're connected to {{1}} as {{2}}. Send "help" to see what you can ask.
```

### es_MX

```
Body:
Estás conectado a {{1}} como {{2}}. Envía "ayuda" para ver qué puedes preguntar.
```

**Probably not needed, submitted anyway.** Linking is always a reply to the
user's own message, so the confirmation is inside the window and free-form text
would do. It is here because the window is measured from a timestamp Meta
controls, and a link confirmation arriving 24 hours and two seconds after the
code was sent is a confusing failure for the one message a new user must
receive. One template is cheap insurance.

---

## 4. Escalation acknowledgement

**Name:** `aval_escalation_ack_en` / `aval_escalation_ack_es`
**Category:** UTILITY
**Languages:** `en_US`, `es_MX`

### en_US

```
Body:
We've received your message about {{1}} and passed it to the property team. Someone will respond here.
```

### es_MX

```
Body:
Recibimos tu mensaje sobre {{1}} y lo pasamos al equipo de la propiedad. Alguien te responderá por aquí.
```

| Variable | Example |
|---|---|
| `{{1}}` | `a maintenance issue` / `un problema de mantenimiento` |

**`{{1}}` is a fixed phrase from a short list, never the resident's own words.**
Interpolating what the resident wrote would put their text into a Meta-hosted
template payload — which is both a data-protection problem under the LFPDPPP
and a reliable way to get a template rejected for containing unpredictable
content. `lib/channels/escalation.ts` produces a category; the category maps to
one of five approved phrases.

---

## Submission checklist

- [ ] Submit all four in `en_US`.
- [ ] Submit all four in `es_MX` **as separate submissions** — same day, since
      they approve independently and the slowest one sets the ship date.
- [ ] Provide realistic sample values for every variable. The most common
      rejection is a reviewer unable to tell what a template will actually say.
- [ ] Confirm each came back as UTILITY. If one was recategorised to MARKETING,
      the text read as promotional — rewrite and resubmit rather than accepting
      it, because the frequency caps will drop alerts.
- [ ] Record the approved template names in the org's WhatsApp connection
      credentials so `lib/channels/outbound.ts` can name them at send time.
- [ ] Re-check status before launch. Approval can be revoked, and a revoked
      template fails at send with a generic error.

## What is deliberately not templated

Answers to questions, confirmations, previews, and undo replies. All of those
are inside the 24-hour window by construction, and templating them would fix
their wording at approval time — which would defeat the renderer, the per-org
term map, and the whole point of the channel being conversational.
