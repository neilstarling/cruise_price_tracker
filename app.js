const STORAGE_KEY = "cunard-queens-grill-cruises";
const API_KEY_STORAGE = "cunard-gemini-api-key";
const API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const FREE_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite"
];
const RETRYABLE_API_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_MODEL_ATTEMPTS = 2;
const MODEL_RETRY_DELAY_MS = 3000;
const IMAGE_DB_NAME = "cunard-queens-grill-share-inbox";
const IMAGE_STORE_NAME = "shared-images";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const CRUISE_FIELDS = [
  "cruise_number",
  "ship",
  "destination",
  "nights",
  "departure_date",
  "return_date",
  "departure_port",
  "arrival_port",
  "price_per_person",
  "currency",
  "promo_notes"
];

const elements = {
  addButton: document.querySelector("#add-button"),
  emptyAddButton: document.querySelector("#empty-add-button"),
  manualAddButton: document.querySelector("#manual-add-button"),
  emptyManualButton: document.querySelector("#empty-manual-button"),
  fileInput: document.querySelector("#file-input"),
  status: document.querySelector("#status-message"),
  list: document.querySelector("#cruise-list"),
  empty: document.querySelector("#empty-state"),
  count: document.querySelector("#cruise-count"),
  printButton: document.querySelector("#print-button"),
  shipFilter: document.querySelector("#ship-filter"),
  sortOrder: document.querySelector("#sort-order"),
  settingsDialog: document.querySelector("#settings-dialog"),
  apiKey: document.querySelector("#api-key"),
  editDialog: document.querySelector("#edit-dialog"),
  editForm: document.querySelector("#edit-form"),
  editError: document.querySelector("#edit-error"),
  importDialog: document.querySelector("#import-dialog"),
  importForm: document.querySelector("#import-form"),
  importFile: document.querySelector("#import-file"),
  importError: document.querySelector("#import-error"),
  dropOverlay: document.querySelector("#drop-overlay")
};

let cruises = loadCruises();
let pendingFiles = [];
let dragDepth = 0;

function showStatus(message, kind = "info", busy = false) {
  elements.status.textContent = message;
  elements.status.dataset.kind = kind;
  elements.status.dataset.busy = String(busy);
  elements.status.hidden = !message;
}

function loadCruises() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) throw new Error("Saved cruise data is not a list.");
    return parsed.map((item) => normalizeCruise(item));
  } catch (error) {
    queueMicrotask(() => showStatus(`Could not load saved cruises: ${error.message}`, "error"));
    return [];
  }
}

function saveCruises(nextCruises) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextCruises));
    cruises = nextCruises;
    renderCruises();
    return true;
  } catch (error) {
    showStatus(`Could not save your cruises in this browser: ${error.message}`, "error");
    return false;
  }
}

function normalizeCruise(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("A cruise entry must be an object.");
  }

  const cruise = {};
  for (const field of CRUISE_FIELDS) {
    const value = source[field];
    if (field === "nights" || field === "price_per_person") {
      cruise[field] = Number(value);
    } else {
      cruise[field] = typeof value === "string" ? value.trim() : "";
    }
  }
  cruise.currency = cruise.currency.toUpperCase();

  const requiredFields = CRUISE_FIELDS.filter((field) => field !== "promo_notes");
  if (requiredFields.some((field) => cruise[field] === "" || cruise[field] === null || Number.isNaN(cruise[field]))) {
    throw new Error("Every cruise field is required, including a promotion note (which may be empty).");
  }
  if (!Number.isInteger(cruise.nights) || cruise.nights < 1) {
    throw new Error("Nights must be a positive whole number.");
  }
  if (!Number.isFinite(cruise.price_per_person) || cruise.price_per_person <= 0) {
    throw new Error("Price per person must be a positive number.");
  }
  if (!isValidDate(cruise.departure_date) || !isValidDate(cruise.return_date)) {
    throw new Error("Departure and return dates must use YYYY-MM-DD.");
  }
  if (cruise.return_date < cruise.departure_date) {
    throw new Error("Return date cannot be before departure date.");
  }
  if (!/^[A-Z]{3}$/.test(cruise.currency)) {
    throw new Error("Currency must be a three-letter code, such as GBP.");
  }

  const totalRoomCost = cruise.price_per_person * 2;
  return {
    ...cruise,
    id: typeof source.id === "string" && source.id ? source.id : createId(),
    date_added: isValidTimestamp(source.date_added) ? source.date_added : new Date().toISOString(),
    total_room_cost: totalRoomCost,
    cost_per_night_total: totalRoomCost / cruise.nights,
    cost_per_night_pp: cruise.price_per_person / cruise.nights
  };
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function isValidTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `cruise-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function renderCruises() {
  const filtered = cruises.filter((cruise) => elements.shipFilter.value === "all" || cruise.ship === elements.shipFilter.value);
  const sorters = {
    nightly: (a, b) => a.cost_per_night_total - b.cost_per_night_total,
    total: (a, b) => a.total_room_cost - b.total_room_cost,
    departure: (a, b) => a.departure_date.localeCompare(b.departure_date),
    duration: (a, b) => a.nights - b.nights,
    added: (a, b) => b.date_added.localeCompare(a.date_added)
  };
  filtered.sort(sorters[elements.sortOrder.value] ?? sorters.nightly);

  elements.count.textContent = String(cruises.length);
  elements.printButton.disabled = filtered.length === 0;
  elements.list.replaceChildren(...filtered.map(createCruiseCard));
  elements.empty.hidden = cruises.length > 0;
  elements.list.hidden = filtered.length === 0;
  if (cruises.length > 0 && filtered.length === 0) {
    elements.empty.hidden = false;
    elements.empty.querySelector("h3").textContent = "No voyages for this ship";
    elements.empty.querySelector("p").textContent = "Choose another ship filter to see your saved cruises.";
    elements.empty.querySelector("#empty-add-button").hidden = true;
  } else {
    elements.empty.querySelector("h3").textContent = "A voyage worth keeping";
    elements.empty.querySelector("p").textContent = "Add a screenshot of a Queens Grill listing and your fare details will appear here.";
    elements.empty.querySelector("#empty-add-button").hidden = false;
  }
}

function createCruiseCard(cruise) {
  const card = document.createElement("article");
  card.className = "cruise-card";
  card.innerHTML = `
    <div class="card-top">
      <div>
        <span class="ship-label"></span>
        <p class="cruise-number"></p>
      </div>
      <div class="card-actions">
        <button type="button" class="edit-button">Edit</button>
        <button type="button" class="delete-button">Delete</button>
      </div>
    </div>
    <div class="card-body">
      <h3 class="card-destination"></h3>
      <div class="itinerary">
        <div><span class="itinerary-label">Departs</span><strong class="departure-date"></strong><small class="departure-port"></small></div>
        <div><span class="itinerary-label">Returns</span><strong class="return-date"></strong><small class="arrival-port"></small></div>
      </div>
      <div class="card-metrics">
        <div><span class="metric-label">Duration</span><span class="metric-value nights"></span></div>
        <div><span class="metric-label">Price per person</span><span class="metric-value price-pp"></span></div>
        <div><span class="metric-label">Total suite</span><span class="metric-value total-price"></span></div>
        <div class="metric-highlight"><span class="metric-label">Per night · suite</span><span class="metric-value nightly-total"></span></div>
      </div>
      <p class="promo-notes" hidden></p>
    </div>
    <div class="card-foot"><span class="price-basis">Queens Grill · 2 guests</span><span class="added-date"></span></div>
  `;

  const putText = (selector, value) => { card.querySelector(selector).textContent = value; };
  putText(".ship-label", cruise.ship);
  putText(".cruise-number", cruise.cruise_number);
  putText(".card-destination", cruise.destination);
  putText(".departure-date", formatDate(cruise.departure_date));
  putText(".departure-port", cruise.departure_port);
  putText(".return-date", formatDate(cruise.return_date));
  putText(".arrival-port", cruise.arrival_port);
  putText(".nights", `${cruise.nights} nights`);
  putText(".price-pp", formatMoney(cruise.price_per_person, cruise.currency));
  putText(".total-price", formatMoney(cruise.total_room_cost, cruise.currency));
  putText(".nightly-total", formatMoney(cruise.cost_per_night_total, cruise.currency));
  putText(".added-date", `Added ${formatDate(cruise.date_added.slice(0, 10))}`);

  const promo = card.querySelector(".promo-notes");
  if (cruise.promo_notes) {
    promo.textContent = cruise.promo_notes;
    promo.hidden = false;
  }

  card.querySelector(".edit-button").addEventListener("click", () => openEditor(cruise));
  card.querySelector(".delete-button").addEventListener("click", () => {
    if (window.confirm(`Delete ${cruise.cruise_number} from your saved voyages?`)) {
      saveCruises(cruises.filter((item) => item.id !== cruise.id));
      showStatus(`${cruise.cruise_number} was deleted.`, "success");
    }
  });
  return card;
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function formatMoney(value, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${Number(value).toFixed(2)}`;
  }
}

function openEditor(cruise) {
  elements.editError.hidden = true;
  document.querySelector("#edit-id").value = cruise?.id ?? "";
  document.querySelector("#edit-title").textContent = cruise ? "Edit cruise" : "Review extracted cruise";
  for (const field of CRUISE_FIELDS) {
    const input = elements.editForm.elements.namedItem(field);
    input.value = cruise?.[field] ?? "";
  }
  elements.editDialog.showModal();
}

function readApiKey() {
  try {
    return localStorage.getItem(API_KEY_STORAGE)?.trim() ?? "";
  } catch (error) {
    showStatus(`Could not access browser storage: ${error.message}`, "error");
    return "";
  }
}

async function processFiles(fileList) {
  const files = Array.from(fileList);
  if (!files.length) return;
  const apiKey = readApiKey();
  if (!apiKey) {
    pendingFiles.push(...files);
    showStatus("Add your Gemini API key in Settings to process the selected screenshot(s).", "error");
    if (!elements.settingsDialog.open) elements.settingsDialog.showModal();
    return;
  }

  for (const file of files) {
    try {
      if (!file.type.startsWith("image/")) throw new Error(`${file.name || "A shared file"} is not an image.`);
      if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name || "Image"} is larger than the 20 MB limit.`);
      showStatus(`Sending ${file.name || "shared screenshot"} to Gemini…`, "info", true);
      const extracted = await extractCruise(file, apiKey);
      showStatus(`${file.name || "Screenshot"} extracted. Review the details below.`);
      openEditor(extracted);
      const saved = await waitForEditorResult();
      if (saved) showStatus(`${file.name || "Screenshot"} was added to your collection.`, "success");
      else showStatus(`${file.name || "Screenshot"} was extracted but not saved.`, "info");
    } catch (error) {
      showStatus(`Could not process ${file.name || "the screenshot"}: ${error.message}`, "error");
    }
  }
}

function waitForEditorResult() {
  return new Promise((resolve) => {
    const onSaved = () => { cleanup(); resolve(true); };
    const onClosed = () => { cleanup(); resolve(false); };
    const cleanup = () => {
      elements.editForm.removeEventListener("cruise-saved", onSaved);
      elements.editDialog.removeEventListener("close", onClosed);
    };
    elements.editForm.addEventListener("cruise-saved", onSaved, { once: true });
    elements.editDialog.addEventListener("close", onClosed, { once: true });
  });
}

async function extractCruise(file, apiKey) {
  const imageBase64 = await fileToBase64(file);
  const schema = {
    type: "OBJECT",
    properties: {
      cruise_number: { type: "STRING" },
      ship: { type: "STRING" },
      destination: { type: "STRING" },
      nights: { type: "INTEGER" },
      departure_date: { type: "STRING" },
      return_date: { type: "STRING" },
      departure_port: { type: "STRING" },
      arrival_port: { type: "STRING" },
      price_per_person: { type: "NUMBER" },
      currency: { type: "STRING" },
      promo_notes: { type: "STRING" }
    },
    required: CRUISE_FIELDS
  };
  const prompt = `Read this Cunard cruise listing screenshot and extract the Queens Grill fare details. Return only a JSON object matching the provided schema. Use ISO dates (YYYY-MM-DD), an integer for nights, a numeric price per person without currency symbols, a three-letter currency code, and an empty string if no promotion is shown. Do not guess unreadable values; if an essential field cannot be read, use an empty string.`;
  const requestBody = JSON.stringify({
    contents: [{
      role: "user",
      parts: [
        { text: prompt },
        { inline_data: { mime_type: file.type, data: imageBase64 } }
      ]
    }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema }
  });
  let payload;

  for (const [index, model] of FREE_MODELS.entries()) {
    const url = new URL(`${API_BASE_URL}/${model}:generateContent`);
    url.searchParams.set("key", apiKey);
    let modelSucceeded = false;

    for (let attempt = 1; attempt <= MAX_MODEL_ATTEMPTS; attempt += 1) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody
      });

      if (response.ok) {
        try {
          payload = await response.json();
        } catch {
          throw new Error(`Gemini ${model} returned an unreadable response.`);
        }
        modelSucceeded = true;
        break;
      }

      const message = await readGeminiError(response, model);
      const isHighDemand = response.status === 503 || message.toLowerCase().includes("high demand");
      const shouldRetryModel = isHighDemand && attempt < MAX_MODEL_ATTEMPTS;

      if (shouldRetryModel) {
        console.warn(`${model} is busy (attempt ${attempt}/${MAX_MODEL_ATTEMPTS}); retrying in 3 seconds.`);
        showStatus(`Gemini ${model} is busy; retrying in 3 seconds (attempt ${attempt}/${MAX_MODEL_ATTEMPTS})…`, "info", true);
        await new Promise((resolve) => setTimeout(resolve, MODEL_RETRY_DELAY_MS));
        continue;
      }

      const hasFallback = index < FREE_MODELS.length - 1;
      const shouldTryFallback = RETRYABLE_API_STATUSES.has(response.status) || isHighDemand;
      if (!shouldTryFallback || !hasFallback) {
        const detail = shouldTryFallback ? `All Gemini fallback models were unavailable. ${message}` : message;
        throw new Error(detail);
      }

      const nextModel = FREE_MODELS[index + 1];
      console.warn(`${model} is temporarily unavailable (HTTP ${response.status}); trying ${nextModel}.`);
      showStatus(`Gemini ${model} is busy; trying ${nextModel}…`, "info", true);
      break;
    }

    if (modelSucceeded) break;
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Gemini returned an invalid response object.");
  }

  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) throw new Error("Gemini did not return cruise details. Try a clearer screenshot.");
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new Error("Gemini's response was not valid JSON. Try again or enter the details manually.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Gemini's response did not contain a cruise object.");
  }
  return parsed;
}

async function readGeminiError(response, model) {
  const body = await response.text();
  if (!body) return `Gemini ${model} request failed (HTTP ${response.status}).`;

  try {
    const errorPayload = JSON.parse(body);
    return errorPayload.error?.message || `Gemini ${model} request failed (HTTP ${response.status}).`;
  } catch {
    return body;
  }
}

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

elements.addButton.addEventListener("click", () => elements.fileInput.click());
elements.emptyAddButton.addEventListener("click", () => elements.fileInput.click());
elements.manualAddButton.addEventListener("click", () => openEditor(null));
elements.emptyManualButton.addEventListener("click", () => openEditor(null));
elements.fileInput.addEventListener("change", (event) => {
  processFiles(event.target.files);
  event.target.value = "";
});
elements.shipFilter.addEventListener("change", renderCruises);
elements.sortOrder.addEventListener("change", renderCruises);
elements.printButton.addEventListener("click", () => window.print());

document.querySelector("#settings-button").addEventListener("click", () => {
  elements.apiKey.value = readApiKey();
  elements.settingsDialog.showModal();
});
document.querySelector("#save-settings-button").addEventListener("click", () => {
  const key = elements.apiKey.value.trim();
  try {
    if (key) localStorage.setItem(API_KEY_STORAGE, key);
    else localStorage.removeItem(API_KEY_STORAGE);
    elements.settingsDialog.close();
    showStatus(key ? "Gemini API key saved in this browser." : "Gemini API key removed.", "success");
    if (key && pendingFiles.length) processFiles(pendingFiles.splice(0));
  } catch (error) {
    showStatus(`Could not save the API key: ${error.message}`, "error");
  }
});
document.querySelector("#clear-key-button").addEventListener("click", () => {
  elements.apiKey.value = "";
  try {
    localStorage.removeItem(API_KEY_STORAGE);
    showStatus("Gemini API key removed.", "success");
  } catch (error) {
    showStatus(`Could not remove the API key: ${error.message}`, "error");
  }
});

elements.editForm.addEventListener("submit", (event) => {
  event.preventDefault();
  elements.editError.hidden = true;
  const formData = new FormData(elements.editForm);
  const source = Object.fromEntries(CRUISE_FIELDS.map((field) => [field, formData.get(field)]));
  const existingId = document.querySelector("#edit-id").value;
  const existing = cruises.find((cruise) => cruise.id === existingId);
  try {
    const updated = normalizeCruise({ ...source, id: existing?.id, date_added: existing?.date_added });
    const next = existing
      ? cruises.map((cruise) => cruise.id === existing.id ? updated : cruise)
      : [updated, ...cruises];
    if (!saveCruises(next)) return;
    elements.editDialog.close();
    elements.editForm.dispatchEvent(new Event("cruise-saved"));
  } catch (error) {
    elements.editError.textContent = error.message;
    elements.editError.hidden = false;
  }
});
document.querySelector("#cancel-edit-button").addEventListener("click", () => elements.editDialog.close());
document.querySelector("#close-edit-button").addEventListener("click", () => elements.editDialog.close());

document.querySelector("#export-button").addEventListener("click", () => {
  const contents = JSON.stringify({ version: 1, exported_at: new Date().toISOString(), cruises }, null, 2);
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "cunard-cruises-backup.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showStatus(`Exported ${cruises.length} cruise${cruises.length === 1 ? "" : "s"}.`, "success");
});
document.querySelector("#import-button").addEventListener("click", () => {
  elements.importForm.reset();
  elements.importError.hidden = true;
  elements.importDialog.showModal();
});
document.querySelector("#cancel-import-button").addEventListener("click", () => elements.importDialog.close());
document.querySelector("#close-import-button").addEventListener("click", () => elements.importDialog.close());
elements.importForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.importError.hidden = true;
  const file = elements.importFile.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const entries = Array.isArray(parsed) ? parsed : parsed?.cruises;
    if (!Array.isArray(entries)) throw new Error("The JSON file must contain a cruises array.");
    const imported = entries.map((entry) => normalizeCruise(entry));
    if (!imported.length) throw new Error("No cruises were found in this file.");
    const mode = new FormData(elements.importForm).get("import-mode");
    const next = mode === "replace" ? imported : mergeCruises(cruises, imported);
    if (!saveCruises(next)) return;
    elements.importDialog.close();
    showStatus(`${imported.length} cruise${imported.length === 1 ? "" : "s"} imported (${mode === "replace" ? "replaced" : "merged"}).`, "success");
  } catch (error) {
    elements.importError.textContent = `Import failed: ${error.message}`;
    elements.importError.hidden = false;
  }
});

function mergeCruises(current, imported) {
  const merged = [...current];
  for (const cruise of imported) {
    const index = merged.findIndex((item) => item.id === cruise.id ||
      (item.cruise_number === cruise.cruise_number && item.departure_date === cruise.departure_date));
    if (index >= 0) merged[index] = { ...cruise, id: merged[index].id, date_added: merged[index].date_added };
    else merged.unshift(cruise);
  }
  return merged;
}

let dragLeaveTimer;
document.addEventListener("dragenter", (event) => {
  if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
  event.preventDefault();
  dragDepth += 1;
  elements.dropOverlay.classList.add("is-visible");
});
document.addEventListener("dragover", (event) => {
  if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) event.preventDefault();
});
document.addEventListener("dragleave", (event) => {
  if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
  dragDepth = Math.max(0, dragDepth - 1);
  clearTimeout(dragLeaveTimer);
  dragLeaveTimer = setTimeout(() => {
    if (dragDepth === 0) elements.dropOverlay.classList.remove("is-visible");
  }, 50);
});
document.addEventListener("drop", (event) => {
  if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
  event.preventDefault();
  dragDepth = 0;
  elements.dropOverlay.classList.remove("is-visible");
  processFiles(event.dataTransfer.files);
});
document.addEventListener("paste", (event) => {
  const images = Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (images.length) {
    event.preventDefault();
    processFiles(images);
  }
});

async function openShareDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IMAGE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IMAGE_STORE_NAME)) {
        request.result.createObjectStore(IMAGE_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the shared image inbox."));
  });
}

async function drainSharedImages() {
  if (!("indexedDB" in window)) return;
  let database;
  try {
    database = await openShareDatabase();
    const transaction = database.transaction(IMAGE_STORE_NAME, "readwrite");
    const store = transaction.objectStore(IMAGE_STORE_NAME);
    const images = await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not read shared screenshots."));
    });
    store.clear();
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not clear the shared image inbox."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Could not clear the shared image inbox."));
    });
    if (images.length) await processFiles(images.map((entry) => entry.file));
  } catch (error) {
    showStatus(`Could not receive shared screenshots: ${error.message}`, "error");
  } finally {
    database?.close();
  }
}

if ("serviceWorker" in navigator && isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").then(() => drainSharedImages()).catch((error) => {
      showStatus(`Offline support could not be enabled: ${error.message}`, "error");
    });
  });
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "shared-images-ready") drainSharedImages();
  });
}

renderCruises();
