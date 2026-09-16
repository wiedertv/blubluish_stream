/* ==========================================================================
   BLUBLUISH CARD ALERTS — StreamElements Custom Widget
   Follow  -> RARE
   Tier 1  -> EPIC
   Tier 2  -> LEGENDARY
   Tier 3  -> GOLDEN LEGENDARY

   StreamElements:
   - onWidgetLoad provides fieldData.
   - onEventReceived provides listener + event.
   - widgetDuration (FIELDS) holds the SE event queue.
   - SE_API.resumeQueue() releases it when our animation finishes.
   ========================================================================== */

let fieldData = {};
let isPlaying = false;
let activeTimer = null;
let exitTimer = null;

const root = document.getElementById("bb-alert");
const cardImage = document.getElementById("bb-card-image");
const username = document.getElementById("bb-username");
const particleLayer = document.getElementById("bb-particles");
const frontParticleLayer = document.getElementById("bb-front-particles");

const AUDIO = {
  rare: new Audio(),
  epic: new Audio(),
  legendary: new Audio(),
  golden: new Audio()
};

AUDIO.rare.preload = "auto";
AUDIO.epic.preload = "auto";
AUDIO.legendary.preload = "auto";
AUDIO.golden.preload = "auto";

const SKIPPABLE_LISTENERS = new Set([
  "bot:counter",
  "event",
  "event:test",
  "event:skip",
  "alertService:toggleSound",
  "message",
  "delete-message",
  "delete-messages",
  "kvstore:update",
  "widget-button"
]);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function numberField(key, fallback) {
  const value = Number(fieldData[key]);
  return Number.isFinite(value) ? value : fallback;
}

function textField(key, fallback = "") {
  const value = fieldData[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boolField(key, fallback = true) {
  const value = fieldData[key];
  return typeof value === "boolean" ? value : fallback;
}

function sanitizeName(value) {
  const name = String(value || "Aventurero").trim();
  return name.slice(0, Math.max(1, numberField("maxUsernameLength", 24)));
}

function safeResumeQueue() {
  try {
    if (typeof SE_API !== "undefined" && SE_API.resumeQueue) {
      SE_API.resumeQueue();
    }
  } catch (_) {}
}

function stopTimers() {
  if (activeTimer) clearTimeout(activeTimer);
  if (exitTimer) clearTimeout(exitTimer);
  activeTimer = null;
  exitTimer = null;
}

function stopAllAudio() {
  Object.values(AUDIO).forEach(audio => {
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch (_) {}
  });
}

function configureAudio() {
  AUDIO.rare.src = textField("rareSoundUrl");
  AUDIO.epic.src = textField("epicSoundUrl");
  AUDIO.legendary.src = textField("legendarySoundUrl");
  AUDIO.golden.src = textField("goldenSoundUrl");

  const volume = Math.min(1, Math.max(0, numberField("soundVolume", 85) / 100));

  Object.values(AUDIO).forEach(audio => {
    audio.volume = volume;
  });
}

function configureLayout() {
  document.documentElement.style.setProperty(
    "--bb-card-width",
    `${numberField("cardWidth", 560)}px`
  );

  document.documentElement.style.setProperty(
    "--bb-user-top",
    `${numberField("usernameTop", 69)}%`
  );

  document.documentElement.style.setProperty(
    "--bb-user-width",
    `${numberField("usernameWidth", 72)}%`
  );

  document.documentElement.style.setProperty(
    "--bb-user-font-size",
    `${numberField("usernameFontSize", 34)}px`
  );

  document.documentElement.style.setProperty(
    "--bb-user-color",
    textField("usernameColor", "#F6FBFF")
  );
}

/* -------------------------------------------------------------------------- */
/* Tier normalization                                                          */
/* -------------------------------------------------------------------------- */

function normalizeTier(event) {
  const raw =
    event?.tier ??
    event?.subTier ??
    event?.subscriptionTier ??
    event?.subscriptionPlan ??
    event?.plan ??
    event?.planName ??
    "";

  const tier = String(raw).toLowerCase().trim();

  // Twitch Prime behaves like Tier 1.
  if (tier.includes("prime")) return 1;

  // Common Twitch / StreamElements representations.
  if (
    tier === "3000" ||
    tier.includes("tier 3") ||
    tier.includes("tier3") ||
    tier === "3"
  ) return 3;

  if (
    tier === "2000" ||
    tier.includes("tier 2") ||
    tier.includes("tier2") ||
    tier === "2"
  ) return 2;

  if (
    tier === "1000" ||
    tier.includes("tier 1") ||
    tier.includes("tier1") ||
    tier === "1"
  ) return 1;

  // If StreamElements changes the shape, Tier 1 is safest.
  return 1;
}

function presetFor(listener, event) {
  if (listener === "follower-latest") {
    return {
      key: "rare",
      css: "bb-rare",
      image: textField("rareImageUrl"),
      audio: AUDIO.rare,
      duration: numberField("rareDuration", 5.2),
      particleCount: numberField("rareParticles", 20),
      particleSpread: 270
    };
  }

  if (listener !== "subscriber-latest") {
    return null;
  }

  // Ignore community-gift aggregate/train events for V1 so one gift bomb
  // does not flood the screen. A normal single gifted sub can still show.
  if (event?.bulkGifted === true || event?.isCommunityGift === true) {
    return null;
  }

  const tier = normalizeTier(event);

  if (tier === 3) {
    return {
      key: "golden",
      css: "bb-golden",
      image: textField("goldenImageUrl"),
      audio: AUDIO.golden,
      duration: numberField("goldenDuration", 7.0),
      particleCount: numberField("goldenParticles", 46),
      particleSpread: 390
    };
  }

  if (tier === 2) {
    return {
      key: "legendary",
      css: "bb-legendary",
      image: textField("legendaryImageUrl"),
      audio: AUDIO.legendary,
      duration: numberField("legendaryDuration", 6.2),
      particleCount: numberField("legendaryParticles", 34),
      particleSpread: 350
    };
  }

  return {
    key: "epic",
    css: "bb-epic",
    image: textField("epicImageUrl"),
    audio: AUDIO.epic,
    duration: numberField("epicDuration", 5.7),
    particleCount: numberField("epicParticles", 27),
    particleSpread: 315
  };
}

/* -------------------------------------------------------------------------- */
/* Particles                                                                   */
/* -------------------------------------------------------------------------- */

function clearParticles() {
  particleLayer.innerHTML = "";
  frontParticleLayer.innerHTML = "";
}

function random(min, max) {
  return Math.random() * (max - min) + min;
}

function makeParticle(layer, spread, index, front = false) {
  const particle = document.createElement("span");
  particle.className = `bb-particle ${Math.random() > 0.54 ? "bb-dot" : ""}`;

  const angle = random(0, Math.PI * 2);
  const radius = random(30, spread * 0.38);

  const x = Math.cos(angle) * radius;
  const y = Math.sin(angle) * radius;
  const travel = random(spread * 0.34, spread);

  const dx = Math.cos(angle) * travel;
  const dy = Math.sin(angle) * travel - random(30, 120);

  particle.style.setProperty("--x", `${x.toFixed(1)}px`);
  particle.style.setProperty("--y", `${y.toFixed(1)}px`);
  particle.style.setProperty("--dx", `${dx.toFixed(1)}px`);
  particle.style.setProperty("--dy", `${dy.toFixed(1)}px`);
  particle.style.setProperty("--size", `${random(front ? 4 : 3, front ? 11 : 9).toFixed(1)}px`);
  particle.style.setProperty("--delay", `${random(0.04, 0.70).toFixed(2)}s`);
  particle.style.setProperty("--life", `${random(0.75, 1.75).toFixed(2)}s`);

  layer.appendChild(particle);
}

function spawnParticles(count, spread) {
  clearParticles();

  for (let i = 0; i < count; i++) {
    const front = i % 3 === 0;
    makeParticle(front ? frontParticleLayer : particleLayer, spread, i, front);
  }
}

/* -------------------------------------------------------------------------- */
/* Alert playback                                                              */
/* -------------------------------------------------------------------------- */

function applyPresetClass(cssClass) {
  root.classList.remove(
    "bb-rare",
    "bb-epic",
    "bb-legendary",
    "bb-golden",
    "bb-active",
    "bb-exit"
  );

  root.classList.add(cssClass);
}

async function playSound(audio) {
  if (!boolField("enableSound", true)) return;
  if (!audio || !audio.src) return;

  try {
    audio.currentTime = 0;
    await audio.play();
  } catch (_) {
    // Autoplay is normally allowed inside the overlay/browser source after
    // StreamElements triggers the event. If a browser blocks it, the visual
    // alert still works.
  }
}

function finishAlert() {
  root.classList.remove("bb-active");
  root.classList.add("bb-exit");

  exitTimer = setTimeout(() => {
    root.classList.add("bb-hidden");
    root.classList.remove("bb-exit");
    clearParticles();
    stopAllAudio();
    isPlaying = false;
    safeResumeQueue();
  }, 520);
}

function showAlert(preset, name) {
  if (!preset || !preset.image) {
    isPlaying = false;
    safeResumeQueue();
    return;
  }

  stopTimers();
  stopAllAudio();
  clearParticles();

  isPlaying = true;

  applyPresetClass(preset.css);
  username.textContent = sanitizeName(name);
  cardImage.src = preset.image;

  spawnParticles(preset.particleCount, preset.particleSpread);

  root.classList.remove("bb-hidden");
  root.setAttribute("aria-hidden", "false");

  // Force layout so re-triggering the same rarity restarts CSS animations.
  void root.offsetWidth;

  root.classList.add("bb-active");

  playSound(preset.audio);

  activeTimer = setTimeout(
    finishAlert,
    Math.max(1.5, preset.duration) * 1000
  );
}

/* -------------------------------------------------------------------------- */
/* StreamElements lifecycle                                                    */
/* -------------------------------------------------------------------------- */

window.addEventListener("onWidgetLoad", function (obj) {
  fieldData = obj?.detail?.fieldData || {};

  configureLayout();
  configureAudio();

  root.classList.add("bb-hidden");
  root.setAttribute("aria-hidden", "true");
});

window.addEventListener("onEventReceived", function (obj) {
  const listener = obj?.detail?.listener;
  const event = obj?.detail?.event || {};

  if (!listener) return;

  // These events are not held by the queue in the same meaningful way and
  // should not interfere with the alert.
  if (SKIPPABLE_LISTENERS.has(listener)) {
    return;
  }

  const preset = presetFor(listener, event);

  if (!preset) {
    // We only own follows + direct/single subscription alerts in V1.
    safeResumeQueue();
    return;
  }

  // StreamElements' widgetDuration handles sequencing. This check only guards
  // against editor/test edge cases.
  if (isPlaying) {
    safeResumeQueue();
    return;
  }

  showAlert(preset, event?.name || event?.sender || "Aventurero");
});

/* -------------------------------------------------------------------------- */
/* Test buttons from FIELDS                                                    */
/* -------------------------------------------------------------------------- */

window.addEventListener("onEventReceived", function (obj) {
  if (obj?.detail?.listener !== "widget-button") return;

  const field = obj?.detail?.event?.field;
  const name = textField("testUsername", "ArthasMain");

  let preset = null;

  if (field === "testRare") {
    preset = presetFor("follower-latest", {});
  }

  if (field === "testEpic") {
    preset = {
      key: "epic",
      css: "bb-epic",
      image: textField("epicImageUrl"),
      audio: AUDIO.epic,
      duration: numberField("epicDuration", 5.7),
      particleCount: numberField("epicParticles", 27),
      particleSpread: 315
    };
  }

  if (field === "testLegendary") {
    preset = {
      key: "legendary",
      css: "bb-legendary",
      image: textField("legendaryImageUrl"),
      audio: AUDIO.legendary,
      duration: numberField("legendaryDuration", 6.2),
      particleCount: numberField("legendaryParticles", 34),
      particleSpread: 350
    };
  }

  if (field === "testGolden") {
    preset = {
      key: "golden",
      css: "bb-golden",
      image: textField("goldenImageUrl"),
      audio: AUDIO.golden,
      duration: numberField("goldenDuration", 7.0),
      particleCount: numberField("goldenParticles", 46),
      particleSpread: 390
    };
  }

  if (preset) {
    if (isPlaying) {
      stopTimers();
      stopAllAudio();
      isPlaying = false;
    }
    showAlert(preset, name);
  }
});