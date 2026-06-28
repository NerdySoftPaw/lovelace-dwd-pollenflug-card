/**
 * DWD Pollenflug Card — a self-contained Lovelace card for the
 * `dwd_pollenflug` Home Assistant integration.
 *
 * No build step, no dependencies: a plain custom element. Installable via HACS
 * (category: plugin) or manually by copying this file to `config/www/` and
 * registering it as a JavaScript-module dashboard resource.
 *
 * Integration: https://github.com/NerdySoftPaw/ha-dwd-pollenflug
 */

const DAY_LABELS = ["Heute", "Morgen", "Übermorgen"];

// Fallback labels, keyed by the English pollen slug at the end of the entity_id.
const POLLEN_LABELS = {
  hazel: "Hasel",
  alder: "Erle",
  ash: "Esche",
  birch: "Birke",
  grasses: "Gräser",
  rye: "Roggen",
  mugwort: "Beifuß",
  ragweed: "Ambrosia",
};

// Index -> RGB stops, interpolated for half-steps.
const COLOR_STOPS = [
  [0.0, [76, 175, 80]],   // keine        – green
  [1.0, [139, 195, 74]],  // gering       – light green
  [1.5, [255, 193, 7]],   // g.–mittel    – amber
  [2.0, [255, 152, 0]],   // mittel       – orange
  [3.0, [244, 67, 54]],   // hoch         – red
];

function levelColor(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "var(--disabled-text-color, #9e9e9e)";
  }
  const v = Math.max(0, Math.min(3, value));
  let lo = COLOR_STOPS[0];
  let hi = COLOR_STOPS[COLOR_STOPS.length - 1];
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    if (v >= COLOR_STOPS[i][0] && v <= COLOR_STOPS[i + 1][0]) {
      lo = COLOR_STOPS[i];
      hi = COLOR_STOPS[i + 1];
      break;
    }
  }
  const span = hi[0] - lo[0] || 1;
  const t = (v - lo[0]) / span;
  const ch = (a, b) => Math.round(a + (b - a) * t);
  return `rgb(${ch(lo[1][0], hi[1][0])}, ${ch(lo[1][1], hi[1][1])}, ${ch(lo[1][2], hi[1][2])})`;
}

// 2.5 -> "2–3", 1 -> "1", null -> "–"
function fmtLevel(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  if (Number.isInteger(value)) return String(value);
  const lo = Math.floor(value);
  return `${lo}–${lo + 1}`;
}

function parseNumber(state) {
  if (state === undefined || state === null) return null;
  if (state === "unavailable" || state === "unknown" || state === "") return null;
  const n = Number(state);
  return Number.isNaN(n) ? null : n;
}

// All sensor entities created by the dwd_pollenflug integration.
function pollenEntities(hass) {
  if (!hass || !hass.entities) return [];
  return Object.keys(hass.entities).filter(
    (id) =>
      id.startsWith("sensor.") &&
      hass.entities[id].platform === "dwd_pollenflug"
  );
}

class DwdPollenflugCard extends HTMLElement {
  setConfig(config) {
    if (!config || !Array.isArray(config.entities) || config.entities.length === 0) {
      throw new Error('dwd-pollenflug-card: "entities" mit mindestens einem Sensor angeben.');
    }
    this._config = config;
    this._entities = config.entities.map((e) =>
      typeof e === "string" ? { entity: e } : e
    );
    this._showForecast = config.forecast !== false;
    this._built = false;
    this.innerHTML = "";
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
    this._update();
  }

  getCardSize() {
    return 1 + this._entities.length;
  }

  // --- Card-picker / editor integration ---------------------------------
  static getConfigElement() {
    return document.createElement("dwd-pollenflug-card-editor");
  }

  static getStubConfig(hass) {
    const ids = pollenEntities(hass);
    if (ids.length) {
      const dev = hass.entities[ids[0]].device_id;
      const sameDevice = ids.filter((id) => hass.entities[id].device_id === dev);
      return { entities: sameDevice.length ? sameDevice : ids, forecast: true };
    }
    return { entities: [], forecast: true };
  }

  _deviceName(entityId) {
    try {
      const reg = this._hass.entities?.[entityId];
      const dev = reg?.device_id ? this._hass.devices?.[reg.device_id] : null;
      return dev?.name_by_user || dev?.name || null;
    } catch (_e) {
      return null;
    }
  }

  _title() {
    if (this._config.title) return this._config.title;
    const name = this._deviceName(this._entities[0]?.entity);
    return name || "Pollenflug";
  }

  // Short per-row label: strip the region/device prefix from the friendly name
  // (auto-localises to "Gräser", "Birke", …); fall back to the entity_id slug.
  _shortName(entityId, attrs) {
    const full = attrs.friendly_name || entityId;
    const device = this._deviceName(entityId);
    if (device && full.startsWith(device)) {
      const rest = full.slice(device.length).replace(/^[\s–-]+/, "").trim();
      if (rest) return rest;
    }
    const token = entityId.split(".").pop().split("_").pop();
    return POLLEN_LABELS[token] || full;
  }

  _build() {
    const card = document.createElement("ha-card");
    const style = document.createElement("style");
    style.textContent = `
      .pf-header { display:flex; align-items:center; gap:8px;
        padding:14px 16px 6px; font-size:1.15rem; font-weight:500;
        color: var(--primary-text-color); }
      .pf-header ha-icon { color: var(--state-icon-color, #44739e); }
      .pf-body { padding:6px 16px 12px; display:flex; flex-direction:column; gap:10px; }
      .pf-row { display:grid; grid-template-columns:26px 1fr auto; align-items:center;
        gap:10px; }
      .pf-row ha-icon { --mdc-icon-size:22px; color: var(--state-icon-color, #44739e); }
      .pf-main { min-width:0; }
      .pf-name { font-size:0.95rem; color:var(--primary-text-color);
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .pf-track { height:8px; border-radius:6px; margin-top:5px;
        background: var(--divider-color, #e0e0e0); overflow:hidden; }
      .pf-fill { height:100%; border-radius:6px; transition: width .4s ease, background-color .4s ease; }
      .pf-desc { font-size:0.75rem; color:var(--secondary-text-color); margin-top:3px; }
      .pf-chips { display:flex; gap:5px; }
      .pf-chip { display:flex; flex-direction:column; align-items:center; gap:3px;
        min-width:34px; padding:3px 6px; border-radius:8px;
        background: var(--secondary-background-color, #f0f0f0); }
      .pf-chip .pf-day { font-size:0.6rem; text-transform:uppercase;
        letter-spacing:.04em; color:var(--secondary-text-color); }
      .pf-chip .pf-val { display:flex; align-items:center; gap:4px;
        font-size:0.82rem; font-weight:600; color:var(--primary-text-color); }
      .pf-dot { width:9px; height:9px; border-radius:50%; flex:0 0 auto; }
      .pf-footer { padding:0 16px 12px; font-size:0.7rem;
        color:var(--secondary-text-color); }
      .pf-unavail .pf-name, .pf-unavail .pf-desc { opacity:.5; }
    `;

    const header = document.createElement("div");
    header.className = "pf-header";
    header.innerHTML = `<ha-icon icon="mdi:flower-pollen"></ha-icon><span class="pf-title"></span>`;

    const body = document.createElement("div");
    body.className = "pf-body";

    this._rows = {};
    for (const item of this._entities) {
      const row = document.createElement("div");
      row.className = "pf-row";

      const icon = document.createElement("ha-icon");
      const main = document.createElement("div");
      main.className = "pf-main";
      const name = document.createElement("div");
      name.className = "pf-name";
      const track = document.createElement("div");
      track.className = "pf-track";
      const fill = document.createElement("div");
      fill.className = "pf-fill";
      track.appendChild(fill);
      const desc = document.createElement("div");
      desc.className = "pf-desc";
      main.append(name, track, desc);

      const chips = document.createElement("div");
      chips.className = "pf-chips";
      const chipEls = [];
      if (this._showForecast) {
        for (const label of DAY_LABELS) {
          const chip = document.createElement("div");
          chip.className = "pf-chip";
          const day = document.createElement("span");
          day.className = "pf-day";
          day.textContent = label;
          const val = document.createElement("span");
          val.className = "pf-val";
          const dot = document.createElement("span");
          dot.className = "pf-dot";
          const num = document.createElement("span");
          val.append(dot, num);
          chip.append(day, val);
          chips.appendChild(chip);
          chipEls.push({ chip, dot, num });
        }
      }

      row.append(icon, main, chips);
      body.appendChild(row);
      this._rows[item.entity] = { row, icon, name, fill, desc, chipEls, item };
    }

    const footer = document.createElement("div");
    footer.className = "pf-footer";

    card.append(style, header, body, footer);
    this.innerHTML = "";
    this.appendChild(card);

    this._titleEl = header.querySelector(".pf-title");
    this._footerEl = footer;
    this._built = true;
  }

  _update() {
    if (!this._hass) return;
    this._titleEl.textContent = this._title();

    let lastUpdate = null;
    for (const [entityId, refs] of Object.entries(this._rows)) {
      const st = this._hass.states[entityId];
      if (!st) {
        refs.row.classList.add("pf-unavail");
        refs.name.textContent = entityId;
        refs.desc.textContent = "nicht gefunden";
        refs.fill.style.width = "0%";
        continue;
      }
      const attrs = st.attributes;
      lastUpdate = lastUpdate || attrs.last_update;

      const today = parseNumber(st.state);
      refs.icon.setAttribute("icon", attrs.icon || "mdi:flower-pollen");
      refs.name.textContent = refs.item.name || this._shortName(entityId, attrs);

      refs.fill.style.width = `${((today ?? 0) / 3) * 100}%`;
      refs.fill.style.backgroundColor = levelColor(today);
      refs.row.classList.toggle("pf-unavail", today === null);
      refs.desc.textContent =
        attrs.state_today_desc || (today === null ? "keine Daten" : fmtLevel(today));

      if (refs.chipEls.length) {
        const days = [
          { v: today, d: attrs.state_today_desc },
          { v: parseNumber(attrs.state_tomorrow), d: attrs.state_tomorrow_desc },
          { v: parseNumber(attrs.state_in_2_days), d: attrs.state_in_2_days_desc },
        ];
        refs.chipEls.forEach((chip, i) => {
          const { v, d } = days[i];
          chip.dot.style.backgroundColor = levelColor(v);
          chip.num.textContent = fmtLevel(v);
          chip.chip.title = d || "";
        });
      }
    }

    if (lastUpdate) {
      const dt = new Date(lastUpdate);
      const txt = Number.isNaN(dt.getTime())
        ? lastUpdate
        : dt.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
      this._footerEl.textContent = `Stand: ${txt} · Daten: Deutscher Wetterdienst`;
    } else {
      this._footerEl.textContent = "Daten: Deutscher Wetterdienst";
    }
  }
}

customElements.define("dwd-pollenflug-card", DwdPollenflugCard);

// --- GUI editor for the card picker -------------------------------------
const EDITOR_SCHEMA = [
  { name: "title", selector: { text: {} } },
  { name: "forecast", selector: { boolean: {} } },
  {
    name: "entities",
    selector: {
      entity: {
        multiple: true,
        filter: { integration: "dwd_pollenflug", domain: "sensor" },
      },
    },
  },
];

const EDITOR_LABELS = {
  title: "Titel (optional)",
  forecast: "Vorschau Morgen/Übermorgen anzeigen",
  entities: "Pollen-Sensoren",
};

class DwdPollenflugCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { forecast: true, entities: [], ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _render() {
    if (!this._hass) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (schema) => EDITOR_LABELS[schema.name] || schema.name;
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        this.dispatchEvent(
          new CustomEvent("config-changed", {
            detail: { config: ev.detail.value },
            bubbles: true,
            composed: true,
          })
        );
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = EDITOR_SCHEMA;
    this._form.data = this._config;
  }
}

customElements.define("dwd-pollenflug-card-editor", DwdPollenflugCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "dwd-pollenflug-card",
  name: "DWD Pollenflug Card",
  description: "Pollenflug-Übersicht (heute/morgen/übermorgen) für eine DWD-Region.",
  preview: true,
  documentation: "https://github.com/NerdySoftPaw/lovelace-dwd-pollenflug-card",
});

console.info(
  "%c DWD-POLLENFLUG-CARD %c loaded ",
  "background:#44739e;color:#fff;border-radius:3px 0 0 3px;padding:2px 4px",
  "background:#4caf50;color:#fff;border-radius:0 3px 3px 0;padding:2px 4px"
);
