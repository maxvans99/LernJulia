/* LernJulia – App-Logik */

(function () {
  "use strict";

  const COURSE_FILES = ["data/bbub01.enc.json", "data/bbub02.enc.json"];
  const SESSION_KEY = "lernjulia_pw";
  const PROGRESS_KEY = "lernjulia_progress";

  let courses = [];
  let state = {
    view: "home", // home | lessons | lesson
    courseId: null,
    lessonNumber: null,
    tab: "summary",
    quiz: { index: 0, correctCount: 0, answered: false, selected: null, finished: false },
    flashcard: { index: 0, flipped: false },
    exercise: { index: 0, checked: false, correct: null }
  };

  const $ = (sel) => document.querySelector(sel);
  const loginScreen = $("#login-screen");
  const appScreen = $("#app");
  const loginForm = $("#login-form");
  const passwordInput = $("#password-input");
  const loginError = $("#login-error");
  const loginBtn = $("#login-btn");
  const backBtn = $("#back-btn");
  const logoutBtn = $("#logout-btn");
  const headerTitle = $("#header-title");
  const mainContent = $("#main-content");

  // ---------- Crypto ----------

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function deriveKey(password, saltBytes) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: saltBytes,
        iterations: 200000,
        hash: "SHA-256"
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
  }

  async function decryptToBuffer(encObj, password) {
    const salt = b64ToBytes(encObj.salt);
    const iv = b64ToBytes(encObj.iv);
    const ciphertext = b64ToBytes(encObj.ciphertext);
    const key = await deriveKey(password, salt);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, ciphertext);
  }

  async function decryptFile(encObj, password) {
    const plainBuf = await decryptToBuffer(encObj, password);
    const text = new TextDecoder().decode(plainBuf);
    return JSON.parse(text);
  }

  const podcastUrlCache = {};

  async function loadPodcastUrl(courseId, lessonNumber) {
    const cacheKey = courseId + "-" + lessonNumber;
    if (podcastUrlCache[cacheKey]) return podcastUrlCache[cacheKey];
    const password = sessionStorage.getItem(SESSION_KEY);
    const file = "data/podcasts/" + courseId + "-lektion-" + lessonNumber + ".enc.json";
    const res = await fetch(file);
    if (!res.ok) throw new Error("Podcast nicht gefunden: " + file);
    const encObj = await res.json();
    const buf = await decryptToBuffer(encObj, password);
    const blob = new Blob([buf], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    podcastUrlCache[cacheKey] = url;
    return url;
  }

  async function loadCourses(password) {
    const loaded = [];
    for (const file of COURSE_FILES) {
      const res = await fetch(file);
      if (!res.ok) throw new Error("Datei nicht gefunden: " + file);
      const encObj = await res.json();
      const course = await decryptFile(encObj, password);
      loaded.push(course);
    }
    return loaded;
  }

  // ---------- Progress ----------

  function getProgress() {
    try {
      return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function saveProgress(courseId, lessonNumber) {
    const progress = getProgress();
    const key = courseId + "-" + lessonNumber;
    progress[key] = true;
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  }

  function isLessonDone(courseId, lessonNumber) {
    const progress = getProgress();
    return !!progress[courseId + "-" + lessonNumber];
  }

  function exportProgressCode() {
    const json = JSON.stringify(getProgress());
    return btoa(unescape(encodeURIComponent(json)));
  }

  function importProgressCode(code) {
    const json = decodeURIComponent(escape(atob(code.trim())));
    const incoming = JSON.parse(json);
    const current = getProgress();
    const merged = Object.assign({}, current, incoming);
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(merged));
  }

  // ---------- Login ----------

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = passwordInput.value;
    await tryLogin(pw);
  });

  async function tryLogin(pw) {
    loginError.hidden = true;
    loginBtn.disabled = true;
    loginBtn.textContent = "Anmelden…";
    try {
      courses = await loadCourses(pw);
      sessionStorage.setItem(SESSION_KEY, pw);
      showApp();
    } catch (err) {
      loginError.textContent = "Falsches Passwort oder Daten nicht ladbar.";
      loginError.hidden = false;
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = "Anmelden";
    }
  }

  function showApp() {
    loginScreen.classList.remove("active");
    appScreen.classList.add("active");
    state.view = "home";
    render();
  }

  logoutBtn.addEventListener("click", () => {
    sessionStorage.removeItem(SESSION_KEY);
    courses = [];
    appScreen.classList.remove("active");
    loginScreen.classList.add("active");
    passwordInput.value = "";
  });

  backBtn.addEventListener("click", () => {
    goBack();
  });

  function goBack() {
    if (state.view === "lesson") {
      state.view = "lessons";
      state.tab = "summary";
    } else if (state.view === "lessons") {
      state.view = "home";
      state.courseId = null;
    }
    render();
  }

  // Auto-login within session
  window.addEventListener("DOMContentLoaded", async () => {
    const savedPw = sessionStorage.getItem(SESSION_KEY);
    if (savedPw) {
      try {
        courses = await loadCourses(savedPw);
        showApp();
      } catch (e) {
        sessionStorage.removeItem(SESSION_KEY);
      }
    }
  });

  // ---------- Rendering ----------

  function render() {
    backBtn.hidden = state.view === "home";
    if (state.view === "home") {
      headerTitle.textContent = "LernJulia";
      renderHome();
    } else if (state.view === "lessons") {
      const course = getCourse(state.courseId);
      headerTitle.textContent = course ? course.title : "Lektionen";
      renderLessons(course);
    } else if (state.view === "lesson") {
      const course = getCourse(state.courseId);
      const lesson = getLesson(course, state.lessonNumber);
      headerTitle.textContent = lesson ? "Lektion " + lesson.number : "Lektion";
      renderLesson(course, lesson);
    }
  }

  function getCourse(id) {
    return courses.find((c) => c.id === id);
  }

  function getLesson(course, number) {
    if (!course) return null;
    return course.lessons.find((l) => l.number === number);
  }

  function el(html) {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.firstElementChild;
  }

  function renderHome() {
    mainContent.innerHTML = "";
    const heading = el('<p style="color:var(--text-muted);margin-bottom:16px;">Wähle einen Kurs, um zu starten.</p>');
    mainContent.appendChild(heading);

    const grid = el('<div class="grid courses"></div>');
    if (courses.length === 0) {
      mainContent.appendChild(el('<div class="empty-state">Keine Kursdaten verfügbar.</div>'));
      return;
    }
    courses.forEach((course) => {
      const total = course.lessons.length;
      const done = course.lessons.filter((l) => isLessonDone(course.id, l.number)).length;
      const card = el(
        '<div class="card course-card">' +
          "<h3>" + escapeHtml(course.title) + "</h3>" +
          "<p>" + escapeHtml(course.code) + "</p>" +
          '<p style="margin-top:8px;">' + done + " von " + total + " Lektionen abgeschlossen</p>" +
        "</div>"
      );
      card.addEventListener("click", () => {
        state.view = "lessons";
        state.courseId = course.id;
        render();
      });
      grid.appendChild(card);
    });
    mainContent.appendChild(grid);

    renderSyncBox();
  }

  function renderSyncBox() {
    const box = el(
      '<div class="card sync-box" style="margin-top:24px;">' +
        "<h4>Fortschritt zwischen Geräten übertragen</h4>" +
        '<p style="color:var(--text-muted);margin:8px 0 12px;">Auf diesem Gerät: Code erzeugen und auf dem anderen Gerät einfügen.</p>' +
        '<button class="btn btn-secondary" id="sync-export-btn">Sync-Code anzeigen</button>' +
        '<textarea id="sync-export-out" readonly style="display:none;margin-top:10px;width:100%;min-height:70px;" ></textarea>' +
        '<div style="margin-top:16px;">' +
          "<label>Code von anderem Gerät einfügen</label>" +
          '<textarea id="sync-import-in" style="width:100%;min-height:70px;margin-top:6px;"></textarea>' +
          '<button class="btn btn-primary" id="sync-import-btn" style="margin-top:10px;">Übernehmen</button>' +
          '<p id="sync-import-msg" style="margin-top:8px;"></p>' +
        "</div>" +
      "</div>"
    );
    mainContent.appendChild(box);

    box.querySelector("#sync-export-btn").addEventListener("click", () => {
      const out = box.querySelector("#sync-export-out");
      out.value = exportProgressCode();
      out.style.display = "block";
      out.focus();
      out.select();
    });

    box.querySelector("#sync-import-btn").addEventListener("click", () => {
      const input = box.querySelector("#sync-import-in");
      const msg = box.querySelector("#sync-import-msg");
      try {
        importProgressCode(input.value);
        msg.textContent = "Fortschritt übernommen!";
        msg.style.color = "var(--accent)";
        render();
      } catch (e) {
        msg.textContent = "Ungültiger Code.";
        msg.style.color = "#c0392b";
      }
    });
  }

  function renderLessons(course) {
    mainContent.innerHTML = "";
    if (!course) {
      mainContent.appendChild(el('<div class="empty-state">Kurs nicht gefunden.</div>'));
      return;
    }
    const grid = el('<div class="grid"></div>');
    course.lessons.forEach((lesson) => {
      const done = isLessonDone(course.id, lesson.number);
      const card = el(
        '<div class="card lesson-card">' +
          '<div><h3>Lektion ' + lesson.number + '</h3><p>' + escapeHtml(lesson.title) + "</p></div>" +
          '<span class="badge ' + (done ? "" : "todo") + '">' + (done ? "Erledigt" : "Offen") + "</span>" +
        "</div>"
      );
      card.addEventListener("click", () => {
        state.view = "lesson";
        state.lessonNumber = lesson.number;
        state.tab = "summary";
        resetQuizState();
        resetFlashcardState();
        resetExerciseState();
        render();
      });
      grid.appendChild(card);
    });
    mainContent.appendChild(grid);
  }

  function renderLesson(course, lesson) {
    mainContent.innerHTML = "";
    if (!course || !lesson) {
      mainContent.appendChild(el('<div class="empty-state">Lektion nicht gefunden.</div>'));
      return;
    }

    const tabs = el('<div class="tabs"></div>');
    const tabDefs = [
      { key: "summary", label: "Zusammenfassung" },
      { key: "podcast", label: "🎧 Podcast" },
      { key: "quiz", label: "Quiz" },
      { key: "flashcards", label: "Karteikarten" },
      { key: "exercises", label: "Übungen" }
    ];
    tabDefs.forEach((t) => {
      const btn = el(
        '<button class="tab-btn ' + (state.tab === t.key ? "active" : "") + '">' + t.label + "</button>"
      );
      btn.addEventListener("click", () => {
        state.tab = t.key;
        render();
      });
      tabs.appendChild(btn);
    });
    mainContent.appendChild(tabs);

    const container = el('<div id="tab-content"></div>');
    mainContent.appendChild(container);

    if (state.tab === "summary") renderSummary(container, lesson);
    else if (state.tab === "podcast") renderPodcast(container, course, lesson);
    else if (state.tab === "quiz") renderQuiz(container, course, lesson);
    else if (state.tab === "flashcards") renderFlashcards(container, lesson);
    else if (state.tab === "exercises") renderExercises(container, lesson);
  }

  // ---------- Podcast ----------

  function renderPodcast(container, course, lesson) {
    const card = el(
      '<div class="card">' +
        "<h4>🎧 Podcast: Lektion " + lesson.number + "</h4>" +
        '<p style="color:var(--text-muted);margin:8px 0 16px;">Lässt sich die Zusammenfassung dieser Lektion vorlesen.</p>' +
        '<p id="podcast-status">Lädt…</p>' +
        '<audio id="podcast-audio" controls style="width:100%;display:none;"></audio>' +
      "</div>"
    );
    container.appendChild(card);

    const statusEl = card.querySelector("#podcast-status");
    const audioEl = card.querySelector("#podcast-audio");

    loadPodcastUrl(course.id, lesson.number)
      .then((url) => {
        audioEl.src = url;
        audioEl.style.display = "block";
        statusEl.style.display = "none";
      })
      .catch(() => {
        statusEl.textContent = "Kein Podcast für diese Lektion verfügbar.";
      });
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str == null ? "" : String(str);
    return d.innerHTML;
  }

  // ---------- Summary ----------

  function renderSummary(container, lesson) {
    if (!lesson.sections || lesson.sections.length === 0) {
      container.appendChild(el('<div class="empty-state">Keine Zusammenfassung vorhanden.</div>'));
      return;
    }
    lesson.sections.forEach((sec) => {
      const block = el(
        '<div class="card section-block"><h4>' + escapeHtml(sec.heading) + "</h4><div>" + sec.html + "</div></div>"
      );
      container.appendChild(block);
    });
  }

  // ---------- Quiz ----------

  function resetQuizState() {
    state.quiz = { index: 0, correctCount: 0, answered: false, selected: null, finished: false };
  }

  function renderQuiz(container, course, lesson) {
    const quiz = lesson.quiz || [];
    if (quiz.length === 0) {
      container.appendChild(el('<div class="empty-state">Kein Quiz vorhanden.</div>'));
      return;
    }

    if (state.quiz.finished) {
      renderQuizResult(container, course, lesson, quiz);
      return;
    }

    const q = quiz[state.quiz.index];
    const card = el('<div class="card"></div>');
    card.appendChild(el('<p class="quiz-progress">Frage ' + (state.quiz.index + 1) + " von " + quiz.length + "</p>"));
    card.appendChild(el('<p class="quiz-question">' + escapeHtml(q.question) + "</p>"));

    const optionsWrap = el('<div class="quiz-options"></div>');
    q.options.forEach((opt, i) => {
      const optBtn = el('<button class="quiz-option">' + escapeHtml(opt) + "</button>");
      if (state.quiz.answered) {
        optBtn.disabled = true;
        if (i === q.correct) optBtn.classList.add("correct");
        else if (i === state.quiz.selected) optBtn.classList.add("incorrect");
      }
      optBtn.addEventListener("click", () => {
        if (state.quiz.answered) return;
        state.quiz.answered = true;
        state.quiz.selected = i;
        if (i === q.correct) state.quiz.correctCount++;
        render();
      });
      optionsWrap.appendChild(optBtn);
    });
    card.appendChild(optionsWrap);

    if (state.quiz.answered) {
      const isCorrect = state.quiz.selected === q.correct;
      const feedback = el(
        '<div class="quiz-feedback ' + (isCorrect ? "correct" : "incorrect") + '">' +
          "<strong>" + (isCorrect ? "Richtig!" : "Leider falsch.") + "</strong> " +
          escapeHtml(q.explanation || "") +
        "</div>"
      );
      card.appendChild(feedback);

      const nextBtn = el(
        '<button class="btn btn-primary btn-block" style="margin-top:16px;">' +
          (state.quiz.index + 1 < quiz.length ? "Nächste Frage" : "Ergebnis anzeigen") +
        "</button>"
      );
      nextBtn.addEventListener("click", () => {
        if (state.quiz.index + 1 < quiz.length) {
          state.quiz.index++;
          state.quiz.answered = false;
          state.quiz.selected = null;
        } else {
          state.quiz.finished = true;
          saveProgress(course.id, lesson.number);
        }
        render();
      });
      card.appendChild(nextBtn);
    }

    container.appendChild(card);
  }

  function renderQuizResult(container, course, lesson, quiz) {
    const card = el('<div class="card quiz-result"></div>');
    card.appendChild(el("<h3>Auswertung</h3>"));
    card.appendChild(el('<p class="score">' + state.quiz.correctCount + " / " + quiz.length + "</p>"));
    card.appendChild(el("<p>richtige Antworten</p>"));
    const retryBtn = el('<button class="btn btn-secondary" style="margin-top:16px;">Nochmal</button>');
    retryBtn.addEventListener("click", () => {
      resetQuizState();
      render();
    });
    card.appendChild(retryBtn);
    container.appendChild(card);
  }

  // ---------- Flashcards ----------

  function resetFlashcardState() {
    state.flashcard = { index: 0, flipped: false };
  }

  function renderFlashcards(container, lesson) {
    const cards = lesson.flashcards || [];
    if (cards.length === 0) {
      container.appendChild(el('<div class="empty-state">Keine Karteikarten vorhanden.</div>'));
      return;
    }
    if (state.flashcard.index >= cards.length) state.flashcard.index = 0;
    const item = cards[state.flashcard.index];

    const wrap = el('<div class="flashcard-wrap"></div>');
    const cardEl = el(
      '<div class="flashcard' + (state.flashcard.flipped ? " flipped" : "") + '">' +
        '<div class="flashcard-inner">' +
          '<div class="flashcard-face flashcard-front">' + escapeHtml(item.front) + "</div>" +
          '<div class="flashcard-face flashcard-back">' + escapeHtml(item.back) + "</div>" +
        "</div>" +
      "</div>"
    );
    cardEl.addEventListener("click", () => {
      state.flashcard.flipped = !state.flashcard.flipped;
      render();
    });
    wrap.appendChild(cardEl);

    const nav = el('<div class="flashcard-nav"></div>');
    const prevBtn = el('<button class="btn btn-secondary">← Zurück</button>');
    prevBtn.disabled = state.flashcard.index === 0;
    prevBtn.addEventListener("click", () => {
      if (state.flashcard.index > 0) {
        state.flashcard.index--;
        state.flashcard.flipped = false;
        render();
      }
    });
    const counter = el(
      '<span class="flashcard-counter">' + (state.flashcard.index + 1) + " / " + cards.length + "</span>"
    );
    const nextBtn = el('<button class="btn btn-secondary">Weiter →</button>');
    nextBtn.disabled = state.flashcard.index === cards.length - 1;
    nextBtn.addEventListener("click", () => {
      if (state.flashcard.index < cards.length - 1) {
        state.flashcard.index++;
        state.flashcard.flipped = false;
        render();
      }
    });
    nav.appendChild(prevBtn);
    nav.appendChild(counter);
    nav.appendChild(nextBtn);
    wrap.appendChild(nav);

    container.appendChild(wrap);
  }

  // ---------- Exercises ----------

  function resetExerciseState() {
    state.exercise = { index: 0, checked: false, correct: null };
  }

  function normalize(str) {
    return String(str || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function renderExercises(container, lesson) {
    const exercises = lesson.exercises || [];
    if (exercises.length === 0) {
      container.appendChild(el('<div class="empty-state">Keine Übungen vorhanden.</div>'));
      return;
    }
    if (state.exercise.index >= exercises.length) state.exercise.index = 0;
    const ex = exercises[state.exercise.index];

    const card = el('<div class="card"></div>');
    card.appendChild(el('<p class="quiz-progress">Übung ' + (state.exercise.index + 1) + " von " + exercises.length + "</p>"));
    card.appendChild(el('<div class="exercise-task">' + ex.task + "</div>"));

    const form = el('<div class="exercise-form"></div>');
    const sollWrap = el("<div></div>");
    sollWrap.appendChild(el("<label>Soll-Konto</label>"));
    const sollInput = el('<input type="text" id="soll-input" placeholder="z. B. Kasse">');
    sollWrap.appendChild(sollInput);
    form.appendChild(sollWrap);

    const habenWrap = el("<div></div>");
    habenWrap.appendChild(el("<label>Haben-Konto</label>"));
    const habenInput = el('<input type="text" id="haben-input" placeholder="z. B. Bank">');
    habenWrap.appendChild(habenInput);
    form.appendChild(habenWrap);

    const amountWrap = el("<div></div>");
    amountWrap.appendChild(el("<label>Betrag</label>"));
    const amountInput = el('<input type="text" id="amount-input" placeholder="z. B. 1.190 €">');
    amountWrap.appendChild(amountInput);
    form.appendChild(amountWrap);

    const checkBtn = el('<button class="btn btn-primary btn-block">Lösung prüfen</button>');
    checkBtn.addEventListener("click", () => {
      const sollOk = normalize(sollInput.value) === normalize(ex.soll);
      const habenOk = normalize(habenInput.value) === normalize(ex.haben);
      const amountOk = normalize(amountInput.value) === normalize(ex.amount);
      state.exercise.checked = true;
      state.exercise.correct = sollOk && habenOk && amountOk;
      render();
    });
    form.appendChild(checkBtn);
    card.appendChild(form);

    if (state.exercise.checked) {
      const box = el(
        '<div class="solution-box ' + (state.exercise.correct ? "" : "wrong") + '">' +
          "<h4>" + (state.exercise.correct ? "Richtig gelöst!" : "Musterlösung") + "</h4>" +
          "<p><strong>Soll:</strong> " + escapeHtml(ex.soll) + "</p>" +
          "<p><strong>Haben:</strong> " + escapeHtml(ex.haben) + "</p>" +
          "<p><strong>Betrag:</strong> " + escapeHtml(ex.amount) + "</p>" +
          (ex.solutionNote ? "<p>" + escapeHtml(ex.solutionNote) + "</p>" : "") +
        "</div>"
      );
      card.appendChild(box);
    }

    const nav = el('<div style="display:flex;gap:12px;margin-top:16px;"></div>');
    const prevBtn = el('<button class="btn btn-secondary">← Vorherige</button>');
    prevBtn.disabled = state.exercise.index === 0;
    prevBtn.addEventListener("click", () => {
      if (state.exercise.index > 0) {
        state.exercise.index--;
        state.exercise.checked = false;
        state.exercise.correct = null;
        render();
      }
    });
    const nextBtn = el('<button class="btn btn-secondary">Nächste →</button>');
    nextBtn.disabled = state.exercise.index === exercises.length - 1;
    nextBtn.addEventListener("click", () => {
      if (state.exercise.index < exercises.length - 1) {
        state.exercise.index++;
        state.exercise.checked = false;
        state.exercise.correct = null;
        render();
      }
    });
    nav.appendChild(prevBtn);
    nav.appendChild(nextBtn);
    card.appendChild(nav);

    container.appendChild(card);
  }
})();
